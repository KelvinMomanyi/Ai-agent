import { Card, Text, BlockStack } from "@shopify/polaris";

type AovMetricCardProps = {
  label: string;
  value: string;
  caption?: string;
};

export function AovMetricCard({ label, value, caption }: AovMetricCardProps) {
  return (
    <Card>
      <BlockStack gap="100">
        <Text as="p" variant="bodySm" tone="subdued">
          {label}
        </Text>
        <Text as="p" variant="headingLg">
          {value}
        </Text>
        {caption ? (
          <Text as="p" variant="bodySm" tone="subdued">
            {caption}
          </Text>
        ) : null}
      </BlockStack>
    </Card>
  );
}
