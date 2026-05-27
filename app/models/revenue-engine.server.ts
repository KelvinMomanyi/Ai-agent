export type RevenueMode =
  | "aov"
  | "profit"
  | "inventory_clear"
  | "subscription"
  | "ltv"
  | "seasonal";

export type EngineConfig = {
  discountPercentage: number;
  offerStrategy: string;
  brandVoice?: string;
  minProductPrice: number;
  revenueMode: RevenueMode;
  enableAutopilot: boolean;
  enableDynamicBundles: boolean;
  enableExperimentation: boolean;
  enableBehavioralTargeting: boolean;
  primaryPlacement: string;
  maxBundleItems: number;
  urgencyLevel: string;
};

export type ProductCandidate = {
  id: string;
  title: string;
  handle?: string;
  price: string;
  type?: string;
  tags?: string[];
  inventoryQuantity?: number | null;
  image?: {
    src?: string;
    alt?: string;
  } | string | null;
};

type CartItem = {
  id?: string | number;
  variant_id?: string | number;
  product_id?: string | number;
  title?: string;
  product_title?: string;
  product_type?: string;
  price?: string | number;
  final_price?: number;
  quantity?: number;
  tags?: string[];
};

export type BehaviorContext = {
  cartTotal?: number;
  itemCount?: number;
  device?: "mobile" | "desktop" | "tablet" | string;
  trafficSource?: string;
  referrer?: string;
  pageType?: string;
  path?: string;
  viewedProducts?: Array<{ id?: string | number; title?: string; handle?: string }>;
  viewportWidth?: number;
  localHour?: number;
};

type ScoredProduct = ProductCandidate & {
  score: number;
  scoreReasons: string[];
  numericPrice: number;
};

export type RevenueOffer = {
  id: string;
  title: string;
  price: string;
  image: string;
  message: string;
  reasoning: string;
  confidence: number;
  offerType: "single" | "bundle";
  mode: RevenueMode;
  modeLabel: string;
  placement: string;
  urgency: string;
  segment: string;
  insight: string;
  autopilotAction?: string;
  discount?: {
    percentage: number | null;
    code: string;
    text: string;
  };
  experiment?: {
    id: string;
    variant: string;
    hypothesis: string;
  };
  bundle?: {
    id: string;
    title: string;
    items: Array<{
      id: string;
      title: string;
      price: string;
      image: string;
    }>;
    subtotal: string;
    discountedTotal: string;
    discountPercentage: number | null;
  };
  metadata: {
    strategy: string;
    scoreReasons: string[];
    cartTotal: number;
    trafficSource: string;
    device: string;
    generatedAt: string;
  };
};

export const defaultEngineConfig: EngineConfig = {
  discountPercentage: 10,
  offerStrategy:
    "Focus on high-value complementary items with a gentle discount sweetener.",
  brandVoice: "",
  minProductPrice: 20,
  revenueMode: "aov",
  enableAutopilot: true,
  enableDynamicBundles: true,
  enableExperimentation: true,
  enableBehavioralTargeting: true,
  primaryPlacement: "inline",
  maxBundleItems: 3,
  urgencyLevel: "balanced",
};

const modeLabels: Record<RevenueMode, string> = {
  aov: "AOV Mode",
  profit: "Profit Mode",
  inventory_clear: "Inventory Clear Mode",
  subscription: "Subscription Mode",
  ltv: "LTV Mode",
  seasonal: "Seasonal Mode",
};

const seasonalTermsByMonth: Record<number, string[]> = {
  0: ["winter", "thermal", "snow", "new year"],
  1: ["valentine", "gift", "winter"],
  2: ["spring", "refresh", "training"],
  3: ["spring", "outdoor", "travel"],
  4: ["summer", "travel", "outdoor"],
  5: ["summer", "beach", "cooling"],
  6: ["summer", "travel", "outdoor"],
  7: ["back to school", "fall", "training"],
  8: ["fall", "autumn", "layer"],
  9: ["halloween", "fall", "cold"],
  10: ["holiday", "gift", "black friday"],
  11: ["holiday", "gift", "winter"],
};

