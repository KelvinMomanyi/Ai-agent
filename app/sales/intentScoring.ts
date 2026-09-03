import type { ShopperProfile } from "./types";

export type IntentScoringWeights = {
  pageView: number;
  productView: number;
  repeatedProductView: number;
  collectionView: number;
  search: number;
  variantSelected: number;
  cartOpened: number;
  addToCart: number;
  productComparison: number;
  productQuestion: number;
  policyQuestion: number;
  checkout: number;
  recommendationClick: number;
  recommendationAdd: number;
  returnToProduct: number;
  removalPenalty: number;
  idlePenalty: number;
  rapidBrowsingPenalty: number;
};

export const DEFAULT_INTENT_WEIGHTS: IntentScoringWeights = {
  pageView: 1.5,
  productView: 5,
  repeatedProductView: 9,
  collectionView: 2,
  search: 6,
  variantSelected: 10,
  cartOpened: 8,
  addToCart: 24,
  productComparison: 10,
  productQuestion: 8,
  policyQuestion: 7,
  checkout: 30,
  recommendationClick: 10,
  recommendationAdd: 25,
  returnToProduct: 8,
  removalPenalty: 8,
  idlePenalty: 5,
  rapidBrowsingPenalty: 6,
};

export type PurchaseIntentInput = {
  eventCounts: Record<string, number>;
  productsViewed: number;
  repeatedProducts: number;
  cartItemCount: number;
  sessionDurationSeconds: number;
  checkoutStarted: boolean;
  profile: ShopperProfile;
  weights?: Partial<IntentScoringWeights>;
};

export function calculatePurchaseIntent(input: PurchaseIntentInput) {
  const weights = { ...DEFAULT_INTENT_WEIGHTS, ...(input.weights || {}) };
  const count = (type: string) =>
    Math.max(0, Number(input.eventCounts[type] || 0));
  const diminishing = (value: number, cap: number) =>
    Math.min(Math.sqrt(value), cap);
  const policyQuestions =
    count("shipping_policy") +
    count("returns_policy") +
    count("product_availability");
  const productQuestions =
    count("customer_message_sent") + count("product_question");

  let score =
    diminishing(count("page_view"), 3) * weights.pageView +
    diminishing(input.productsViewed, 4) * weights.productView +
    diminishing(input.repeatedProducts, 3) * weights.repeatedProductView +
    diminishing(count("collection_viewed") + count("collection_view"), 2) *
      weights.collectionView +
    diminishing(count("search_performed") + count("search"), 3) *
      weights.search +
    diminishing(count("variant_selected"), 2) * weights.variantSelected +
    diminishing(count("cart_opened"), 2) * weights.cartOpened +
    diminishing(count("add_to_cart"), 2) * weights.addToCart +
    diminishing(count("comparison_page_visit") + count("product_compared"), 2) *
      weights.productComparison +
    diminishing(productQuestions, 3) * weights.productQuestion +
    diminishing(policyQuestions, 2) * weights.policyQuestion +
    diminishing(count("recommendation_clicked"), 2) *
      weights.recommendationClick +
    diminishing(count("recommendation_added"), 2) * weights.recommendationAdd +
    diminishing(
      count("product_revisited") + count("repeated_product_view"),
      2,
    ) *
      weights.returnToProduct;

  if (input.cartItemCount > 0) score += 16;
  if (input.checkoutStarted || count("checkout_started") > 0) {
    score += weights.checkout;
  }
  if (input.sessionDurationSeconds >= 45) score += 4;
  if (input.sessionDurationSeconds >= 120) score += 5;
  if (input.profile.need || input.profile.intendedUse) score += 5;
  if (input.profile.budgetMax !== null) score += 4;
  if (
    input.profile.preferredColors.length ||
    input.profile.preferredSizes.length ||
    input.profile.preferences.length
  ) {
    score += 4;
  }

  score -= diminishing(count("remove_from_cart"), 3) * weights.removalPenalty;
  score -= diminishing(count("idle"), 2) * weights.idlePenalty;
  score -=
    diminishing(count("rapid_browsing"), 2) * weights.rapidBrowsingPenalty;

  return Math.round(clamp(score, 0, 100));
}

export function calculateHesitationScore(input: {
  intentScore: number;
  eventCounts: Record<string, number>;
  repeatedProducts: number;
  cartItemCount: number;
  sessionDurationSeconds: number;
  currentObjection: string | null;
}) {
  const count = (type: string) =>
    Math.max(0, Number(input.eventCounts[type] || 0));
  let score = 0;
  if (input.intentScore >= 45 && input.sessionDurationSeconds >= 90)
    score += 18;
  if (input.repeatedProducts > 0)
    score += Math.min(input.repeatedProducts * 14, 28);
  score += Math.min(count("remove_from_cart") * 22, 44);
  score += Math.min(count("cart_closed") * 12, 24);
  score += Math.min(count("comparison_page_visit") * 10, 20);
  score += Math.min(count("checkout_returned") * 25, 50);
  score += Math.min(count("idle") * 10, 20);
  if (input.currentObjection) score += 18;
  if (input.cartItemCount > 0 && count("cart_closed") > 0) score += 10;
  if (count("checkout_started") > 0 && input.cartItemCount === 0) score -= 15;
  return Math.round(clamp(score, 0, 100));
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(
    Math.max(Number.isFinite(value) ? value : 0, minimum),
    maximum,
  );
}
