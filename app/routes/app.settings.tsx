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
import { ensureRevenueEngineConfigSchema } from "../models/shop-config.server";

const defaultConfig = {
  discountPercentage: 10,
  offerStrategy:
    "Prioritize revenue outcomes. Use bundles for high-intent carts, protect margin, and avoid generic copy.",
  minProductPrice: 20,
  revenueMode: "aov",
  enableAutopilot: true,
  enableDynamicBundles: true,
  enableExperimentation: true,
  enableBehavioralTargeting: true,
  primaryPlacement: "autopilot",
  maxBundleItems: 3,
  urgencyLevel: "balanced",
};

const revenueModeOptions = [
  { label: "AOV Mode", value: "aov" },
  { label: "Profit Mode", value: "profit" },
  { label: "Inventory Clear Mode", value: "inventory_clear" },
  { label: "Subscription Mode", value: "subscription" },
  { label: "LTV Mode", value: "ltv" },
  { label: "Seasonal Mode", value: "seasonal" },
];

const placementOptions = [
  { label: "Autopilot", value: "autopilot" },
  { label: "AI product companion", value: "inline" },
  { label: "AI smart cart drawer", value: "slide_cart" },
  { label: "Product companion page", value: "product_page" },
  { label: "AI progress journey", value: "checkout" },
  { label: "Cart drawer fallback", value: "modal" },
];