export function normalizeEngineConfig(config?: Partial<EngineConfig> | null): EngineConfig {
  const revenueMode = isRevenueMode(config?.revenueMode)
    ? config.revenueMode
    : defaultEngineConfig.revenueMode;

  return {
    discountPercentage:
      typeof config?.discountPercentage === "number"
        ? clamp(Math.round(config.discountPercentage), 0, 80)
        : defaultEngineConfig.discountPercentage,
    offerStrategy: config?.offerStrategy || defaultEngineConfig.offerStrategy,
    brandVoice: config?.brandVoice || defaultEngineConfig.brandVoice,
    minProductPrice:
      typeof config?.minProductPrice === "number"
        ? Math.max(0, config.minProductPrice)
        : defaultEngineConfig.minProductPrice,
    revenueMode,
    enableAutopilot:
      typeof config?.enableAutopilot === "boolean"
        ? config.enableAutopilot
        : defaultEngineConfig.enableAutopilot,
    enableDynamicBundles:
      typeof config?.enableDynamicBundles === "boolean"
        ? config.enableDynamicBundles
        : defaultEngineConfig.enableDynamicBundles,
    enableExperimentation:
      typeof config?.enableExperimentation === "boolean"
        ? config.enableExperimentation
        : defaultEngineConfig.enableExperimentation,
    enableBehavioralTargeting:
      typeof config?.enableBehavioralTargeting === "boolean"
        ? config.enableBehavioralTargeting
        : defaultEngineConfig.enableBehavioralTargeting,
    primaryPlacement: config?.primaryPlacement || defaultEngineConfig.primaryPlacement,
    maxBundleItems:
      typeof config?.maxBundleItems === "number"
        ? clamp(Math.round(config.maxBundleItems), 1, 4)
        : defaultEngineConfig.maxBundleItems,
    urgencyLevel: config?.urgencyLevel || defaultEngineConfig.urgencyLevel,
  };
}

