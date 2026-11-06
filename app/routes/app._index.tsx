import {
  data as json,
  type LoaderFunctionArgs,
  useFetcher,
  useLoaderData,
  useRevalidator,
} from "react-router";
import { useEffect, useRef } from "react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  InlineStack,
  Layout,
  Page,
  Text,
} from "@shopify/polaris";
import { AovMetricCard } from "../components/dashboard/AovMetricCard";
import { RevenueChart } from "../components/dashboard/RevenueChart";
import { WidgetPerformanceTable } from "../components/dashboard/WidgetPerformanceTable";
import { SetupChecklist } from "../components/dashboard/SetupChecklist";
import {
  ensureInitialCatalogSync,
  getCatalogSyncProgress,
} from "../jobs/aovboost.server";
import prisma from "../db.server";
import { getDashboardMetrics } from "../models/analytics.server";
import { getCatalogReadiness } from "../models/catalogCache.server";
import type { CatalogReadiness } from "../models/productCatalogMapping";
import { getSetupChecklist } from "../models/onboarding.server";
import { themeEmbedEditorUrl } from "../models/onboarding";
import { authenticate } from "../shopify.server";
import { getPlanStatus } from "../models/usage.server";
import { getHoldoutReport } from "../models/holdoutAnalytics.server";
import { HoldoutMeasurementCard } from "../components/dashboard/HoldoutMeasurementCard";
import { getThemeSummary } from "../models/themeCompatibility.server";
import { ThemeTestButton } from "../components/ThemeTestButton";
import { getAppSettings } from "../models/settings.server";
export { pauseCartRecommendationsAction as action } from "../models/measurementAdmin.server";

type SyncProgress = {
  total?: number;
  done?: number;
  status?: string;
  error?: string;
  emptyCatalog?: boolean;
  updatedAt?: string;
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
  // Parent and child loaders can run concurrently on the first entry. This
  // create-if-absent operation ensures Home can see a durable job immediately.
  await ensureInitialCatalogSync(session.shop);
  const [
    metrics,
    catalogReadiness,
    activeBundleCount,
    syncProgress,
    currencyResponse,
    themeCompatibility,
  ] = await Promise.all([
    getDashboardMetrics(session.shop),
    getCatalogReadiness(session.shop),
    prisma.bundle.count({ where: { shop: session.shop, isActive: true } }),
    getCatalogSyncProgress(session.shop),
    admin.graphql(
      `#graphql\nquery AOVBoostShopCurrency { shop { currencyCode } }`,
    ),
    getThemeSummary(session.shop),
  ]);
  const currencyResult: any = await currencyResponse.json();
  const currencyCode = /^[A-Z]{3}$/.test(
    currencyResult.data?.shop?.currencyCode,
  )
    ? currencyResult.data.shop.currencyCode
    : "USD";

  return json({
    planStatus: await getPlanStatus(session.shop, admin),
    measurement: await getHoldoutReport(session.shop),
    pairingSetup: await getAppSettings(session.shop).then((settings) => ({
      pairingMode: settings.pairingMode,
      pairingOnboardingSeenAt: settings.pairingOnboardingSeenAt,
    })),
    themeCompatibility,
    metrics,
    productCount: catalogReadiness.storedProductCount,
    catalogReadiness,
    activeBundleCount,
    syncProgress,
    currencyCode,
    setupSteps: await getSetupChecklist(
      session.shop,
      catalogReadiness,
      syncProgress,
      new Date(),
      themeCompatibility.profile,
    ),
    themeEditorUrl: themeEmbedEditorUrl(
      session.shop,
      process.env.SHOPIFY_API_KEY || "",
    ),
    storefrontUrl: `https://${session.shop}/`,
  });
};

