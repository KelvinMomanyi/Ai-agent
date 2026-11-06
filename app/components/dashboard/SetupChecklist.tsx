import {
  Badge,
  BlockStack,
  Button,
  Card,
  InlineStack,
  Text,
} from "@shopify/polaris";
import type { SetupStep } from "../../models/onboarding";

export function SetupChecklist({
  steps,
  themeEditorUrl,
  storefrontUrl,
  onRefresh,
  refreshing,
}: {
  steps: SetupStep[];
  themeEditorUrl: string | null;
  storefrontUrl: string;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">
          Get your first recommendation working
        </Text>
        <ol style={{ margin: 0, paddingLeft: "24px" }}>
          {steps.map((step) => (
            <li key={step.id} style={{ marginBottom: "16px" }}>
              <BlockStack gap="200">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="h3" variant="headingSm">
                    {step.label}
                  </Text>
                  <Badge
                    tone={
                      step.state === "complete"
                        ? "success"
                        : step.state === "failed"
                          ? "critical"
                          : step.state === "blocked" || step.state === "empty"
                            ? "attention"
                            : "info"
                    }
                  >
                    {step.id === "verify" && step.state === "complete"
                      ? "Verified"
                      : step.state.replace(/_/g, " ")}
                  </Badge>
                </InlineStack>
                <Text as="p" tone="subdued">
                  {step.detail}
                </Text>
                {step.id === "preview" ? (
                  <InlineStack>
                    <Button
                      url="/app/preview"
                      disabled={step.state === "blocked"}
                    >
                      Preview an offer
                    </Button>
                  </InlineStack>
                ) : null}
                {step.id === "pairings" ? (
                  <InlineStack>
                    <Button
                      url="/app/pairings"
                      disabled={step.state === "blocked"}
                    >
                      Review pairings
                    </Button>
                  </InlineStack>
                ) : null}
                {step.id === "embed" && themeEditorUrl ? (
                  <InlineStack>
                    <Button url={themeEditorUrl} external>
                      Open theme editor
                    </Button>
                  </InlineStack>
                ) : null}
                {step.id === "verify" ? (
                  <InlineStack gap="200">
                    <Button url={storefrontUrl} external>
                      Open storefront
                    </Button>
                    <Button onClick={onRefresh} loading={refreshing}>
                      Check connection
                    </Button>
                  </InlineStack>
                ) : null}
              </BlockStack>
            </li>
          ))}
        </ol>
      </BlockStack>
    </Card>
  );
}