export async function buildRevenueOffer(input: {
  cartItems: CartItem[];
  products: ProductCandidate[];
  historyContext?: string[];
  shopConfig?: Partial<EngineConfig> | null;
  behaviorContext?: BehaviorContext;
  shopDomain?: string; // New field for DB querying
}): Promise<RevenueOffer | null> {
  const config = normalizeEngineConfig(input.shopConfig);
  const behavior = input.behaviorContext || {};
  const cartItems = Array.isArray(input.cartItems) ? input.cartItems : [];
  const availableProducts = filterCartProducts(input.products, cartItems);

  if (availableProducts.length === 0) return null;

  // ML Co-occurrence data (Simulated here by passing historyContext down, 
  // but a real implementation would query Prisma. For now we use the passed historyContext).
  // In a full DB implementation, we would query `prisma.event.findMany(...)` here.

  const cartTotal = getCartTotal(cartItems, behavior);
  const scoredProducts = availableProducts
    .map((product) =>
      scoreProduct({
        product,
        cartItems,
        cartTotal,
        behavior,
        historyContext: input.historyContext || [],
        config,
      }),
    )
    .sort((a, b) => b.score - a.score);

  const bundleSize =
    config.enableDynamicBundles && scoredProducts.length > 1
      ? Math.min(config.maxBundleItems, scoredProducts.length)
      : 1;
  const selectedProducts = scoredProducts.slice(0, bundleSize);
  const primaryProduct = selectedProducts[0];

  if (!primaryProduct) return null;

  const offerType = selectedProducts.length > 1 ? "bundle" : "single";
  const subtotal = selectedProducts.reduce(
    (sum, product) => sum + product.numericPrice,
    0,
  );
  const discountPercentage =
    subtotal >= config.minProductPrice ? config.discountPercentage : null;
  const discountedTotal =
    discountPercentage && discountPercentage > 0
      ? subtotal * (1 - discountPercentage / 100)
      : subtotal;
  const experiment = config.enableExperimentation
    ? await buildExperiment(cartItems, behavior, config, input.shopDomain)
    : undefined;
  const placement = choosePlacement(config, behavior, cartTotal);
  const segment = describeSegment(behavior, cartTotal, cartItems);
  const bundleTitle =
    offerType === "bundle"
      ? buildBundleTitle(config.revenueMode, selectedProducts, behavior)
      : primaryProduct.title;

  const scoreReasons = selectedProducts.flatMap((product) => product.scoreReasons);
  const insight = buildInsight({
    mode: config.revenueMode,
    selectedProducts,
    behavior,
    cartTotal,
    placement,
  });
  const autopilotAction = config.enableAutopilot
    ? buildAutopilotAction(config, experiment?.variant, placement)
    : undefined;

  const offer: RevenueOffer = {
    id: primaryProduct.id,
    title: bundleTitle,
    price: formatMoney(primaryProduct.numericPrice),
    image: getProductImage(primaryProduct),
    message: buildOfferMessage({
      config,
      offerType,
      selectedProducts,
      behavior,
      cartItems,
      discountPercentage,
      bundleTitle,
      segment,
    }),
    reasoning: scoreReasons.slice(0, 3).join(" ") || "Selected by revenue scoring.",
    confidence: clamp(Math.round(82 + primaryProduct.score * 2), 82, 98),
    offerType,
    mode: config.revenueMode,
    modeLabel: modeLabels[config.revenueMode],
    placement,
    urgency: config.urgencyLevel,
    segment,
    insight,
    autopilotAction,
    discount: discountPercentage
      ? {
          percentage: discountPercentage,
          code: `SMART-AI-REWARD-${discountPercentage}`,
          text: `${discountPercentage}% off this revenue-engine offer`,
        }
      : undefined,
    experiment,
    bundle:
      offerType === "bundle"
        ? {
            id: `bundle-${hashString(selectedProducts.map((p) => p.id).join("|"))}`,
            title: bundleTitle,
            items: selectedProducts.map((product) => ({
              id: product.id,
              title: product.title,
              price: formatMoney(product.numericPrice),
              image: getProductImage(product),
            })),
            subtotal: formatMoney(subtotal),
            discountedTotal: formatMoney(discountedTotal),
            discountPercentage,
          }
        : undefined,
    metadata: {
      strategy: config.offerStrategy,
      scoreReasons,
      cartTotal,
      trafficSource: behavior.trafficSource || "direct",
      device: behavior.device || "unknown",
      generatedAt: new Date().toISOString(),
    },
  };

  return offer;
}

function scoreProduct(input: {
  product: ProductCandidate;
  cartItems: CartItem[];
  cartTotal: number;
  behavior: BehaviorContext;
  historyContext: string[];
  config: EngineConfig;
}): ScoredProduct {
  const { product, cartItems, cartTotal, behavior, historyContext, config } = input;
  const title = product.title.toLowerCase();
  const tags = (product.tags || []).map((tag) => tag.toLowerCase());
  const type = (product.type || "").toLowerCase();
  const price = parseFloat(String(product.price || "0")) || 0;
  const reasons: string[] = [];
  let score = 1;

  const cartTerms = getCartTerms(cartItems);
  for (const term of cartTerms) {
    if (term.length > 3 && title.includes(term)) {
      score += 2.5;
      reasons.push(`Matched cart keyword "${term}".`);
    }
  }

  const cartTypes = new Set(
    cartItems
      .map((item) => String(item.product_type || "").toLowerCase())
      .filter(Boolean),
  );
  if (type && cartTypes.has(type)) {
    score += 1.5;
    reasons.push(`Matched product category "${type}".`);
  }

  const priceRatio = price / Math.max(cartTotal, 1);
  if (priceRatio >= 0.1 && priceRatio <= 0.55) {
    score += 2;
    reasons.push("Fits a high-converting add-on price band.");
  }

  if (behavior.viewedProducts?.some((view) => titleIncludes(title, view.title))) {
    score += 3;
    reasons.push("Customer viewed a closely related product this session.");
  }

  for (const history of historyContext) {
    if (history.toLowerCase().includes(title)) {
      score += 1.5;
      reasons.push("Appears in recent converting orders.");
      break;
    }
  }

  score += scoreRevenueMode(product, price, config.revenueMode, tags, title, type);

  if (config.enableBehavioralTargeting) {
    score += scoreBehavior(price, cartTotal, behavior, title, tags, reasons);
  }

  return {
    ...product,
    score,
    scoreReasons: reasons,
    numericPrice: price,
  };
}