const urgencyOptions = [
  { label: "Calm", value: "calm" },
  { label: "Balanced", value: "balanced" },
  { label: "Assertive", value: "assertive" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await ensureRevenueEngineConfigSchema(prisma);

  const config = await prisma.shopConfig.findUnique({
    where: { shopDomain: session.shop },
  });

  return json({ config: config || defaultConfig });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await ensureRevenueEngineConfigSchema(prisma);

  const formData = await request.formData();

  const discountPercentage = clampNumber(
    parseInt(String(formData.get("discountPercentage") || "10"), 10),
    0,
    80,
  );
  const minProductPrice = Math.max(
    0,
    parseFloat(String(formData.get("minProductPrice") || "20")),
  );
  const maxBundleItems = clampNumber(
    parseInt(String(formData.get("maxBundleItems") || "3"), 10),
    1,
    4,
  );

  try {
    const config = await prisma.shopConfig.upsert({
      where: { shopDomain: session.shop },
      update: {
        discountPercentage,
        offerStrategy: String(formData.get("offerStrategy") || ""),
        minProductPrice,
        revenueMode: String(formData.get("revenueMode") || "aov"),
        enableAutopilot: parseBoolean(formData.get("enableAutopilot")),
        enableDynamicBundles: parseBoolean(formData.get("enableDynamicBundles")),
        enableExperimentation: parseBoolean(formData.get("enableExperimentation")),
        enableBehavioralTargeting: parseBoolean(
          formData.get("enableBehavioralTargeting"),
        ),
        primaryPlacement: String(formData.get("primaryPlacement") || "autopilot"),
        maxBundleItems,
        urgencyLevel: String(formData.get("urgencyLevel") || "balanced"),
      },
      create: {
        shopDomain: session.shop,
        discountPercentage,
        offerStrategy: String(formData.get("offerStrategy") || ""),
        minProductPrice,
        revenueMode: String(formData.get("revenueMode") || "aov"),
        enableAutopilot: parseBoolean(formData.get("enableAutopilot")),
        enableDynamicBundles: parseBoolean(formData.get("enableDynamicBundles")),
        enableExperimentation: parseBoolean(formData.get("enableExperimentation")),
        enableBehavioralTargeting: parseBoolean(
          formData.get("enableBehavioralTargeting"),
        ),
        primaryPlacement: String(formData.get("primaryPlacement") || "autopilot"),
        maxBundleItems,
        urgencyLevel: String(formData.get("urgencyLevel") || "balanced"),
      },
    });

    return json({ success: true, config });
  } catch (error) {
    console.error("Error saving revenue engine settings:", error);
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
    discountPercentage: String(config.discountPercentage),
    offerStrategy: config.offerStrategy,
    minProductPrice: String(config.minProductPrice),
    revenueMode: config.revenueMode,
    enableAutopilot: config.enableAutopilot,
    enableDynamicBundles: config.enableDynamicBundles,
    enableExperimentation: config.enableExperimentation,
    enableBehavioralTargeting: config.enableBehavioralTargeting,
    primaryPlacement: config.primaryPlacement,
    maxBundleItems: String(config.maxBundleItems),
    urgencyLevel: config.urgencyLevel,
  });

  const isSaving =
    navigation.state === "submitting" || navigation.state === "loading";

  const handleSave = () => {
    submit(
      {
        ...formState,
        enableAutopilot: String(formState.enableAutopilot),
        enableDynamicBundles: String(formState.enableDynamicBundles),
        enableExperimentation: String(formState.enableExperimentation),
        enableBehavioralTargeting: String(formState.enableBehavioralTargeting),
      },
      { method: "post" },
    );
  };

  return (
    <Page
      title="AI Revenue Engine"
      subtitle="Configure the goal, automation, testing, and native offer behavior."
      backAction={{ content: "Dashboard", url: "/app" }}
      primaryAction={{
        content: "Save settings",
        onAction: handleSave,
        loading: isSaving,
      }}
    >
      <Layout>
        {actionData?.success && (
          <Layout.Section>
            <Banner tone="success">Revenue engine settings saved.</Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack gap="200">
                <Badge>Autonomous strategy</Badge>
                <Badge>Dynamic bundles</Badge>
                <Badge>Experimentation</Badge>
              </InlineStack>

              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">
                  Revenue Goal
                </Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Choose what the engine should optimize before it picks products,
                  copy, discounts, and placement.
                </Text>
              </BlockStack>

              <FormLayout>
                <Select
                  label="AI mode"
                  options={revenueModeOptions}
                  value={formState.revenueMode}
                  onChange={(value) =>
                    setFormState({ ...formState, revenueMode: value })
                  }
                />

                <Select
                  label="Primary AI surface"
                  options={placementOptions}
                  value={formState.primaryPlacement}
                  onChange={(value) =>
                    setFormState({ ...formState, primaryPlacement: value })
                  }
                  helpText="Autopilot lets the engine choose the product companion, smart cart drawer, progress journey, or fallback drawer."
                />

                <Select
                  label="Urgency style"
                  options={urgencyOptions}
                  value={formState.urgencyLevel}
                  onChange={(value) =>
                    setFormState({ ...formState, urgencyLevel: value })
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
                  Offer Economics
                </Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Set the guardrails the engine uses when it creates a revenue
                  offer or bundle.
                </Text>
              </BlockStack>

              <FormLayout>
                <TextField
                  label="Discount percentage"
                  type="number"
                  value={formState.discountPercentage}
                  onChange={(value) =>
                    setFormState({ ...formState, discountPercentage: value })
                  }
                  suffix="%"
                  autoComplete="off"
                />

                <TextField
                  label="Minimum offer value for discount"
                  type="number"
                  value={formState.minProductPrice}
                  onChange={(value) =>
                    setFormState({ ...formState, minProductPrice: value })
                  }
                  prefix="$"
                  autoComplete="off"
                />

                <TextField
                  label="Maximum bundle items"
                  type="number"
                  value={formState.maxBundleItems}
                  onChange={(value) =>
                    setFormState({ ...formState, maxBundleItems: value })
                  }
                  helpText="Use 2 to 3 for most stores. Four is best for kits or complete-the-look offers."
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
                  Automation
                </Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  These options move the app away from a static upsell widget and
                  toward self-optimizing revenue operations.
                </Text>
              </BlockStack>

              <FormLayout>
                <Checkbox
                  label="Enable AI autopilot"
                  checked={formState.enableAutopilot}
                  onChange={(checked) =>
                    setFormState({ ...formState, enableAutopilot: checked })
                  }
                />
                <Checkbox
                  label="Create dynamic bundles"
                  checked={formState.enableDynamicBundles}
                  onChange={(checked) =>
                    setFormState({ ...formState, enableDynamicBundles: checked })
                  }
                />
                <Checkbox
                  label="Run AI experiments"
                  checked={formState.enableExperimentation}
                  onChange={(checked) =>
                    setFormState({ ...formState, enableExperimentation: checked })
                  }
                />
                <Checkbox
                  label="Use in-session behavioral targeting"
                  checked={formState.enableBehavioralTargeting}
                  onChange={(checked) =>
                    setFormState({
                      ...formState,
                      enableBehavioralTargeting: checked,
                    })
                  }
                />

                <TextField
                  label="AI strategy brief"
                  value={formState.offerStrategy}
                  onChange={(value) =>
                    setFormState({ ...formState, offerStrategy: value })
                  }
                  multiline={4}
                  helpText="Tell the engine how to trade off margin, conversion, inventory, brand voice, and offer aggressiveness."
                  autoComplete="off"
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

function clampNumber(value: number, min: number, max: number) {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}
