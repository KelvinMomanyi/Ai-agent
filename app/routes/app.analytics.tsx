import { data as json, type LoaderFunctionArgs, useLoaderData } from "react-router";
import {
  Badge,
  Banner,
  BlockStack,
  Card,
  DataTable,
  InlineStack,
  Layout,
  Page,
  Text,
} from "@shopify/polaris";
import { getRevenueAnalytics } from "../models/analytics.server";
import { authenticate } from "../shopify.server";
import UpsellChart from "./components/UpsellChart";
import UpsellTimeSeriesChart from "./components/UpsellTimeSeriesChart";

const WINDOW_DAYS = 30;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const from = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const [report, shopResponse] = await Promise.all([
    getRevenueAnalytics(session.shop, from),
    admin.graphql(`#graphql
      query AOVBoostAnalyticsCurrency {
        shop { currencyCode }
      }
    `),
  ]);
  const shopJson = await shopResponse.json();
  const currencyCode = /^[A-Z]{3}$/.test(shopJson.data?.shop?.currencyCode)
    ? shopJson.data.shop.currencyCode
    : "USD";

  return json({ report, currencyCode, windowDays: WINDOW_DAYS });
};

export default function RevenueDashboard() {
  const { report, currencyCode, windowDays } = useLoaderData<typeof loader>();
  const { dashboard, funnel } = report;
  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currencyCode,
    }).format(amount);
  const metricCards = [
    {
      label: "Attributed revenue",
      value: formatCurrency(dashboard.attributedRevenue),
      caption: "Discounted line revenue linked to converted offers.",
    },
    {
      label: "Offer impressions",
      value: funnel.impressions.toLocaleString(),
      caption: "Offers confirmed as rendered by the storefront.",
    },
    {
      label: "Click-through rate",
      value:
        funnel.impressions > 0
          ? formatPercent(funnel.clicks / funnel.impressions)
          : "Not available",
      caption: `${funnel.clicks.toLocaleString()} recorded offer clicks.`,
    },
    {
      label: "Offer conversion rate",
      value:
        funnel.impressions > 0
          ? formatPercent(funnel.conversions / funnel.impressions)
          : "Not available",
      caption: "Signed order conversions divided by impressions.",
    },
    {
      label: "Attributed-order AOV",
      value:
        dashboard.attributedOrderCount > 0
          ? formatCurrency(dashboard.avgAov)
          : "Not available",
      caption: `${dashboard.attributedOrderCount.toLocaleString()} attributed orders.`,
    },
    {
      label: "Observed AOV lift",
      value: dashboard.aovLiftAvailable
        ? formatPercent(dashboard.aovLift)
        : "Not available",
      caption: dashboard.aovLiftAvailable
        ? "Compared with orders without an attributed offer."
        : "Requires both attributed and unattributed orders.",
    },
  ];
  const funnelData = [
    { name: "Generated", count: funnel.generated, color: "#6B7280" },
    { name: "Impressions", count: funnel.impressions, color: "#2563EB" },
    { name: "Clicks", count: funnel.clicks, color: "#059669" },
    { name: "Conversions", count: funnel.conversions, color: "#D97706" },
  ];
  const offerRows = report.offerRows.map((offer) => [
    offer.name,
    formatLabel(offer.widgetType),
    offer.generated.toLocaleString(),
    offer.impressions.toLocaleString(),
    offer.clicks.toLocaleString(),
    offer.conversions.toLocaleString(),
    formatCurrency(offer.revenue),
    offer.impressions > 0
      ? formatPercent(offer.clicks / offer.impressions)
      : "Not available",
  ]);
  const experimentRows = report.experimentRows.map((experiment) => [
    experiment.experiment,
    formatLabel(experiment.variant),
    experiment.generated.toLocaleString(),
    experiment.impressions.toLocaleString(),
    experiment.clicks.toLocaleString(),
    experiment.conversions.toLocaleString(),
    formatCurrency(experiment.revenue),
    experiment.impressions > 0
      ? formatPercent(experiment.clicks / experiment.impressions)
      : "Not available",
  ]);
  const journeyRows = report.journeyRows.map((journey) => [
    formatLabel(journey.journeyStage),
    journey.sessions.toLocaleString(),
    journey.convertedSessions.toLocaleString(),
    formatCurrency(journey.revenue),
    formatCurrency(journey.sessions ? journey.revenue / journey.sessions : 0),
  ]);

  return (
    <Page
      title="Revenue analytics"
      subtitle="Authoritative offer engagement and signed order outcomes"
    >
      <Layout>
        <Layout.Section>
          <Banner title="About this report" tone="info">
            <Text as="p">
              This report uses a rolling {windowDays}-day window. AOV lift is an
              observational comparison between orders with and without an
              attributed AOVBoost offer; it is not a randomized causal estimate.
            </Text>
          </Banner>
        </Layout.Section>

        <Layout.Section>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: "12px",
            }}
          >
            {metricCards.map((metric) => (
              <Card key={metric.label}>
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">
                    {metric.label}
                  </Text>
                  <Text as="p" variant="headingLg">
                    {metric.value}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {metric.caption}
                  </Text>
                </BlockStack>
              </Card>
            ))}
          </div>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack gap="200">
                <Badge tone="success">Authoritative records</Badge>
                <Badge>
                  {funnel.impressions > 0
                    ? `${Math.round(report.bundleShare * 100)}% bundle mix`
                    : "Bundle mix unavailable"}
                </Badge>
                <Badge>{`${windowDays}-day window`}</Badge>
              </InlineStack>
              <Text as="h2" variant="headingMd">
                Performance insights
              </Text>
              <BlockStack gap="200">
                {report.insights.map((insight) => (
                  <Text as="p" variant="bodyMd" key={insight}>
                    {insight}
                  </Text>
                ))}
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
              gap: "16px",
            }}
          >
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Offer funnel
                </Text>
                <UpsellChart data={funnelData} />
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  30-day engagement trend
                </Text>
                {report.timeSeries.length > 0 ? (
                  <UpsellTimeSeriesChart data={report.timeSeries} />
                ) : (
                  <Text as="p" tone="subdued">
                    No offers were generated in this reporting window.
                  </Text>
                )}
              </BlockStack>
            </Card>
          </div>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Top revenue offers
              </Text>
              {offerRows.length > 0 ? (
                <DataTable
                  columnContentTypes={[
                    "text",
                    "text",
                    "numeric",
                    "numeric",
                    "numeric",
                    "numeric",
                    "numeric",
                    "numeric",
                  ]}
                  headings={[
                    "Offer",
                    "Widget",
                    "Generated",
                    "Impressions",
                    "Clicks",
                    "Conversions",
                    "Revenue",
                    "CTR",
                  ]}
                  rows={offerRows}
                />
              ) : (
                <Text as="p" tone="subdued">
                  No offers were generated in this reporting window.
                </Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Experiment variant performance
              </Text>
              {experimentRows.length > 0 ? (
                <DataTable
                  columnContentTypes={[
                    "text",
                    "text",
                    "numeric",
                    "numeric",
                    "numeric",
                    "numeric",
                    "numeric",
                    "numeric",
                  ]}
                  headings={[
                    "Experiment",
                    "Variant",
                    "Generated",
                    "Impressions",
                    "Clicks",
                    "Conversions",
                    "Revenue",
                    "CTR",
                  ]}
                  rows={experimentRows}
                />
              ) : (
                <Text as="p" tone="subdued">
                  No experiment-attributed offers were generated in this window.
                </Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Shopper journey stages
              </Text>
              <Text as="p" tone="subdued">
                Sessions are grouped by their latest computed journey stage.
              </Text>
              {journeyRows.length > 0 ? (
                <DataTable
                  columnContentTypes={[
                    "text",
                    "numeric",
                    "numeric",
                    "numeric",
                    "numeric",
                  ]}
                  headings={[
                    "Journey stage",
                    "Sessions",
                    "Converted sessions",
                    "Attributed revenue",
                    "Average revenue/session",
                  ]}
                  rows={journeyRows}
                />
              ) : (
                <Text as="p" tone="subdued">
                  No shopper sessions were active in this reporting window.
                </Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
