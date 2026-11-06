import { useEffect, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import {
  data as json,
  Form,
  Link,
  useFetcher,
  useLoaderData,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  InlineStack,
  Layout,
  Page,
  Text,
  TextField,
  Select,
  Thumbnail,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { generatePairingSuggestions } from "../jobs/pairingSuggestions.server";
import {
  bulkApprovePairings,
  changeRelationshipStatus,
  pairingAdminData,
  PairingAdminError,
  removePairingExclusion,
  saveMerchantPair,
  undoPairingRejection,
} from "../models/productRelationships.server";
import prisma from "../db.server";
import { getAppSettings } from "../models/settings.server";
import { markPairingPolicyDirty } from "../jobs/pairingAutopilot.server";
import { redis } from "../redis.server";
import {
  PAIRING_BATCH_SIZE,
  HIGH_CONFIDENCE_PAIRING,
} from "../models/productPairings";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const search = (url.searchParams.get("q") || "").slice(0, 80);
  return json({
    ...(await pairingAdminData(
      session.shop,
      url.searchParams.get("source") || undefined,
      search,
    )),
    search,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  try {
    const intent = String(form.get("intent") || "");
    if (intent === "acknowledgeAutopilot") {
      await getAppSettings(session.shop);
      await prisma.appSettings.updateMany({
        where: { shop: session.shop },
        data: { pairingOnboardingSeenAt: new Date() },
      });
      return json({
        ok: true,
        message: "Pairing preferences are available in Product pairings.",
      });
    }
    if (intent === "policy") {
      const pairingMode = String(form.get("pairingMode")),
        pairingStrictness = String(form.get("pairingStrictness")),
        verticalPreset = String(form.get("verticalPreset"));
      const pairingSensitiveKeywords = [
        ...new Set(
          String(form.get("sensitiveKeywords") || "")
            .split(/[,\n]/)
            .map((word) => word.trim())
            .filter(Boolean),
        ),
      ];
      if (
        !["autopilot", "review_first", "off"].includes(pairingMode) ||
        !["cautious", "balanced", "broad"].includes(pairingStrictness) ||
        !["generic", "beauty_haircare"].includes(verticalPreset) ||
        pairingSensitiveKeywords.length > 30 ||
        pairingSensitiveKeywords.some((word) => word.length > 80)
      )
        throw new PairingAdminError(
          "Choose valid pairing preferences and at most 30 sensitive phrases (80 characters each).",
        );
      await prisma.appSettings.upsert({
        where: { shop: session.shop },
        create: {
          shop: session.shop,
          pairingMode,
          pairingStrictness,
          verticalPreset,
          pairingSensitiveKeywords,
        },
        update: {
          pairingMode,
          pairingStrictness,
          verticalPreset,
          pairingSensitiveKeywords,
        },
      });
      await Promise.all([
        redis.del(`settings:${session.shop}`),
        redis.del(`public-settings:${session.shop}`),
      ]);
      await markPairingPolicyDirty(session.shop);
      return json({
        ok: true,
        message:
          "Pairing preferences saved. Safe pairings refresh in bounded background batches.",
      });
    }
    if (intent === "generate") {
      let raw: unknown;
      try {
        raw = JSON.parse(String(form.get("sourceProductIds") || "[]"));
      } catch {
        throw new PairingAdminError("Select products to generate suggestions.");
      }
      if (
        !Array.isArray(raw) ||
        raw.length > 50 ||
        raw.some(
          (id) =>
            typeof id !== "string" ||
            !/^gid:\/\/shopify\/Product\/\d+$/.test(id),
        )
      )
        throw new PairingAdminError("Invalid product selection.");
      const ids = Array.from(new Set(raw as string[]));
      const batch = ids.slice(0, PAIRING_BATCH_SIZE);
      const result = await generatePairingSuggestions(
        session.shop,
        batch,
        request.signal,
      );
      const remainingSourceIds = ids.slice(PAIRING_BATCH_SIZE);
      const total = Math.max(
        ids.length,
        Math.min(50, Number(form.get("total")) || ids.length),
      );
      return json({
        ok: true,
        generated: true,
        remainingSourceIds,
        total,
        done: total - remainingSourceIds.length,
        suggested: result.suggested,
      });
    }
    if (intent === "bulkApprove") {
      const count = await bulkApprovePairings(session.shop);
      return json({
        ok: true,
        message: `${count} high-confidence suggestions approved.`,
      });
    }
    const id = String(form.get("relationshipId") || "");
    if (intent === "undoReject") {
      await undoPairingRejection(session.shop, id);
      return json({ ok: true, message: "Rejection undone." });
    }
    if (intent === "approve" || intent === "reject") {
      await changeRelationshipStatus(
        session.shop,
        id,
        intent === "approve" ? "approved" : "rejected",
      );
      if (intent === "reject")
        return json({
          ok: true,
          message: "Pairing rejected and removed from recommendations.",
          undoId: id,
        });
    } else if (intent === "removeExclusion") {
      await removePairingExclusion(session.shop, id);
    } else if (
      intent === "add" ||
      intent === "replace" ||
      intent === "exclude"
    ) {
      await saveMerchantPair({
        shop: session.shop,
        sourceProductId: String(form.get("sourceProductId") || ""),
        targetProductId: String(form.get("targetProductId") || ""),
        replaceId: intent === "replace" ? id : undefined,
        exclude: intent === "exclude",
        reason: String(form.get("reason") || "") || undefined,
      });
    } else throw new PairingAdminError("Unknown pairing action.");
    return json({ ok: true, message: "Pairing updated." });
  } catch (error) {
    if (error instanceof PairingAdminError)
      return json(
        { ok: false, error: error.message },
        { status: error.status },
      );
    console.error("AOVBoost pairing setup action failed", {
      shop: session.shop,
    });
    return json(
      { ok: false, error: "Pairings could not be saved. Please retry." },
      { status: 503 },
    );
  }
};

type ActionResult = {
  ok?: boolean;
  error?: string;
  message?: string;
  generated?: boolean;
  remainingSourceIds?: string[];
  total?: number;
  done?: number;
  undoId?: string;
};
const NO_SOURCE_IDS: string[] = [];
const statusLabel = (status: string) =>
  (
    ({
      suggested: "Needs review",
      approved: "Merchant approved",
      auto_approved: "Autopilot live",
      rejected: "Rejected",
      demoted: "Demoted",
    }) as Record<string, string>
  )[status] || "Saved for later";

export default function Pairings() {
  const data = useLoaderData<typeof loader>();
  const generator = useFetcher<ActionResult>();
  const editor = useFetcher<ActionResult>();
  const shopify = useAppBridge();
  const [search, setSearch] = useState(data.search);
  const [paused, setPaused] = useState(false);
  const [pickerError, setPickerError] = useState("");
  const [mode, setMode] = useState<string>(data.mode);
  const [strictness, setStrictness] = useState<string>(data.strictness);
  const [preset, setPreset] = useState<string>(data.preset);
  const [sensitiveKeywords, setSensitiveKeywords] = useState(
    data.sensitiveKeywords.join(", "),
  );
  const remaining = generator.data?.remainingSourceIds || NO_SOURCE_IDS;
  const generating =
    generator.state !== "idle" ||
    (!paused && remaining.length > 0 && generator.data?.ok);
  useEffect(() => {
    if (
      generator.state !== "idle" ||
      paused ||
      !generator.data?.ok ||
      !remaining.length
    )
      return;
    const timer = window.setTimeout(
      () =>
        generator.submit(
          {
            intent: "generate",
            sourceProductIds: JSON.stringify(remaining),
            total: String(generator.data?.total || remaining.length),
          },
          { method: "post" },
        ),
      600,
    );
    return () => window.clearTimeout(timer);
  }, [generator, remaining, paused]);
  const generate = (ids: string[]) => {
    setPaused(false);
    generator.submit(
      {
        intent: "generate",
        sourceProductIds: JSON.stringify(ids),
        total: String(ids.length),
      },
      { method: "post" },
    );
  };
  const edit = (
    intent: string,
    row?:
      (typeof data.relationships)[number] | (typeof data.reviewQueue)[number],
  ) =>
    editor.submit(
      {
        intent,
        relationshipId: row?.id || "",
        sourceProductId: row?.sourceProductId || data.source?.id || "",
        targetProductId: row?.target.id || "",
      },
      { method: "post" },
    );
  const pickTarget = async (
    replaceId?: string,
    sourceProductId = data.source?.id,
  ) => {
    setPickerError("");
    try {
      const selection = await shopify.resourcePicker({
        type: "product",
        action: "select",
        multiple: false,
        filter: { variants: false },
      });
      const target = selection?.[0];
      if (target && sourceProductId)
        editor.submit(
          {
            intent: replaceId ? "replace" : "add",
            relationshipId: replaceId || "",
            sourceProductId,
            targetProductId: target.id,
          },
          { method: "post" },
        );
    } catch {
      setPickerError(
        "The product picker could not open. Try again inside Shopify admin.",
      );
    }
  };
  return (
    <Page
      title="Product pairings"
      backAction={{ content: "Home", url: "/app" }}
      primaryAction={{
        content: "Refresh pairings for top products",
        disabled:
          Boolean(generating) ||
          !data.generationSourceIds.length ||
          data.mode === "off",
        onAction: () => generate(data.generationSourceIds),
      }}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text
                as="h2"
                variant="headingMd"
              >{`Autopilot paired ${data.coverage.autopilot} of your top ${data.coverage.total} products. ${data.attentionCount} pairings need your attention.`}</Text>
              <Text as="p" tone="subdued">
                Safe, confident pairs can go live automatically in Autopilot.
                Sensitive or uncertain pairs stay for review. Merchant choices,
                exclusions and current availability take precedence. Coverage is
                not a sales prediction.
              </Text>
              <InlineStack gap="200">
                <Badge>
                  {data.preset === "beauty_haircare"
                    ? "Beauty & haircare"
                    : "Generic"}
                </Badge>
                <Button url="/app/settings">Change preset</Button>
                <Button
                  onClick={() => edit("bulkApprove")}
                  loading={editor.state !== "idle"}
                >
                  Approve high-confidence suggestions
                </Button>
              </InlineStack>
              <Text as="p" tone="subdued">
                {data.coverage.merchant} top products have merchant-approved
                pairs; {data.coverage.autopilot} have autopilot pairs. High
                confidence reflects catalog evidence, not a guaranteed
                acceptance rate.
              </Text>
              <editor.Form method="post">
                <BlockStack gap="200">
                  <input type="hidden" name="intent" value="policy" />
                  <Select
                    label="Pairing mode"
                    name="pairingMode"
                    options={[
                      { label: "Autopilot", value: "autopilot" },
                      { label: "Review first", value: "review_first" },
                      { label: "Off", value: "off" },
                    ]}
                    value={mode}
                    onChange={setMode}
                  />
                  <Select
                    label="Strictness"
                    name="pairingStrictness"
                    options={[
                      { label: "Cautious", value: "cautious" },
                      { label: "Balanced", value: "balanced" },
                      { label: "Broad", value: "broad" },
                    ]}
                    value={strictness}
                    onChange={setStrictness}
                  />
                  <Select
                    label="Store preset"
                    name="verticalPreset"
                    options={[
                      { label: "Generic", value: "generic" },
                      { label: "Beauty & haircare", value: "beauty_haircare" },
                    ]}
                    value={preset}
                    onChange={setPreset}
                  />
                  <TextField
                    label="Additional sensitive phrases"
                    name="sensitiveKeywords"
                    value={sensitiveKeywords}
                    onChange={setSensitiveKeywords}
                    autoComplete="off"
                    helpText="Comma-separated phrases that must always be reviewed. These extend the built-in safety list."
                  />
                  <Button submit loading={editor.state !== "idle"}>
                    Save pairing preferences
                  </Button>
                </BlockStack>
              </editor.Form>
              {generator.data?.done ? (
                <Text as="p">{`Checked ${generator.data.done} of ${generator.data.total} products. Suggestions are saved after each batch.`}</Text>
              ) : null}
              {generating ? (
                <Button onClick={() => setPaused(true)}>
                  Pause generation
                </Button>
              ) : paused && remaining.length ? (
                <Button onClick={() => setPaused(false)}>
                  Resume generation
                </Button>
              ) : null}
              {generator.data?.error || editor.data?.error || pickerError ? (
                <Banner tone="critical">
                  {generator.data?.error || editor.data?.error || pickerError}
                </Banner>
              ) : null}
              {editor.data?.message ? (
                <Banner tone="success">{editor.data.message}</Banner>
              ) : null}
              {editor.data?.undoId ? (
                <Button
                  onClick={() =>
                    editor.submit(
                      {
                        intent: "undoReject",
                        relationshipId: editor.data!.undoId!,
                      },
                      { method: "post" },
                    )
                  }
                  disabled={editor.state !== "idle"}
                >
                  Undo rejection
                </Button>
              ) : null}
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Review by exception
              </Text>
              <Text as="p" tone="subdued">
                Highest recent product traffic first, then lowest confidence. Up
                to 100 flagged pairs are shown.
              </Text>
              {data.reviewQueue.length ? (
                data.reviewQueue.map((row) => (
                  <Card key={row.id}>
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingSm">
                        {row.sourceTitle} → {row.target.title}
                      </Text>
                      <InlineStack gap="200">
                        <Badge>
                          {row.status === "approved" ||
                          row.origin === "merchant"
                            ? "Merchant"
                            : "Autopilot"}
                        </Badge>
                        <Badge>{statusLabel(row.status)}</Badge>
                      </InlineStack>
                      <Text as="p">Why: {row.why}</Text>
                      <Text as="p" tone="subdued">
                        {row.views} recorded product views in 14 days ·
                        Confidence score {row.confidence.toFixed(2)} (not an
                        acceptance probability)
                      </Text>
                      <InlineStack gap="200">
                        <Button
                          onClick={() => edit("approve", row)}
                          disabled={editor.state !== "idle"}
                        >
                          Approve
                        </Button>
                        <Button
                          onClick={() => edit("reject", row)}
                          disabled={editor.state !== "idle"}
                        >
                          Reject
                        </Button>
                        <Button
                          onClick={() =>
                            pickTarget(row.id, row.sourceProductId)
                          }
                          disabled={editor.state !== "idle"}
                        >
                          Replace
                        </Button>
                        <Button
                          onClick={() => edit("exclude", row)}
                          disabled={editor.state !== "idle"}
                        >
                          Exclude this product
                        </Button>
                      </InlineStack>
                    </BlockStack>
                  </Card>
                ))
              ) : (
                <Text as="p">
                  No flagged pairs need review in your top products.
                </Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Form method="get">
                <BlockStack gap="200">
                  <TextField
                    label="Search products"
                    name="q"
                    value={search}
                    onChange={setSearch}
                    autoComplete="off"
                  />
                  <Button submit>Search</Button>
                </BlockStack>
              </Form>
              {data.products.map((product) => (
                <BlockStack key={product.id} gap="100">
                  <Link
                    to={`/app/pairings?source=${encodeURIComponent(product.id)}&q=${encodeURIComponent(data.search)}`}
                  >
                    {product.title}
                  </Link>
                  <Text
                    as="p"
                    tone="subdued"
                  >{`${product.orderCount} recorded orders`}</Text>
                </BlockStack>
              ))}
              {!data.products.length ? (
                <Text as="p">
                  No synced products match. Sync your catalog on Home or change
                  the search.
                </Text>
              ) : null}
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section>
          {data.source ? (
            <Card>
              <BlockStack gap="400">
                <Text
                  as="h2"
                  variant="headingMd"
                >{`Add-ons for ${data.source.title}`}</Text>
                <InlineStack gap="200">
                  <Button
                    onClick={() => pickTarget()}
                    disabled={editor.state !== "idle"}
                  >
                    Add an approved pairing
                  </Button>
                  <Button
                    disabled={Boolean(generating)}
                    onClick={() => generate([data.source!.id])}
                  >
                    Suggest for this product
                  </Button>
                </InlineStack>
                {data.relationships.map((row) => (
                  <Card key={row.id}>
                    <BlockStack gap="200">
                      <InlineStack gap="200" blockAlign="center">
                        {row.target.imageUrl ? (
                          <Thumbnail
                            source={row.target.imageUrl}
                            alt={row.target.title}
                          />
                        ) : null}
                        <Text as="h3" variant="headingSm">
                          {row.target.title}
                        </Text>
                        <Badge
                          tone={
                            row.kind === "exclude"
                              ? "critical"
                              : row.status === "approved"
                                ? "success"
                                : "info"
                          }
                        >
                          {row.kind === "exclude"
                            ? "Excluded"
                            : statusLabel(row.status)}
                        </Badge>
                        <Badge>
                          {row.status === "approved" ||
                          row.origin === "merchant"
                            ? "Merchant"
                            : "Autopilot"}
                        </Badge>
                        {row.status === "suggested" &&
                        row.confidence >= HIGH_CONFIDENCE_PAIRING ? (
                          <Badge tone="attention">Strong evidence</Badge>
                        ) : null}
                      </InlineStack>
                      <Text as="p">Why: {row.why}</Text>
                      {row.kind === "upgrade" ? (
                        <Text as="p" tone="subdued">
                          Upgrade relationships are saved for later; they do not
                          perform cart replacements.
                        </Text>
                      ) : null}
                      <InlineStack gap="200">
                        {row.kind === "exclude" ? (
                          <Button
                            onClick={() => edit("removeExclusion", row)}
                            disabled={editor.state !== "idle"}
                          >
                            Remove exclusion
                          </Button>
                        ) : (
                          <>
                            {row.status !== "approved" ? (
                              <Button
                                onClick={() => edit("approve", row)}
                                disabled={editor.state !== "idle"}
                              >
                                Approve
                              </Button>
                            ) : null}
                            {row.status !== "rejected" ? (
                              <Button
                                onClick={() => edit("reject", row)}
                                disabled={editor.state !== "idle"}
                              >
                                Reject
                              </Button>
                            ) : null}
                            {row.status === "rejected" ? (
                              <Button
                                onClick={() => edit("undoReject", row)}
                                disabled={editor.state !== "idle"}
                              >
                                Undo rejection
                              </Button>
                            ) : null}
                            <Button
                              onClick={() => pickTarget(row.id)}
                              disabled={editor.state !== "idle"}
                            >
                              Replace
                            </Button>
                            <Button
                              onClick={() => edit("exclude", row)}
                              disabled={editor.state !== "idle"}
                            >{`Exclude for ${data.source!.title}`}</Button>
                          </>
                        )}
                      </InlineStack>
                    </BlockStack>
                  </Card>
                ))}
                {!data.relationships.length ? (
                  <Text as="p">
                    Generate suggestions or choose an approved add-on.
                    Suggestions can be generated before any shoppers visit your
                    store.
                  </Text>
                ) : null}
              </BlockStack>
            </Card>
          ) : (
            <Banner tone="info">
              Choose a synced source product to review its pairings.
            </Banner>
          )}
        </Layout.Section>
      </Layout>
    </Page>
  );
}
