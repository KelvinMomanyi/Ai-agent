import type { CatalogCacheProduct } from "../models/catalogCache.server";
import type {
  MerchantSalesSettings,
  RankedRecommendation,
  ShopperProfile,
} from "./types";

export type UpsellAffinity = {
  sourceId: string;
  targetId: string;
  score: number;
  orderCount: number;
  reason?: string | null;
};

export function rankUpsells(input: {
  products: CatalogCacheProduct[];
  affinities: UpsellAffinity[];
  cartProductIds: string[];
  rejectedProductIds: string[];
  profile: ShopperProfile;
  settings: MerchantSalesSettings;
  cartValue: number;
}): RankedRecommendation<CatalogCacheProduct>[] {
  if (
    !input.settings.agentEnabled ||
    input.profile.purchaseIntentScore <
      input.settings.minimumUpsellIntentScore ||
    input.profile.currentObjection === "PRICE" ||
    input.profile.currentObjection === "NEED_TO_THINK"
  ) {
    return [];
  }
  const products = new Map(
    input.products.map((product) => [product.id, product]),
  );
  const cart = new Set(input.cartProductIds);
  const rejected = new Set(input.rejectedProductIds);
  const priority = new Set(input.settings.upsellPriorityProductIds);
  const blocked = new Set(input.settings.excludedProductIds);
  const affinityByTarget = new Map<string, UpsellAffinity>();
  for (const affinity of input.affinities) {
    if (!cart.has(affinity.sourceId)) continue;
    const current = affinityByTarget.get(affinity.targetId);
    if (!current || affinity.score > current.score) {
      affinityByTarget.set(affinity.targetId, affinity);
    }
  }

  return Array.from(affinityByTarget.values())
    .flatMap((affinity) => {
      const product = products.get(affinity.targetId);
      if (
        !product?.availableForSale ||
        cart.has(affinity.targetId) ||
        blocked.has(affinity.targetId) ||
        rejected.has(affinity.targetId)
      ) {
        return [];
      }
      const attachRate = Math.min(Math.log1p(affinity.orderCount) / 6, 1);
      const compatibility = clamp(affinity.score, 0, 1);
      const price = Number(product.price || 0);
      const priceResistance =
        input.profile.priceSensitivity === "high" &&
        price > Math.max(input.cartValue * 0.35, 1)
          ? 30
          : 0;
      const score =
        compatibility * 50 +
        attachRate * 25 +
        Math.min(Number(product.orderCount || 0) / 50, 1) * 10 +
        (priority.has(product.id) ? 10 : 0) -
        priceResistance;
      return [
        {
          product,
          score: Math.round(score * 100) / 100,
          rank: 1,
          reasons: [
            affinity.reason || "Complements an item in your cart",
          ].slice(0, 4),
          recommendedVariantId:
            product.variants.filter((variant) => variant.availableForSale)
              .length === 1
              ? product.variants.find((variant) => variant.availableForSale)
                  ?.id || ""
              : "",
          recommendationType: "upsell" as const,
        },
      ];
    })
    .filter((entry) => entry.score > 20)
    .sort((left, right) => right.score - left.score)
    .slice(0, 1)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(
    Math.max(Number.isFinite(value) ? value : 0, minimum),
    maximum,
  );
}
