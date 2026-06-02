import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Badge, BlockStack, Card, InlineStack, Layout, Page, Text } from "@shopify/polaris";
import { AovMetricCard } from "../components/dashboard/AovMetricCard";
import { RevenueChart } from "../components/dashboard/RevenueChart";
import { WidgetPerformanceTable } from "../components/dashboard/WidgetPerformanceTable";
import { getDashboardMetrics } from "../models/analytics.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const metrics = await getDashboardMetrics(session.shop);

  return json({
    metrics,
    providers: {
      gemini: Boolean(process.env.GOOGLE_API_KEY),
      groq: Boolean(process.env.GROQ_API_KEY),
    },
  });
};

export default function AovBoostDashboard() {
  const { metrics, providers } = useLoaderData<typeof loader>();

  return (
    <Page
      title="AOVBoost Dashboard"
      subtitle="Last 30 days"
      primaryAction={{ content: "Sync products", url: "/api/sync" }}
      secondaryActions={[
        { content: "Bundles", url: "/app/bundles" },
        { content: "Experiments", url: "/app/experiments" },
      ]}
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
            <AovMetricCard label="Avg AOV" value={formatCurrency(metrics.avgAov)} />
            <AovMetricCard label="AOV Lift" value={formatPercent(metrics.aovLift)} />
            <AovMetricCard label="Widget CTR" value={formatPercent(metrics.widgetCtr)} />
            <AovMetricCard
              label="Chat Engaged"
              value={metrics.chatEngaged.toLocaleString()}
            />
          </div>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Revenue attributed to AOVBoost
              </Text>
              <RevenueChart data={metrics.revenueSeries} />
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Widget performance
              </Text>
              <WidgetPerformanceTable rows={metrics.widgetRows} />
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                AI Provider Status
              </Text>
              <InlineStack gap="200">
                <Badge tone={providers.gemini ? "success" : "critical"}>
                  Gemini {providers.gemini ? "active" : "missing"}
                </Badge>
                <Badge tone={providers.groq ? "success" : "critical"}>
                  Groq {providers.groq ? "active" : "missing"}
                </Badge>
              </InlineStack>
              {!providers.gemini && !providers.groq ? (
                <Text as="p" tone="subdued">
                  Heuristic fallback is active until an AI key is configured.
                </Text>
              ) : null}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}
