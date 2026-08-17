import { data as json, type LoaderFunctionArgs, useFetcher, useLoaderData } from "react-router";
import { useEffect, useRef } from "react";
import { Badge, BlockStack, Card, InlineStack, Layout, Page, Text } from "@shopify/polaris";
import { AovMetricCard } from "../components/dashboard/AovMetricCard";
import { RevenueChart } from "../components/dashboard/RevenueChart";
import { WidgetPerformanceTable } from "../components/dashboard/WidgetPerformanceTable";
import prisma from "../db.server";
import { getDashboardMetrics } from "../models/analytics.server";
import { getCatalogReadiness } from "../models/catalogCache.server";
import type { CatalogReadiness } from "../models/productCatalogMapping";
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
  catalogReadiness?: CatalogReadiness;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const [metrics, catalogReadiness, activeBundleCount, syncProgress, currencyResponse] = await Promise.all([
    getDashboardMetrics(session.shop),
    getCatalogReadiness(session.shop),
    prisma.bundle.count({ where: { shop: session.shop, isActive: true } }),
    getJsonCache<SyncProgress>(cacheKeys.syncProgress(session.shop)),
    admin.graphql(`#graphql\nquery AOVBoostShopCurrency { shop { currencyCode } }`),
  ]);
  const currencyResult: any = await currencyResponse.json();
  const currencyCode = /^[A-Z]{3}$/.test(currencyResult.data?.shop?.currencyCode)
    ? currencyResult.data.shop.currencyCode
    : "USD";

  return json({
    metrics,
    productCount: catalogReadiness.storedProductCount,
    catalogReadiness,
    activeBundleCount,
    syncProgress,
    currencyCode,
    providers: {
      gemini: Boolean(process.env.GOOGLE_API_KEY),
      groq: Boolean(process.env.GROQ_API_KEY),
    },
  });
};

export default function AovBoostDashboard() {
  const { metrics, providers, productCount, catalogReadiness, activeBundleCount, syncProgress, currencyCode } =
    useLoaderData<typeof loader>();
  const syncFetcher = useFetcher<SyncResponse>();
  const automaticRepairStarted = useRef(false);
  const currentProgress = syncFetcher.data?.progress ?? syncProgress;
  const currentProductCount = syncFetcher.data?.productCount ?? productCount;
  const currentReadiness =
    syncFetcher.data?.catalogReadiness ?? catalogReadiness;
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

  useEffect(() => {
    const repairCanStart =
      currentReadiness.resyncRequired &&
      !syncFailed &&
      !syncShouldContinue &&
      syncFetcher.state === "idle" &&
      !automaticRepairStarted.current;
    if (!repairCanStart) return;

    automaticRepairStarted.current = true;
    syncFetcher.submit(
      { intent: "restart" },
      { method: "post", action: "/api/sync" },
    );
  }, [currentReadiness.resyncRequired, syncFailed, syncShouldContinue, syncFetcher]);

  return (
    <Page
      title="AOVBoost Dashboard"
      subtitle="Last 30 days"
      primaryAction={{
        content: syncIsSubmitting
          ? "Syncing products"
          : currentReadiness.resyncRequired
            ? "Repair catalog sync"
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
        { content: "Analytics", url: "/app/analytics" },
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
              value={
                metrics.attributedOrderCount > 0
                  ? formatCurrency(metrics.avgAov, currencyCode)
                  : "Not available"
              }
            />
            <AovMetricCard
              label="AOV Lift"
              value={
                metrics.aovLiftAvailable
                  ? formatPercent(metrics.aovLift)
                  : "Not available"
              }
              caption="Observational, not a randomized causal estimate."
            />
            <AovMetricCard
              label="Widget CTR"
              value={
                metrics.widgetImpressions > 0
                  ? formatPercent(metrics.widgetCtr)
                  : "Not available"
              }
            />
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
                <Badge tone={currentReadiness.actionableProductCount > 0 ? "success" : "critical"}>
                  {`${currentReadiness.actionableProductCount.toLocaleString()} storefront-ready`}
                </Badge>
                <Badge tone="info">
                  {`${currentProductCount.toLocaleString()} stored`}
                </Badge>
                {currentProgress?.status ? (
                  <Badge tone={syncFailed ? "critical" : "info"}>
                    {formatStatus(currentProgress.status)}
                  </Badge>
                ) : null}
              </InlineStack>
              <Text as="p" tone={syncFailed ? "critical" : "subdued"}>
                {getCatalogStatusText(currentReadiness, currentProgress, syncFailed)}
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Storefront merchandising
              </Text>
              <InlineStack gap="200">
                <Badge tone={activeBundleCount > 0 ? "success" : "attention"}>
                  {`${activeBundleCount.toLocaleString()} active bundles`}
                </Badge>
                <Badge tone={currentReadiness.actionableProductCount > 1 ? "success" : "critical"}>
                  {`${currentReadiness.actionableProductCount.toLocaleString()} recommendation-ready`}
                </Badge>
              </InlineStack>
              <Text as="p" tone="subdued">
                {getMerchandisingStatusText(activeBundleCount, currentReadiness)}
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
  readiness: CatalogReadiness,
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
  if (readiness.resyncRequired) {
    return `${readiness.missingVariantDataCount.toLocaleString()} stored products are missing current variant data. Use Repair catalog sync so recommendations and add-to-cart actions can render safely.`;
  }
  if (readiness.actionableProductCount > 0) {
    return "The catalog has verified, sellable variants for chat and storefront recommendations.";
  }
  return "No products are synced yet. Sync before storefront chat can recommend exact items.";
}

function getMerchandisingStatusText(
  activeBundleCount: number,
  readiness: CatalogReadiness,
) {
  if (activeBundleCount === 0 && readiness.actionableProductCount < 2) {
    return "No active bundle or usable recommendation pool exists yet. Repair the catalog, then create a bundle if you want a bundle card on product pages.";
  }
  if (activeBundleCount === 0) {
    return "Catalog-backed recommendation strips are ready. Create an active bundle to show bundle cards on matching product pages.";
  }
  if (readiness.actionableProductCount < 2) {
    return "Bundles exist, but the recommendation catalog needs repair before product cards can be safely added to cart.";
  }
  return "Active bundles and catalog-backed recommendation strips are ready for eligible storefront pages.";
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
