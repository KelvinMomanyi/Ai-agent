import type { Prisma } from "@prisma/client";
import type { OfferDecision, OfferCandidate, ShopperSessionSnapshot } from "../ai/types";
import { catalogProductToWidgetProduct } from "./catalogGuard.server";
import prisma from "../db.server";
import { getActiveBundlesForProduct } from "./bundle.server";
import {
  getRecommendationCatalog,
  pickCatalogProducts,
  type CatalogCacheProduct,
} from "./catalogCache.server";

export async function buildOfferCandidates(input: {
  shop: string;
  session: ShopperSessionSnapshot;
  currentProductId?: string;
  excludeProductIds?: string[];
}): Promise<OfferCandidate[]> {
  const recommendationSourceProductId =
    input.currentProductId ||
    input.session.cartProductIds[0] ||
    input.session.viewedProductIds.at(-1);
  const [catalog, bundles] = await Promise.all([
    getRecommendationCatalog({
      shop: input.shop,
      sourceProductId: recommendationSourceProductId,
    }),
    getActiveBundlesForProduct(input.shop, input.currentProductId, {
      excludeProductIds: input.excludeProductIds,
    }),
  ]);
  const catalogProducts = pickCatalogProducts({
    catalog,
    sourceProductId: recommendationSourceProductId,
    cartProductIds: input.session.cartProductIds,
    excludeProductIds: input.excludeProductIds,
    query: String(input.session.context?.lastSearchQuery || ""),
    limit: 5,
  });

  const bundleCandidates: OfferCandidate[] = bundles.map((bundle) => ({
    id: bundle.id,
    type: "bundle",
    widgetType: "bundle",
    productId: input.currentProductId,
    title: bundle.name,
    score: 0.8 + bundle.priority / 500,
    affinityScore: 0.8 + bundle.priority / 500,
    payload: {
      bundle,
      items: bundle.items.map((item) => ({
        ...catalogProductToWidgetProduct(item.product),
        quantity: item.quantity,
      })),
    },
  }));

  const affinityCandidates: OfferCandidate[] = catalogProducts.map((product, index) => ({
    id: product.id,
    type: "product",
    widgetType:
      input.session.cartProductIds.length > 0 ? "upsell_drawer" : "rec_strip",
    productId: product.id,
    title: product.title,
    score: scoreCatalogCandidate(product, index, recommendationSourceProductId),
    affinityScore: scoreCatalogCandidate(product, index, recommendationSourceProductId),
    payload: {
      product: catalogProductToWidgetProduct(product),
      affinity: {
        score: scoreCatalogCandidate(product, index, recommendationSourceProductId),
        reason: "Selected from the synced store catalog.",
        orderCount: 0,
      },
    },
  }));

  return [...bundleCandidates, ...affinityCandidates].sort(
    (left, right) => right.score - left.score,
  );
}

function scoreCatalogCandidate(
  product: CatalogCacheProduct,
  index: number,
  sourceProductId?: string,
) {
  const sourceBoost = sourceProductId ? 0.2 : 0;
  const categoryBoost = product.category && product.category !== "uncategorized" ? 0.1 : 0;
  return Math.max(0.25, 0.72 + sourceBoost + categoryBoost - index * 0.04);
}

export async function createOfferRecord(input: {
  shop: string;
  sessionId: string;
  decision: OfferDecision;
  triggerContext: Record<string, unknown>;
  abVariant?: string | null;
}) {
  if (!input.decision.widgetType) return null;

  return prisma.offer.create({
    data: {
      shop: input.shop,
      sessionId: input.sessionId,
      widgetType: input.decision.widgetType,
      payload: input.decision.payload as Prisma.InputJsonValue,
      triggerContext: input.triggerContext as Prisma.InputJsonValue,
      aiProvider: input.decision.aiProvider,
      abVariant: input.abVariant || null,
    },
  });
}

export async function markOfferImpression(shop: string, offerId: string) {
  return prisma.offer.updateMany({
    where: { shop, id: offerId },
    data: { shown: true },
  });
}

export async function markOfferClick(shop: string, offerId: string) {
  return prisma.offer.updateMany({
    where: { shop, id: offerId },
    data: { clicked: true },
  });
}

export async function markOfferConversion(
  shop: string,
  offerId: string,
  revenueImpact?: string | number,
) {
  return prisma.offer.updateMany({
    where: { shop, id: offerId },
    data: {
      converted: true,
      revenueImpact:
        revenueImpact === undefined || revenueImpact === null
          ? undefined
          : String(revenueImpact),
    },
  });
}