function scoreRevenueMode(
  product: ProductCandidate,
  price: number,
  mode: RevenueMode,
  tags: string[],
  title: string,
  type: string,
) {
  switch (mode) {
    case "aov":
      return price >= 50 ? 3 : price >= 25 ? 2 : 0.75;
    case "profit":
      return hasAny(tags, ["high-margin", "high margin", "premium", "private label"]) ||
        title.includes("premium")
        ? 4
        : price >= 40
          ? 2
          : 0.5;
    case "inventory_clear":
      return hasAny(tags, ["clearance", "overstock", "slow-moving", "slow moving", "last chance"]) ||
        title.includes("clearance")
        ? 5
        : product.inventoryQuantity && product.inventoryQuantity > 50
          ? 2
          : 0.25;
    case "subscription":
      return hasAny(tags, ["subscription", "subscribe", "recurring", "refill"]) ||
        title.includes("subscription") ||
        title.includes("refill")
        ? 5
        : type.includes("consumable")
          ? 2
          : 0;
    case "ltv":
      return hasAny(tags, ["refill", "care", "accessory", "maintenance", "replacement"]) ||
        title.includes("refill") ||
        title.includes("care")
        ? 4
        : price >= 15 && price <= 60
          ? 1.5
          : 0.5;
    case "seasonal": {
      const terms = seasonalTermsByMonth[new Date().getMonth()] || [];
      return terms.some((term) => title.includes(term) || tags.includes(term)) ? 4 : 0.75;
    }
    default:
      return 1;
  }
}

function scoreBehavior(
  price: number,
  cartTotal: number,
  behavior: BehaviorContext,
  title: string,
  tags: string[],
  reasons: string[],
) {
  let score = 0;
  const traffic = (behavior.trafficSource || "").toLowerCase();
  const device = (behavior.device || "").toLowerCase();
  const premiumIntent = cartTotal >= 150 || (behavior.viewedProducts?.length || 0) >= 3;

  if (premiumIntent && price >= 40) {
    score += 2.5;
    reasons.push("Premium-intent session favors higher-value add-ons.");
  }

  if (device === "mobile" && price <= Math.max(cartTotal * 0.35, 35)) {
    score += 1;
    reasons.push("Mobile shopper matched with a lower-friction offer.");
  }

  if (
    ["tiktok", "instagram", "facebook", "pinterest"].some((source) =>
      traffic.includes(source),
    )
  ) {
    if (hasAny(tags, ["gift", "trending", "new"]) || title.includes("gift")) {
      score += 1.5;
      reasons.push("Social traffic matched with a giftable or trend-led product.");
    }
  }

  return score;
}

function filterCartProducts(products: ProductCandidate[], cartItems: CartItem[]) {
  const cartIds = new Set<string>();
  const cartTitles = new Set<string>();

  for (const item of cartItems) {
    [item.id, item.variant_id, item.product_id].forEach((id) => {
      if (id) cartIds.add(String(id));
      if (id) cartIds.add(`gid://shopify/ProductVariant/${id}`);
    });
    const title = item.title || item.product_title;
    if (title) cartTitles.add(title.toLowerCase());
  }

  return products.filter((product) => {
    if (!product.id || cartIds.has(String(product.id))) return false;
    const title = product.title.toLowerCase();
    return !Array.from(cartTitles).some(
      (cartTitle) => title === cartTitle || title.includes(cartTitle),
    );
  });
}

