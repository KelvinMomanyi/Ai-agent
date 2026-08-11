import type { Event, Offer, ShopperEvent, ShopperSession } from "@prisma/client";
import prisma from "../db.server";

type ConversionEventRecord = Pick<Event, "data" | "timestamp">;
type ShopperActionEvent = Pick<ShopperEvent, "type" | "payload" | "createdAt">;
type AnalyticsSession = Pick<
  ShopperSession,
  "id" | "journeyStage" | "chatEngaged"
>;

export type DashboardMetrics = {
  avgAov: number;
  aovLift: number;
  widgetCtr: number;
  widgetImpressions: number;
  chatEngaged: number;
  attributedRevenue: number;
  attributedOrderCount: number;
  baselineOrderCount: number;
  aovLiftAvailable: boolean;
  widgetRows: Array<{
    widgetType: string;
    impressions: number;
    clicks: number;
    conversions: number;
    revenue: number;
  }>;
  revenueSeries: Array<{ date: string; revenue: number }>;
};

export type RevenueAnalyticsReport = {
  dashboard: DashboardMetrics;
  funnel: {
    generated: number;
    impressions: number;
    clicks: number;
    conversions: number;
  };
  timeSeries: Array<{
    date: string;
    generated: number;
    impressions: number;
    clicks: number;
    conversions: number;
    revenue: number;
  }>;
  offerRows: Array<{
    name: string;
    widgetType: string;
    generated: number;
    impressions: number;
    clicks: number;
    conversions: number;
    revenue: number;
  }>;
  experimentRows: Array<{
    experiment: string;
    variant: string;
    generated: number;
    impressions: number;
    clicks: number;
    conversions: number;
    revenue: number;
  }>;
  journeyRows: Array<{
    journeyStage: string;
    sessions: number;
    convertedSessions: number;
    revenue: number;
  }>;
  bundleShare: number;
  insights: string[];
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
      select: { data: true, timestamp: true },
    }),
  ]);

  return summarizeDashboardMetrics({ offers, chatEngaged, conversionEvents });
}

export async function getRevenueAnalytics(
  shop: string,
  from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
): Promise<RevenueAnalyticsReport> {
  const [offers, sessions, shopperEvents, conversionEvents, experiments] =
    await Promise.all([
      prisma.offer.findMany({
        where: { shop, createdAt: { gte: from } },
        orderBy: { createdAt: "asc" },
      }),
      prisma.shopperSession.findMany({
        where: { shop, updatedAt: { gte: from } },
        select: { id: true, journeyStage: true, chatEngaged: true },
      }),
      prisma.shopperEvent.findMany({
        where: {
          shop,
          createdAt: { gte: from },
          type: {
            in: ["widget_impression", "impression", "widget_click", "click"],
          },
        },
        orderBy: { createdAt: "asc" },
        select: { type: true, payload: true, createdAt: true },
      }),
      prisma.event.findMany({
        where: { storeId: shop, event: "conversion", timestamp: { gte: from } },
        orderBy: { timestamp: "asc" },
        select: { data: true, timestamp: true },
      }),
      prisma.experiment.findMany({
        where: { shop },
        select: { id: true, name: true },
      }),
    ]);

  return summarizeRevenueAnalytics({
    offers,
    sessions,
    shopperEvents,
    conversionEvents,
    experiments,
  });
}

