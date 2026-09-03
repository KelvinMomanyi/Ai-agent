import type { ObjectionType, SalesState, ShopperProfile } from "./types";

export type SalesStateInput = {
  currentState?: string;
  intentScore: number;
  hesitationScore: number;
  cartItemCount: number;
  productsViewed: number;
  recommendationsShown: number;
  recommendationsClicked: number;
  recommendationsAccepted: number;
  customerMessageCount: number;
  checkoutStarted: boolean;
  purchaseCompleted: boolean;
  cartAbandoned: boolean;
  objection: ObjectionType | null;
  profile: ShopperProfile;
};

export function determineSalesState(input: SalesStateInput): SalesState {
  if (input.purchaseCompleted) return "PURCHASED";
  if (input.checkoutStarted) return "CHECKOUT";
  if (input.cartAbandoned && input.cartItemCount > 0) return "ABANDONED";
  if (input.objection && input.cartItemCount === 0) return "OBJECTION";
  if (input.hesitationScore >= 55) return "HESITATING";
  if (input.cartItemCount > 0) {
    return input.intentScore >= 72 || input.recommendationsAccepted > 0
      ? "CLOSING"
      : "CART";
  }
  if (input.recommendationsClicked > 0 || input.recommendationsShown > 0) {
    return "CONSIDERATION";
  }
  if (
    input.intentScore >= 48 &&
    (input.profile.need || input.profile.intendedUse)
  ) {
    return "PRODUCT_MATCH";
  }
  if (input.productsViewed > 0 || input.intentScore >= 25) return "INTEREST";
  if (
    input.customerMessageCount > 0 ||
    input.profile.need ||
    input.profile.budgetMax !== null
  ) {
    return "DISCOVERY";
  }
  return "BROWSING";
}

export function getSalesStateGuidance(state: SalesState) {
  switch (state) {
    case "BROWSING":
      return "Use low pressure. Offer contextual help and do not push a product yet.";
    case "DISCOVERY":
      return "Ask at most one unanswered high-value question about need, budget, preference, or urgency.";
    case "INTEREST":
      return "Acknowledge what the shopper is exploring and identify the most useful missing preference.";
    case "PRODUCT_MATCH":
      return "Recommend one primary product and at most two meaningful alternatives. Explain the best match.";
    case "CONSIDERATION":
      return "Help compare, answer doubts, and give a clear best-fit opinion.";
    case "HESITATING":
      return "Reduce pressure. Address the likely friction and avoid a new upsell.";
    case "OBJECTION":
      return "Address the current objection directly before attempting to close.";
    case "CART":
      return "Confirm the choice and suggest at most one highly relevant add-on.";
    case "CLOSING":
      return "Remove remaining friction and invite checkout. Stop discovery questions.";
    case "CHECKOUT":
      return "Do not upsell unless explicitly requested. Help with checkout friction only.";
    case "PURCHASED":
      return "Thank the shopper and stop selling. Share verified next steps only.";
    case "ABANDONED":
      return "Offer subtle help with the unresolved concern. Do not invent an incentive.";
  }
}

export function normalizeSalesState(value: unknown): SalesState {
  const state = String(value || "").toUpperCase();
  return [
    "BROWSING",
    "DISCOVERY",
    "INTEREST",
    "PRODUCT_MATCH",
    "CONSIDERATION",
    "HESITATING",
    "OBJECTION",
    "CART",
    "CLOSING",
    "CHECKOUT",
    "PURCHASED",
    "ABANDONED",
  ].includes(state)
    ? (state as SalesState)
    : "BROWSING";
}