function buildOfferMessage(input: {
  config: EngineConfig;
  offerType: "single" | "bundle";
  selectedProducts: ScoredProduct[];
  behavior: BehaviorContext;
  cartItems: CartItem[];
  discountPercentage: number | null;
  bundleTitle: string;
  segment: string;
}) {
  const {
    config,
    offerType,
    selectedProducts,
    behavior,
    cartItems,
    discountPercentage,
    bundleTitle,
    segment,
  } = input;
  const primaryCartItem =
    cartItems[0]?.title || cartItems[0]?.product_title || "your cart";
  const traffic = behavior.trafficSource || "this session";
  const productList = selectedProducts.map((product) => product.title).join(", ");
  const discountText = discountPercentage
    ? ` The ${discountPercentage}% reward is reserved for this offer.`
    : "";

  if (offerType === "bundle") {
    return `${bundleTitle} completes the job your customer has already started with ${primaryCartItem}. Based on ${segment.toLowerCase()} behavior from ${traffic}, this bundle keeps the offer contextual while lifting order value.${discountText}`;
  }

  if (config.revenueMode === "profit") {
    return `${productList} is the strongest profit-aligned add-on for this cart. It fits the customer's current intent without turning checkout into a generic upsell.${discountText}`;
  }

  if (config.revenueMode === "inventory_clear") {
    return `${productList} is a timely add-on for ${primaryCartItem} and helps move stock while the shopper is already in buying mode.${discountText}`;
  }

  return `${productList} is a high-fit addition to ${primaryCartItem}. The offer is tuned for ${modeLabels[config.revenueMode]} and shown where this shopper is most likely to accept it.${discountText}`;
}

function buildBundleTitle(
  mode: RevenueMode,
  products: ScoredProduct[],
  behavior: BehaviorContext,
) {
  const leadType = products[0]?.type || "Performance";

  if (mode === "inventory_clear") return `Limited ${leadType} Value Kit`;
  if (mode === "profit") return `Premium ${leadType} Upgrade Kit`;
  if (mode === "subscription") return `Refill-Ready ${leadType} Plan`;
  if (mode === "ltv") return `Long-Term ${leadType} Care Kit`;
  if (mode === "seasonal") return `Seasonal ${leadType} Bundle`;
  if ((behavior.device || "").toLowerCase() === "mobile") {
    return `Fast Checkout ${leadType} Bundle`;
  }

  return `Complete ${leadType} Bundle`;
}

async function buildExperiment(
  cartItems: CartItem[],
  behavior: BehaviorContext,
  config: EngineConfig,
  shopDomain?: string
) {
  const variants = [
    {
      variant: "contextual-bundle",
      hypothesis: "Contextual bundles will lift add-to-cart rate over single add-ons.",
    },
    {
      variant: "margin-first-copy",
      hypothesis: "Strategy-led copy will improve offer acceptance from high-intent shoppers.",
    },
    {
      variant: "native-inline-placement",
      hypothesis: "Embedded native placement will outperform interruptive presentation.",
    },
  ];
  
  const seed = `${cartItems.map((item) => item.variant_id || item.id).join("|")}-${behavior.device || ""}-${config.revenueMode}`;
  
  // Epsilon-Greedy Bandit (Simulated logic: in production, fetch real win-rates from DB)
  // If random < 0.2 (exploration), pick randomly.
  // Else (exploitation), pick the variant that historically performs best.
  let selected;
  if (Math.random() < 0.2) {
    selected = variants[hashString(seed) % variants.length]; // Random exploration
  } else {
    // Exploitation (simulating variant 1 winning for now, 
    // a true DB query would group by variant and count conversions)
    selected = variants[1]; 
  }

  return {
    id: `rev-exp-${hashString(`${seed}-${selected.variant}`)}`,
    ...selected,
  };
}

