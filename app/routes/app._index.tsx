import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { Badge, BlockStack, Card, InlineStack, Layout, Page, Text } from "@shopify/polaris";
import { AovMetricCard } from "../components/dashboard/AovMetricCard";
import { RevenueChart } from "../components/dashboard/RevenueChart";
import { WidgetPerformanceTable } from "../components/dashboard/WidgetPerformanceTable";
import prisma from "../db.server";
import { getDashboardMetrics } from "../models/analytics.server";
import { cacheKeys, getJsonCache } from "../redis.server";
import { authenticate } from "../shopify.server";

type SyncProgress = {
  total?: number;
  done?: number;
  status?: string;
} | null;

type SyncResponse = {
  ok?: boolean;
  progress?: SyncProgress;
  productCount?: number;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const [metrics, productCount, syncProgress] = await Promise.all([
    getDashboardMetrics(session.shop),
    prisma.product.count({ where: { shop: session.shop } }),
    getJsonCache<SyncProgress>(cacheKeys.syncProgress(session.shop)),
  ]);

  return json({
    metrics,
    productCount,
    syncProgress,
    providers: {
      gemini: Boolean(process.env.GOOGLE_API_KEY),
      groq: Boolean(process.env.GROQ_API_KEY),
    },
  });
};

export default function AovBoostDashboard() {
  const { metrics, providers, productCount, syncProgress } =
    useLoaderData<typeof loader>();
  const syncFetcher = useFetcher<SyncResponse>();
  const currentProgress = syncFetcher.data?.progress ?? syncProgress;
  const currentProductCount = syncFetcher.data?.productCount ?? productCount;
  const syncIsSubmitting = syncFetcher.state !== "idle";
  const syncFailed = syncFetcher.data?.ok === false;

  return (
    <Page
      title="AOVBoost Dashboard"
      subtitle="Last 30 days"
      primaryAction={{
        content: syncIsSubmitting
          ? "Syncing products"
          : currentProductCount > 0
            ? "Resync products"
            : "Sync products",
        loading: syncIsSubmitting,
        disabled: syncIsSubmitting,
        onAction: () =>
          syncFetcher.submit({}, { method: "post", action: "/api/sync" }),
      }}
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
                Product catalog
              </Text>
              <InlineStack gap="200">
                <Badge tone={currentProductCount > 0 ? "success" : "critical"}>
                  {`${currentProductCount.toLocaleString()} synced`}
                </Badge>
                {currentProgress?.status ? (
                  <Badge tone={syncFailed ? "critical" : "info"}>
                    {formatStatus(currentProgress.status)}
                  </Badge>
                ) : null}
              </InlineStack>
              <Text as="p" tone={syncFailed ? "critical" : "subdued"}>
                {getCatalogStatusText(currentProductCount, currentProgress, syncFailed)}
              </Text>
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
                  {`Gemini ${providers.gemini ? "active" : "missing"}`}
                </Badge>
                <Badge tone={providers.groq ? "success" : "critical"}>
                  {`Groq ${providers.groq ? "active" : "missing"}`}
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

function getCatalogStatusText(
  productCount: number,
  progress: SyncProgress,
  failed: boolean,
) {
  if (failed) return "Product sync failed. Check the app logs and Shopify product scopes.";
  if (progress?.status && progress.status !== "complete") {
    const done = Number(progress.done || 0);
    const total = Number(progress.total || 0);
    const count = total > 0 ? `${done.toLocaleString()} of ${total.toLocaleString()}` : done.toLocaleString();
    return `Catalog sync is ${formatStatus(progress.status).toLowerCase()} (${count}).`;
  }
  if (productCount > 0) {
    return "Chat and widgets can now recommend exact products from this store.";
  }
  return "No products are synced yet. Sync before storefront chat can recommend exact items.";
}

function formatStatus(status: string) {
  return status.replace(/_/g, " ");
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
