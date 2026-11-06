import { useState } from "react";
import {
  data as json,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  useActionData,
  useLoaderData,
  useNavigation,
  useSubmit,
} from "react-router";
import {
  Page,
  Layout,
  Text,
  Card,
  BlockStack,
  TextField,
  FormLayout,
  Banner,
  Select,
  Checkbox,
  InlineStack,
  Badge,
  Button,
} from "@shopify/polaris";
import { ResourcePickerField } from "../components/ResourcePickerField";
import { normalizeVerticalPreset } from "../models/productPairings";
import { authenticate } from "../shopify.server";
import { markPairingPolicyDirty } from "../jobs/pairingAutopilot.server";
import prisma from "../db.server";
import { redis } from "../redis.server";

const aiToneOptions = [
  { label: "Friendly", value: "friendly" },
  { label: "Professional", value: "professional" },
  { label: "Witty & Playful", value: "witty" },
  { label: "Enthusiastic", value: "enthusiastic" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const config = await prisma.appSettings.findUnique({
    where: { shop: session.shop },
  });

  return json({
    providers: {
      Gemini: Boolean(process.env.GOOGLE_API_KEY),
      Mistral: Boolean(process.env.MISTRAL_API_KEY),
      Groq: Boolean(process.env.GROQ_API_KEY),
      DeepSeek: Boolean(process.env.DEEPSEEK_API_KEY),
    },
    config: config
      ? {
          holdoutEnabled: config.holdoutEnabled,
          holdoutPercent: String(config.holdoutPercent),
          focusedMode: config.focusedMode,
          verticalPreset: normalizeVerticalPreset(config.verticalPreset),
          chatEnabled: config.chatEnabled,
          chatGreeting: config.chatGreeting,
          bundlesEnabled: config.bundlesEnabled,
          upsellEnabled: config.upsellEnabled,
          discountNudgeEnabled: config.discountNudgeEnabled,
          discountThreshold: config.discountThreshold.toString(),
          exitIntentEnabled: config.exitIntentEnabled,
          postPurchaseEnabled: config.postPurchaseEnabled,
          aiTone: config.aiTone,
          brandVoice: config.brandVoice || "",
          storeKnowledge: config.storeKnowledge || "",
          blockedProductIds: config.blockedProductIds.join(", "),
          excludedCollectionIds: config.excludedCollectionIds.join(", "),
          preferredProductIds: config.preferredProductIds.join(", "),
          upsellPriorityProductIds: config.upsellPriorityProductIds.join(", "),
          proactiveMessagesEnabled: config.proactiveMessagesEnabled,
          proactiveDelaySeconds: String(config.proactiveDelaySeconds),
          maxProactivePrompts: String(config.maxProactivePrompts),
          maxProductRecommendations: String(config.maxProductRecommendations),
          minimumProactiveConfidence: String(config.minimumProactiveConfidence),
          minimumUpsellIntentScore: String(config.minimumUpsellIntentScore),
          hesitationDetectionEnabled: config.hesitationDetectionEnabled,
          discountPermission: config.discountPermission,
          allowedDiscountCodes: config.allowedDiscountCodes.join(", "),
          bundleSupportEnabled: config.bundleSupportEnabled,
          analyticsEnabled: config.analyticsEnabled,
        }
      : {
          holdoutEnabled: false,
          holdoutPercent: "10",
          focusedMode: true,
          verticalPreset: "generic" as const,
          chatEnabled: false,
          chatGreeting: "Hi! Can I help you find the perfect product?",
          bundlesEnabled: false,
          upsellEnabled: true,
          discountNudgeEnabled: false,
          discountThreshold: "50",
          exitIntentEnabled: false,
          postPurchaseEnabled: false,
          aiTone: "friendly",
          brandVoice: "",
          storeKnowledge: "",
          blockedProductIds: "",
          excludedCollectionIds: "",
          preferredProductIds: "",
          upsellPriorityProductIds: "",
          proactiveMessagesEnabled: false,
          proactiveDelaySeconds: "15",
          maxProactivePrompts: "2",
          maxProductRecommendations: "2",
          minimumProactiveConfidence: "0.65",
          minimumUpsellIntentScore: "55",
          hesitationDetectionEnabled: false,
          discountPermission: false,
          allowedDiscountCodes: "",
          bundleSupportEnabled: false,
          analyticsEnabled: true,
        },
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const rawHoldout = formData.get("holdoutEnabled");
  const holdoutEnabled = parseBoolean(rawHoldout);
  const holdoutPercent = Number(formData.get("holdoutPercent") ?? 10);
  if (
    rawHoldout !== null &&
    (!Number.isInteger(holdoutPercent) ||
      holdoutPercent < 0 ||
      holdoutPercent > 30)
  )
    return json(
      {
        success: false,
        error: "Holdout must be an integer from 0 to 30 percent.",
      },
      { status: 400 },
    );
  if (holdoutEnabled && !parseBoolean(formData.get("analyticsEnabled")))
    return json(
      { success: false, error: "Enable analytics to run holdout measurement." },
      { status: 400 },
    );
  const previousHoldout =
    rawHoldout !== null
      ? await prisma.appSettings.findUnique({
          where: { shop: session.shop },
          select: {
            holdoutEnabled: true,
            holdoutPercent: true,
            holdoutVersion: true,
          },
        })
      : null;
  const holdoutChanged =
    previousHoldout &&
    (previousHoldout.holdoutEnabled !== holdoutEnabled ||
      previousHoldout.holdoutPercent !== holdoutPercent);
  const rawFocusedMode = formData.get("focusedMode");
  const focusedOverrides =
    rawFocusedMode !== null && parseBoolean(rawFocusedMode)
      ? {
          chatEnabled: false,
          bundlesEnabled: false,
          discountNudgeEnabled: false,
          exitIntentEnabled: false,
          postPurchaseEnabled: false,
          proactiveMessagesEnabled: false,
          hesitationDetectionEnabled: false,
          bundleSupportEnabled: false,
        }
      : {};
  const rawPreset = formData.get("verticalPreset");
  if (
    rawPreset !== null &&
    !["generic", "beauty_haircare"].includes(String(rawPreset))
  ) {
    return json(
      { success: false, error: "Choose a valid catalog preset." },
      { status: 400 },
    );
  }

  const chatEnabled = parseBoolean(formData.get("chatEnabled"));
  const chatGreeting = String(formData.get("chatGreeting") || "").trim();
  const bundlesEnabled = parseBoolean(formData.get("bundlesEnabled"));
  const upsellEnabled = parseBoolean(formData.get("upsellEnabled"));
  const discountNudgeEnabled = parseBoolean(
    formData.get("discountNudgeEnabled"),
  );
  const discountThreshold = parseFloat(
    String(formData.get("discountThreshold") || "50"),
  );
  const exitIntentEnabled = parseBoolean(formData.get("exitIntentEnabled"));
  const postPurchaseEnabled = parseBoolean(formData.get("postPurchaseEnabled"));
  const aiTone = String(formData.get("aiTone") || "friendly");
  const brandVoice = String(formData.get("brandVoice") || "")
    .trim()
    .slice(0, 4_000);
  const storeKnowledge = String(formData.get("storeKnowledge") || "")
    .trim()
    .slice(0, 12_000);
  const blockedProductIdsRaw = String(formData.get("blockedProductIds") || "");
  const blockedProductIds = blockedProductIdsRaw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const excludedCollectionIds = parseCsv(formData.get("excludedCollectionIds"));
  const preferredProductIds = parseCsv(formData.get("preferredProductIds"));
  const upsellPriorityProductIds = parseCsv(
    formData.get("upsellPriorityProductIds"),
  );
  const proactiveMessagesEnabled = parseBoolean(
    formData.get("proactiveMessagesEnabled"),
  );
  const proactiveDelaySeconds = parseBoundedNumber(
    formData.get("proactiveDelaySeconds"),
    15,
    10,
    120,
  );
  const maxProactivePrompts = parseBoundedNumber(
    formData.get("maxProactivePrompts"),
    2,
    0,
    5,
  );
  const maxProductRecommendations = parseBoundedNumber(
    formData.get("maxProductRecommendations"),
    3,
    1,
    4,
  );
  const minimumProactiveConfidence = parseBoundedNumber(
    formData.get("minimumProactiveConfidence"),
    0.65,
    0,
    1,
    false,
  );
  const minimumUpsellIntentScore = parseBoundedNumber(
    formData.get("minimumUpsellIntentScore"),
    55,
    0,
    100,
  );
  const hesitationDetectionEnabled = parseBoolean(
    formData.get("hesitationDetectionEnabled"),
  );
  const discountPermission = parseBoolean(formData.get("discountPermission"));
  const allowedDiscountCodes = parseCsv(formData.get("allowedDiscountCodes"));
  const bundleSupportEnabled = parseBoolean(
    formData.get("bundleSupportEnabled"),
  );
  const analyticsEnabled = parseBoolean(formData.get("analyticsEnabled"));

  try {
    const config = await prisma.appSettings.upsert({
      where: { shop: session.shop },
      update: {
        ...(rawHoldout !== null
          ? {
              holdoutEnabled,
              holdoutPercent,
              ...(holdoutChanged ? { holdoutVersion: { increment: 1 } } : {}),
            }
          : {}),
        ...(rawPreset !== null
          ? { verticalPreset: normalizeVerticalPreset(rawPreset) }
          : {}),
        chatEnabled,
        chatGreeting,
        bundlesEnabled,
        upsellEnabled,
        discountNudgeEnabled,
        discountThreshold,
        exitIntentEnabled,
        postPurchaseEnabled,
        aiTone,
        brandVoice: brandVoice || null,
        storeKnowledge: storeKnowledge || null,
        blockedProductIds,
        excludedCollectionIds,
        preferredProductIds,
        upsellPriorityProductIds,
        proactiveMessagesEnabled,
        proactiveDelaySeconds,
        maxProactivePrompts,
        maxProductRecommendations,
        minimumProactiveConfidence,
        minimumUpsellIntentScore,
        hesitationDetectionEnabled,
        discountPermission,
        allowedDiscountCodes,
        bundleSupportEnabled,
        analyticsEnabled,
        ...(rawFocusedMode !== null
          ? { focusedMode: parseBoolean(rawFocusedMode) }
          : {}),
        ...focusedOverrides,
      },
      create: {
        pairingMode: "autopilot",
        holdoutEnabled: rawHoldout === null ? false : holdoutEnabled,
        holdoutPercent: rawHoldout === null ? 10 : holdoutPercent,
        shop: session.shop,
        verticalPreset: normalizeVerticalPreset(rawPreset),
        chatEnabled,
        chatGreeting,
        bundlesEnabled,
        upsellEnabled,
        discountNudgeEnabled,
        discountThreshold,
        exitIntentEnabled,
        postPurchaseEnabled,
        aiTone,
        brandVoice: brandVoice || null,
        storeKnowledge: storeKnowledge || null,
        blockedProductIds,
        excludedCollectionIds,
        preferredProductIds,
        upsellPriorityProductIds,
        proactiveMessagesEnabled,
        proactiveDelaySeconds,
        maxProactivePrompts,
        maxProductRecommendations,
        minimumProactiveConfidence,
        minimumUpsellIntentScore,
        hesitationDetectionEnabled,
        discountPermission,
        allowedDiscountCodes,
        bundleSupportEnabled,
        analyticsEnabled,
        focusedMode:
          rawFocusedMode === null ? true : parseBoolean(rawFocusedMode),
        ...focusedOverrides,
      },
    });

    // Invalidate cached settings
    await redis.del(`settings:${session.shop}`);
    await redis.del(`public-settings:${session.shop}`);
    await markPairingPolicyDirty(session.shop);

    return json({
      success: true,
      config: {
        ...config,
        discountThreshold: config.discountThreshold.toString(),
        blockedProductIds: config.blockedProductIds.join(", "),
        excludedCollectionIds: config.excludedCollectionIds.join(", "),
        preferredProductIds: config.preferredProductIds.join(", "),
        upsellPriorityProductIds: config.upsellPriorityProductIds.join(", "),
        allowedDiscountCodes: config.allowedDiscountCodes.join(", "),
      },
    });
  } catch (error) {
    console.error("Error saving AppSettings:", error);
    return json(
      { success: false, error: "Failed to save settings" },
      { status: 500 },
    );
  }
};

export default function Settings() {
  const { config, providers } = useLoaderData<typeof loader>();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();

  const [formState, setFormState] = useState({
    holdoutEnabled: config.holdoutEnabled,
    holdoutPercent: config.holdoutPercent,
    focusedMode: config.focusedMode,
    verticalPreset: config.verticalPreset,
    chatEnabled: config.chatEnabled,
    chatGreeting: config.chatGreeting,
    bundlesEnabled: config.bundlesEnabled,
    upsellEnabled: config.upsellEnabled,
    discountNudgeEnabled: config.discountNudgeEnabled,
    discountThreshold: config.discountThreshold,
    exitIntentEnabled: config.exitIntentEnabled,
    postPurchaseEnabled: config.postPurchaseEnabled,
    aiTone: config.aiTone,
    brandVoice: config.brandVoice,
    storeKnowledge: config.storeKnowledge,
    blockedProductIds: config.blockedProductIds,
    excludedCollectionIds: config.excludedCollectionIds,
    preferredProductIds: config.preferredProductIds,
    upsellPriorityProductIds: config.upsellPriorityProductIds,
    proactiveMessagesEnabled: config.proactiveMessagesEnabled,
    proactiveDelaySeconds: config.proactiveDelaySeconds,
    maxProactivePrompts: config.maxProactivePrompts,
    maxProductRecommendations: config.maxProductRecommendations,
    minimumProactiveConfidence: config.minimumProactiveConfidence,
    minimumUpsellIntentScore: config.minimumUpsellIntentScore,
    hesitationDetectionEnabled: config.hesitationDetectionEnabled,
    discountPermission: config.discountPermission,
    allowedDiscountCodes: config.allowedDiscountCodes,
    bundleSupportEnabled: config.bundleSupportEnabled,
    analyticsEnabled: config.analyticsEnabled,
  });

  const isSaving =
    navigation.state === "submitting" || navigation.state === "loading";

  const handleSave = () => {
    submit(
      {
        ...formState,
        holdoutEnabled: String(formState.holdoutEnabled),
        focusedMode: String(formState.focusedMode),
        chatEnabled: String(formState.chatEnabled),
        bundlesEnabled: String(formState.bundlesEnabled),
        upsellEnabled: String(formState.upsellEnabled),
        discountNudgeEnabled: String(formState.discountNudgeEnabled),
        exitIntentEnabled: String(formState.exitIntentEnabled),
        postPurchaseEnabled: String(formState.postPurchaseEnabled),
        proactiveMessagesEnabled: String(formState.proactiveMessagesEnabled),
        hesitationDetectionEnabled: String(
          formState.hesitationDetectionEnabled,
        ),
        discountPermission: String(formState.discountPermission),
        bundleSupportEnabled: String(formState.bundleSupportEnabled),
        analyticsEnabled: String(formState.analyticsEnabled),
      },
      { method: "post" },
    );
  };

  return (
    <Page
      title="Recommendations"
      subtitle="Choose cart recommendations and optional storefront features."
      backAction={{ content: "Dashboard", url: "/app" }}
      primaryAction={{
        content: "Save configurations",
        onAction: handleSave,
        loading: isSaving,
      }}
    >
      <Layout>
        {actionData?.success && (
          <Layout.Section>
            <Banner tone="success">
              Storefront configuration settings saved successfully.
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack gap="200">
                <Badge tone="success">Core Engine</Badge>
                <Badge>AOV Maximization</Badge>
              </InlineStack>

              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">
                  Storefront Widgets Toggles
                </Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Individually enable or disable widgets computed by the
                  AOVBoost behavioral decision engine.
                </Text>
              </BlockStack>

              <FormLayout>
                <Checkbox
                  label="Measure conversion with a holdout group (reporting requires Pro)"
                  checked={formState.holdoutEnabled}
                  onChange={(checked) =>
                    setFormState({ ...formState, holdoutEnabled: checked })
                  }
                  helpText="Off by default. Holdout shoppers receive no recommendations but use the same consented session, cart and order tracking. Analytics must be on. Post-purchase offers are paused for both groups while the test runs."
                />
                <TextField
                  label="Holdout percent"
                  type="number"
                  min={0}
                  max={30}
                  step={1}
                  value={formState.holdoutPercent}
                  onChange={(value) =>
                    setFormState({ ...formState, holdoutPercent: value })
                  }
                  autoComplete="off"
                  helpText="0–30%. Changing this setting starts a new measurement cohort. A complete seven-day follow-up and sufficient samples are required before lift appears."
                />
                <Checkbox
                  label="Focused cart recommendations"
                  helpText="Show additive cart recommendations after a confirmed add. Saving this mode turns off browsing widgets, chat, prompts, exit intent, countdowns and live alerts."
                  checked={formState.focusedMode}
                  onChange={(checked) =>
                    setFormState({
                      ...formState,
                      focusedMode: checked,
                      ...(checked
                        ? {
                            upsellEnabled: true,
                            chatEnabled: false,
                            bundlesEnabled: false,
                            discountNudgeEnabled: false,
                            exitIntentEnabled: false,
                            postPurchaseEnabled: false,
                            proactiveMessagesEnabled: false,
                            hesitationDetectionEnabled: false,
                            bundleSupportEnabled: false,
                          }
                        : {}),
                    })
                  }
                />
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "16px",
                  }}
                >
                  <Checkbox
                    label="AI Assistant (Chat)"
                    checked={formState.chatEnabled}
                    disabled={formState.focusedMode}
                    onChange={(checked) =>
                      setFormState({ ...formState, chatEnabled: checked })
                    }
                  />
                  <Checkbox
                    label="Dynamic Bundles"
                    checked={formState.bundlesEnabled}
                    disabled={formState.focusedMode}
                    onChange={(checked) =>
                      setFormState({ ...formState, bundlesEnabled: checked })
                    }
                  />
                  <Checkbox
                    label="Cart recommendations"
                    checked={formState.upsellEnabled}
                    onChange={(checked) =>
                      setFormState({ ...formState, upsellEnabled: checked })
                    }
                  />
                  <Checkbox
                    label="Cart-value Progress Nudges"
                    checked={formState.discountNudgeEnabled}
                    disabled={formState.focusedMode}
                    onChange={(checked) =>
                      setFormState({
                        ...formState,
                        discountNudgeEnabled: checked,
                      })
                    }
                  />
                  <Checkbox
                    label="Exit Intent Popups"
                    checked={formState.exitIntentEnabled}
                    disabled={formState.focusedMode}
                    onChange={(checked) =>
                      setFormState({ ...formState, exitIntentEnabled: checked })
                    }
                  />
                  <Checkbox
                    label="Post Purchase Upsell"
                    checked={formState.postPurchaseEnabled}
                    disabled={formState.focusedMode}
                    onChange={(checked) =>
                      setFormState({
                        ...formState,
                        postPurchaseEnabled: checked,
                      })
                    }
                  />
                </div>
              </FormLayout>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Recommendation products
              </Text>
              <Select
                label="Catalog preset"
                options={[
                  { label: "Generic", value: "generic" },
                  { label: "Beauty & haircare", value: "beauty_haircare" },
                ]}
                value={formState.verticalPreset}
                onChange={(value) =>
                  setFormState((current) => ({
                    ...current,
                    verticalPreset: normalizeVerticalPreset(value),
                  }))
                }
                helpText="Used when suggesting pairings. Regenerate suggestions after changing it; approved pairings stay in place."
              />
              <ResourcePickerField
                label="Blocked products"
                type="product"
                value={formState.blockedProductIds}
                onChange={(blockedProductIds) =>
                  setFormState((current) => ({ ...current, blockedProductIds }))
                }
                helpText="Exclude these products from recommendations."
              />
              <ResourcePickerField
                label="Preferred products"
                type="product"
                value={formState.preferredProductIds}
                onChange={(preferredProductIds) =>
                  setFormState((current) => ({
                    ...current,
                    preferredProductIds,
                  }))
                }
                helpText="Favor these products after customer fit and your exclusions."
              />
              <ResourcePickerField
                label="Upsell priority products"
                type="product"
                value={formState.upsellPriorityProductIds}
                onChange={(upsellPriorityProductIds) =>
                  setFormState((current) => ({
                    ...current,
                    upsellPriorityProductIds,
                  }))
                }
              />
              <ResourcePickerField
                label="Excluded collections"
                type="collection"
                value={formState.excludedCollectionIds}
                onChange={(excludedCollectionIds) =>
                  setFormState((current) => ({
                    ...current,
                    excludedCollectionIds,
                  }))
                }
              />
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  Advanced
                </Text>
                <Button
                  onClick={() => setShowAdvanced((current) => !current)}
                  ariaExpanded={showAdvanced}
                  ariaControls="advanced-settings"
                >
                  {showAdvanced
                    ? "Hide advanced settings"
                    : "Show advanced settings"}
                </Button>
              </InlineStack>
              <Text as="p" tone="subdued">
                Provider status, assistance timing, voice and offer guardrails.
              </Text>
              {showAdvanced ? (
                <InlineStack gap="200">
                  {Object.entries(providers).map(([name, configured]) => (
                    <Badge
                      key={name}
                      tone={configured ? "success" : "info"}
                    >{`${name}: ${configured ? "configured" : "not configured"}`}</Badge>
                  ))}
                </InlineStack>
              ) : null}
            </BlockStack>
          </Card>
        </Layout.Section>
        {showAdvanced ? (
          <Layout.Section>
            <div id="advanced-settings">
              <BlockStack gap="400">
                <Card>
                  <BlockStack gap="400">
                    <BlockStack gap="200">
                      <Text as="h2" variant="headingMd">
                        Sales behavior and proactive assistance
                      </Text>
                      <Text as="p" variant="bodyMd" tone="subdued">
                        Control when the assistant may approach shoppers and the
                        guardrails used for recommendations and upsells.
                      </Text>
                    </BlockStack>

                    <FormLayout>
                      <InlineStack gap="400" wrap>
                        <Checkbox
                          label="Proactive messages"
                          checked={formState.proactiveMessagesEnabled}
                          disabled={formState.focusedMode}
                          onChange={(checked) =>
                            setFormState({
                              ...formState,
                              proactiveMessagesEnabled: checked,
                            })
                          }
                        />
                        <Checkbox
                          label="Hesitation detection"
                          checked={formState.hesitationDetectionEnabled}
                          disabled={formState.focusedMode}
                          onChange={(checked) =>
                            setFormState({
                              ...formState,
                              hesitationDetectionEnabled: checked,
                            })
                          }
                        />
                        <Checkbox
                          label="Sales analytics"
                          checked={formState.analyticsEnabled}
                          onChange={(checked) =>
                            setFormState({
                              ...formState,
                              analyticsEnabled: checked,
                            })
                          }
                        />
                      </InlineStack>

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns:
                            "repeat(auto-fit, minmax(180px, 1fr))",
                          gap: "16px",
                        }}
                      >
                        <TextField
                          label="Proactive delay"
                          type="number"
                          suffix="seconds"
                          value={formState.proactiveDelaySeconds}
                          onChange={(value) =>
                            setFormState({
                              ...formState,
                              proactiveDelaySeconds: value,
                            })
                          }
                          autoComplete="off"
                        />
                        <TextField
                          label="Prompt limit per session"
                          type="number"
                          value={formState.maxProactivePrompts}
                          onChange={(value) =>
                            setFormState({
                              ...formState,
                              maxProactivePrompts: value,
                            })
                          }
                          autoComplete="off"
                        />
                        <TextField
                          label="Products per recommendation"
                          type="number"
                          value={formState.maxProductRecommendations}
                          onChange={(value) =>
                            setFormState({
                              ...formState,
                              maxProductRecommendations: value,
                            })
                          }
                          autoComplete="off"
                        />
                        <TextField
                          label="Minimum proactive confidence"
                          type="number"
                          value={formState.minimumProactiveConfidence}
                          onChange={(value) =>
                            setFormState({
                              ...formState,
                              minimumProactiveConfidence: value,
                            })
                          }
                          autoComplete="off"
                          helpText="Use a value from 0 to 1."
                        />
                        <TextField
                          label="Minimum intent before upsell"
                          type="number"
                          value={formState.minimumUpsellIntentScore}
                          onChange={(value) =>
                            setFormState({
                              ...formState,
                              minimumUpsellIntentScore: value,
                            })
                          }
                          autoComplete="off"
                          helpText="Use a score from 0 to 100."
                        />
                      </div>
                    </FormLayout>
                  </BlockStack>
                </Card>

                <Card>
                  <BlockStack gap="400">
                    <BlockStack gap="200">
                      <Text as="h2" variant="headingMd">
                        AI Sales Assistant & Personality
                      </Text>
                      <Text as="p" variant="bodyMd" tone="subdued">
                        Customize the welcome and voice of the storefront sales
                        assistant. It automatically introduces verified catalog
                        products, recommends strong matches, and answers shopper
                        questions.
                      </Text>
                    </BlockStack>

                    <FormLayout>
                      <TextField
                        label="Greeting Message"
                        value={formState.chatGreeting}
                        onChange={(value) =>
                          setFormState({ ...formState, chatGreeting: value })
                        }
                        autoComplete="off"
                        helpText="The first welcome message. A verified catalog introduction follows when the shopper opens the chat."
                      />

                      <Select
                        label="AI Assistant Persona Tone"
                        options={aiToneOptions}
                        value={formState.aiTone}
                        onChange={(value) =>
                          setFormState({ ...formState, aiTone: value })
                        }
                      />
                    </FormLayout>
                  </BlockStack>
                </Card>

                <Card>
                  <BlockStack gap="400">
                    <BlockStack gap="200">
                      <Text as="h2" variant="headingMd">
                        Offer Economics & Guardrails
                      </Text>
                      <Text as="p" variant="bodyMd" tone="subdued">
                        Define budget constraints and catalog exemptions for A/B
                        tests and widgets.
                      </Text>
                    </BlockStack>

                    <FormLayout>
                      <TextField
                        label="Cart-value Goal"
                        type="number"
                        value={formState.discountThreshold}
                        onChange={(value) =>
                          setFormState({
                            ...formState,
                            discountThreshold: value,
                          })
                        }
                        prefix="$"
                        autoComplete="off"
                        helpText="Shows progress toward this cart value. It does not create or promise a Shopify discount."
                      />

                      <InlineStack gap="400" wrap>
                        <Checkbox
                          label="Bundle suggestions"
                          checked={formState.bundleSupportEnabled}
                          disabled={formState.focusedMode}
                          onChange={(checked) =>
                            setFormState({
                              ...formState,
                              bundleSupportEnabled: checked,
                            })
                          }
                        />
                        <Checkbox
                          label="Allow configured discount codes"
                          checked={formState.discountPermission}
                          onChange={(checked) =>
                            setFormState({
                              ...formState,
                              discountPermission: checked,
                            })
                          }
                        />
                      </InlineStack>

                      <TextField
                        label="Allowed discount codes"
                        value={formState.allowedDiscountCodes}
                        onChange={(value) =>
                          setFormState({
                            ...formState,
                            allowedDiscountCodes: value,
                          })
                        }
                        autoComplete="off"
                        helpText="Comma-separated allowlist. The agent cannot invent or apply other codes."
                        disabled={!formState.discountPermission}
                      />
                    </FormLayout>
                  </BlockStack>
                </Card>

                <Card>
                  <BlockStack gap="400">
                    <BlockStack gap="200">
                      <Text as="h2" variant="headingMd">
                        AI Brand Guidelines
                      </Text>
                      <Text as="p" variant="bodyMd" tone="subdued">
                        Describe your brand personality, core demographics, or
                        styling criteria to prompt the generation engine.
                      </Text>
                    </BlockStack>

                    <FormLayout>
                      <TextField
                        label="Brand Voice Brief"
                        value={formState.brandVoice}
                        onChange={(value) =>
                          setFormState({ ...formState, brandVoice: value })
                        }
                        multiline={4}
                        placeholder="E.g., Energetic, helpful, focus on athletic performance, emphasize high product materials and premium customer experience."
                        autoComplete="off"
                        helpText="Guidelines used directly in dynamic copy generation prompt engineering."
                      />

                      <TextField
                        label="Store facts, FAQs, and support guidance"
                        value={formState.storeKnowledge}
                        onChange={(value) =>
                          setFormState({ ...formState, storeKnowledge: value })
                        }
                        multiline={8}
                        maxLength={12000}
                        showCharacterCount
                        placeholder="Add only verified store facts: sizing guidance, delivery estimates, pickup details, warranty rules, support hours, materials, care instructions, and common FAQs."
                        autoComplete="off"
                        helpText="The assistant treats this as store-specific reference material. Shopify product data and published store policies remain authoritative for catalog, price, stock, shipping, and returns."
                      />
                    </FormLayout>
                  </BlockStack>
                </Card>
              </BlockStack>
            </div>
          </Layout.Section>
        ) : null}
      </Layout>
    </Page>
  );
}

function parseBoolean(value: FormDataEntryValue | null) {
  return value === "true" || value === "on";
}

function parseCsv(value: FormDataEntryValue | null) {
  return Array.from(
    new Set(
      String(value || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ).slice(0, 500);
}

function parseBoundedNumber(
  value: FormDataEntryValue | null,
  fallback: number,
  minimum: number,
  maximum: number,
  integer = true,
) {
  const parsed = Number(value);
  const bounded = Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, minimum), maximum)
    : fallback;
  return integer ? Math.round(bounded) : bounded;
}
