export const SALES_STATES = [
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
] as const;

export type SalesState = (typeof SALES_STATES)[number];

export const OBJECTION_TYPES = [
  "PRICE",
  "QUALITY",
  "TRUST",
  "SHIPPING",
  "RETURNS",
  "SIZE",
  "FIT",
  "COMPATIBILITY",
  "NEED_TO_THINK",
  "COMPARISON",
  "OUT_OF_STOCK",
  "NOT_SURE",
  "OTHER",
] as const;

export type ObjectionType = (typeof OBJECTION_TYPES)[number];

export type ShopperProfile = {
  need: string;
  intendedUse: string;
  budgetMin: number | null;
  budgetMax: number | null;
  budgetCurrency: string;
  preferences: string[];
  preferredColors: string[];
  preferredSizes: string[];
  brands: string[];
  recipient: string;
  occasion: string;
  urgency: string;
  purchaseIntentScore: number;
  priceSensitivity: "unknown" | "low" | "medium" | "high";
  knownObjections: ObjectionType[];
  currentObjection: ObjectionType | null;
  updatedAt: string;
};

export type RankedRecommendation<TProduct = unknown> = {
  product: TProduct;
  score: number;
  rank: number;
  reasons: string[];
  recommendedVariantId: string;
  recommendationType: "primary" | "value" | "premium" | "upsell";
};

export type AgentToolCall = {
  name:
    | "search_products"
    | "get_product"
    | "get_variants"
    | "check_inventory"
    | "compare_products"
    | "get_cart"
    | "add_to_cart"
    | "remove_from_cart"
    | "update_cart_line"
    | "get_related_products"
    | "get_shipping_information"
    | "get_return_policy"
    | "create_bundle_suggestion"
    | "apply_discount";
  arguments: Record<string, unknown>;
};

export type StructuredSalesAgentResponse = {
  message?: unknown;
  intent?: unknown;
  salesState?: unknown;
  profileUpdates?: unknown;
  objection?: unknown;
  toolCalls?: unknown;
  recommendations?: unknown;
  productIds?: unknown;
  action?: unknown;
  followUpQuestion?: unknown;
  shouldProactivelyFollowUp?: unknown;
};

export type MerchantSalesSettings = {
  agentEnabled: boolean;
  proactiveMessagesEnabled: boolean;
  proactiveDelaySeconds: number;
  maxProactivePrompts: number;
  maxProductRecommendations: number;
  excludedProductIds: string[];
  excludedCollectionIds: string[];
  preferredProductIds: string[];
  upsellPriorityProductIds: string[];
  discountPermission: boolean;
  allowedDiscountCodes: string[];
  bundleSupportEnabled: boolean;
  minimumProactiveConfidence: number;
  minimumUpsellIntentScore: number;
  hesitationDetectionEnabled: boolean;
  analyticsEnabled: boolean;
};