export default function AovBoostDashboard() {
  const {
    metrics,
    productCount,
    catalogReadiness,
    activeBundleCount,
    syncProgress,
    currencyCode,
    setupSteps,
    themeEditorUrl,
    storefrontUrl,
    measurement,
    planStatus,
    pairingSetup,
    themeCompatibility,
  } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const syncFetcher = useFetcher<SyncResponse>();
  const pairingIntro = useFetcher();
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
    const refresh = () => revalidator.revalidate();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [revalidator]);

  useEffect(() => {
    if (syncFetcher.state !== "idle" || !syncShouldContinue) return;
    const timer = window.setTimeout(
      () =>
        syncFetcher.submit(
          { intent: "continue" },
          { method: "post", action: "/api/sync" },
        ),
      1500,
    );
    return () => window.clearTimeout(timer);
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
  }, [
    currentReadiness.resyncRequired,
    syncFailed,
    syncShouldContinue,
    syncFetcher,
  ]);

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
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Theme compatibility
              </Text>
              <Text as="p">
                {themeCompatibility?.profile
                  ? `${themeCompatibility.profile.themeName}: ${({ learning: "Learning placement", verified: "Verified displays", degraded: "Using a safer placement", disabled: "Paused after display failures" } as Record<string, string>)[themeCompatibility.profile.status] || "Learning placement"}. Starting placement: ${(themeCompatibility.preference === "off" || themeCompatibility.profile.status === "disabled" ? "paused" : themeCompatibility.preference === "auto" ? themeCompatibility.profile.strategy : themeCompatibility.preference).replace("native_drawer", "cart_drawer").replace(/_/g, " ")}.`
                  : "Waiting for your storefront to identify its theme."}
              </Text>
              <Text as="p">
                {themeCompatibility?.verifiedRate != null
                  ? `${Math.round(themeCompatibility.verifiedRate * 100)}% of ${themeCompatibility.sample} recent offer attempts verified in the last seven days.`
                  : "No verified display sample yet."}
              </Text>
              <InlineStack gap="300">
                <Button url="/app/theme">Placement and appearance</Button>
                <ThemeTestButton />
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>
        {pairingSetup?.pairingMode === "autopilot" &&
        !pairingSetup.pairingOnboardingSeenAt ? (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Product pairing autopilot is on
                </Text>
                <Text as="p">
                  After your catalog sync, validated, non-sensitive pairs can go
                  live automatically. Sensitive or uncertain pairs stay for
                  review. Your approvals, rejections and exclusions always take
                  priority.
                </Text>
                <InlineStack gap="200">
                  <Button url="/app/pairings">
                    Review pairings or turn autopilot off
                  </Button>
                  <Button
                    loading={pairingIntro.state !== "idle"}
                    onClick={() =>
                      pairingIntro.submit(
                        { intent: "acknowledgeAutopilot" },
                        { method: "post", action: "/app/pairings" },
                      )
                    }
                  >
                    Got it
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        ) : null}
        {planStatus.notice ? (
          <Layout.Section>
            <Banner tone="warning" title="Plan & usage">
              <p>{planStatus.notice}</p>
              <Button url="/app/plan">View plan & usage</Button>
            </Banner>
          </Layout.Section>
        ) : null}
        <Layout.Section>
          <HoldoutMeasurementCard
            report={measurement}
            fallbackCurrency={currencyCode}
          />
        </Layout.Section>
        <Layout.Section>
          <SetupChecklist
            steps={setupSteps}
            themeEditorUrl={themeEditorUrl}
            storefrontUrl={storefrontUrl}
            onRefresh={() => revalidator.revalidate()}
            refreshing={revalidator.state !== "idle"}
          />
        </Layout.Section>
        <Layout.Section>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: "12px",
            }}
          >
            <AovMetricCard
              label="Attributed-order AOV"
              value={
                metrics.attributedOrderCount > 0
                  ? formatCurrency(metrics.avgAov, currencyCode)
                  : "Not available"
              }
            />
            <AovMetricCard
              label="Measured conversion lift"
              value={
                measurement.enabled && measurement.lift !== null
                  ? formatPercent(measurement.lift)
                  : "Not enough data yet"
              }
              caption="Randomized holdout with a complete follow-up window."
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
              <RevenueChart
                data={metrics.revenueSeries}
                currencyCode={currencyCode}
              />
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Widget performance
              </Text>
              <WidgetPerformanceTable
                rows={metrics.widgetRows}
                currencyCode={currencyCode}
              />
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
                <Badge
                  tone={
                    currentReadiness.actionableProductCount > 0
                      ? "success"
                      : "critical"
                  }
                >
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
                {getCatalogStatusText(
                  currentReadiness,
                  currentProgress,
                  syncFailed,
                )}
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
                <Badge
                  tone={
                    currentReadiness.actionableProductCount > 1
                      ? "success"
                      : "critical"
                  }
                >
                  {`${currentReadiness.actionableProductCount.toLocaleString()} recommendation-ready`}
                </Badge>
              </InlineStack>
              <Text as="p" tone="subdued">
                {getMerchandisingStatusText(
                  activeBundleCount,
                  currentReadiness,
                )}
              </Text>
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
    return (
      progress?.error ||
      "Product sync failed. Check the app logs and Shopify product scopes."
    );
  }
  if (progress?.emptyCatalog && readiness.storedProductCount === 0) {
    return "Your last sync found no active products. Add products in Shopify, then use Resync products. Empty catalogs are not synced again automatically.";
  }
  if (progress?.status && progress.status !== "complete") {
    const done = Number(progress.done || 0);
    const total = Number(progress.total || 0);
    const count =
      total > 0
        ? `${done.toLocaleString()} of ${total.toLocaleString()}`
        : done.toLocaleString();
    return `Catalog sync is ${formatStatus(progress.status).toLowerCase()} (${count}). Keep Home open to continue. Closing the app pauses sync; reopening resumes from saved progress.`;
  }
  if (readiness.resyncRequired) {
    return `${readiness.missingVariantDataCount.toLocaleString()} stored products are missing current variant data. Use Repair catalog sync so recommendations and add-to-cart actions can render safely.`;
  }
  if (readiness.actionableProductCount > 0) {
    return "The catalog has verified, sellable variants for chat and storefront recommendations.";
  }
  if (readiness.storedProductCount > 0) {
    return "Products are synced, but no available variants can be recommended yet. Check product status and availability in Shopify, then resync.";
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
