import type { Offer } from "@prisma/client";
import prisma from "../db.server";

export type DashboardMetrics = {
  avgAov: number;
  aovLift: number;
  widgetCtr: number;
  chatEngaged: number;
  attributedRevenue: number;
  widgetRows: Array<{
    widgetType: string;
    impressions: number;
    clicks: number;
    conversions: number;
    revenue: number;
  }>;
  revenueSeries: Array<{ date: string; revenue: number }>;
};

export async function getDashboardMetrics(
  shop: string,
  from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
): Promise<DashboardMetrics> {
  const [offers, chatEngaged, conversionEvents] = await Promise.all([
    prisma.offer.findMany({
      where: { shop, createdAt: { gte: from } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.shopperSession.count({
      where: { shop, chatEngaged: true, updatedAt: { gte: from } },
    }),
    prisma.event.findMany({
      where: { storeId: shop, event: "conversion", timestamp: { gte: from } },
    }),
  ]);

  const byWidget = new Map<
    string,
    { widgetType: string; impressions: number; clicks: number; conversions: number; revenue: number }
  >();
  const series = new Map<string, number>();
  let attributedRevenue = 0;
  let impressions = 0;
  let clicks = 0;
  let conversions = 0;

  for (const offer of offers) {
    const row =
      byWidget.get(offer.widgetType) ||
      {
        widgetType: offer.widgetType,
        impressions: 0,
        clicks: 0,
        conversions: 0,
        revenue: 0,
      };

    if (offer.shown) {
      row.impressions += 1;
      impressions += 1;
    }
    if (offer.clicked) {
      row.clicks += 1;
      clicks += 1;
    }
    if (offer.converted) {
      row.conversions += 1;
      conversions += 1;
    }

    const revenue = Number(offer.revenueImpact || 0);
    row.revenue += revenue;
    attributedRevenue += revenue;
    const date = offer.createdAt.toISOString().slice(0, 10);
    series.set(date, (series.get(date) || 0) + revenue);
    byWidget.set(offer.widgetType, row);
  }

  const avgAov = conversions > 0 ? attributedRevenue / conversions : 0;

  let totalOrderCount = conversionEvents.length;
  let totalOrderRevenue = 0;
  for (const event of conversionEvents) {
    const data = event.data as Record<string, any> | null;
    totalOrderRevenue += Number(data?.total_price || data?.totalPrice || 0);
  }

  let aovLift = 0;
  if (conversions > 0 && totalOrderCount > conversions) {
    const nonAttributedRevenue = Math.max(0, totalOrderRevenue - attributedRevenue);
    const nonAttributedCount = Math.max(1, totalOrderCount - conversions);
    const baselineAov = nonAttributedRevenue / nonAttributedCount;
    if (baselineAov > 0) {
      aovLift = (avgAov - baselineAov) / baselineAov;
    }
  } else if (conversions > 0 && totalOrderCount > 0) {
    // Fallback if numbers are skewed or event tracking lags: compare to total overall order AOV
    const overallAov = totalOrderRevenue / totalOrderCount;
    if (overallAov > 0) {
      aovLift = (avgAov - overallAov) / overallAov;
    }
  }

  return {
    avgAov,
    aovLift,
    widgetCtr: impressions > 0 ? clicks / impressions : 0,
    chatEngaged,
    attributedRevenue,
    widgetRows: Array.from(byWidget.values()).sort(
      (left, right) => right.revenue - left.revenue,
    ),
    revenueSeries: Array.from(series.entries()).map(([date, revenue]) => ({
      date,
      revenue,
    })),
  };
}

export async function getExperimentAnalytics(shop: string) {
  const experiments = await prisma.experiment.findMany({
    where: { shop },
    orderBy: { startedAt: "desc" },
  });

  const offers = await prisma.offer.findMany({
    where: {
      shop,
      abVariant: { not: null },
    },
  });

  return experiments.map((experiment) => {
    const relevant = offers.filter(
      (offer) => offer.widgetType === experiment.widgetType,
    );
    const control = summarizeVariant(relevant, "control");
    const treatment = summarizeVariant(relevant, "treatment");

    return {
      ...experiment,
      control,
      treatment,
      significant: calculateTwoProportionZTest(treatment, control),
    };
  });
}

function summarizeVariant(offers: Offer[], variant: string) {
  const scoped = offers.filter((offer) => offer.abVariant === variant);
  const impressions = scoped.filter((offer) => offer.shown).length;
  const clicks = scoped.filter((offer) => offer.clicked).length;
  const conversions = scoped.filter((offer) => offer.converted).length;
  const revenue = scoped.reduce(
    (sum, offer) => sum + Number(offer.revenueImpact || 0),
    0,
  );

  return {
    impressions,
    clicks,
    conversions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    conversionRate: impressions > 0 ? conversions / impressions : 0,
    aov: conversions > 0 ? revenue / conversions : 0,
    revenue,
  };
}

function calculateTwoProportionZTest(
  treatment: { conversions: number; impressions: number },
  control: { conversions: number; impressions: number }
): boolean {
  const n1 = treatment.impressions;
  const n2 = control.impressions;

  if (n1 === 0 || n2 === 0) return false;

  const x1 = treatment.conversions;
  const x2 = control.conversions;

  const p1 = x1 / n1;
  const p2 = x2 / n2;

  const pooledP = (x1 + x2) / (n1 + n2);

  if (pooledP === 0 || pooledP === 1) return false;

  const standardError = Math.sqrt(pooledP * (1 - pooledP) * (1 / n1 + 1 / n2));
  if (standardError === 0) return false;

  const z = (p1 - p2) / standardError;

  // For two-tailed alpha = 0.05, critical value is 1.96
  return Math.abs(z) >= 1.96;
}