function choosePlacement(config: EngineConfig, behavior: BehaviorContext, cartTotal: number) {
  const pageType = (behavior.pageType || "").toLowerCase();
  const device = (behavior.device || "").toLowerCase();

  if (config.primaryPlacement !== "autopilot") return config.primaryPlacement;
  if (pageType.includes("cart")) return "slide_cart";
  if (cartTotal >= 150) return "checkout";
  if (device === "mobile") return "inline";

  return "product_page";
}

function buildInsight(input: {
  mode: RevenueMode;
  selectedProducts: ScoredProduct[];
  behavior: BehaviorContext;
  cartTotal: number;
  placement: string;
}) {
  const { mode, selectedProducts, behavior, cartTotal, placement } = input;
  const source = behavior.trafficSource || "direct traffic";
  const lead = selectedProducts[0]?.title || "this offer";

  if (mode === "aov" && cartTotal >= 100) {
    return `High-cart sessions like this can support a stronger add-on before checkout. ${lead} was selected for ${placement}.`;
  }

  if (mode === "inventory_clear") {
    return `The engine prioritized stock movement while preserving relevance for ${source}.`;
  }

  if (mode === "profit") {
    return `The engine favored margin quality over raw recommendation similarity.`;
  }

  return `The engine matched ${lead} to ${source}, device context, and current cart intent.`;
}

function buildAutopilotAction(
  config: EngineConfig,
  experimentVariant = "baseline",
  placement: string,
) {
  return `Autopilot selected ${modeLabels[config.revenueMode]}, ${placement} placement, and ${experimentVariant} testing for this session.`;
}

function describeSegment(
  behavior: BehaviorContext,
  cartTotal: number,
  cartItems: CartItem[],
) {
  const traffic = behavior.trafficSource || "Direct";
  const device = behavior.device || "unknown device";

  if (cartTotal >= 150) return `Premium ${traffic} ${device}`;
  if (cartItems.length > 2) return `Bundle-ready ${traffic} ${device}`;
  if ((behavior.viewedProducts?.length || 0) >= 3) return `Research-heavy ${traffic} ${device}`;

  return `${traffic} ${device}`;
}

function getCartTotal(cartItems: CartItem[], behavior: BehaviorContext) {
  if (typeof behavior.cartTotal === "number" && behavior.cartTotal > 0) {
    return behavior.cartTotal / (behavior.cartTotal > 10000 ? 100 : 1);
  }

  return cartItems.reduce((sum, item) => {
    const price =
      typeof item.final_price === "number"
        ? item.final_price / 100
        : parseFloat(String(item.price || "0"));
    return sum + price * (item.quantity || 1);
  }, 0);
}

function getCartTerms(cartItems: CartItem[]) {
  return Array.from(
    new Set(
      cartItems.flatMap((item) =>
        String(item.title || item.product_title || "")
          .toLowerCase()
          .split(/[\s\-_,/]+/)
          .filter((term) => term.length > 3),
      ),
    ),
  );
}

function getProductImage(product: ProductCandidate) {
  if (typeof product.image === "string") return product.image;
  return product.image?.src || "https://via.placeholder.com/320";
}

function formatMoney(value: number) {
  return value.toFixed(2);
}

function titleIncludes(title: string, maybeTitle?: string) {
  if (!maybeTitle) return false;
  const normalized = maybeTitle.toLowerCase();
  return title.includes(normalized) || normalized.includes(title);
}

function hasAny(values: string[], needles: string[]) {
  return needles.some((needle) => values.includes(needle));
}

function isRevenueMode(value: unknown): value is RevenueMode {
  return (
    value === "aov" ||
    value === "profit" ||
    value === "inventory_clear" ||
    value === "subscription" ||
    value === "ltv" ||
    value === "seasonal"
  );
}

function hashString(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
