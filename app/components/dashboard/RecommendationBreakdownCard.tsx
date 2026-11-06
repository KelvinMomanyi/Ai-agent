import { BlockStack, Card, DataTable, Text } from "@shopify/polaris";
import type { RecommendationBreakdowns } from "../../models/recommendationBreakdown.server";

const originLabels: Record<string, string> = {
  merchant: "Merchant pairings only",
  autopilot: "Autopilot pairings only",
  affinity: "Co-purchase pairings only",
  catalog: "Catalog fallback only",
  mixed: "Mixed pairing origins",
  unknown: "Unknown pairing origin",
};
const placementLabels: Record<string, string> = {
  native_drawer: "Cart drawer",
  cart_page: "Cart page",
  floating_card: "Floating card",
  unknown: "Unknown or unverified placement",
};
type Row = RecommendationBreakdowns["byOrigin"][number];
const rate = (n: number, denominator: number, value: number | null) =>
  `${n.toLocaleString()} / ${denominator.toLocaleString()}${value === null ? "" : ` (${(value * 100).toFixed(1)}%)`}`;
const revenue = (amounts: Row["amounts"]) =>
  amounts.length
    ? amounts
        .map((amount) =>
          amount.currency
            ? new Intl.NumberFormat("en", {
                style: "currency",
                currency: amount.currency,
              }).format(amount.revenue)
            : `${new Intl.NumberFormat("en").format(amount.revenue)} (currency unavailable)`,
        )
        .join("; ")
    : "No attributed revenue";
function BreakdownTable({
  rows,
  labels,
}: {
  rows: Row[];
  labels: Record<string, string>;
}) {
  return (
    <DataTable
      columnContentTypes={[
        "text",
        "numeric",
        "text",
        "text",
        "text",
        "text",
        "text",
      ]}
      headings={[
        "Group",
        "Displayed offers",
        "Clicked / displayed",
        "Cart add / clicked",
        "Purchased / added",
        "Attributed line revenue",
        "Sample",
      ]}
      rows={rows.map((row) => [
        labels[row.bucket] || "Unknown",
        row.displayed.toLocaleString(),
        rate(row.clicked, row.displayed, row.clickRate),
        rate(row.added, row.clicked, row.addRate),
        rate(row.purchased, row.added, row.purchaseRate),
        revenue(row.amounts),
        row.ready ? "Descriptive sample" : "Not enough data yet",
      ])}
    />
  );
}
export function RecommendationBreakdownCard({
  report,
}: {
  report: RecommendationBreakdowns;
}) {
  const displayed = report.byOrigin.reduce(
    (sum, row) => sum + row.displayed,
    0,
  );
  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">
          Cart recommendation breakdowns
        </Text>
        <Text as="p" tone="subdued">
          These are descriptive results for displayed cart offers in the
          selected period, not measured lift. The randomized holdout above
          measures the whole system. These groups are not randomized; their
          rates do not establish which pairing origin or placement caused a
          purchase.
        </Text>
        {!displayed ? (
          <Text as="p">
            No displayed cart recommendations in this period. Not enough data
            yet.
          </Text>
        ) : (
          <>
            <Text as="h3" variant="headingSm">
              Served offer composition by pairing origin
            </Text>
            <BreakdownTable rows={report.byOrigin} labels={originLabels} />
            <Text as="p" tone="subdued">
              Each offer counts once. Mixed offers contain several pairing
              origins; incomplete historical records stay Unknown. Origin
              reflects the pairings when the offer was served; later approval
              changes do not rewrite this history. This describes the served
              offer, not each card&apos;s visibility; the storefront may drop an
              unavailable card before displaying it.
            </Text>
            <Text as="h3" variant="headingSm">
              By first recorded placement
            </Text>
            <BreakdownTable
              rows={report.byPlacement}
              labels={placementLabels}
            />
            <Text as="p" tone="subdued">
              Placement uses the first reported display. A named placement
              requires a display that passed visibility checks; missing or
              unverified records stay Unknown. These checks run in the
              shopper&apos;s browser, not an independent display audit.
            </Text>
          </>
        )}
        <Text as="p" tone="subdued">
          Rates appear after {report.minimumDisplays} displayed offers per group
          and show their denominator. Purchases and revenue use Shopify order
          data for a recommended product after its confirmed cart add. Revenue
          is attributed, before returns, and kept separate by currency. Each
          table partitions the same offers; do not add the tables together.
        </Text>
      </BlockStack>
    </Card>
  );
}
