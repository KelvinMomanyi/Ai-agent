import { data as json, type LoaderFunctionArgs, useFetcher, useLoaderData } from "react-router";
import { useEffect } from "react";
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
  error?: string;
} | null;

type SyncResponse = {
  ok?: boolean;
  continue?: boolean;
  progress?: SyncProgress;
  productCount?: number;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const [metrics, productCount, syncProgress, currencyResponse] = await Promise.all([
    getDashboardMetrics(session.shop),
    prisma.product.count({ where: { shop: session.shop } }),
    getJsonCache<SyncProgress>(cacheKeys.syncProgress(session.shop)),
    admin.graphql(`#graphql\nquery AOVBoostShopCurrency { shop { currencyCode } }`),
  ]);
  const currencyResult: any = await currencyResponse.json();
  const currencyCode = /^[A-Z]{3}$/.test(currencyResult.data?.shop?.currencyCode)
    ? currencyResult.data.shop.currencyCode
    : "USD";

  return json({
    metrics,
    productCount,
    syncProgress,
    currencyCode,
    providers: {
      gemini: Boolean(process.env.GOOGLE_API_KEY),
      groq: Boolean(process.env.GROQ_API_KEY),
    },
  });
};

export default function AovBoostDashboard() {
  const { metrics, providers, productCount, syncProgress, currencyCode } =
    useLoaderData<typeof loader>();
  const syncFetcher = useFetcher<SyncResponse>();
  const currentProgress = syncFetcher.data?.progress ?? syncProgress;
  const currentProductCount = syncFetcher.data?.productCount ?? productCount;
  const syncShouldContinue = Boolean(
    currentProgress?.status &&
      currentProgress.status !== "complete" &&
      currentProgress.status !== "failed",
  );
  const syncIsSubmitting = syncFetcher.state !== "idle" || syncShouldContinue;
  const syncFailed =
    syncFetcher.data?.ok === false || currentProgress?.status === "failed";

  useEffect(() => {
    if (syncFetcher.state !== "idle" || !syncShouldContinue) return;
    syncFetcher.submit(
      { intent: "continue" },
      { method: "post", action: "/api/sync" },
    );
  }, [syncFetcher, syncShouldContinue]);

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
          syncFetcher.submit(
            { intent: "restart" },
            { method: "post", action: "/api/sync" },
          ),
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
            <AovMetricCard
              label="Avg AOV"
              value={formatCurrency(metrics.avgAov, currencyCode)}
            />
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
              <RevenueChart data={metrics.revenueSeries} currencyCode={currencyCode} />
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Widget performance
              </Text>
              <WidgetPerformanceTable rows={metrics.widgetRows} currencyCode={currencyCode} />
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
  if (failed) {
    return progress?.error || "Product sync failed. Check the app logs and Shopify product scopes.";
  }
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

function formatCurrency(value: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(value);
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}
