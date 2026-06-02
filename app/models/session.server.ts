import type { Prisma, ShopperSession } from "@prisma/client";
import prisma from "../db.server";

export type StorefrontEvent = {
  type: string;
  ts?: number;
  sessionId?: string;
  shop?: string;
  url?: string;
  referrer?: string;
  [key: string]: unknown;
};

export type SessionComputation = {
  journeyStage: string;
  intentScore: number;
  hesitationScore: number;
  viewedProductIds: string[];
  cartProductIds: string[];
  totalPageViews: number;
  sessionDuration: number;
  context: Prisma.InputJsonObject;
};

export async function getShopperSession(shop: string, sessionId: string) {
  return prisma.shopperSession.findFirst({
    where: {
      shop,
      OR: [{ id: sessionId }, { anonymousId: sessionId }],
    },
  });
}

export async function getShopperSessionSnapshot(shop: string, sessionId: string) {
  const session = await getShopperSession(shop, sessionId);
  if (!session) return null;
  return toShopperSessionSnapshot(session);
}

export async function upsertShopperSessionFromEvents(input: {
  shop: string;
  sessionId: string;
  events: StorefrontEvent[];
}) {
  const existing = await getShopperSession(input.shop, input.sessionId);
  const computed = computeSessionState(existing, input.events);

  return prisma.shopperSession.upsert({
    where: {
      shop_anonymousId: {
        shop: input.shop,
        anonymousId: input.sessionId,
      },
    },
    update: computed,
    create: {
      id: input.sessionId,
      shop: input.shop,
      anonymousId: input.sessionId,
      ...computed,
    },
  });
}

export function toShopperSessionSnapshot(session: ShopperSession) {
  return {
    id: session.id,
    anonymousId: session.anonymousId,
    journeyStage: session.journeyStage,
    intentScore: session.intentScore,
    hesitationScore: session.hesitationScore,
    viewedProductIds: session.viewedProductIds,
    cartProductIds: session.cartProductIds,
    chatEngaged: session.chatEngaged,
    totalPageViews: session.totalPageViews,
    sessionDuration: session.sessionDuration,
    context: asRecord(session.context),
  };
}

export function computeSessionState(
  existing: ShopperSession | null,
  events: StorefrontEvent[],
): SessionComputation {
  const viewedProductIds = new Set(existing?.viewedProductIds || []);
  const cartProductIds = new Set(existing?.cartProductIds || []);
  let totalPageViews = existing?.totalPageViews || 0;
  let sessionDuration = existing?.sessionDuration || 0;
  let maxScrollDepth = Number(asRecord(existing?.context).maxScrollDepth || 0);
  let addToCartCount = Number(asRecord(existing?.context).addToCartCount || 0);
  let cartValue = Number(asRecord(existing?.context).cartValue || 0);
  let lastEventType = String(asRecord(existing?.context).lastEventType || "");
  const productViewCounts = new Map<string, number>();

  for (const productId of existing?.viewedProductIds || []) {
    productViewCounts.set(productId, 1);
  }

  for (const event of events) {
    lastEventType = event.type;

    if (event.type === "page_view") totalPageViews += 1;

    if (event.type === "product_view") {
      const productId = getProductId(event);
      if (productId) {
        viewedProductIds.add(productId);
        productViewCounts.set(productId, (productViewCounts.get(productId) || 0) + 1);
      }
    }

    if (event.type === "add_to_cart") {
      addToCartCount += 1;
      const productId = getProductId(event);
      if (productId) cartProductIds.add(productId);
      cartValue = Math.max(cartValue, getCartValue(event));
    }

    if (event.type === "remove_from_cart") {
      const productId = getProductId(event);
      if (productId) cartProductIds.delete(productId);
    }

    if (event.type === "scroll_depth") {
      const depth = Number(event.depth || event.scrollDepth || 0);
      maxScrollDepth = Math.max(maxScrollDepth, depth);
    }

    if (event.type === "session_sync") {
      const snapshot = asRecord(event.snapshot);
      sessionDuration = Math.max(
        sessionDuration,
        Number(snapshot.sessionDuration || event.sessionDuration || 0),
      );
      cartValue = Math.max(
        cartValue,
        Number(snapshot.cartValue || snapshot.cartTotal || event.cartValue || event.cartTotal || 0),
      );
      for (const productId of toStringArray(snapshot.viewedProductIds || event.viewedProductIds)) {
        viewedProductIds.add(productId);
      }
      for (const productId of toStringArray(snapshot.cartProductIds || event.cartProductIds)) {
        cartProductIds.add(productId);
      }
    }
  }

  const productViews = Array.from(productViewCounts.values()).reduce(
    (sum, count) => sum + count,
    0,
  );
  const intentScore = clamp(
    totalPageViews * 2 +
      productViews * 5 +
      (maxScrollDepth >= 90 ? 10 : maxScrollDepth >= 75 ? 8 : maxScrollDepth >= 50 ? 5 : 0) +
      Math.min(sessionDuration / 120, 1) * 30 +
      (cartProductIds.size > 0 ? 30 : 0),
    0,
    100,
  );
  const repeatedProductWithoutCart = Array.from(productViewCounts.entries()).some(
    ([productId, count]) => count >= 2 && !cartProductIds.has(productId),
  );
  const hesitationScore = clamp(
    (intentScore > 40 && addToCartCount === 0 && sessionDuration >= 90 ? 55 : 0) +
      (repeatedProductWithoutCart ? 35 : 0),
    0,
    100,
  );
  const journeyStage = computeJourneyStage({
    viewedCount: viewedProductIds.size,
    productViewCounts,
    cartCount: cartProductIds.size,
    sessionDuration,
  });

  return {
    journeyStage,
    intentScore,
    hesitationScore,
    viewedProductIds: Array.from(viewedProductIds),
    cartProductIds: Array.from(cartProductIds),
    totalPageViews,
    sessionDuration,
    context: {
      maxScrollDepth,
      addToCartCount,
      cartValue,
      lastEventType,
      lastEventAt: new Date().toISOString(),
    },
  };
}

function computeJourneyStage(input: {
  viewedCount: number;
  productViewCounts: Map<string, number>;
  cartCount: number;
  sessionDuration: number;
}) {
  if (input.cartCount > 0) return "buying";
  if (
    input.sessionDuration >= 60 ||
    Array.from(input.productViewCounts.values()).some((count) => count >= 2)
  ) {
    return "deciding";
  }
  if (input.viewedCount >= 3) return "comparing";
  return "discovering";
}

function getProductId(event: StorefrontEvent) {
  return String(
    event.productId ||
      event.product_id ||
      asRecord(event.product).id ||
      asRecord(event.payload).productId ||
      "",
  );
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function getCartValue(event: StorefrontEvent) {
  const payload = asRecord(event.payload);
  return Number(
    event.cartValue ||
      event.cartTotal ||
      payload.cartValue ||
      payload.cartTotal ||
      0,
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