export function summarizeDashboardMetrics(input: {
  offers: Offer[];
  chatEngaged: number;
  conversionEvents: ConversionEventRecord[];
}): DashboardMetrics {
  const { offers, chatEngaged, conversionEvents } = input;
  const byWidget = new Map<
    string,
    { widgetType: string; impressions: number; clicks: number; conversions: number; revenue: number }
  >();
  const series = new Map<string, number>();
  let attributedRevenue = 0;
  let impressions = 0;
  let clicks = 0;
  const offerRevenue = new Map<string, number>();

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
    }

    const revenue = Number(offer.revenueImpact || 0);
    row.revenue += revenue;
    attributedRevenue += revenue;
    offerRevenue.set(offer.id, revenue);
    byWidget.set(offer.widgetType, row);
  }

  let attributedOrderCount = 0;
  let attributedOrderRevenue = 0;
  let baselineOrderCount = 0;
  let baselineOrderRevenue = 0;
  const offersSeenInOrders = new Set<string>();
  for (const event of conversionEvents) {
    const data = event.data as Record<string, any> | null;
    const total = Number(data?.total_price || data?.totalPrice || 0);
    const eventOfferIds = Array.isArray(data?.offerIds)
      ? data.offerIds.map(String).filter(Boolean)
      : [];
    if (eventOfferIds.length > 0) {
      attributedOrderCount += 1;
      attributedOrderRevenue += total;
      const revenue = eventOfferIds.reduce((sum, id) => {
        offersSeenInOrders.add(id);
        return sum + (offerRevenue.get(id) || 0);
      }, 0);
      const date = event.timestamp.toISOString().slice(0, 10);
      series.set(date, (series.get(date) || 0) + revenue);
    } else {
      baselineOrderCount += 1;
      baselineOrderRevenue += total;
    }
  }

  for (const offer of offers) {
    if (!offer.converted || offersSeenInOrders.has(offer.id)) continue;
    const date = offer.createdAt.toISOString().slice(0, 10);
    series.set(date, (series.get(date) || 0) + Number(offer.revenueImpact || 0));
  }

  const avgAov =
    attributedOrderCount > 0 ? attributedOrderRevenue / attributedOrderCount : 0;
  const baselineAov =
    baselineOrderCount > 0 ? baselineOrderRevenue / baselineOrderCount : 0;

  const aovLift = baselineAov > 0 ? (avgAov - baselineAov) / baselineAov : 0;

  return {
    avgAov,
    aovLift,
    widgetCtr: impressions > 0 ? clicks / impressions : 0,
    widgetImpressions: impressions,
    chatEngaged,
    attributedRevenue,
    attributedOrderCount,
    baselineOrderCount,
    aovLiftAvailable: attributedOrderCount > 0 && baselineAov > 0,
    widgetRows: Array.from(byWidget.values()).sort(
      (left, right) => right.revenue - left.revenue,
    ),
    revenueSeries: Array.from(series.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, revenue]) => ({ date, revenue })),
  };
}

export function summarizeRevenueAnalytics(input: {
  offers: Offer[];
  sessions: AnalyticsSession[];
  shopperEvents: ShopperActionEvent[];
  conversionEvents: ConversionEventRecord[];
  experiments: Array<{ id: string; name: string }>;
}): RevenueAnalyticsReport {
  const dashboard = summarizeDashboardMetrics({
    offers: input.offers,
    chatEngaged: input.sessions.filter((session) => session.chatEngaged).length,
    conversionEvents: input.conversionEvents,
  });
  const funnel = {
    generated: input.offers.length,
    impressions: input.offers.filter((offer) => offer.shown).length,
    clicks: input.offers.filter((offer) => offer.clicked).length,
    conversions: input.offers.filter((offer) => offer.converted).length,
  };

  const actionTimes = getOfferActionTimes(
    input.shopperEvents,
    input.conversionEvents,
  );
  const timeSeries = buildOfferTimeSeries(input.offers, actionTimes);
  const offerRows = summarizeOffers(input.offers);
  const experimentRows = summarizeExperimentOffers(
    input.offers,
    input.experiments,
  );
  const journeyRows = summarizeJourneyStages(input.sessions, input.offers);
  const bundleImpressions = input.offers.filter(
    (offer) => offer.shown && offer.widgetType === "bundle",
  ).length;
  const bundleShare = funnel.impressions
    ? bundleImpressions / funnel.impressions
    : 0;

  return {
    dashboard,
    funnel,
    timeSeries,
    offerRows,
    experimentRows,
    journeyRows,
    bundleShare,
    insights: buildAuthoritativeInsights({
      widgetRows: dashboard.widgetRows,
      bundleShare,
      impressions: funnel.impressions,
    }),
  };
}

