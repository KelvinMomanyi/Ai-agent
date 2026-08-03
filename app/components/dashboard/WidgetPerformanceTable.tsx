import { DataTable, Text } from "@shopify/polaris";

type WidgetRow = {
  widgetType: string;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
};

type WidgetPerformanceTableProps = {
  rows: WidgetRow[];
  currencyCode: string;
};

export function WidgetPerformanceTable({ rows, currencyCode }: WidgetPerformanceTableProps) {
  if (rows.length === 0) {
    return (
      <Text as="p" tone="subdued">
        Widget performance appears after storefront impressions are recorded.
      </Text>
    );
  }

  return (
    <DataTable
      columnContentTypes={["text", "numeric", "numeric", "numeric", "numeric"]}
      headings={["Widget Type", "Impressions", "Clicks", "Conversions", "Rev"]}
      rows={rows.map((row) => [
        formatWidget(row.widgetType),
        row.impressions.toLocaleString(),
        row.clicks.toLocaleString(),
        row.conversions.toLocaleString(),
        formatCurrency(row.revenue, currencyCode),
      ])}
    />
  );
}

function formatWidget(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatCurrency(value: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: value >= 1000 ? "compact" : "standard",
  }).format(value);
}
