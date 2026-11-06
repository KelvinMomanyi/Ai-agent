import type { Prisma } from "@prisma/client";
import type {
  OfferDecision,
  OfferCandidate,
  ShopperSessionSnapshot,
} from "../ai/types";
import { catalogProductToWidgetProduct } from "./catalogGuard.server";
import prisma from "../db.server";
import { capturePairingProvenance } from "./pairingProvenance.server";
import { getActiveBundlesForProduct } from "./bundle.server";
import {
  selectPairingRecommendations,
  getPairingDenials,
  type PairingRules,
} from "./pairingRecommendations.server";
import { stripPrivateSignals } from "../utils/storefrontPayload.server";

export async function buildOfferCandidates(input: {
  shop: string;
  session: ShopperSessionSnapshot;
  currentProductId?: string;
  sourceProductId?: string;
  excludeProductIds?: string[];
  settings?: PairingRules;
  cartOnly?: boolean;
}): Promise<OfferCandidate[]> {
  const recommendationSourceProductId =
    input.sourceProductId ||
    input.currentProductId ||
    input.session.cartProductIds[0] ||
    input.session.viewedProductIds.at(-1);
  const settings = input.settings ||
    (await prisma.appSettings.findUnique({
      where: { shop: input.shop },
      select: {
        blockedProductIds: true,
        excludedCollectionIds: true,
        preferredProductIds: true,
        upsellPriorityProductIds: true,
        pairingMode: true,
        pairingStrictness: true,
        pairingSensitiveKeywords: true,
        verticalPreset: true,
      },
    })) || {
      blockedProductIds: [],
      excludedCollectionIds: [],
      preferredProductIds: [],
      upsellPriorityProductIds: [],
    };
  const [selected, allBundles] = await Promise.all([
    selectPairingRecommendations({
      shop: input.shop,
      sourceProductId: recommendationSourceProductId,
      cartProductIds: input.session.cartProductIds,
      excludeProductIds: input.excludeProductIds,
      settings,
      limit: input.cartOnly ? 12 : 5,
    }),
    input.cartOnly
      ? Promise.resolve([])
      : getActiveBundlesForProduct(input.shop, input.currentProductId, {
          excludeProductIds: input.excludeProductIds,
        }),
  ]);
  const denied = await getPairingDenials({
    shop: input.shop,
    sourceProductId: recommendationSourceProductId,
    cartProductIds: input.session.cartProductIds,
    targetProductIds: allBundles.flatMap((bundle) =>
      bundle.items.map((item) => item.productId),
    ),
  });
  const bundles = allBundles.filter((bundle) =>
    bundle.items.every(
      (item) =>
        !denied.has(item.productId) &&
        !settings.blockedProductIds.includes(item.productId) &&
        !item.product.collectionIds.some((id) =>
          settings.excludedCollectionIds.includes(id),
        ),
    ),
  );

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
        ...stripPrivateSignals(catalogProductToWidgetProduct(item.product)),
        quantity: item.quantity,
      })),
    },
  }));

  const affinityCandidates: OfferCandidate[] = selected.map(
    ({ product, reason, tier }, index) => ({
      id: product.id,
      type: "product",
      widgetType:
        input.session.cartProductIds.length > 0 ? "upsell_drawer" : "rec_strip",
      productId: product.id,
      title: product.title,
      score:
        (tier === "approved"
          ? 0.99
          : tier === "auto_approved"
            ? 0.9
            : tier === "copurchase"
              ? 0.8
              : 0.5) -
        index * 0.005,
      affinityScore:
        (tier === "approved"
          ? 0.99
          : tier === "auto_approved"
            ? 0.9
            : tier === "copurchase"
              ? 0.8
              : 0.5) -
        index * 0.005,
      payload: {
        pairingTier:
          tier === "approved"
            ? 0
            : tier === "auto_approved"
              ? 1
              : tier === "copurchase"
                ? 2
                : 3,
        product: stripPrivateSignals(catalogProductToWidgetProduct(product)),
        affinity: {
          score:
            (tier === "approved"
              ? 0.99
              : tier === "auto_approved"
                ? 0.9
                : tier === "copurchase"
                  ? 0.8
                  : 0.5) -
            index * 0.005,
          reason,
          orderCount: Math.max(0, Number(product.orderCount || 0)),
        },
      },
    }),
  );

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
  experimentId?: string | null;
}) {
  if (!input.decision.widgetType) return null;
  const source = String(
    input.triggerContext.sourceProductId ||
      input.triggerContext.currentProductId ||
      (input.triggerContext.cartProductIds as string[] | undefined)?.[0] ||
      "",
  );
  const targets = Array.isArray(input.decision.payload.products)
    ? input.decision.payload.products.map((entry: any) =>
        String(entry.productId || entry.product?.id || ""),
      )
    : [];
  const pairingProvenance = ["upsell_drawer", "upsell", "rec_strip"].includes(
    input.decision.widgetType,
  )
    ? await capturePairingProvenance(input.shop, source, targets)
    : [];
  if (pairingProvenance === null) return null;
  const payload = stripPrivateSignals(input.decision.payload);
  delete payload.offerId;

  return prisma.offer.create({
    data: {
      shop: input.shop,
      sessionId: input.sessionId,
      widgetType: input.decision.widgetType,
      payload: payload as Prisma.InputJsonValue,
      pairingProvenance: pairingProvenance as unknown as Prisma.InputJsonValue,
      triggerContext: input.triggerContext as Prisma.InputJsonValue,
      aiProvider: input.decision.aiProvider,
      abVariant: input.abVariant || null,
      experimentId: input.experimentId || null,
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