type OfferActionTimes = {
  impressions: Map<string, Date>;
  clicks: Map<string, Date>;
  conversions: Map<string, Date>;
};

function getOfferActionTimes(
  shopperEvents: ShopperActionEvent[],
  conversionEvents: ConversionEventRecord[],
): OfferActionTimes {
  const impressions = new Map<string, Date>();
  const clicks = new Map<string, Date>();
  const conversions = new Map<string, Date>();

  for (const event of shopperEvents) {
    const offerId = getOfferId(event.payload);
    if (!offerId) continue;
    if (
      (event.type === "widget_impression" || event.type === "impression") &&
      !impressions.has(offerId)
    ) {
      impressions.set(offerId, event.createdAt);
    }
    if (
      (event.type === "widget_click" || event.type === "click") &&
      !clicks.has(offerId)
    ) {
      clicks.set(offerId, event.createdAt);
    }
  }

  for (const event of conversionEvents) {
    const data = asRecord(event.data);
    const offerIds = Array.isArray(data.offerIds) ? data.offerIds : [];
    for (const value of offerIds) {
      const offerId = String(value || "");
      if (offerId && !conversions.has(offerId)) {
        conversions.set(offerId, event.timestamp);
      }
    }
  }

  return { impressions, clicks, conversions };
}

function buildOfferTimeSeries(offers: Offer[], times: OfferActionTimes) {
  const days = new Map<
    string,
    {
      date: string;
      generated: number;
      impressions: number;
      clicks: number;
      conversions: number;
      revenue: number;
    }
  >();
  const dayFor = (date: Date) => {
    const key = date.toISOString().slice(0, 10);
    const existing = days.get(key);
    if (existing) return existing;
    const day = {
      date: key,
      generated: 0,
      impressions: 0,
      clicks: 0,
      conversions: 0,
      revenue: 0,
    };
    days.set(key, day);
    return day;
  };

  for (const offer of offers) {
    dayFor(offer.createdAt).generated += 1;
    if (offer.shown) {
      dayFor(times.impressions.get(offer.id) || offer.createdAt).impressions += 1;
    }
    if (offer.clicked) {
      dayFor(times.clicks.get(offer.id) || offer.createdAt).clicks += 1;
    }
    if (offer.converted) {
      const day = dayFor(times.conversions.get(offer.id) || offer.createdAt);
      day.conversions += 1;
      day.revenue += Number(offer.revenueImpact || 0);
    }
  }

  return Array.from(days.values()).sort((left, right) =>
    left.date.localeCompare(right.date),
  );
}

function summarizeOffers(offers: Offer[]) {
  const groups = new Map<
    string,
    RevenueAnalyticsReport["offerRows"][number]
  >();
  for (const offer of offers) {
    const name = getOfferName(offer);
    const key = `${offer.widgetType}:${name}`;
    const row = groups.get(key) || {
      name,
      widgetType: offer.widgetType,
      generated: 0,
      impressions: 0,
      clicks: 0,
      conversions: 0,
      revenue: 0,
    };
    row.generated += 1;
    if (offer.shown) row.impressions += 1;
    if (offer.clicked) row.clicks += 1;
    if (offer.converted) row.conversions += 1;
    row.revenue += Number(offer.revenueImpact || 0);
    groups.set(key, row);
  }

  return Array.from(groups.values())
    .sort(
      (left, right) =>
        right.revenue - left.revenue ||
        right.conversions - left.conversions ||
        right.clicks - left.clicks,
    )
    .slice(0, 10);
}

