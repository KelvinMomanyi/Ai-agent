import {
  data as json,
  useFetcher,
  useLoaderData,
  useRevalidator,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from "react-router";
import {
  Page,
  Card,
  BlockStack,
  Text,
  Button,
  Select,
  TextField,
  Banner,
  InlineStack,
} from "@shopify/polaris";
import { useState, useEffect } from "react";
import { Prisma } from "@prisma/client";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getThemeSummary } from "../models/themeCompatibility.server";
import { getAppSettings } from "../models/settings.server";
import { getAdminOfferPreview } from "../models/offerPreview.server";
import { issueThemePreview } from "../models/themePreview.server";
import { redis } from "../redis.server";
import { ThemeTestButton } from "../components/ThemeTestButton";
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const [summary, settings] = await Promise.all([
    getThemeSummary(session.shop),
    getAppSettings(session.shop),
  ]);
  return json({
    summary,
    settings: {
      preference: settings.placementPreference,
      accent: settings.recommendationAccentColor || "",
      radius: settings.recommendationRadius?.toString() || "",
      font: settings.recommendationFont,
    },
  });
};
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  if (intent === "preview") {
    let preview = await getAdminOfferPreview(session.shop);
    if (!preview.products.length) {
      for (const source of (preview.sources || [])
        .filter((row) => row.id !== preview.source?.id)
        .slice(0, 3)) {
        const candidate = await getAdminOfferPreview(session.shop, source.id);
        if (candidate.source && candidate.products.length) {
          preview = candidate;
          break;
        }
      }
    }
    if (!preview.source || !preview.products.length)
      return json(
        {
          error:
            "No eligible preview pair is available yet. Check catalog readiness and pairings, then retry.",
        },
        { status: 400 },
      );
    const token = issueThemePreview(session.shop, preview.source.id);
    const url = new URL(
      `/products/${encodeURIComponent(preview.source.handle)}`,
      `https://${session.shop}`,
    );
    url.searchParams.set("aovboost_preview", token);
    return json({ previewUrl: url.toString() });
  }
  if (intent === "reset") {
    const themeId = String(form.get("themeId"));
    if (!/^(?:\d{1,20}|unknown)$/.test(themeId))
      return json({ error: "Invalid theme" }, { status: 400 });
    await prisma.$transaction([
      prisma.themeReport.deleteMany({
        where: { shop: session.shop, themeId, kind: "display" },
      }),
      prisma.themeProfile.updateMany({
        where: { shop: session.shop, themeId },
        data: {
          status: "learning",
          strategy: "native_drawer",
          selectors: Prisma.DbNull,
          lastVerifiedAt: null,
        },
      }),
    ]);
    return json({ ok: true });
  }
  const preference = String(form.get("preference")),
    accent = String(form.get("accent") || ""),
    radius = String(form.get("radius") || ""),
    font = String(form.get("font"));
  if (
    intent !== "save" ||
    !["auto", "cart_drawer", "cart_page", "floating_card", "off"].includes(
      preference,
    ) ||
    (accent && !/^#[\da-f]{6}$/i.test(accent)) ||
    (radius && (!/^\d{1,2}$/.test(radius) || Number(radius) > 24)) ||
    !["inherit", "system"].includes(font)
  )
    return json(
      {
        error:
          "Choose a valid placement, six-digit hex color and radius between 0 and 24.",
      },
      { status: 400 },
    );
  await getAppSettings(session.shop);
  await prisma.appSettings.updateMany({
    where: { shop: session.shop },
    data: {
      placementPreference: preference,
      recommendationAccentColor: accent || null,
      recommendationRadius: radius ? Number(radius) : null,
      recommendationFont: font,
    },
  });
  await redis.del(`settings:${session.shop}`);
  return json({ ok: true });
};
export const placementLabel = (strategy: string) =>
  ({
    native_drawer: "Cart drawer",
    cart_page: "Cart page",
    floating_card: "Floating card",
    none: "Paused",
  })[strategy] || "Learning";
