import { json } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  DataTable,
  Text,
  BlockStack,
  InlineStack,
  Badge,
} from "@shopify/polaris";
import { useMemo } from "react";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import UpsellChart from "./components/UpsellChart";
import UpsellTimeSeriesChart from "./components/UpsellTimeSeriesChart";

type EventData = {
  event: string;
  timestamp: string;
  data: Record<string, any>;
};

type ShopData = {
  currencyCode: string;
  currencyFormats?: {
    moneyFormat?: string;
  };
};

type LoaderData = {
  events: EventData[];
  shop: ShopData;
};

type OfferPerformance = {
  name: string;
  impressions: number;
  adds: number;
  conversions: number;
  revenue: number;
  mode: string;
  placement: string;
  experiment: string;
  offerType: string;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  const [events, shopResponse] = await Promise.all([
    prisma.event.findMany({
      where: {
        storeId: session.shop,
        timestamp: {
          gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        },
      },
      orderBy: { timestamp: "desc" },
    }),
    admin.graphql(`#graphql
      query getShop {
        shop {
          currencyCode
          currencyFormats {
            moneyFormat
          }
        }
      }
    `),
  ]);

  const shopJson = await shopResponse.json();

  return json({
    events,
    shop: shopJson.data.shop,
  });
};

export default function RevenueDashboard() {
  const { events, shop } = useLoaderData<LoaderData>();

  const dashboard = useMemo(() => processEvents(events), [events]);
  const formatCurrency = (amount: number) => formatMoney(amount, shop);

  const metricCards = [
    {
      label: "Attributed revenue",
      value: formatCurrency(dashboard.metrics.revenue),
    },
    {
      label: "Offer impressions",
      value: dashboard.metrics.impressions.toLocaleString(),
    },
    {
      label: "Add rate",
      value: formatPercent(dashboard.metrics.addRate),
    },
    {
      label: "Conversion rate",
      value: formatPercent(dashboard.metrics.conversionRate),
    },
    {
      label: "Abandoned opportunity",
      value: formatCurrency(dashboard.metrics.abandonedOpportunity),
    },
  ];

  const chartData = [
    { name: "Generated", count: dashboard.metrics.generated, color: "#6B7280" },
    { name: "Impressions", count: dashboard.metrics.impressions, color: "#2563EB" },
    { name: "Adds", count: dashboard.metrics.adds, color: "#059669" },
    { name: "Conversions", count: dashboard.metrics.conversions, color: "#D97706" },
  ];

  const offerRows = dashboard.offerRows.map((offer) => [
    offer.name,
    offer.mode,
    offer.placement,
    offer.offerType,
    offer.impressions.toString(),
    offer.adds.toString(),
    offer.conversions.toString(),
    formatCurrency(offer.revenue),
    formatPercent(offer.impressions ? offer.adds / offer.impressions : 0),
  ]);

  const experimentRows = dashboard.experimentRows.map((experiment) => [
    experiment.variant,
    experiment.impressions.toString(),
    experiment.adds.toString(),
    formatPercent(experiment.impressions ? experiment.adds / experiment.impressions : 0),
    experiment.revenue ? formatCurrency(experiment.revenue) : formatCurrency(0),
  ]);

  return (
    <Page
      title="Revenue Dashboard"
      subtitle="Track revenue outcomes, winning offers, AI experiments, and customer segments."
    >
      <Layout>
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
                </BlockStack>
              </Card>
            ))}
          </div>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack gap="200">
                <Badge>Revenue engine</Badge>
                <Badge>{dashboard.metrics.bundleShareLabel}</Badge>
                <Badge>{dashboard.metrics.topMode || "No mode data"}</Badge>
              </InlineStack>
              <Text as="h2" variant="headingMd">
                AI Insights
              </Text>
              <BlockStack gap="200">
                {dashboard.insights.map((insight) => (
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
                  Revenue Funnel
                </Text>
                <UpsellChart data={chartData} />
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  30-Day Trend
                </Text>
                <UpsellTimeSeriesChart data={dashboard.timeSeriesData} />
              </BlockStack>
            </Card>
          </div>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Top Revenue Offers
              </Text>
              {offerRows.length > 0 ? (
                <DataTable
                  columnContentTypes={[
                    "text",
                    "text",
                    "text",
                    "text",
                    "numeric",
                    "numeric",
                    "numeric",
                    "numeric",
                    "numeric",
                  ]}
                  headings={[
                    "Offer",
                    "Mode",
                    "Placement",
                    "Type",
                    "Impressions",
                    "Adds",
                    "Conversions",
                    "Revenue",
                    "Add rate",
                  ]}
                  rows={offerRows}
                />
              ) : (
                <Text as="p" tone="subdued">
                  No offer activity yet.
                </Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                AI Experiment Performance
              </Text>
              {experimentRows.length > 0 ? (
                <DataTable
                  columnContentTypes={[
                    "text",
                    "numeric",
                    "numeric",
                    "numeric",
                    "numeric",
                  ]}
                  headings={["Variant", "Impressions", "Adds", "Add rate", "Revenue"]}
                  rows={experimentRows}
                />
              ) : (
                <Text as="p" tone="subdued">
                  Experiment results appear after impressions and add-to-cart events.
                </Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
        
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Visitor Intent Segments
              </Text>
              {dashboard.intentRows.length > 0 ? (
                <DataTable
                  columnContentTypes={[
                    "text",
                    "numeric",
                    "numeric",
                  ]}
                  headings={["Intent Profile", "Visitors", "Average Revenue"]}
                  rows={dashboard.intentRows}
                />
              ) : (
                <Text as="p" tone="subdued">
                  No visitor intent data available yet.
                </Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function processEvents(events: EventData[]) {
  const offers = new Map<string, OfferPerformance>();
  const experiments = new Map<
    string,
    { variant: string; impressions: number; adds: number; revenue: number }
  >();
  const timeSeries = new Map<
    string,
    { date: string; impressions: number; clicks: number; conversions: number; revenue: number }
  >();
  const modes = new Map<string, number>();
  const placements = new Map<string, number>();
  const trafficSources = new Map<string, { impressions: number; adds: number }>();
  const intents = new Map<string, { visitors: Set<string>; revenue: number }>();

  let generated = 0;
  let impressions = 0;
  let adds = 0;
  let conversions = 0;
  let revenue = 0;
  let offerValueTotal = 0;
  let offerValueCount = 0;
  let bundleImpressions = 0;

  for (const event of events) {
    const data = event.data || {};
    const date = new Date(event.timestamp).toISOString().split("T")[0];
    const day = ensureDay(timeSeries, date);
    const offerName = getOfferName(data);
    const offer = ensureOffer(offers, offerName, data);
    const experimentKey = data.experimentVariant || data.experimentId;
    const trafficSource = data.behavior?.trafficSource || data.trafficSource || "direct";

    if (data.modeLabel || data.mode) increment(modes, data.modeLabel || data.mode);
    if (data.placement) increment(placements, data.placement);
    if (trafficSource) {
      const source = trafficSources.get(trafficSource) || { impressions: 0, adds: 0 };
      trafficSources.set(trafficSource, source);
    }

    if (event.event === "offer_generated") {
      generated += 1;
    }

    if (event.event === "upsell_impression") {
      impressions += 1;
      offer.impressions += 1;
      day.impressions += 1;
      trafficSources.get(trafficSource)!.impressions += 1;
      if (data.offerType === "bundle" || data.bundleId) bundleImpressions += 1;
      if (experimentKey) ensureExperiment(experiments, experimentKey, data).impressions += 1;
      const offerValue = getOfferValue(data);
      if (offerValue > 0) {
        offerValueTotal += offerValue;
        offerValueCount += 1;
      }
    }

    if (event.event === "upsell_add_to_cart") {
      adds += 1;
      offer.adds += 1;
      day.clicks += 1;
      trafficSources.get(trafficSource)!.adds += 1;
      if (experimentKey) ensureExperiment(experiments, experimentKey, data).adds += 1;
    }

    if (event.event === "conversion") {
      const orderRevenue = getOrderRevenue(data);
      conversions += 1;
      revenue += orderRevenue;
      offer.conversions += 1;
      offer.revenue += orderRevenue;
      day.conversions += 1;
      day.revenue += orderRevenue;
      if (experimentKey) ensureExperiment(experiments, experimentKey, data).revenue += orderRevenue;
      
      const intentProfile = data.behavior?.intentProfile || "unknown";
      if (!intents.has(intentProfile)) intents.set(intentProfile, { visitors: new Set(), revenue: 0 });
      const intentData = intents.get(intentProfile)!;
      if (data.visitorId) intentData.visitors.add(data.visitorId);
      intentData.revenue += orderRevenue;
    }
  }

  const averageOfferValue = offerValueCount ? offerValueTotal / offerValueCount : 0;
  const abandonedOpportunity = Math.max(impressions - adds, 0) * averageOfferValue;
  const topMode = topKey(modes);
  const topPlacement = topKey(placements);
  const topTraffic = topTrafficSource(trafficSources);
  const bundleShare = impressions ? bundleImpressions / impressions : 0;

  const offerRows = Array.from(offers.values())
    .filter((offer) => offer.impressions || offer.adds || offer.conversions)
    .sort((a, b) => b.revenue - a.revenue || b.adds - a.adds)
    .slice(0, 10);

  const experimentRows = Array.from(experiments.values()).sort(
    (a, b) => b.revenue - a.revenue || b.adds - a.adds,
  );

  const timeSeriesData = Array.from(timeSeries.values()).sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  
  const intentRows = Array.from(intents.entries()).map(([intent, data]) => [
    intent,
    data.visitors.size.toString(),
    data.visitors.size ? (data.revenue / data.visitors.size).toFixed(2) : "0.00",
  ]);

  return {
    metrics: {
      generated,
      impressions,
      adds,
      conversions,
      revenue,
      addRate: impressions ? adds / impressions : 0,
      conversionRate: adds ? conversions / adds : 0,
      abandonedOpportunity,
      topMode,
      topPlacement,
      bundleShareLabel: `${Math.round(bundleShare * 100)}% bundle mix`,
    },
    offerRows,
    experimentRows,
    timeSeriesData,
    intentRows,
    insights: buildInsights({
      topMode,
      topPlacement,
      topTraffic,
      bundleShare,
      abandonedOpportunity,
      impressions,
      adds,
    }),
  };
}

function ensureOffer(
  offers: Map<string, OfferPerformance>,
  name: string,
  data: Record<string, any>,
) {
  const existing = offers.get(name);
  if (existing) return existing;

  const offer = {
    name,
    impressions: 0,
    adds: 0,
    conversions: 0,
    revenue: 0,
    mode: data.modeLabel || data.mode || "Unknown",
    placement: data.placement || "Unknown",
    experiment: data.experimentVariant || "Baseline",
    offerType: data.offerType || (data.bundleId ? "bundle" : "single"),
  };

  offers.set(name, offer);
  return offer;
}

function ensureExperiment(
  experiments: Map<string, { variant: string; impressions: number; adds: number; revenue: number }>,
  key: string,
  data: Record<string, any>,
) {
  const existing = experiments.get(key);
  if (existing) return existing;

  const experiment = {
    variant: data.experimentVariant || key,
    impressions: 0,
    adds: 0,
    revenue: 0,
  };

  experiments.set(key, experiment);
  return experiment;
}

function ensureDay(
  timeSeries: Map<string, { date: string; impressions: number; clicks: number; conversions: number; revenue: number }>,
  date: string,
) {
  const existing = timeSeries.get(date);
  if (existing) return existing;

  const day = { date, impressions: 0, clicks: 0, conversions: 0, revenue: 0 };
  timeSeries.set(date, day);
  return day;
}

function getOfferName(data: Record<string, any>) {
  return (
    data.bundleTitle ||
    data.title ||
    data.product_title ||
    data.name ||
    data.id ||
    "Revenue offer"
  );
}

function getOfferValue(data: Record<string, any>) {
  if (data.bundle?.discountedTotal) return parseFloat(data.bundle.discountedTotal) || 0;
  if (data.discountedTotal) return parseFloat(data.discountedTotal) || 0;
  if (data.price) return parseFloat(data.price) || 0;
  if (data.final_price) return Number(data.final_price) / 100;
  return 0;
}

function getOrderRevenue(data: Record<string, any>) {
  if (data.total_price) return parseFloat(String(data.total_price)) || 0;
  if (!Array.isArray(data.line_items)) return 0;

  return data.line_items.reduce((sum: number, item: Record<string, any>) => {
    const price = parseFloat(String(item.price || "0")) || 0;
    return sum + price * (item.quantity || 1);
  }, 0);
}

function buildInsights(input: {
  topMode: string;
  topPlacement: string;
  topTraffic: string;
  bundleShare: number;
  abandonedOpportunity: number;
  impressions: number;
  adds: number;
}) {
  const insights = [];

  if (input.topMode) {
    insights.push(`${input.topMode} is currently the most active optimization goal.`);
  }

  if (input.topPlacement) {
    insights.push(`${input.topPlacement} is the leading placement for recent offers.`);
  }

  if (input.topTraffic) {
    insights.push(`${input.topTraffic} traffic is producing the strongest offer engagement.`);
  }

  if (input.bundleShare > 0.4) {
    insights.push("Dynamic bundles are a major part of the offer mix, which supports higher AOV positioning.");
  } else {
    insights.push("Single-product offers still dominate. More bundle testing may uncover larger order-value gains.");
  }

  if (input.impressions > input.adds && input.abandonedOpportunity > 0) {
    insights.push("Abandoned opportunity value shows how much accepted-offer revenue is being left in the funnel.");
  }

  return insights.length ? insights : ["Revenue insights appear after the storefront block records offer activity."];
}

function topTrafficSource(
  trafficSources: Map<string, { impressions: number; adds: number }>,
) {
  let winner = "";
  let winnerRate = 0;

  for (const [source, stats] of trafficSources.entries()) {
    const rate = stats.impressions ? stats.adds / stats.impressions : 0;
    if (rate > winnerRate) {
      winner = source;
      winnerRate = rate;
    }
  }

  return winner;
}

function topKey(values: Map<string, number>) {
  return Array.from(values.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}

function increment(values: Map<string, number>, key: string) {
  values.set(key, (values.get(key) || 0) + 1);
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatMoney(amount: number, shop: ShopData) {
  const formattedAmount = amount.toFixed(2);

  if (shop.currencyFormats?.moneyFormat) {
    return shop.currencyFormats.moneyFormat
      .replace("{{amount}}", formattedAmount)
      .replace("{{amount_with_comma_separator}}", formattedAmount.replace(".", ","))
      .replace("{{amount_no_decimals}}", Math.round(amount).toString())
      .replace(
        "{{amount_with_comma_separator_no_decimals}}",
        Math.round(amount).toString().replace(".", ","),
      );
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: shop.currencyCode || "USD",
  }).format(amount);
}
