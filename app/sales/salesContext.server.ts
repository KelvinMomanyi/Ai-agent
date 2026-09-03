import type { ShopperSession } from "@prisma/client";
import type { GroundedCartContext } from "../models/chatResponse";
import type { CatalogCacheProduct } from "../models/catalogCache.server";
import { getObjectionGuidance } from "./objectionEngine";
import {
  getSalesStateGuidance,
  normalizeSalesState,
} from "./salesStateMachine";
import { normalizeShopperProfile } from "./shopperProfile";
import type { MerchantSalesSettings } from "./types";

export function buildSalesContext(input: {
  session: ShopperSession;
  currentPage: { pageType?: string; path?: string; productId?: string };
  cart: GroundedCartContext;
  recentProducts: CatalogCacheProduct[];
  recentEvents: Array<{ type: string; payload: unknown }>;
  previousRecommendations: Array<{
    productId: string;
    recommendationType: string;
    clickedAt: Date | null;
    addedAt: Date | null;
    rejectedAt: Date | null;
  }>;
  settings: MerchantSalesSettings;
}) {
  const profile = normalizeShopperProfile(input.session.shopperProfile);
  const state = normalizeSalesState(input.session.salesState);
  const productIndex = new Map(
    input.recentProducts.map((product) => [product.id, product.title]),
  );
  const recommendationSummary = input.previousRecommendations
    .slice(0, 8)
    .map((item) => {
      const outcome = item.addedAt
        ? "added"
        : item.rejectedAt
          ? "rejected"
          : item.clickedAt
            ? "clicked"
            : "shown";
      return `${productIndex.get(item.productId) || item.productId}: ${item.recommendationType}, ${outcome}`;
    });
  const recentHighValueEvents = input.recentEvents
    .filter((event) =>
      [
        "product_view",
        "product_revisited",
        "variant_selected",
        "add_to_cart",
        "remove_from_cart",
        "cart_opened",
        "cart_closed",
        "checkout_started",
        "recommendation_clicked",
        "recommendation_added",
        "upsell_rejected",
      ].includes(event.type),
    )
    .slice(0, 12)
    .map((event) => event.type);

  return [
    `Current sales state: ${state}`,
    `State guidance: ${getSalesStateGuidance(state)}`,
    `Purchase intent score: ${Math.round(input.session.intentScore)}/100`,
    `Hesitation score: ${Math.round(input.session.hesitationScore)}/100`,
    `Current objection: ${profile.currentObjection || "none"}`,
    profile.currentObjection
      ? `Objection guidance: ${getObjectionGuidance(profile.currentObjection, profile)}`
      : "",
    `Structured shopper profile: ${JSON.stringify(compactProfile(profile))}`,
    `Current page: ${[input.currentPage.pageType, input.currentPage.path, input.currentPage.productId].filter(Boolean).join("; ") || "unavailable"}`,
    `Cart item count: ${input.cart.itemCount}`,
    input.cart.totalPrice === null
      ? "Cart total: unavailable"
      : `Cart total: ${input.cart.totalPrice}`,
    `Recent high-value events: ${recentHighValueEvents.join(", ") || "none"}`,
    `Previous recommendation outcomes: ${recommendationSummary.join(" | ") || "none"}`,
    `Merchant controls: max ${input.settings.maxProductRecommendations} recommendations; upsell intent threshold ${input.settings.minimumUpsellIntentScore}; discounts ${input.settings.discountPermission ? "allowed only from configured codes" : "not allowed"}; bundles ${input.settings.bundleSupportEnabled ? "enabled" : "disabled"}.`,
    "Available capabilities: verified product search, product/variant lookup, inventory checks, comparisons, live cart reading, validated add-to-cart requests, related products, published shipping/returns information, and bundle suggestions. No arbitrary API, URL, SQL, code, or Admin GraphQL execution is available.",
  ]
    .filter(Boolean)
    .join("\n");
}

function compactProfile(profile: ReturnType<typeof normalizeShopperProfile>) {
  return Object.fromEntries(
    Object.entries(profile).filter(([key, value]) => {
      if (["updatedAt", "purchaseIntentScore"].includes(key)) return false;
      if (value === "" || value === null || value === "unknown") return false;
      return !Array.isArray(value) || value.length > 0;
    }),
  );
}