function summarizeExperimentOffers(
  offers: Offer[],
  experiments: Array<{ id: string; name: string }>,
) {
  const names = new Map(experiments.map(({ id, name }) => [id, name]));
  const groups = new Map<
    string,
    RevenueAnalyticsReport["experimentRows"][number]
  >();

  for (const offer of offers) {
    if (!offer.experimentId || !offer.abVariant) continue;
    const key = `${offer.experimentId}:${offer.abVariant}`;
    const row = groups.get(key) || {
      experiment: names.get(offer.experimentId) || "Archived experiment",
      variant: offer.abVariant,
      generated: 0,
      impressions: 0,
      clicks: 0,
      conversions: 0,
      revenue: 0,
    };
    row.generated += 1;
    if (offer.shown) row.impressions += 1;
    if (offer.clicked) row.clicks += 1;
    if (offer.converted) row.conversions += 1;
    row.revenue += Number(offer.revenueImpact || 0);
    groups.set(key, row);
  }

  return Array.from(groups.values()).sort(
    (left, right) =>
      right.revenue - left.revenue || right.conversions - left.conversions,
  );
}

function summarizeJourneyStages(sessions: AnalyticsSession[], offers: Offer[]) {
  const offersBySession = new Map<string, Offer[]>();
  for (const offer of offers) {
    const existing = offersBySession.get(offer.sessionId) || [];
    existing.push(offer);
    offersBySession.set(offer.sessionId, existing);
  }

  const groups = new Map<
    string,
    RevenueAnalyticsReport["journeyRows"][number]
  >();
  for (const session of sessions) {
    const stage = session.journeyStage || "unknown";
    const sessionOffers = offersBySession.get(session.id) || [];
    const row = groups.get(stage) || {
      journeyStage: stage,
      sessions: 0,
      convertedSessions: 0,
      revenue: 0,
    };
    row.sessions += 1;
    if (sessionOffers.some((offer) => offer.converted)) {
      row.convertedSessions += 1;
    }
    row.revenue += sessionOffers.reduce(
      (sum, offer) => sum + Number(offer.revenueImpact || 0),
      0,
    );
    groups.set(stage, row);
  }

  return Array.from(groups.values()).sort(
    (left, right) => right.revenue - left.revenue || right.sessions - left.sessions,
  );
}

function buildAuthoritativeInsights(input: {
  widgetRows: DashboardMetrics["widgetRows"];
  bundleShare: number;
  impressions: number;
}) {
  if (input.impressions === 0) {
    return ["Performance insights appear after an offer impression is recorded."];
  }

  const revenueLeader = [...input.widgetRows].sort(
    (left, right) => right.revenue - left.revenue,
  )[0];
  const ctrLeader = [...input.widgetRows]
    .filter((row) => row.impressions > 0)
    .sort(
      (left, right) =>
        right.clicks / right.impressions - left.clicks / left.impressions,
    )[0];
  const insights: string[] = [];
  if (revenueLeader?.revenue) {
    insights.push(
      `${formatWidgetType(revenueLeader.widgetType)} leads attributed revenue in this window.`,
    );
  }
  if (ctrLeader) {
    insights.push(
      `${formatWidgetType(ctrLeader.widgetType)} has the highest observed click-through rate.`,
    );
  }
  insights.push(
    `${Math.round(input.bundleShare * 100)}% of recorded impressions were bundle offers.`,
  );
  return insights;
}

function getOfferName(offer: Offer) {
  const payload = asRecord(offer.payload);
  const copy = asRecord(payload.copy);
  const bundle = asRecord(payload.bundle);
  const product = asRecord(payload.product);
  const products = Array.isArray(payload.products) ? payload.products : [];
  const firstProduct = asRecord(products[0]);
  return String(
    bundle.name ||
      bundle.title ||
      copy.headline ||
      payload.headline ||
      product.title ||
      firstProduct.title ||
      formatWidgetType(offer.widgetType),
  ).slice(0, 120);
}

function getOfferId(payload: unknown) {
  const data = asRecord(payload);
  return String(data.offerId || data.offer_id || "").trim();
}

function formatWidgetType(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
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
      experimentId: { not: null },
    },
  });

  return experiments.map((experiment) => {
    const relevant = offers.filter(
      (offer) =>
        offer.experimentId === experiment.id &&
        offer.widgetType === experiment.widgetType,
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
