import type { Prisma, ShopperSession } from "@prisma/client";
import prisma from "../db.server";
import {
  calculateHesitationScore,
  calculatePurchaseIntent,
} from "../sales/intentScoring";
import { classifyObjection } from "../sales/objectionEngine";
import { determineSalesState } from "../sales/salesStateMachine";
import {
  extractProfileUpdates,
  mergeShopperProfile,
  normalizeShopperProfile,
} from "../sales/shopperProfile";

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
  salesState: string;
  intentScore: number;
  hesitationScore: number;
  shopperProfile: Prisma.InputJsonObject;
  viewedProductIds: string[];
  cartProductIds: string[];
  checkoutStarted: boolean;
  purchaseCompleted: boolean;
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

export async function getShopperSessionSnapshot(
  shop: string,
  sessionId: string,
) {
  const session = await getShopperSession(shop, sessionId);
  if (!session) return null;
  return toShopperSessionSnapshot(session);
}

export async function upsertShopperSessionFromEvents(input: {
  shop: string;
  sessionId: string;
  customerId?: string | null;
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
    update: {
      ...computed,
      lastActivityAt: new Date(),
      ...(input.customerId ? { customerId: input.customerId } : {}),
    },
    create: {
      id: input.sessionId,
      shop: input.shop,
      anonymousId: input.sessionId,
      customerId: input.customerId || null,
      lastActivityAt: new Date(),
      ...computed,
    },
  });
}