export function themeFix(result: any): string {
  if (result?.reason === "placement_disabled")
    return "Cart placement is off or paused. Enable a placement or reset compatibility learning before testing.";
  if (result?.verified)
    return "The test card passed display checks. Normal sessions still need to confirm compatibility.";
  if (result?.cartUi === "page_redirect")
    return "Your theme redirects to the cart; offers can appear after the cart items.";
  if (result?.reason === "test_add_unconfirmed")
    return "Check the product's Add to cart form, then run another test.";
  if (result?.cartUi === "popup_notification")
    return "Your theme shows a cart notification. A floating offer waits for it to close.";
  return "A display could not be verified. Try Cart page only or check that the AOVBoost embed is enabled.";
}
export default function ThemeCompatibility() {
  const { summary, settings } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  useEffect(() => {
    const refresh = () => revalidator.revalidate();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [revalidator]);
  const [preference, setPreference] = useState(settings.preference),
    [accent, setAccent] = useState(settings.accent),
    [radius, setRadius] = useState(settings.radius),
    [font, setFont] = useState(settings.font);
  const profile = summary.profile;
  const displayStrategy =
    profile?.status === "disabled" || settings.preference === "off"
      ? "none"
      : settings.preference === "auto"
        ? profile?.strategy || "native_drawer"
        : settings.preference === "cart_drawer"
          ? "native_drawer"
          : settings.preference;
  const preview = summary.lastPreview?.lastPreviewResult as any;
  return (
    <Page
      title="Theme compatibility"
      backAction={{ content: "Home", url: "/app" }}
    >
      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingMd">
            {profile?.themeName || "Waiting for a storefront visit"}
          </Text>
          <Text as="p">
            {profile
              ? `${profile.status === "verified" ? "Verified by multiple storefront sessions" : profile.status === "disabled" ? "Offers paused after repeated display failures" : profile.status === "degraded" ? "Using a safer placement after repeated failures" : "Learning how your cart works"}. Starting placement: ${placementLabel(displayStrategy)}.`
              : "Open your storefront with the app embed enabled to detect the theme."}
          </Text>
          <Text as="p">
            {summary.verifiedRate === null
              ? "No display attempts in the last seven days."
              : `${Math.round(summary.verifiedRate * 100)}% verified display rate across ${summary.sample} recent offer attempts in the last seven days.`}
          </Text>
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="save" />
            <BlockStack gap="300">
              <Select
                label="Cart recommendation placement"
                name="preference"
                value={preference}
                onChange={setPreference}
                options={[
                  { label: "Auto", value: "auto" },
                  { label: "Cart drawer", value: "cart_drawer" },
                  { label: "Cart page only", value: "cart_page" },
                  { label: "Floating card", value: "floating_card" },
                  { label: "Off", value: "off" },
                ]}
              />
              <Text as="p" tone="subdued">
                Cart drawer uses a safe fallback if a drawer placement cannot be
                verified. Floating cards wait for native dialogs to close.
              </Text>
              <TextField
                label="Accent color (optional)"
                name="accent"
                value={accent}
                onChange={setAccent}
                autoComplete="off"
                placeholder="#171717"
              />
              <TextField
                label="Corner radius, pixels (optional)"
                name="radius"
                value={radius}
                onChange={setRadius}
                type="number"
                min={0}
                max={24}
                autoComplete="off"
              />
              <Select
                label="Font"
                name="font"
                value={font}
                onChange={setFont}
                options={[
                  { label: "Inherit store font", value: "inherit" },
                  { label: "System font", value: "system" },
                ]}
              />
              {fetcher.data && "error" in fetcher.data ? (
                <Banner tone="critical">{fetcher.data.error}</Banner>
              ) : null}
              {fetcher.data && "ok" in fetcher.data ? (
                <Banner tone="success">Preferences saved.</Banner>
              ) : null}
              <Button
                submit
                variant="primary"
                loading={fetcher.state !== "idle"}
              >
                Save preferences
              </Button>
            </BlockStack>
          </fetcher.Form>
          <InlineStack gap="300">
            <ThemeTestButton />
            {profile ? (
              <fetcher.Form method="post">
                <input type="hidden" name="intent" value="reset" />
                <input type="hidden" name="themeId" value={profile.themeId} />
                <Button submit>Reset compatibility learning</Button>
              </fetcher.Form>
            ) : null}
          </InlineStack>
          <Text as="p" tone="subdued">
            The test opens your store and asks you to run one native add. That
            item stays in your cart. Preview activity is excluded from shopper
            analytics.
          </Text>
          {preview ? (
            <Banner tone={preview.verified ? "success" : "warning"}>
              {themeFix(preview)}
            </Banner>
          ) : null}
        </BlockStack>
      </Card>
    </Page>
  );
}
