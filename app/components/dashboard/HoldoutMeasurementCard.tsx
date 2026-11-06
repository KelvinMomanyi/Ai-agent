import { useFetcher } from "react-router";
import {
  Banner,
  BlockStack,
  Button,
  Card,
  DataTable,
  InlineStack,
  Text,
} from "@shopify/polaris";
import type { getHoldoutReport } from "../../models/holdoutAnalytics.server";
import { RecommendationBreakdownCard } from "./RecommendationBreakdownCard";
type Report = Awaited<ReturnType<typeof getHoldoutReport>>;
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
export function HoldoutMeasurementCard({
  report,
  fallbackCurrency,
  planPrice = null,
}: {
  report: Report;
  fallbackCurrency: string;
  planPrice?: number | null;
}) {
  const pause = useFetcher<{ ok: boolean }>();
  const currency = report.currency || fallbackCurrency;
  const money = (value: number | null, code: string | null = currency) =>
    value === null
      ? "Not available"
      : !code || !/^[A-Z]{3}$/.test(code)
        ? `${new Intl.NumberFormat("en").format(value)} (currency unavailable)`
        : new Intl.NumberFormat("en", {
            style: "currency",
            currency: code,
          }).format(value);
  const arms = [report.exposed, report.holdout];
  const funnel = report.funnel;
  return (
    <BlockStack gap="400">
      {report.guardrail && report.enabled ? (
        <Banner
          tone="critical"
          title="Conversion is lower in the recommendation arm"
        >
          <BlockStack gap="200">
            <Text as="p">
              The mature recommendation arm converts materially and
              significantly less often than holdout. Review the offers and
              consider pausing cart recommendations.
            </Text>
            <Button
              tone="critical"
              loading={pause.state !== "idle"}
              disabled={!report.recommendationsEnabled || pause.data?.ok}
              onClick={() =>
                pause.submit(
                  { intent: "pause_recommendations" },
                  { method: "post" },
                )
              }
            >
              Pause cart recommendations
            </Button>
            {pause.data?.ok ? (
              <Text as="p">Cart recommendations are paused.</Text>
            ) : null}
          </BlockStack>
        </Banner>
      ) : null}
      <Card>
        <BlockStack gap="300">
          <InlineStack align="space-between">
            <Text as="h2" variant="headingMd">
              Measured lift
            </Text>
            <Button url="/app/settings">Measurement settings</Button>
          </InlineStack>
          {!report.recommendationsEnabled ? (
            <Text as="p">Cart recommendations are paused.</Text>
          ) : null}
          <Text as="p" variant="headingLg">
            {report.reportingAvailable === false
              ? "Holdout reporting is included with Pro"
              : !report.enabled
                ? "Holdout is off"
                : report.lift === null
                  ? report.status
                  : `${report.lift >= 0 ? "+" : ""}${percent(report.lift)} conversion`}
          </Text>
          {report.reportingAvailable !== false ? (
            <>
              <Text as="p" tone="subdued">
                A shopper session is one saved anonymous browser identity per
                experiment version, compared whether or not a card appears.
                Exposed means assigned to recommendations, not confirmed
                display. Each session has seven days of follow-up;{" "}
                {report.pendingSessions.toLocaleString()} recent sessions are
                still waiting.
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
                ]}
                headings={[
                  "Assigned group",
                  "Mature sessions",
                  "Converted sessions",
                  "Orders",
                  "Conversion",
                  "AOV",
                  "Revenue / session",
                ]}
                rows={arms.map((arm) => [
                  arm.arm === "exposed" ? "Exposed (assigned)" : "Holdout",
                  arm.sessions.toLocaleString(),
                  arm.convertedSessions.toLocaleString(),
                  arm.orders.toLocaleString(),
                  percent(arm.conversionRate),
                  money(arm.aov),
                  money(arm.revenuePerSession),
                ])}
              />
              <Text as="p" tone="subdued">
                Conversion uses sessions with at least one linked order /
                assigned sessions. AOV and revenue per session are descriptive;
                no incremental revenue claim is made. Amounts are withheld when
                currencies differ. Cart linkage: exposed{" "}
                {report.exposed.cartSessions
                  ? percent(report.exposed.linkCoverage)
                  : "Not available"}
                , holdout{" "}
                {report.holdout.cartSessions
                  ? percent(report.holdout.linkCoverage)
                  : "Not available"}
                .
              </Text>
            </>
          ) : (
            <Button url="/app/plan">View plans</Button>
          )}
        </BlockStack>
      </Card>
      <Card>
        <BlockStack gap="300">
          <Text as="h2" variant="headingMd">
            Recommendation funnel
          </Text>
          <DataTable
            columnContentTypes={["text", "numeric", "text"]}
            headings={["Stage", "Offers", "Explicit denominator"]}
            rows={[
              [
                "Displayed",
                funnel.displayed.toLocaleString(),
                "Offers with a recorded visible impression",
              ],
              [
                "Clicked",
                funnel.clicked.toLocaleString(),
                `${funnel.clicked} / ${funnel.displayed} displayed`,
              ],
              [
                "Confirmed cart add",
                funnel.added.toLocaleString(),
                `${funnel.added} / ${funnel.clicked} clicked`,
              ],
              [
                "Purchased",
                funnel.purchased.toLocaleString(),
                `${funnel.purchased} / ${funnel.added} added`,
              ],
            ]}
          />
          <Text as="p" tone="subdued">
            Stages require the preceding event in order. Purchases require a
            signed Shopify order. Generated decisions are not impressions.
          </Text>
        </BlockStack>
      </Card>
      <RecommendationBreakdownCard report={report.breakdowns} />
      <Card>
        <BlockStack gap="200">
          <Text as="h2" variant="headingMd">
            Monthly value summary
          </Text>
          <Text as="p">
            Calendar month from {report.month.start.slice(0, 10)} UTC.
            Attributed line revenue before returns, rather than incremental
            revenue.
          </Text>
          {report.month.amounts.length ? (
            report.month.amounts.map((amount) => (
              <Text as="p" key={amount.currency || "unknown"}>
                {money(amount.revenue, amount.currency)} attributed ·{" "}
                {amount.orders} linked orders (
                {amount.currency || "currency unavailable"})
              </Text>
            ))
          ) : (
            <Text as="p">No attributed order revenue this month.</Text>
          )}
          <Text as="p" tone="subdued">
            {planPrice === null
              ? "Plan price is not available yet."
              : `Plan price: ${money(planPrice)}`}
          </Text>
        </BlockStack>
      </Card>
    </BlockStack>
  );
}
