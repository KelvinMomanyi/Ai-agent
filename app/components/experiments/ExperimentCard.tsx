import { Badge, BlockStack, Card, InlineStack, Text } from "@shopify/polaris";

type VariantStats = {
  impressions: number;
  ctr: number;
  conversionRate: number;
  aov: number;
};

type ExperimentCardProps = {
  name: string;
  widgetType: string;
  trafficSplit: number;
  isActive: boolean;
  startedAt: string;
  control: VariantStats;
  treatment: VariantStats;
  significant: boolean;
};

export function ExperimentCard({
  name,
  widgetType,
  trafficSplit,
  isActive,
  startedAt,
  control,
  treatment,
  significant,
}: ExperimentCardProps) {
  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <BlockStack gap="100">
            <Text as="h3" variant="headingMd">
              {name}
            </Text>
            <Text as="p" tone="subdued">
              {formatWidget(widgetType)} started {startedAt}
            </Text>
          </BlockStack>
          <InlineStack gap="200">
            <Badge tone={isActive ? "success" : undefined}>
              {isActive ? "Active" : "Ended"}
            </Badge>
            <Badge tone={significant ? "success" : "attention"}>
              {significant ? "Significant" : "Collecting data"}
            </Badge>
          </InlineStack>
        </InlineStack>

        <Text as="p" variant="bodySm" tone="subdued">
          Treatment receives {Math.round(trafficSplit * 100)}% of traffic.
        </Text>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: "12px",
          }}
        >
          <VariantSummary title="Control" stats={control} />
          <VariantSummary title="Treatment" stats={treatment} />
        </div>
      </BlockStack>
    </Card>
  );
}

function VariantSummary({
  title,
  stats,
}: {
  title: string;
  stats: VariantStats;
}) {
  return (
    <BlockStack gap="100">
      <Text as="p" variant="headingSm">
        {title}
      </Text>
      <Text as="p" variant="bodySm">
        {stats.impressions.toLocaleString()} impressions
      </Text>
      <Text as="p" variant="bodySm">
        CTR {formatPercent(stats.ctr)}
      </Text>
      <Text as="p" variant="bodySm">
        CVR {formatPercent(stats.conversionRate)}
      </Text>
      <Text as="p" variant="bodySm">
        AOV {formatCurrency(stats.aov)}
      </Text>
    </BlockStack>
  );
}

function formatWidget(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}