export function toShopperSessionSnapshot(session: ShopperSession) {
  return {
    id: session.id,
    anonymousId: session.anonymousId,
    journeyStage: session.journeyStage,
    salesState: session.salesState,
    intentScore: session.intentScore,
    hesitationScore: session.hesitationScore,
    shopperProfile: normalizeShopperProfile(session.shopperProfile),
    viewedProductIds: session.viewedProductIds,
    cartProductIds: session.cartProductIds,
    chatEngaged: session.chatEngaged,
    checkoutStarted: session.checkoutStarted,
    purchaseCompleted: session.purchaseCompleted,
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
  const cartVariantIds = new Set(
    toStringArray(asRecord(existing?.context).cartVariantIds),
  );
  let totalPageViews = existing?.totalPageViews || 0;
  let sessionDuration = existing?.sessionDuration || 0;
  let maxScrollDepth = Number(asRecord(existing?.context).maxScrollDepth || 0);
  let addToCartCount = Number(asRecord(existing?.context).addToCartCount || 0);
  let cartItemCount = Number(
    asRecord(existing?.context).cartItemCount || cartProductIds.size,
  );
  let cartValue = Number(asRecord(existing?.context).cartValue || 0);
  let lastEventType = String(asRecord(existing?.context).lastEventType || "");
  let intentSignals = Number(asRecord(existing?.context).intentSignals || 0);
  let hesitationSignals = Number(
    asRecord(existing?.context).hesitationSignals || 0,
  );
  let checkoutStarted = existing?.checkoutStarted || false;
  let purchaseCompleted = existing?.purchaseCompleted || false;
  let shopperProfile = normalizeShopperProfile(existing?.shopperProfile);
  let currentObjection = shopperProfile.currentObjection;
  const existingContext = asRecord(existing?.context);
  const eventCounts = new Map<string, number>(
    Object.entries(asRecord(existingContext.behaviorEventCounts)).map(
      ([type, count]) => [type, Math.max(0, Number(count || 0))],
    ),
  );
  const productViewCounts = new Map<string, number>(
    Object.entries(asRecord(existingContext.productViewCounts)).map(
      ([productId, count]) => [productId, Math.max(0, Number(count || 0))],
    ),
  );
  for (const productId of existing?.viewedProductIds || []) {
    if (!productViewCounts.has(productId)) productViewCounts.set(productId, 1);
  }
  const collectionsViewed = new Set(
    toStringArray(existingContext.collectionsViewed),
  );
  const searchQueries = toStringArray(existingContext.searchQueries);
  const recommendationsShown = new Set(
    toStringArray(existingContext.recommendationsShown),
  );
  const recommendationsClicked = new Set(
    toStringArray(existingContext.recommendationsClicked),
  );
  const recommendationsAccepted = new Set(
    toStringArray(existingContext.recommendationsAccepted),
  );
  const recommendationsRejected = new Set(
    toStringArray(existingContext.recommendationsRejected),
  );
  const upsellsShown = new Set(toStringArray(existingContext.upsellsShown));
  const upsellsAccepted = new Set(
    toStringArray(existingContext.upsellsAccepted),
  );
  const upsellsRejected = new Set(
    toStringArray(existingContext.upsellsRejected),
  );
  let landingPage = String(existingContext.landingPage || "");
  let currentPage = String(existingContext.currentPage || "");
  let trafficSource = String(existingContext.trafficSource || "");
  let cartContents = Array.isArray(existingContext.cartContents)
    ? existingContext.cartContents
    : [];
  let currentProductId = String(
    existingContext.currentProductId || existing?.viewedProductIds.at(-1) || "",
  );
  let currentVariantId = String(existingContext.currentVariantId || "");
  let currentCollectionId = String(existingContext.currentCollectionId || "");

  for (const event of events) {
    lastEventType = event.type;
    if (event.type !== "session_sync") {
      eventCounts.set(event.type, (eventCounts.get(event.type) || 0) + 1);
    }

    if (event.type === "page_view") {
      totalPageViews += 1;
      currentPage = String(event.url || event.path || "").slice(0, 500);
      if (!landingPage) landingPage = currentPage;
      if (!trafficSource) {
        trafficSource = getTrafficSource(event.referrer);
      }
    }

    if (event.type === "product_view" || event.type === "product_viewed") {
      const productId = getProductId(event);
      if (productId) {
        currentProductId = productId;
        viewedProductIds.add(productId);
        productViewCounts.set(
          productId,
          (productViewCounts.get(productId) || 0) + 1,
        );
      }
    }

    if (
      event.type === "collection_view" ||
      event.type === "collection_viewed"
    ) {
      const collectionId = String(
        event.collectionId || event.collection_id || "",
      );
      if (collectionId) {
        currentCollectionId = collectionId;
        collectionsViewed.add(collectionId);
      }
    }

    if (event.type === "search" || event.type === "search_performed") {
      const query = String(event.query || "")
        .trim()
        .slice(0, 160);
      if (query && !searchQueries.includes(query)) searchQueries.push(query);
    }

    if (event.type === "customer_message_sent") {
      const message = String(
        event.message || asRecord(event.payload).message || "",
      );
      const objection = classifyObjection(message);
      currentObjection = objection;
      shopperProfile = mergeShopperProfile(
        shopperProfile,
        extractProfileUpdates(message),
        { objection },
      );
    }

    if (event.type === "add_to_cart") {
      addToCartCount += 1;
      const productId = getProductId(event);
      if (productId) cartProductIds.add(productId);
      for (const variantId of toStringArray(event.cartVariantIds)) {
        cartVariantIds.add(variantId);
      }
      const addedVariantId = String(event.variantId || event.variant_id || "");
      if (addedVariantId) {
        currentVariantId = addedVariantId;
        cartVariantIds.add(addedVariantId);
      }
      cartItemCount = Math.max(cartItemCount, Number(event.cartItemCount || 0));
      cartValue = Math.max(cartValue, getCartValue(event));
    }

    if (event.type === "cart_update") {
      const nextCartProductIds = toStringArray(event.cartProductIds);
      if (
        nextCartProductIds.length > 0 ||
        Number(event.cartItemCount || 0) === 0
      ) {
        cartProductIds.clear();
      }
      for (const productId of nextCartProductIds) {
        cartProductIds.add(productId);
      }
      const nextCartVariantIds = toStringArray(event.cartVariantIds);
      if (
        nextCartVariantIds.length > 0 ||
        Number(event.cartItemCount || 0) === 0
      ) {
        cartVariantIds.clear();
      }
      for (const variantId of nextCartVariantIds) {
        cartVariantIds.add(variantId);
      }
      cartItemCount = Number(
        event.cartItemCount ||
          nextCartProductIds.length ||
          nextCartVariantIds.length ||
          0,
      );
      cartValue = getCartValue(event);
      cartContents = Array.isArray(event.cartItems)
        ? event.cartItems
        : cartContents;
    }

    if (event.type === "variant_selected") {
      currentVariantId = String(event.variantId || event.variant_id || "");
      const productId = getProductId(event);
      if (productId) currentProductId = productId;
    }

    if (event.type === "checkout_start" || event.type === "checkout_started") {
      checkoutStarted = true;
    }

    if (event.type === "purchase_completed") purchaseCompleted = true;

    const recommendationId = getRecommendationProductId(event);
    if (recommendationId) {
      if (
        event.type === "recommendation_shown" ||
        event.type === "upsell_shown"
      ) {
        recommendationsShown.add(recommendationId);
      }
      if (event.type === "upsell_shown") upsellsShown.add(recommendationId);
      if (event.type === "recommendation_clicked") {
        recommendationsClicked.add(recommendationId);
      }
      if (
        event.type === "recommendation_added" ||
        event.type === "upsell_added"
      ) {
        recommendationsAccepted.add(recommendationId);
      }
      if (event.type === "upsell_added") upsellsAccepted.add(recommendationId);
      if (
        event.type === "recommendation_rejected" ||
        event.type === "upsell_rejected"
      ) {
        recommendationsRejected.add(recommendationId);
      }
      if (event.type === "upsell_rejected")
        upsellsRejected.add(recommendationId);
    }

    if (event.type === "remove_from_cart") {
      const productId = getProductId(event);
      if (productId) cartProductIds.delete(productId);
    }

    if (event.type === "scroll_depth") {
      const depth = Number(event.depth || event.scrollDepth || 0);
      maxScrollDepth = Math.max(maxScrollDepth, depth);
    }

    if (isIntentSignal(event.type)) {
      intentSignals += 1;
    }

    if (isHesitationSignal(event.type)) {
      hesitationSignals += 1;
    }

    if (event.type === "session_sync") {
      const snapshot = asRecord(event.snapshot);
      sessionDuration = Math.max(
        sessionDuration,
        Number(snapshot.sessionDuration || event.sessionDuration || 0),
      );
      cartValue = Math.max(
        cartValue,
        Number(
          snapshot.cartValue ||
            snapshot.cartTotal ||
            event.cartValue ||
            event.cartTotal ||
            0,
        ),
      );
      for (const productId of toStringArray(
        snapshot.viewedProductIds || event.viewedProductIds,
      )) {
        viewedProductIds.add(productId);
      }
      for (const productId of toStringArray(
        snapshot.cartProductIds || event.cartProductIds,
      )) {
        cartProductIds.add(productId);
      }
      for (const variantId of toStringArray(
        snapshot.cartVariantIds || event.cartVariantIds,
      )) {
        cartVariantIds.add(variantId);
      }
      cartItemCount = Math.max(
        cartItemCount,
        Number(
          snapshot.cartItemCount ||
            event.cartItemCount ||
            cartProductIds.size ||
            cartVariantIds.size,
        ),
      );
    }
  }

  const repeatedProducts = Array.from(productViewCounts.entries()).filter(
    ([productId, count]) => count >= 2 && !cartProductIds.has(productId),
  ).length;
  const intentScore = calculatePurchaseIntent({
    eventCounts: Object.fromEntries(eventCounts),
    productsViewed: viewedProductIds.size,
    repeatedProducts,
    cartItemCount,
    sessionDurationSeconds: sessionDuration,
    checkoutStarted,
    profile: shopperProfile,
  });
  const hesitationScore = calculateHesitationScore({
    intentScore,
    eventCounts: Object.fromEntries(eventCounts),
    repeatedProducts,
    cartItemCount,
    sessionDurationSeconds: sessionDuration,
    currentObjection,
  });
  shopperProfile = mergeShopperProfile(
    shopperProfile,
    {},
    {
      objection: currentObjection,
      purchaseIntentScore: intentScore,
    },
  );
  const salesState = determineSalesState({
    currentState: existing?.salesState,
    intentScore,
    hesitationScore,
    cartItemCount,
    productsViewed: viewedProductIds.size,
    recommendationsShown: recommendationsShown.size,
    recommendationsClicked: recommendationsClicked.size,
    recommendationsAccepted: recommendationsAccepted.size,
    customerMessageCount: Number(eventCounts.get("customer_message_sent") || 0),
    checkoutStarted,
    purchaseCompleted,
    cartAbandoned: Number(eventCounts.get("cart_abandoned") || 0) > 0,
    objection: currentObjection,
    profile: shopperProfile,
  });
  const journeyStage = computeJourneyStage({
    viewedCount: viewedProductIds.size,
    productViewCounts,
    cartCount: Math.max(cartProductIds.size, cartItemCount),
    sessionDuration,
  });

  return {
    journeyStage,
    salesState,
    intentScore,
    hesitationScore,
    shopperProfile: shopperProfile as unknown as Prisma.InputJsonObject,
    viewedProductIds: Array.from(viewedProductIds),
    cartProductIds: Array.from(cartProductIds),
    checkoutStarted,
    purchaseCompleted,
    totalPageViews,
    sessionDuration,
    context: {
      maxScrollDepth,
      addToCartCount,
      cartItemCount,
      cartVariantIds: Array.from(cartVariantIds),
      cartValue,
      cartContents: cartContents as Prisma.InputJsonArray,
      trafficSource,
      landingPage,
      currentPage,
      currentProductId,
      currentVariantId,
      currentCollectionId,
      collectionsViewed: Array.from(collectionsViewed).slice(-30),
      searchQueries: searchQueries.slice(-20),
      productViewCounts: Object.fromEntries(productViewCounts),
      behaviorEventCounts: Object.fromEntries(eventCounts),
      recommendationsShown: Array.from(recommendationsShown).slice(-30),
      recommendationsClicked: Array.from(recommendationsClicked).slice(-30),
      recommendationsAccepted: Array.from(recommendationsAccepted).slice(-30),
      recommendationsRejected: Array.from(recommendationsRejected).slice(-30),
      upsellsShown: Array.from(upsellsShown).slice(-20),
      upsellsAccepted: Array.from(upsellsAccepted).slice(-20),
      upsellsRejected: Array.from(upsellsRejected).slice(-20),
      intentSignals,
      hesitationSignals,
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

function getRecommendationProductId(event: StorefrontEvent) {
  return String(
    event.productId ||
      asRecord(event.payload).productId ||
      asRecord(event.metadata).productId ||
      "",
  );
}

function getTrafficSource(value: unknown) {
  const referrer = String(value || "").trim();
  if (!referrer) return "direct";
  try {
    return new URL(referrer).hostname.slice(0, 255);
  } catch {
    return referrer.slice(0, 255);
  }
}

function isIntentSignal(type: string) {
  return [
    "long_product_dwell",
    "repeated_product_view",
    "scroll_depth_interest",
    "comparison_page_visit",
    "search_query",
    "wishlist_save",
    "first_time_visitor",
    "purchase_history_match",
    "loyalty_tier_reached",
  ].includes(type);
}

function isHesitationSignal(type: string) {
  return [
    "price_hesitation",
    "price_sensitive_chat",
    "coupon_field_focus",
    "cart_item_removed",
    "cart_abandoned",
    "exit_intent",
    "inactivity_timeout",
    "payment_failure",
  ].includes(type);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
