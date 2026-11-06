import { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { cachedReport } from "./reportCache.server";
import { getAppSettings } from "./settings.server";
import { calculateTwoProportionZTest } from "./analytics.server";
import { getEntitlements, limitsFor } from "./entitlements.server";
import {
  recommendationBreakdownQuery,
  summarizeBreakdowns,
  type BreakdownAggregate,
} from "./recommendationBreakdown.server";

export const FOLLOWUP_DAYS = 7;
export const MIN_ARM_SESSIONS = 200;
export const MIN_ARM_CONVERTED_SESSIONS = 20;
export const MIN_ARM_NONCONVERTED_SESSIONS = 20;
export const MIN_CART_LINK_COVERAGE = 0.95;
export const MAX_CART_LINK_COVERAGE_GAP = 0.02;
export const MATERIAL_CONVERSION_DROP = 0.1;
export type ArmAggregate = {
  arm: string;
  sessions: number;
  convertedSessions: number;
  orders: number;
  revenue: number;
  currencies: string[];
  cartSessions: number;
  linkedCarts: number;
};
export function summarizeHoldout(arms: ArmAggregate[]) {
  const empty = (arm: string): ArmAggregate => ({
    arm,
    sessions: 0,
    convertedSessions: 0,
    orders: 0,
    revenue: 0,
    currencies: [],
    cartSessions: 0,
    linkedCarts: 0,
  });
  const currencies = new Set(arms.flatMap((arm) => arm.currencies || []));
  const normalize = (name: string) => {
    const arm = arms.find((row) => row.arm === name) || empty(name);
    return {
      ...arm,
      conversionRate: arm.sessions ? arm.convertedSessions / arm.sessions : 0,
      aov: currencies.size <= 1 && arm.orders ? arm.revenue / arm.orders : null,
      revenuePerSession:
        currencies.size <= 1 && arm.sessions
          ? arm.revenue / arm.sessions
          : null,
      linkCoverage: arm.cartSessions ? arm.linkedCarts / arm.cartSessions : 0,
    };
  };
  const exposed = normalize("exposed"),
    holdout = normalize("holdout");
  const sufficient = [exposed, holdout].every(
    (arm) =>
      arm.sessions >= MIN_ARM_SESSIONS &&
      arm.convertedSessions >= MIN_ARM_CONVERTED_SESSIONS &&
      arm.sessions - arm.convertedSessions >= MIN_ARM_NONCONVERTED_SESSIONS,
  );
  const linkageReady =
    Math.abs(exposed.linkCoverage - holdout.linkCoverage) <=
      MAX_CART_LINK_COVERAGE_GAP + Number.EPSILON &&
    [exposed, holdout].every(
      (arm) => arm.linkCoverage >= MIN_CART_LINK_COVERAGE,
    );
  const ready = sufficient && linkageReady;
  const significant =
    ready &&
    calculateTwoProportionZTest(
      { impressions: exposed.sessions, conversions: exposed.convertedSessions },
      { impressions: holdout.sessions, conversions: holdout.convertedSessions },
    );
  const lift =
    significant && holdout.conversionRate > 0
      ? exposed.conversionRate / holdout.conversionRate - 1
      : null;
  return {
    exposed,
    holdout,
    ready,
    significant,
    lift,
    linkageReady,
    currency: currencies.size === 1 ? [...currencies][0] : null,
    guardrail: lift !== null && lift <= -MATERIAL_CONVERSION_DROP,
    status: !sufficient
      ? "Not enough data yet"
      : !linkageReady
        ? "Cart linkage needs attention"
        : !significant
          ? "No conclusive difference yet"
          : "Measured conversion lift",
  };
}

export function holdoutArmsQuery(
  shop: string,
  version: number,
  from: Date,
  to: Date,
) {
  return Prisma.sql`
    WITH cohort AS MATERIALIZED (
      SELECT * FROM "HoldoutEnrollment" WHERE shop=${shop} AND version=${version}
        AND "startedAt">=${from} AND "startedAt"<${new Date(to.getTime() - FOLLOWUP_DAYS * 86400_000)}
    ), outcomes AS (
      SELECT e.id, COUNT(o.id)::int orders, COALESCE(SUM(o.revenue),0)::float revenue,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT o.currency),NULL) currencies
      FROM cohort e LEFT JOIN "HoldoutOrder" o ON o.shop=${shop} AND o."enrollmentId"=e.id
        AND o."createdAt">=e."startedAt" AND o."createdAt"<e."startedAt"+INTERVAL '7 days' AND o."createdAt"<${to}
      GROUP BY e.id
    ) SELECT e.arm, COUNT(*)::int sessions, COUNT(*) FILTER (WHERE x.orders>0)::int "convertedSessions",
      COALESCE(SUM(x.orders),0)::int orders, COALESCE(SUM(x.revenue),0)::float revenue,
      ARRAY(SELECT DISTINCT o.currency FROM "HoldoutOrder" o JOIN cohort c ON c.id=o."enrollmentId" AND c.shop=o.shop
        WHERE o.shop=${shop} AND c.arm=e.arm AND o."createdAt">=c."startedAt" AND o."createdAt"<c."startedAt"+INTERVAL '7 days' AND o."createdAt"<${to}) currencies,
      COUNT(*) FILTER (WHERE e."cartSeenAt" IS NOT NULL)::int "cartSessions",
      COUNT(*) FILTER (WHERE e."cartSeenAt" IS NOT NULL AND e."cartLinkedAt" IS NOT NULL)::int "linkedCarts"
    FROM cohort e JOIN outcomes x ON x.id=e.id GROUP BY e.arm`;
}

export function measuredFunnelQuery(shop: string, from: Date, to: Date) {
  return Prisma.sql`
    WITH offers AS MATERIALIZED (SELECT id,"sessionId" FROM "Offer" WHERE shop=${shop} AND "createdAt">=${from} AND "createdAt"<${to} AND "widgetType" IN ('upsell_drawer','rec_strip','bundle')),
    events AS MATERIALIZED (
      SELECT "sessionId",type,"createdAt",COALESCE(payload->>'offerId',payload->>'offer_id') id
      FROM "ShopperEvent" WHERE shop=${shop} AND "createdAt">=${from} AND "createdAt"<${to}
      AND type IN ('widget_impression','impression','widget_click','click','recommendation_added','upsell_added')
    ), displayed AS (SELECT e.id,e."sessionId",MIN(e."createdAt") at FROM events e JOIN offers o ON o.id=e.id AND o."sessionId"=e."sessionId" WHERE e.type IN ('widget_impression','impression') GROUP BY e.id,e."sessionId"),
    clicked AS (SELECT e.id,e."sessionId",MIN(e."createdAt") at FROM events e JOIN displayed d ON d.id=e.id AND d."sessionId"=e."sessionId" WHERE e.type IN ('widget_click','click') AND e."createdAt">=d.at GROUP BY e.id,e."sessionId"),
    added AS (SELECT e.id,e."sessionId",MIN(e."createdAt") at FROM events e JOIN clicked c ON c.id=e.id AND c."sessionId"=e."sessionId" WHERE e.type IN ('recommendation_added','upsell_added') AND e."createdAt">=c.at GROUP BY e.id,e."sessionId"),
    orders AS MATERIALIZED (SELECT timestamp,data FROM "Event" WHERE "storeId"=${shop} AND event='conversion' AND timestamp>=${from} AND timestamp<${to}),
    purchased AS (SELECT DISTINCT a.id FROM orders o CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(o.data->'offerIds')='array' THEN o.data->'offerIds' ELSE '[]'::jsonb END) link JOIN added a ON a.id=link.value AND o.timestamp>=a.at)
    SELECT (SELECT COUNT(*)::int FROM displayed) displayed,(SELECT COUNT(*)::int FROM clicked) clicked,(SELECT COUNT(*)::int FROM added) added,(SELECT COUNT(*)::int FROM purchased) purchased`;
}

export function monthlyValueQuery(shop: string, from: Date, to: Date) {
  return Prisma.sql`
    WITH lines AS (
      SELECT e."orderId", e.data->>'currency' currency, l.value line
      FROM "Event" e CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(e.data->'line_items')='array' THEN e.data->'line_items' ELSE '[]'::jsonb END) l
      JOIN "Offer" o ON o.shop=${shop} AND o.id=l.value->>'offerId'
      WHERE e."storeId"=${shop} AND e.event='conversion' AND e.timestamp>=${from} AND e.timestamp<${to}
        AND COALESCE(e.data->'offerIds','[]'::jsonb) @> jsonb_build_array(o.id)
    ) SELECT currency,COUNT(DISTINCT "orderId")::int orders,
      COALESCE(SUM(GREATEST(0,(line->>'price')::numeric*(line->>'quantity')::numeric-(line->>'totalDiscount')::numeric)),0)::float revenue
      FROM lines WHERE (line->>'price') ~ '^[0-9]+([.][0-9]+)?$' AND (line->>'quantity') ~ '^[0-9]+([.][0-9]+)?$' AND (line->>'totalDiscount') ~ '^[0-9]+([.][0-9]+)?$'
      GROUP BY currency`;
}

export async function getHoldoutReport(
  shop: string,
  from = new Date(Date.now() - 30 * 86400_000),
  to = new Date(),
) {
  const settings = await getAppSettings(shop);
  const reportingAvailable = limitsFor(await getEntitlements(shop)).features
    .holdoutReporting;
  return cachedReport(
    shop,
    `holdout-v2:${reportingAvailable}:${settings.holdoutVersion}:${settings.holdoutEnabled}:${settings.updatedAt}:${Math.floor(to.getTime() / 60_000)}`,
    from,
    async () => {
      const monthStart = new Date(
        Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1),
      );
      const [arms, funnelRows, monthRows, pending, breakdownRows] =
        await Promise.all([
          reportingAvailable
            ? prisma.$queryRaw<ArmAggregate[]>(
                holdoutArmsQuery(shop, settings.holdoutVersion, from, to),
              )
            : Promise.resolve([]),
          prisma.$queryRaw<
            Array<{
              displayed: number;
              clicked: number;
              added: number;
              purchased: number;
            }>
          >(measuredFunnelQuery(shop, from, to)),
          prisma.$queryRaw<
            Array<{ currency: string | null; orders: number; revenue: number }>
          >(monthlyValueQuery(shop, monthStart, to)),
          reportingAvailable
            ? prisma.holdoutEnrollment.count({
                where: {
                  shop,
                  version: settings.holdoutVersion,
                  startedAt: {
                    gte: new Date(
                      Math.max(
                        from.getTime(),
                        to.getTime() - FOLLOWUP_DAYS * 86400_000,
                      ),
                    ),
                    lt: to,
                  },
                },
              })
            : Promise.resolve(0),
          prisma.$queryRaw<BreakdownAggregate[]>(
            recommendationBreakdownQuery(shop, from, to),
          ),
        ]);
      return {
        ...summarizeHoldout(arms),
        reportingAvailable,
        enabled:
          reportingAvailable &&
          settings.holdoutEnabled &&
          settings.holdoutPercent > 0 &&
          settings.analyticsEnabled,
        percent: settings.holdoutPercent,
        version: settings.holdoutVersion,
        pendingSessions: pending,
        from: from.toISOString(),
        to: to.toISOString(),
        funnel: funnelRows[0] || {
          displayed: 0,
          clicked: 0,
          added: 0,
          purchased: 0,
        },
        month: { start: monthStart.toISOString(), amounts: monthRows },
        recommendationsEnabled: settings.upsellEnabled,
        breakdowns: summarizeBreakdowns(breakdownRows),
      };
    },
  );
}

export function measurementDateRange(url: URL, now = new Date()) {
  const parse = (name: string) => {
    const value = url.searchParams.get(name);
    if (!value) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
      throw new Response("Invalid date range", { status: 400 });
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (
      !Number.isFinite(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== value
    )
      throw new Response("Invalid date range", { status: 400 });
    return parsed;
  };
  const from = parse("from") || new Date(now.getTime() - 30 * 86400_000);
  const end = parse("to");
  const to = end
    ? new Date(Math.min(now.getTime(), end.getTime() + 86400_000))
    : now;
  if (from >= to || to.getTime() - from.getTime() > 366 * 86400_000)
    throw new Response("Choose a range of 1–366 days", { status: 400 });
  return { from, to };
}
