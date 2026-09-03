import type { Prisma } from "@prisma/client";
import prisma from "../db.server";
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
  let updated = 0;
  let attributedRevenue = 0;
  for (const line of input.lineItems) {
    const revenue = Math.max(
      Number(line.price || 0) * Number(line.quantity || 1) -
        Number(line.totalDiscount || 0),
      0,
    );
    const result = await prisma.recommendationOutcome.updateMany({
      where: {
        shop: input.shop,
        sessionId: { in: sessionIds },
        productId: line.productId,
        purchasedAt: null,
        OR: [{ clickedAt: { not: null } }, { addedAt: { not: null } }],
      },
      data: {
        purchasedAt: new Date(),
        orderId: input.orderId,
        revenue: String(revenue),
      },
    });
    updated += result.count;
    if (result.count > 0) attributedRevenue += revenue;
  }
  if (updated > 0) {
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
    await prisma.shopperSession.updateMany({
      where: { shop: input.shop, id: { in: sessionIds } },
      data: {
        purchaseCompleted: true,
        salesState: "PURCHASED",
        orderId: input.orderId,
        orderValue: String(orderValue),
        aiAttributedRevenue: String(attributedRevenue),
      },
    });
  }
  return { outcomeCount: updated, attributedRevenue };
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
