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
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
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
    config: config
      ? {
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
          chatEnabled: true,
          chatGreeting: "Hi! Can I help you find the perfect product?",
          bundlesEnabled: true,
          upsellEnabled: true,
          discountNudgeEnabled: true,
          discountThreshold: "50",
          exitIntentEnabled: true,
          postPurchaseEnabled: true,
          aiTone: "friendly",
          brandVoice: "",
          storeKnowledge: "",
          blockedProductIds: "",
          excludedCollectionIds: "",
          preferredProductIds: "",
          upsellPriorityProductIds: "",
          proactiveMessagesEnabled: true,
          proactiveDelaySeconds: "15",
          maxProactivePrompts: "2",
          maxProductRecommendations: "3",
          minimumProactiveConfidence: "0.65",
          minimumUpsellIntentScore: "55",
          hesitationDetectionEnabled: true,
          discountPermission: false,
          allowedDiscountCodes: "",
          bundleSupportEnabled: true,
          analyticsEnabled: true,
        },
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

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
      },
      create: {
        shop: session.shop,
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
      },
    });

    // Invalidate cached settings
    await redis.del(`settings:${session.shop}`);

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
  const { config } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();

  const [formState, setFormState] = useState({
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
      title="AOVBoost Configuration"
      subtitle="Optimize behavior engine toggles, brand guidelines, and economic guardrails."
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
                    onChange={(checked) =>
                      setFormState({ ...formState, chatEnabled: checked })
                    }
                  />
                  <Checkbox
                    label="Dynamic Bundles"
                    checked={formState.bundlesEnabled}
                    onChange={(checked) =>
                      setFormState({ ...formState, bundlesEnabled: checked })
                    }
                  />
                  <Checkbox
                    label="Smart Cart Drawer (Upsell)"
                    checked={formState.upsellEnabled}
                    onChange={(checked) =>
                      setFormState({ ...formState, upsellEnabled: checked })
                    }
                  />
                  <Checkbox
                    label="Cart-value Progress Nudges"
                    checked={formState.discountNudgeEnabled}
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
                    onChange={(checked) =>
                      setFormState({ ...formState, exitIntentEnabled: checked })
                    }
                  />
                  <Checkbox
                    label="Post Purchase Upsell"
                    checked={formState.postPurchaseEnabled}
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
                      setFormState({ ...formState, analyticsEnabled: checked })
                    }
                  />
                </InlineStack>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
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
                      setFormState({ ...formState, maxProactivePrompts: value })
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

                <TextField
                  label="Preferred product GIDs"
                  value={formState.preferredProductIds}
                  onChange={(value) =>
                    setFormState({ ...formState, preferredProductIds: value })
                  }
                  multiline={2}
                  autoComplete="off"
                  helpText="Comma-separated products to favor only after customer fit."
                />
                <TextField
                  label="Upsell priority product GIDs"
                  value={formState.upsellPriorityProductIds}
                  onChange={(value) =>
                    setFormState({
                      ...formState,
                      upsellPriorityProductIds: value,
                    })
                  }
                  multiline={2}
                  autoComplete="off"
                />
                <TextField
                  label="Excluded collection GIDs"
                  value={formState.excludedCollectionIds}
                  onChange={(value) =>
                    setFormState({
                      ...formState,
                      excludedCollectionIds: value,
                    })
                  }
                  multiline={2}
                  autoComplete="off"
                />
              </FormLayout>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
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
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">
                  Offer Economics & Guardrails
                </Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Define budget constraints and catalog exemptions for A/B tests
                  and widgets.
                </Text>
              </BlockStack>

              <FormLayout>
                <TextField
                  label="Cart-value Goal"
                  type="number"
                  value={formState.discountThreshold}
                  onChange={(value) =>
                    setFormState({ ...formState, discountThreshold: value })
                  }
                  prefix="$"
                  autoComplete="off"
                  helpText="Shows progress toward this cart value. It does not create or promise a Shopify discount."
                />

                <TextField
                  label="Excluded Product GIDs"
                  value={formState.blockedProductIds}
                  onChange={(value) =>
                    setFormState({ ...formState, blockedProductIds: value })
                  }
                  multiline={3}
                  placeholder="gid://shopify/Product/12345, gid://shopify/Product/67890"
                  autoComplete="off"
                  helpText="Comma-separated Shopify Product GIDs to completely exclude from any recommended upsells."
                />

                <InlineStack gap="400" wrap>
                  <Checkbox
                    label="Bundle suggestions"
                    checked={formState.bundleSupportEnabled}
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
                    setFormState({ ...formState, allowedDiscountCodes: value })
                  }
                  autoComplete="off"
                  helpText="Comma-separated allowlist. The agent cannot invent or apply other codes."
                  disabled={!formState.discountPermission}
                />
              </FormLayout>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">
                  AI Brand Guidelines
                </Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Describe your brand personality, core demographics, or styling
                  criteria to prompt the generation engine.
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
        </Layout.Section>
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
