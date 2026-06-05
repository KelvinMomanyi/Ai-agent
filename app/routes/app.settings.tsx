import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  useActionData,
  useLoaderData,
  useNavigation,
  useSubmit,
} from "@remix-run/react";
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
          blockedProductIds: config.blockedProductIds.join(", "),
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
          blockedProductIds: "",
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
  const discountNudgeEnabled = parseBoolean(formData.get("discountNudgeEnabled"));
  const discountThreshold = parseFloat(String(formData.get("discountThreshold") || "50"));
  const exitIntentEnabled = parseBoolean(formData.get("exitIntentEnabled"));
  const postPurchaseEnabled = parseBoolean(formData.get("postPurchaseEnabled"));
  const aiTone = String(formData.get("aiTone") || "friendly");
  const brandVoice = String(formData.get("brandVoice") || "").trim();
  const blockedProductIdsRaw = String(formData.get("blockedProductIds") || "");
  const blockedProductIds = blockedProductIdsRaw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

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
        blockedProductIds,
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
        blockedProductIds,
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
    blockedProductIds: config.blockedProductIds,
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
            <Banner tone="success">Storefront configuration settings saved successfully.</Banner>
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
                  Individually enable or disable widgets computed by the AOVBoost behavioral decision engine.
                </Text>
              </BlockStack>

              <FormLayout>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
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
                    label="Discount Nudges"
                    checked={formState.discountNudgeEnabled}
                    onChange={(checked) =>
                      setFormState({ ...formState, discountNudgeEnabled: checked })
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
                      setFormState({ ...formState, postPurchaseEnabled: checked })
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
                  AI Chat Widget & Personality
                </Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Customize the first greeting and voice style of the storefront shopping companion.
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
                  helpText="The welcome message showing up when the chatbot initializes."
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
                  Define budget constraints and catalog exemptions for A/B tests and widgets.
                </Text>
              </BlockStack>

              <FormLayout>
                <TextField
                  label="Discount Threshold"
                  type="number"
                  value={formState.discountThreshold}
                  onChange={(value) =>
                    setFormState({ ...formState, discountThreshold: value })
                  }
                  prefix="$"
                  autoComplete="off"
                  helpText="Minimum cart value required before sweetening discounts are offered to customers."
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
                  Describe your brand personality, core demographics, or styling criteria to prompt the generation engine.
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
