import type { OfferDecision, OfferCandidate, ShopperSessionSnapshot } from "../ai/types";
import prisma from "../db.server";
import { getActiveBundlesForProduct } from "./bundle.server";
import { getTopAffinities } from "./product.server";

export async function buildOfferCandidates(input: {
  shop: string;
  session: ShopperSessionSnapshot;
  currentProductId?: string;
}): Promise<OfferCandidate[]> {
  const [affinities, bundles] = await Promise.all([
    input.currentProductId
      ? getTopAffinities(input.shop, input.currentProductId, 5)
      : Promise.resolve([]),
    getActiveBundlesForProduct(input.shop, input.currentProductId),
  ]);

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
        id: item.product.id,
        title: item.product.title,
        imageUrl: item.product.imageUrl,
        price: item.product.price.toString(),
        quantity: item.quantity,
      })),
    },
  }));

  const affinityCandidates: OfferCandidate[] = affinities.map((affinity) => ({
    id: affinity.targetId,
    type: "product",
    widgetType:
      input.session.cartProductIds.length > 0 ? "upsell_drawer" : "rec_strip",
    productId: affinity.targetId,
    title: (affinity as any).target?.title || affinity.targetId,
    score: affinity.score,
    affinityScore: affinity.score,
    payload: {
      product: (affinity as any).target,
      affinity: {
        score: affinity.score,
        reason: affinity.reason,
        orderCount: affinity.orderCount,
      },
    },
  }));

  return [...bundleCandidates, ...affinityCandidates].sort(
    (left, right) => right.score - left.score,
  );
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
      payload: input.decision.payload,
      triggerContext: input.triggerContext,
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
