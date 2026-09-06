import type { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { withCommerceTransaction } from "./commerceTransaction.server";
import { getJsonCache, setJsonCache } from "../redis.server";
import type { StorefrontEvent } from "./session.server";
import type { ShopperProfile, SalesState } from "../sales/types";

export type RecommendationRecordInput = {
  productId: string;
  variantId?: string;
  primaryProductId?: string;
  recommendationType: "primary" | "value" | "premium" | "upsell" | "bundle";
  reason: string;
  rank: number;
  metadata?: Record<string, unknown>;
};

export async function recordRecommendationOutcomes(input: {
  shop: string;
  sessionId: string;
  profile: ShopperProfile;
  salesState: SalesState;
  cartValueBefore?: number | null;
  recommendations: RecommendationRecordInput[];
}) {
  if (input.recommendations.length === 0) return [];
  return prisma.$transaction(
    input.recommendations.slice(0, 4).map((recommendation) =>
      prisma.recommendationOutcome.create({
        data: {
          shop: input.shop,
          sessionId: input.sessionId,
          productId: recommendation.productId,
          variantId: recommendation.variantId || null,
          primaryProductId: recommendation.primaryProductId || null,
          recommendationType: recommendation.recommendationType,
          reason: recommendation.reason.slice(0, 500),
          rank: recommendation.rank,
          shopperProfileSnapshot:
            input.profile as unknown as Prisma.InputJsonValue,
          salesState: input.salesState,
          cartValueBefore:
            input.cartValueBefore === null ||
            input.cartValueBefore === undefined
              ? null
              : String(input.cartValueBefore),
          metadata: (recommendation.metadata || {}) as Prisma.InputJsonValue,
        },
      }),
    ),
  );
}

export async function getRecommendationHistory(
  shop: string,
  sessionId: string,
) {
  return prisma.recommendationOutcome.findMany({
    where: { shop, sessionId },
    orderBy: { shownAt: "desc" },
    take: 30,
  });
}

export async function markLatestRecommendationRejected(input: {
  shop: string;
  sessionId: string;
  reason: string;
}) {
  const outcome = await prisma.recommendationOutcome.findFirst({
    where: {
      shop: input.shop,
      sessionId: input.sessionId,
      rejectedAt: null,
      addedAt: null,
      purchasedAt: null,
    },
    orderBy: { shownAt: "desc" },
    select: { id: true, productId: true },
  });
  if (!outcome) return null;
  const now = new Date();
  await prisma.$transaction([
    prisma.recommendationOutcome.update({
      where: { id: outcome.id },
      data: {
        rejectedAt: now,
        rejectionReason: input.reason.slice(0, 240),
      },
    }),
    prisma.shopperEvent.create({
      data: {
        shop: input.shop,
        sessionId: input.sessionId,
        type: "recommendation_rejected",
        payload: {
          productId: outcome.productId,
          reason: input.reason.slice(0, 240),
        },
        createdAt: now,
      },
    }),
  ]);
  return outcome.productId;
}

export async function applyRecommendationEvents(input: {
  shop: string;
  sessionId: string;
  events: StorefrontEvent[];
}) {
  for (const event of input.events) {
    const field = outcomeFieldForEvent(event.type);
    if (!field) continue;
    const productId = String(
      event.productId ||
        asRecord(event.payload).productId ||
        asRecord(event.metadata).productId ||
        "",
    );
    if (!productId) continue;
    const outcome = await prisma.recommendationOutcome.findFirst({
      where: {
        shop: input.shop,
        sessionId: input.sessionId,
        productId,
      },
      orderBy: { shownAt: "desc" },
      select: { id: true },
    });
    if (!outcome) continue;
    const cartValue = Number(
      event.cartValue || asRecord(event.payload).cartValue || NaN,
    );
    await prisma.recommendationOutcome.update({
      where: { id: outcome.id },
      data: {
        [field]: new Date(
          typeof event.ts === "number" && Number.isFinite(event.ts)
            ? event.ts
            : Date.now(),
        ),
        ...(field === "rejectedAt"
          ? {
              rejectionReason: String(
                event.reason || asRecord(event.payload).reason || "dismissed",
              ).slice(0, 240),
            }
          : {}),
        ...(field === "addedAt" && Number.isFinite(cartValue)
          ? { cartValueAfter: String(cartValue) }
          : {}),
      },
    });
  }
}

export async function markPurchasedRecommendationOutcomes(input: {
  shop: string;
  sessionIds: string[];
  orderId: string;
  orderValue?: number;
  lineItems: Array<{
    productId: string;
    variantId: string;
    quantity: number;
    price: number;
    totalDiscount: number;
  }>;
}) {
  const sessionIds = Array.from(new Set(input.sessionIds.filter(Boolean)));
  if (sessionIds.length === 0) {
    return { outcomeCount: 0, attributedRevenue: 0 };
  }
  return withCommerceTransaction(
    `order:${input.shop}`,
    input.orderId,
    async (tx) => {
      for (const sessionId of [...sessionIds].sort()) {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`session:${input.shop}`}), hashtext(${sessionId}))::text`;
      }
      const groupedLines = new Map<
        string,
        { productId: string; variantId: string; revenue: number }
      >();
      for (const line of input.lineItems) {
        const revenue = Math.max(
          Number(line.price || 0) * Number(line.quantity || 1) -
            Number(line.totalDiscount || 0),
          0,
        );
        const key = `${line.productId}:${line.variantId}`;
        const previous = groupedLines.get(key);
        groupedLines.set(key, {
          productId: line.productId,
          variantId: line.variantId,
          revenue: (previous?.revenue || 0) + revenue,
        });
      }
      for (const line of groupedLines.values()) {
        const credited = await tx.recommendationOutcome.findFirst({
          where: {
            shop: input.shop,
            orderId: input.orderId,
            productId: line.productId,
            variantId: line.variantId,
          },
        });
        if (credited) continue;
        const outcome = await tx.recommendationOutcome.findFirst({
          where: {
            shop: input.shop,
            sessionId: { in: sessionIds },
            productId: line.productId,
            purchasedAt: null,
            rejectedAt: null,
            session: { chatEngaged: true },
            AND: [
              { OR: [{ variantId: line.variantId }, { variantId: null }] },
              {
                OR: [{ clickedAt: { not: null } }, { addedAt: { not: null } }],
              },
            ],
          },
          orderBy: { shownAt: "desc" },
          select: { id: true },
        });
        if (!outcome) continue;
        await tx.recommendationOutcome.update({
          where: { id: outcome.id },
          data: {
            purchasedAt: new Date(),
            orderId: input.orderId,
            variantId: line.variantId,
            revenue: String(line.revenue),
          },
        });
      }
      // Return persisted totals, not this delivery's delta, so redelivery is stable.
      const outcomes = await tx.recommendationOutcome.findMany({
        where: { shop: input.shop, orderId: input.orderId },
        select: { sessionId: true, revenue: true },
      });
      const attributedRevenue = outcomes.reduce(
        (sum, outcome) => sum + Number(outcome.revenue || 0),
        0,
      );
      const orderValue = Number.isFinite(input.orderValue)
        ? Math.max(Number(input.orderValue), 0)
        : input.lineItems.reduce(
            (sum, line) =>
              sum +
              Math.max(
                Number(line.price || 0) * Number(line.quantity || 1) -
                  Number(line.totalDiscount || 0),
                0,
              ),
            0,
          );
      for (const sessionId of sessionIds)
        await tx.shopperSession.updateMany({
          where: { shop: input.shop, id: sessionId },
          data: {
            purchaseCompleted: true,
            salesState: "PURCHASED",
            orderId: input.orderId,
            orderValue: String(orderValue),
            aiAttributedRevenue: String(
              outcomes
                .filter((outcome) => outcome.sessionId === sessionId)
                .reduce(
                  (sum, outcome) => sum + Number(outcome.revenue || 0),
                  0,
                ),
            ),
          },
        });
      return { outcomeCount: outcomes.length, attributedRevenue };
    },
  );
}

export async function getRecommendationPerformance(shop: string) {
  const key = `sales-outcome-performance:${shop}`;
  try {
    const cached =
      await getJsonCache<
        Record<string, { shown: number; purchased: number; rejected: number }>
      >(key);
    if (cached) return cached;
    const rows = await prisma.recommendationOutcome.groupBy({
      by: ["productId"],
      where: { shop, shownAt: { gte: new Date(Date.now() - 90 * 86400000) } },
      _count: { _all: true, purchasedAt: true, rejectedAt: true },
    });
    const result = Object.fromEntries(
      rows.map((row) => [
        row.productId,
        {
          shown: row._count._all,
          purchased: row._count.purchasedAt,
          rejected: row._count.rejectedAt,
        },
      ]),
    );
    await setJsonCache(key, result, 600);
    return result;
  } catch {
    // Learning signals are optional: cache/analytics failure must not block sales.
    return {};
  }
}

function outcomeFieldForEvent(type: string) {
  if (type === "recommendation_clicked") return "clickedAt" as const;
  if (type === "recommendation_added" || type === "upsell_added") {
    return "addedAt" as const;
  }
  if (type === "recommendation_rejected" || type === "upsell_rejected") {
    return "rejectedAt" as const;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
