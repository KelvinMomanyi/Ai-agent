import type { CatalogCacheProduct } from "../models/catalogCache.server";
import {
  budgetCurrencyMatches,
  eligibleVariants,
  merchantAllowsProduct,
} from "./recommendationEligibility";
import type {
  MerchantSalesSettings,
  RankedRecommendation,
  ShopperProfile,
} from "./types";

export type RecommendationWeights = {
  intentMatch: number;
  preferenceMatch: number;
  budgetMatch: number;
  availability: number;
  salesPerformance: number;
  merchantPriority: number;
  historicalConversion: number;
  mismatchPenalty: number;
};

export const DEFAULT_RECOMMENDATION_WEIGHTS: RecommendationWeights = {
  intentMatch: 38,
  preferenceMatch: 22,
  budgetMatch: 15,
  availability: 10,
  salesPerformance: 7,
  merchantPriority: 5,
  historicalConversion: 3,
  mismatchPenalty: 35,
};

export function rankProductRecommendations(input: {
  products: CatalogCacheProduct[];
  query: string;
  profile: ShopperProfile;
  settings: MerchantSalesSettings;
  cartProductIds?: string[];
  rejectedProductIds?: string[];
  weights?: Partial<RecommendationWeights>;
  currencyCode?: string;
  outcomes?: Record<
    string,
    { shown: number; purchased: number; rejected: number }
  >;
}): RankedRecommendation<CatalogCacheProduct>[] {
  if (
    !input.settings.agentEnabled ||
    !budgetCurrencyMatches(input.profile, input.currencyCode)
  )
    return [];
  const weights = {
    ...DEFAULT_RECOMMENDATION_WEIGHTS,
    ...(input.weights || {}),
  };
  const inCart = new Set(input.cartProductIds || []);
  const rejected = new Set(input.rejectedProductIds || []);
  const preferred = new Set(input.settings.preferredProductIds);
  const queryTokens = tokens(
    [input.query, input.profile.need, input.profile.intendedUse].join(" "),
  );

  const eligible = input.products.filter((product) => {
    if (
      !merchantAllowsProduct(product, input.settings) ||
      rejected.has(product.id)
    )
      return false;
    if (inCart.has(product.id)) return false;
    return eligibleVariants(product, input.profile).length > 0;
  });

  const scored = eligible
    .map((product) => {
      const intentMatch = matchRatio(queryTokens, productSearchTokens(product));
      if (queryTokens.length > 0 && intentMatch === 0) return null;
      const variants = eligibleVariants(product, input.profile);
      const recommendedVariant = variants[0];
      // Cards and budget reasoning must use the same eligible variant's price.
      const pricedProduct = {
        ...product,
        price: recommendedVariant.price,
        compareAtPrice: recommendedVariant.compareAtPrice,
        variants,
      };
      const preferenceMatch = getPreferenceMatch(product, input.profile);
      const budgetMatch = getBudgetMatch(pricedProduct, input.profile);
      const availability = getAvailabilityScore(product);
      const orderSignal = Math.log1p(
        Math.max(0, Number(product.orderCount || 0)),
      );
      const rejectionPenalty = rejected.has(product.id)
        ? weights.mismatchPenalty
        : 0;
      const score =
        intentMatch * weights.intentMatch +
        preferenceMatch * weights.preferenceMatch +
        budgetMatch * weights.budgetMatch +
        availability * weights.availability +
        Math.min(orderSignal / 5, 1) * weights.salesPerformance +
        (preferred.has(product.id) ? weights.merchantPriority : 0) -
        rejectionPenalty;
      const outcomes = input.outcomes?.[product.id];
      const learnedFit = outcomes
        ? (outcomes.purchased + 1) / (outcomes.shown + 10)
        : 0;
      return {
        product: pricedProduct,
        score: roundScore(score + learnedFit * weights.historicalConversion),
        reasons: buildMatchReasons(pricedProduct, input.profile, intentMatch),
        recommendedVariantId: recommendedVariant?.id || "",
      };
    })
    .filter(
      (entry): entry is NonNullable<typeof entry> =>
        entry !== null && entry.score > 0,
    )
    .sort(
      (left, right) =>
        right.score - left.score ||
        Number(right.product.orderCount || 0) -
          Number(left.product.orderCount || 0),
    );

  if (scored.length === 0) return [];
  const primary = scored[0];
  const primaryPrice = positivePrice(primary.product.price);
  const chosen: Array<
    (typeof scored)[number] & {
      recommendationType: "primary" | "value" | "premium";
    }
  > = [{ ...primary, recommendationType: "primary" }];
  const cheaper = scored.find(
    (entry) =>
      entry.product.id !== primary.product.id &&
      positivePrice(entry.product.price) < primaryPrice * 0.9,
  );
  const premium = scored.find(
    (entry) =>
      entry.product.id !== primary.product.id &&
      entry.product.id !== cheaper?.product.id &&
      positivePrice(entry.product.price) > primaryPrice * 1.1,
  );
  if (cheaper) chosen.push({ ...cheaper, recommendationType: "value" });
  if (premium) chosen.push({ ...premium, recommendationType: "premium" });
  for (const entry of scored) {
    if (chosen.length >= input.settings.maxProductRecommendations) break;
    if (chosen.some((item) => item.product.id === entry.product.id)) continue;
    chosen.push({ ...entry, recommendationType: "primary" });
  }

  return chosen
    .slice(0, clamp(input.settings.maxProductRecommendations, 1, 4))
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

function getPreferenceMatch(
  product: CatalogCacheProduct,
  profile: ShopperProfile,
) {
  const preferences = tokens(
    [
      ...profile.preferences,
      ...profile.preferredColors,
      ...profile.preferredSizes,
      ...profile.brands,
    ].join(" "),
  );
  if (preferences.length === 0) return 0.5;
  return matchRatio(preferences, productSearchTokens(product));
}

function getBudgetMatch(product: CatalogCacheProduct, profile: ShopperProfile) {
  const price = positivePrice(product.price);
  if (!price || profile.budgetMax === null) return 0.5;
  if (profile.budgetMin !== null && price < profile.budgetMin) return 0.75;
  const ratio = price / Math.max(profile.budgetMax, 1);
  return ratio <= 0.8 ? 1 : ratio <= 1 ? 0.85 : 0;
}

function getAvailabilityScore(product: CatalogCacheProduct) {
  if (!product.availableForSale) return 0;
  if (product.inventory === null) return 0.7;
  return product.inventory > 0 ? Math.min(0.7 + product.inventory / 50, 1) : 0;
}

function buildMatchReasons(
  product: CatalogCacheProduct,
  profile: ShopperProfile,
  intentMatch: number,
) {
  const reasons: string[] = [];
  const price = positivePrice(product.price);
  if (profile.budgetMax !== null && price <= profile.budgetMax) {
    reasons.push("Within your budget");
  }
  if (profile.preferredColors.length) {
    const color = product.variants[0]?.selectedOptions.find((option) =>
      /colou?r/i.test(option.name),
    )?.value;
    if (color) reasons.push(`Available in ${color.toLowerCase()}`);
  }
  if (profile.preferredSizes.length) {
    const size = product.variants[0]?.selectedOptions.find((option) =>
      /size/i.test(option.name),
    )?.value;
    if (size) reasons.push(`Your size ${size} is available`);
  }
  const preference = profile.preferences.find((value) =>
    product.searchText.toLowerCase().includes(value.toLowerCase()),
  );
  if (preference) reasons.push(`Matches your ${preference} preference`);
  if (intentMatch >= 0.35 && profile.intendedUse) {
    reasons.push(`Strong match for ${profile.intendedUse}`);
  }
  if (product.compareAtPrice && positivePrice(product.compareAtPrice) > price) {
    reasons.push("Currently below its compare-at price");
  }
  if (reasons.length === 0) reasons.push("Best match from the current catalog");
  return reasons.slice(0, 4);
}

function productSearchTokens(product: CatalogCacheProduct) {
  return tokens(
    [
      product.title,
      product.description,
      product.vendor,
      product.productType,
      product.category,
      ...product.tags,
      ...product.variants.flatMap((variant) =>
        variant.selectedOptions.flatMap((option) => [
          option.name,
          option.value,
        ]),
      ),
    ].join(" "),
  );
}

function matchRatio(needles: string[], haystack: string[]) {
  if (needles.length === 0) return 0.35;
  const values = new Set(haystack);
  return needles.filter((token) => values.has(token)).length / needles.length;
}

function tokens(value: string) {
  const stopWords = new Set([
    "the",
    "and",
    "for",
    "with",
    "from",
    "that",
    "this",
    "these",
    "those",
    "want",
    "need",
    "looking",
    "please",
    "show",
    "find",
    "help",
    "budget",
    "under",
    "size",
    "have",
    "some",
    "something",
    "product",
    "products",
    "recommend",
    "recommendation",
    "can",
    "you",
    "would",
    "like",
    "what",
    "which",
    "cheaper",
    "option",
    "options",
  ]);
  return Array.from(
    new Set(
      normalize(value)
        .split(/[^a-z0-9]+/)
        .filter(
          (token) =>
            token.length > 2 && !/^\d+$/.test(token) && !stopWords.has(token),
        ),
    ),
  );
}

function normalize(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .trim();
}

function positivePrice(value: unknown) {
  const price = Number(value || 0);
  return Number.isFinite(price) && price > 0 ? price : 0;
}

function roundScore(value: number) {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}
