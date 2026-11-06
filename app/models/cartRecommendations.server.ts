import { createHash } from "node:crypto";
import type { AppSettings } from "@prisma/client";
import type {
  OfferCandidate,
  OfferDecision,
  ShopperSessionSnapshot,
} from "../ai/types";
import { rankOffers } from "../ai/offerRanker.server";
import prisma from "../db.server";
import { getJsonCache, setJsonCache, redis } from "../redis.server";
import { buildOfferCandidates } from "./offer.server";
import { enforcePairingDecisionPolicy } from "./pairingRecommendations.server";
import {
  isRecentCartDismissal,
  recommendationLimit,
  CART_DISMISS_TTL_MS,
} from "../../shared/cartRecommendations";

const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const noCartOffer = (reasoning: string): OfferDecision => ({
  widgetType: null,
  payload: {},
  reasoning,
  confidence: 0,
  aiProvider: "heuristic",
});

export async function buildCartRecommendation(input: {
  shop: string;
  session: ShopperSessionSnapshot;
  settings: AppSettings;
  sourceProductId?: string;
  sourceVariantId?: string;
  cartProductIds: string[];
  cartVariantIds: string[];
  cartItems: Array<Record<string, unknown>>;
  cartItemCount: number;
  mutationId: string;
  confirmed: boolean;
  currency?: string;
  market?: string;
  dismissedWidgets: string[];
  signal?: AbortSignal;
}): Promise<OfferDecision> {
  if (!input.settings.upsellEnabled)
    return noCartOffer("cart_recommendations_disabled");
  if (!input.confirmed || !input.mutationId)
    return noCartOffer("cart_add_not_confirmed");
  if (input.cartItemCount <= 0 || !input.cartProductIds.length)
    return noCartOffer("cart_is_empty");
  if (
    input.sourceProductId &&
    !input.cartProductIds.includes(input.sourceProductId)
  )
    return noCartOffer("cart_source_not_present");
  if (input.signal?.aborted) return noCartOffer("cart_request_cancelled");
  if (
    input.dismissedWidgets.includes("upsell_drawer") ||
    isRecentCartDismissal(
      input.session.context.lastCartRecommendationDismissedAt,
    )
  )
    return noCartOffer("cart_recommendation_dismissed");
  const history = await prisma.recommendationOutcome.findMany({
    where: {
      shop: input.shop,
      sessionId: input.session.id,
      rejectedAt: { gte: new Date(Date.now() - CART_DISMISS_TTL_MS) },
    },
    select: { productId: true },
    orderBy: { rejectedAt: "desc" },
    take: 30,
  });
  const candidates = (
    await buildOfferCandidates({
      shop: input.shop,
      session: input.session,
      sourceProductId: input.sourceProductId,
      settings: input.settings,
      cartOnly: true,
      excludeProductIds: [
        ...input.settings.blockedProductIds,
        ...history.map(({ productId }) => productId),
      ],
    })
  )
    .filter((candidate) => candidate.type === "product")
    .slice(0, 12);
  if (!candidates.length) return noCartOffer("no_eligible_cart_complements");
  // Reuse the existing catalog invalidation generation; do not count/scan products
  // on every cart add. Candidate content also covers current approval changes.
  const catalog = (await redis.get(`catalog:${input.shop}:version`)) || "0";
  const key = `cart-ranking:${input.shop}:v1:${digest({
    source: input.sourceProductId,
    variant: input.sourceVariantId,
    cart: input.cartItems
      .map((item) => [item.key, item.productId, item.variantId, item.quantity])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    products: [...input.cartProductIds].sort(),
    variants: [...input.cartVariantIds].sort(),
    count: input.cartItemCount,
    currency: input.currency || "",
    market: input.market || "",
    settings: [
      process.env.AOVBOOST_DISABLE_AI !== "true",
      input.settings.updatedAt,
      input.settings.maxProductRecommendations,
      input.settings.blockedProductIds,
      input.settings.excludedCollectionIds,
      input.settings.preferredProductIds,
      input.settings.upsellPriorityProductIds,
    ],
    catalog,
    candidates: candidates.map(({ id, payload }) => [id, payload]),
  })}`;
  const cached = await getJsonCache<{
    ids: string[];
    provider: OfferDecision["aiProvider"];
  }>(key);
  const byId = new Map(
    candidates.map((candidate) => [candidate.id, candidate]),
  );
  let ranked: OfferCandidate[];
  let provider: OfferDecision["aiProvider"];
  if (
    cached &&
    Array.isArray(cached.ids) &&
    cached.ids.length === candidates.length &&
    new Set(cached.ids).size === candidates.length &&
    cached.ids.every((id) => byId.has(id))
  ) {
    ranked = cached.ids.map((id) => byId.get(id)!);
    provider = cached.provider;
  } else {
    const result = await rankOffers(candidates, input.session, {
      shop: input.shop,
      signal: input.signal,
    });
    ranked = result.candidates;
    provider = result.provider;
    if (!input.signal?.aborted)
      await setJsonCache(
        key,
        { ids: ranked.map(({ id }) => id), provider },
        300,
      );
  }
  if (input.signal?.aborted) return noCartOffer("cart_request_cancelled");
  const maximum = recommendationLimit(input.settings.maxProductRecommendations);
  return enforcePairingDecisionPolicy({
    shop: input.shop,
    sourceProductId: input.sourceProductId,
    cartProductIds: input.cartProductIds,
    settings: input.settings,
    decision: {
      widgetType: "upsell_drawer",
      aiProvider: provider,
      confidence: 1,
      reasoning: "Verified additive complements for a confirmed cart addition.",
      payload: {
        triggerType: "cart_item_added",
        mutationId: input.mutationId,
        maxProductRecommendations: maximum,
        copy: { headline: "Recommended for this cart" },
        products: ranked.slice(0, maximum).map((candidate) => ({
          productId: candidate.productId,
          reason:
            (candidate.payload.affinity as { reason?: string })?.reason ||
            "Selected from your synced store catalog.",
        })),
      },
    },
  });
}
