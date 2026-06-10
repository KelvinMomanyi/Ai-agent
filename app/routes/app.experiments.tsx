import { useState } from "react";
import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import {
  Badge,
  BlockStack,
  Button,
  Card,
  FormLayout,
  InlineStack,
  Layout,
  Page,
  Select,
  Text,
  TextField,
  Banner,
  DataTable,
  Divider,
  Box,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getExperimentAnalytics } from "../models/analytics.server";

const widgetTypeOptions = [
  { label: "AI Assistant (Chat)", value: "chat" },
  { label: "Toast Nudge", value: "toast" },
  { label: "Countdown Banner", value: "countdown_banner" },
  { label: "Inline Alert", value: "inline_alert" },
  { label: "Dynamic Bundle", value: "bundle" },
  { label: "Smart Cart Drawer (Upsell)", value: "upsell_drawer" },
  { label: "Discount Nudge", value: "discount_nudge" },
  { label: "Recommendation Strip", value: "rec_strip" },
  { label: "Social Proof Alert", value: "social_proof" },
  { label: "Exit Intent Popup", value: "exit_intent" },
  { label: "Post Purchase Upsell", value: "post_purchase" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const experiments = await getExperimentAnalytics(session.shop);

  return json({
    experiments: experiments.map((exp) => ({
      ...exp,
      startedAt: exp.startedAt.toString(),
      endedAt: exp.endedAt ? exp.endedAt.toString() : null,
      controlConfig: JSON.stringify(exp.controlConfig, null, 2),
      treatmentConfig: JSON.stringify(exp.treatmentConfig, null, 2),
    })),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent === "create") {
    const name = String(formData.get("name") || "").trim();
    const widgetType = String(formData.get("widgetType") || "chat");
    const trafficSplit = parseFloat(String(formData.get("trafficSplit") || "50")) / 100;
    const controlConfigRaw = String(formData.get("controlConfig") || "{}").trim();
    const treatmentConfigRaw = String(formData.get("treatmentConfig") || "{}").trim();

    const errors: Record<string, string> = {};
    if (!name) errors.name = "Experiment name is required";

    let controlConfig = {};
    let treatmentConfig = {};
    try {
      controlConfig = JSON.parse(controlConfigRaw || "{}");
    } catch {
      errors.controlConfig = "Invalid control JSON config";
    }
    try {
      treatmentConfig = JSON.parse(treatmentConfigRaw || "{}");
    } catch {
      errors.treatmentConfig = "Invalid treatment JSON config";
    }

    if (Object.keys(errors).length > 0) {
      return json({ errors, success: false }, { status: 400 });
    }

    // Disable all other active experiments for the same widgetType to prevent collisions
    await prisma.experiment.updateMany({
      where: { shop: session.shop, widgetType, isActive: true },
      data: { isActive: false, endedAt: new Date() },
    });

    await prisma.experiment.create({
      data: {
        shop: session.shop,
        name,
        widgetType,
        trafficSplit,
        isActive: true,
        controlConfig,
        treatmentConfig,
        startedAt: new Date(),
      },
    });

    return redirect("/app/experiments");
  }

  if (intent === "toggle") {
    const id = String(formData.get("id") || "");
    const isActiveStr = String(formData.get("isActive") || "");
    const wasActive = isActiveStr === "true";

    await prisma.experiment.updateMany({
      where: { shop: session.shop, id },
      data: {
        isActive: !wasActive,
        endedAt: wasActive ? new Date() : null,
      },
    });

    return redirect("/app/experiments");
  }

  if (intent === "delete") {
    const id = String(formData.get("id") || "");
    await prisma.experiment.deleteMany({
      where: { shop: session.shop, id },
    });

    return redirect("/app/experiments");
  }

  return redirect("/app/experiments");
};

export default function Experiments() {
  const { experiments } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const submit = useSubmit();

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formState, setFormState] = useState({
    name: "",
    widgetType: "chat",
    trafficSplit: "50",
    controlConfig: "{}",
    treatmentConfig: "{}",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const isSubmitting = navigation.state === "submitting";

  const handleCreate = () => {
    const tempErrors: Record<string, string> = {};
    if (!formState.name.trim()) tempErrors.name = "Experiment name is required";
    try {
      JSON.parse(formState.controlConfig);
    } catch {
      tempErrors.controlConfig = "Invalid control JSON config";
    }
    try {
      JSON.parse(formState.treatmentConfig);
    } catch {
      tempErrors.treatmentConfig = "Invalid treatment JSON config";
    }

    if (Object.keys(tempErrors).length > 0) {
      setErrors(tempErrors);
      return;
    }

    submit(
      {
        intent: "create",
        ...formState,
      },
      { method: "post" },
    );
    setShowCreateForm(false);
    setFormState({
      name: "",
      widgetType: "chat",
      trafficSplit: "50",
      controlConfig: "{}",
      treatmentConfig: "{}",
    });
    setErrors({});
  };

  const handleToggle = (id: string, isActive: boolean) => {
    submit({ intent: "toggle", id, isActive: String(isActive) }, { method: "post" });
  };

  const handleDelete = (id: string) => {
    if (confirm("Are you sure you want to delete this experiment permanently?")) {
      submit({ intent: "delete", id }, { method: "post" });
    }
  };

  return (
    <Page
      title="A/B Tests & Experiments"
      subtitle="Establish statistical control. Evaluate Gemini copywriting, custom thresholds, and widget styling rules."
      backAction={{ content: "Dashboard", url: "/app" }}
      primaryAction={{
        content: showCreateForm ? "Cancel" : "Create A/B test",
        onAction: () => setShowCreateForm(!showCreateForm),
      }}
    >
      <Layout>
        {showCreateForm && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Configure A/B Test Parameters
                </Text>
                <FormLayout>
                  <TextField
                    label="Experiment Name"
                    value={formState.name}
                    onChange={(value) => setFormState({ ...formState, name: value })}
                    error={errors.name}
                    autoComplete="off"
                    placeholder="E.g., Chatbot Friendly vs Assertive Greeting"
                  />

                  <Select
                    label="Widget Under Test"
                    options={widgetTypeOptions}
                    value={formState.widgetType}
                    onChange={(value) => setFormState({ ...formState, widgetType: value })}
                  />

                  <TextField
                    label="Traffic Allocation Split (Treatment Group)"
                    type="number"
                    value={formState.trafficSplit}
                    onChange={(value) => setFormState({ ...formState, trafficSplit: value })}
                    suffix="%"
                    autoComplete="off"
                    helpText="Remaining percentage goes directly to Control group."
                  />

                  <TextField
                    label="Control Configuration Variant JSON"
                    value={formState.controlConfig}
                    onChange={(value) => setFormState({ ...formState, controlConfig: value })}
                    multiline={4}
                    error={errors.controlConfig}
                    autoComplete="off"
                  />

                  <TextField
                    label="Treatment Configuration Variant JSON"
                    value={formState.treatmentConfig}
                    onChange={(value) => setFormState({ ...formState, treatmentConfig: value })}
                    multiline={4}
                    error={errors.treatmentConfig}
                    autoComplete="off"
                  />

                  <InlineStack align="end" gap="200">
                    <Button onClick={() => setShowCreateForm(false)}>Cancel</Button>
                    <Button variant="primary" onClick={handleCreate} loading={isSubmitting}>
                      Launch Experiment
                    </Button>
                  </InlineStack>
                </FormLayout>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                All Configured Experiments
              </Text>
              {experiments.length === 0 ? (
                <Text as="p" tone="subdued">
                  No active or past experiments found. Establish your first test split above.
                </Text>
              ) : (
                experiments.map((exp: any) => {
                  const startedDate = new Date(exp.startedAt).toLocaleDateString();
                  const endedDate = exp.endedAt ? new Date(exp.endedAt).toLocaleDateString() : "Ongoing";

                  const dataRows = [
                    [
                      "Control (A)",
                      exp.control.impressions.toLocaleString(),
                      exp.control.clicks.toLocaleString(),
                      exp.control.conversions.toLocaleString(),
                      `${(exp.control.ctr * 100).toFixed(2)}%`,
                      `${(exp.control.conversionRate * 100).toFixed(2)}%`,
                      new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(exp.control.aov),
                      new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(exp.control.revenue),
                    ],
                    [
                      "Treatment (B)",
                      exp.treatment.impressions.toLocaleString(),
                      exp.treatment.clicks.toLocaleString(),
                      exp.treatment.conversions.toLocaleString(),
                      `${(exp.treatment.ctr * 100).toFixed(2)}%`,
                      `${(exp.treatment.conversionRate * 100).toFixed(2)}%`,
                      new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(exp.treatment.aov),
                      new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(exp.treatment.revenue),
                    ],
                  ];

                  return (
                    <Box key={exp.id} padding="400" borderStyle="solid" borderWidth="100" borderColor="border" borderRadius="200">
                      <BlockStack gap="300">
                        <InlineStack align="space-between">
                          <BlockStack gap="100">
                            <InlineStack gap="200" blockAlign="center">
                              <Text as="h3" variant="headingSm">
                                {exp.name}
                              </Text>
                              <Badge tone={exp.isActive ? "success" : undefined}>
                                {exp.isActive ? "Active" : "Inactive / Paused"}
                              </Badge>
                              {exp.significant ? (
                                <Badge tone="info">Significant Result</Badge>
                              ) : (
                                <Badge>Inconclusive</Badge>
                              )}
                            </InlineStack>
                            <Text as="p" variant="bodySm" tone="subdued">
                              Widget under test: <strong>{exp.widgetType}</strong> | Traffic split: {exp.trafficSplit * 100}% B
                            </Text>
                            <Text as="p" variant="bodySm" tone="subdued">
                              Timeline: {startedDate} to {endedDate}
                            </Text>
                          </BlockStack>

                          <InlineStack gap="200">
                            <Button onClick={() => handleToggle(exp.id, exp.isActive)}>
                              {exp.isActive ? "Pause Test" : "Resume / Run"}
                            </Button>
                            <Button tone="critical" onClick={() => handleDelete(exp.id)}>
                              Delete
                            </Button>
                          </InlineStack>
                        </InlineStack>

                        <Divider />

                        <BlockStack gap="200">
                          <Text as="h4" variant="headingXs">
                            Experiment Performance Metrics
                          </Text>
                          <DataTable
                            columnContentTypes={[
                              "text",
                              "numeric",
                              "numeric",
                              "numeric",
                              "numeric",
                              "numeric",
                              "numeric",
                              "numeric",
                            ]}
                            headings={[
                              "Variant Group",
                              "Impressions",
                              "Clicks",
                              "Conversions",
                              "CTR",
                              "Conversion Rate",
                              "AOV",
                              "Revenue Impact",
                            ]}
                            rows={dataRows}
                          />
                        </BlockStack>

                        {exp.significant ? (
                          <Banner tone="info" title="Two-Proportion Z-Test Significance Met">
                            We have observed a statistically significant difference in conversion outcomes ($\alpha = 0.05$). The treatment parameters show high likelihood of conversion impact rather than random chance variance.
                          </Banner>
                        ) : (
                          <Banner title="Z-Test Inconclusive / Collecting Data">
                            Not enough transactions or insufficient conversion variance yet to satisfy two-proportion z-test significance. The app will continue distributing traffic splits.
                          </Banner>
                        )}
                      </BlockStack>
                    </Box>
                  );
                })
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
