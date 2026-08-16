import type { CatalogProduct } from "./catalogGuard.server";
import { getSafeDefaultVariantId } from "./productCatalogMapping";

export type ChatMessageHistory = Array<{
  role: "user" | "assistant";
  content: string;
}>;

export type BundleSummary = {
  name: string;
  discountType: string;
  discountValue: string;
  items: Array<{
    productId: string;
    product?: { id: string; title: string } | null;
  }>;
};

export type ChatProductCard = {
  productId: string;
  title: string;
  handle: string;
  variantId: string;
  imageUrl: string | null;
  price: string;
  variants: Array<{
    id: string;
    title: string;
    price: string;
    selectedOptions: Array<{ name: string; value: string }>;
  }>;
  variantsTruncated: boolean;
};

export type GroundedChatAction = {
  type: "show_products" | "add_to_cart";
  productId: string;
  variantId: string;
  quantity: number;
};

export type CurrencyInfo = {
  code: string;
  moneyFormat?: string;
  moneyWithCurrencyFormat?: string;
  locale?: string;
  source?: string;
};

export type GroundedAiChatResponse = {
  reply?: unknown;
  productIds?: unknown;
  action?: unknown;
  followUpQuestion?: unknown;
};

export type ValidatedChatResponse = {
  reply: string;
  products: CatalogProduct[];
  action: GroundedChatAction | null;
  fallbackUsed: boolean;
};

export type RequestedCartSelection = {
  product: CatalogProduct;
  variant: CatalogProduct["variants"][number] | null;
  needsSelection: boolean;
};

export type GroundedCartItem = {
  product: CatalogProduct | null;
  productId: string;
  variantId: string;
  title: string;
  variantTitle: string;
  handle: string;
  quantity: number;
  finalUnitPrice: number | null;
  originalUnitPrice: number | null;
  finalLinePrice: number | null;
  originalLinePrice: number | null;
};

export type GroundedCartContext = {
  status: "loaded" | "unavailable";
  currencyCode: string;
  itemCount: number;
  subtotalPrice: number | null;
  totalPrice: number | null;
  totalDiscount: number | null;
  discounts: Array<{ title: string; amount: number | null }>;
  items: GroundedCartItem[];
};

export function normalizeLiveCartContext(
  value: unknown,
  catalogProducts: CatalogProduct[],
): GroundedCartContext {
  const input = asRecord(value);
  if (input.status !== "loaded" || !Array.isArray(input.items)) {
    return unavailableCartContext();
  }

  const productIndex = new Map<string, CatalogProduct>();
  for (const product of catalogProducts) {
    for (const key of productLookupKeys(product)) {
      productIndex.set(key, product);
    }
  }

  const items = input.items.slice(0, 100).flatMap((rawItem) => {
    const item = asRecord(rawItem);
    const quantity = boundedInteger(item.quantity, 1, 1000);
    if (quantity === null) return [];

    const suppliedProductId = cleanPromptText(item.productId, 100);
    const suppliedHandle = cleanPromptText(item.handle, 255).toLowerCase();
    const numericProductId = suppliedProductId.split("/").filter(Boolean).pop();
    const productIdLookupKeys = [
      suppliedProductId,
      numericProductId,
      numericProductId ? `gid://shopify/Product/${numericProductId}` : "",
    ]
      .filter((key): key is string => Boolean(key))
      .map((key) => key.toLowerCase());
    const handleLookupKeys = [
      suppliedHandle,
      suppliedHandle ? `/products/${suppliedHandle}` : "",
    ].filter(Boolean);
    const product = suppliedProductId
      ? productIdLookupKeys.map((key) => productIndex.get(key)).find(Boolean) ||
        null
      : handleLookupKeys.map((key) => productIndex.get(key)).find(Boolean) ||
        null;

    const suppliedVariantId = cleanPromptText(item.variantId, 120);
    const numericVariantId = suppliedVariantId.split("/").filter(Boolean).pop();
    const variant = product?.variants.find((candidate) => {
      const candidateNumericId = candidate.id.split("/").filter(Boolean).pop();
      return (
        candidate.id === suppliedVariantId ||
        candidateNumericId === suppliedVariantId ||
        candidate.id === `gid://shopify/ProductVariant/${numericVariantId}`
      );
    });
    const rawTitle = cleanPromptText(item.title, 200);
    const rawVariantTitle = cleanPromptText(item.variantTitle, 160);
    const variantTitle = cleanCartVariantTitle(
      variant?.title || rawVariantTitle,
    );

    return [
      {
        product,
        productId: product?.id || suppliedProductId,
        variantId: variant?.id || suppliedVariantId,
        title: product?.title || rawTitle || "Cart item",
        variantTitle,
        handle: product?.handle || suppliedHandle,
        quantity,
        finalUnitPrice: boundedMoney(item.finalUnitPrice),
        originalUnitPrice: boundedMoney(item.originalUnitPrice),
        finalLinePrice: boundedMoney(item.finalLinePrice),
        originalLinePrice: boundedMoney(item.originalLinePrice),
      },
    ];
  });
  const summedItemCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const reportedItemCount = boundedInteger(input.itemCount, 0, 10_000);
  if ((reportedItemCount || 0) > 0 && summedItemCount === 0) {
    return unavailableCartContext();
  }
  const itemCount = Math.max(summedItemCount, reportedItemCount || 0);
  const computedTotal = items.reduce<number | null>((sum, item) => {
    const linePrice =
      item.finalLinePrice ??
      (item.finalUnitPrice === null
        ? null
        : item.finalUnitPrice * item.quantity);
    return linePrice === null || sum === null ? null : sum + linePrice;
  }, 0);
  const discounts = Array.isArray(input.discounts)
    ? input.discounts
        .slice(0, 20)
        .map((value) => asRecord(value))
        .map((discount) => ({
          title: cleanPromptText(discount.title, 160),
          amount: boundedMoney(discount.amount),
        }))
        .filter((discount) => discount.title)
    : [];

  return {
    status: "loaded",
    currencyCode: normalizeCurrencyCode(input.currency, ""),
    itemCount,
    subtotalPrice: boundedMoney(input.subtotalPrice),
    totalPrice: boundedMoney(input.totalPrice) ?? computedTotal,
    totalDiscount: boundedMoney(input.totalDiscount),
    discounts,
    items,
  };
}

export function formatCartContextForPrompt(
  cart: GroundedCartContext,
  currency: CurrencyInfo,
) {
  if (cart.status !== "loaded") {
    return "The live Shopify cart could not be verified. Do not say it is empty and do not guess its contents or total.";
  }
  if (cart.itemCount === 0) return "Verified live Shopify cart: empty.";

  const total =
    cart.totalPrice === null
      ? "unavailable"
      : formatCartMoney(cart.totalPrice, currency);
  const subtotal =
    cart.subtotalPrice === null
      ? "unavailable"
      : formatCartMoney(cart.subtotalPrice, currency);
  const lines = cart.items.map((item) => {
    const variant = item.variantTitle ? `; option: ${item.variantTitle}` : "";
    const linePrice =
      item.finalLinePrice === null
        ? ""
        : `; current line total: ${formatCartMoney(item.finalLinePrice, currency)}`;
    const verification = item.product
      ? `verified catalog ID: ${item.product.id}`
      : "live-cart-only item; not eligible for recommendation or productIds";
    return `- ${item.quantity} x ${item.title}${variant}${linePrice}; ${verification}`;
  });

  return [
    `Verified live Shopify cart item count: ${cart.itemCount}`,
    `Verified cart subtotal: ${subtotal}`,
    `Verified current cart total after cart discounts: ${total}`,
    cart.discounts.length > 0
      ? `Applied discounts: ${cart.discounts
          .map((discount) =>
            discount.amount === null
              ? discount.title
              : `${discount.title} (${formatCartMoney(discount.amount, currency)})`,
          )
          .join(", ")}`
      : "Applied discounts: none listed",
    ...lines,
  ].join("\n");
}

export function buildCartSummaryReply(
  cart: GroundedCartContext,
  currency: CurrencyInfo,
) {
  if (cart.status !== "loaded") {
    return "I couldn\u2019t verify your live cart just now, so I won\u2019t guess whether it is empty or what its total is. Please try again in a moment.";
  }
  if (cart.itemCount === 0) return "Your cart is currently empty.";

  const itemLabel = cart.itemCount === 1 ? "item" : "items";
  const subtotal =
    cart.subtotalPrice === null
      ? ""
      : ` a subtotal of ${formatCartMoney(cart.subtotalPrice, currency)} and`;
  const total =
    cart.totalPrice === null
      ? "an unavailable current total"
      : `a current total of ${formatCartMoney(cart.totalPrice, currency)}`;
  const discount =
    cart.totalDiscount !== null && cart.totalDiscount > 0
      ? ` You\u2019re currently saving ${formatCartMoney(cart.totalDiscount, currency)} through cart discounts.`
      : "";
  const discountNames =
    cart.discounts.length > 0
      ? ` Applied: ${cart.discounts.map((item) => item.title).join(", ")}.`
      : "";
  const details = cart.items
    .map((item) => {
      const option = item.variantTitle ? ` (${item.variantTitle})` : "";
      const lineTotal =
        item.finalLinePrice === null
          ? ""
          : ` \u2014 ${formatCartMoney(item.finalLinePrice, currency)}`;
      const link = item.handle ? ` /products/${item.handle}` : "";
      return `- ${item.quantity} \u00d7 ${item.title}${option}${lineTotal}${link}`;
    })
    .join("\n");

  return `Your cart has ${cart.itemCount} ${itemLabel}, with${subtotal} ${total}.${discount}${discountNames}${details ? `\n\n${details}` : ""}`;
}

export function sanitizeMessageHistory(value: unknown): ChatMessageHistory {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (message) =>
        message &&
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string",
    )
    .slice(-12)
    .map((message) => ({
      role: message.role as "user" | "assistant",
      content: message.content.trim().slice(0, 1000),
    }))
    .filter((message) => message.content.length > 0);
}

export function buildCatalogFallbackReply(
  userMessage: string,
  catalogProducts: CatalogProduct[],
  bundles: BundleSummary[],
  messageIntent = "general",
  currency: CurrencyInfo = { code: "USD" },
  excludedProductIds: string[] = [],
) {
  if (catalogProducts.length === 0) {
    return "I can’t verify any available products in this store’s synced catalog right now, so I won’t invent a recommendation.";
  }

  if (
    /^\s*(hi|hello|hey|good (?:morning|afternoon|evening))[!.?\s]*$/i.test(
      userMessage,
    )
  ) {
    return "Hi! Tell me what you’re shopping for, and I’ll check only this store’s current catalog.";
  }

  const excluded = new Set(excludedProductIds);
  const eligibleProducts = catalogProducts.filter(
    (product) => !excluded.has(product.id),
  );
  if (eligibleProducts.length === 0) {
    return "I don’t see another verified in-store product to suggest right now.";
  }

  const queryTokens = tokenize(userMessage);
  const minimumMatchScore =
    queryTokens.length === 0
      ? Number.POSITIVE_INFINITY
      : queryTokens.length === 1
        ? 4
        : Math.min(10, queryTokens.length * 3);
  const scoredProducts = eligibleProducts
    .map((product) => ({
      product,
      score: scoreProduct(product, queryTokens),
    }))
    .filter((item) => item.score >= minimumMatchScore)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3);

  const matches =
    messageIntent === "price_sensitive"
      ? eligibleProducts
          .slice()
          .sort(
            (left, right) => Number(left.price || 0) - Number(right.price || 0),
          )
          .slice(0, 3)
      : scoredProducts.length > 0
        ? scoredProducts.map((item) => item.product)
        : isOpenEndedDiscoveryRequest(userMessage)
          ? eligibleProducts.slice(0, 3)
          : [];

  if (matches.length === 0) {
    return "I couldn’t find an exact match in this store’s current catalog. I’d rather be accurate than suggest an item the store may not carry—tell me the category or feature you want and I’ll check the closest in-store options.";
  }

  const intro =
    messageIntent === "price_sensitive"
      ? "Here are lower-priced options from this store:"
      : scoredProducts.length > 0
        ? "These look like the best matches:"
        : "I did not find an exact match, but these are good places to start:";
  const recommendations = matches
    .map(
      (product) =>
        `${product.title} (${formatPrice(product.price, currency)}) /products/${product.handle}`,
    )
    .join("; ");
  const bundle = bundles[0]
    ? ` There is also an active bundle: ${bundles[0].name}.`
    : "";

  return `${intro} ${recommendations}.${bundle}`;
}

export function formatCatalogProductsForPrompt(
  products: CatalogProduct[],
  currency: CurrencyInfo,
) {
  if (products.length === 0)
    return "No verified sellable products are available.";

  return products
    .map((product) => {
      const availableVariants = product.variants.filter(
        (variant) => variant.availableForSale,
      );
      const optionValues = new Map<string, Set<string>>();
      for (const variant of availableVariants) {
        for (const option of variant.selectedOptions) {
          const values = optionValues.get(option.name) || new Set<string>();
          values.add(option.value);
          optionValues.set(option.name, values);
        }
      }
      const options = Array.from(optionValues.entries())
        .map(
          ([name, values]) =>
            `${name}: ${Array.from(values).slice(0, 30).join(", ")}`,
        )
        .join("; ");
      const prices = availableVariants
        .map((variant) => Number(variant.price))
        .filter((price) => Number.isFinite(price) && price > 0);
      const lowestPrice =
        prices.length > 0 ? Math.min(...prices) : Number(product.price);
      const highestPrice =
        prices.length > 0 ? Math.max(...prices) : Number(product.price);
      const priceRange =
        Number.isFinite(lowestPrice) && lowestPrice > 0
          ? lowestPrice === highestPrice
            ? formatPrice(lowestPrice, currency)
            : `${formatPrice(lowestPrice, currency)} to ${formatPrice(highestPrice, currency)}`
          : "not provided";
      const description = cleanPromptText(product.description, 700);
      const details = [
        `ID: ${product.id}`,
        `Exact title: ${cleanPromptText(product.title, 200)}`,
        `URL: /products/${product.handle}`,
        `Current price: ${priceRange}`,
        `Availability: sellable now`,
        product.inventory === null
          ? "Inventory quantity: not provided"
          : `Synced sellable quantity: ${Math.max(0, product.inventory)}`,
        product.vendor ? `Vendor: ${cleanPromptText(product.vendor, 150)}` : "",
        product.productType
          ? `Product type: ${cleanPromptText(product.productType, 150)}`
          : "",
        product.tags.length > 0
          ? `Tags: ${product.tags
              .slice(0, 20)
              .map((tag) => cleanPromptText(tag, 80))
              .join(", ")}`
          : "",
        options
          ? `Available option values: ${options}`
          : "Available option values: none listed",
        description
          ? `Verified description: ${description}`
          : "Verified description: not provided",
      ]
        .filter(Boolean)
        .join("\n  ");
      return `- ${details}`;
    })
    .join("\n\n");
}

export function validateGroundedAiChatResponse(input: {
  value: GroundedAiChatResponse | null;
  catalog: CatalogProduct[];
  fallback: string;
  currency: CurrencyInfo;
  excludedProductIds?: string[];
  userMessage?: string;
}): ValidatedChatResponse {
  const reply =
    typeof input.value?.reply === "string"
      ? input.value.reply.trim().slice(0, 2_000)
      : "";
  if (
    !reply ||
    containsModelSuppliedPrice(reply) ||
    /\/products\/[a-z0-9][a-z0-9-]*/i.test(reply)
  ) {
    return {
      reply: input.fallback,
      products: [],
      action: null,
      fallbackUsed: true,
    };
  }

  const index = new Map<string, CatalogProduct>();
  for (const product of input.catalog) {
    for (const key of productLookupKeys(product)) index.set(key, product);
  }
  const requestedIds = Array.isArray(input.value?.productIds)
    ? input.value.productIds.map(String).filter(Boolean).slice(0, 8)
    : [];
  const products: CatalogProduct[] = [];
  const seen = new Set<string>();
  const excluded = new Set(input.excludedProductIds || []);
  for (const requestedId of requestedIds) {
    const product = index.get(requestedId.toLowerCase());
    if (!product || excluded.has(product.id)) {
      return {
        reply: input.fallback,
        products: [],
        action: null,
        fallbackUsed: true,
      };
    }
    if (!seen.has(product.id)) {
      products.push(product);
      seen.add(product.id);
    }
  }

  const followUp =
    typeof input.value?.followUpQuestion === "string"
      ? input.value.followUpQuestion.trim().slice(0, 300)
      : "";
  const conversationalReply = [reply, followUp]
    .filter((part, index, parts) => part && parts.indexOf(part) === index)
    .join(" ")
    .slice(0, 2_200);
  const canonicalProducts = products
    .slice(0, 4)
    .map(
      (product) =>
        `${product.title} (${formatPrice(product.price, input.currency)}) /products/${product.handle}`,
    );
  const action = validateGroundedChatAction(input.value?.action, products);
  const groundedLead =
    products.length > 0
      ? buildGroundedProductLead(
          products,
          input.userMessage || "",
          input.currency,
        )
      : conversationalReply;

  return {
    reply:
      canonicalProducts.length > 0
        ? `${groundedLead}\n\n${canonicalProducts.join("\n")}`
        : conversationalReply,
    products: products.slice(0, 4),
    action,
    fallbackUsed: false,
  };
}

export function getCatalogProductCards(
  products: CatalogProduct[],
  currency: CurrencyInfo,
  selectedVariantIds: Record<string, string> = {},
): ChatProductCard[] {
  return products.slice(0, 4).map((product) => {
    const availableVariants = product.variants.filter(
      (variant) => variant.availableForSale,
    );
    const renderedVariants = availableVariants.slice(0, 50);
    const requestedVariantId = selectedVariantIds[product.id] || "";
    const variantId =
      renderedVariants.find((variant) => variant.id === requestedVariantId)
        ?.id ||
      (renderedVariants.length === 1
        ? renderedVariants[0].id
        : renderedVariants.length === 0
          ? getSafeDefaultVariantId(product.metafields)
          : "");

    return {
      productId: product.id,
      title: product.title,
      handle: product.handle,
      variantId,
      imageUrl: product.imageUrl || product.image || null,
      price: formatPrice(product.price, currency),
      variants: renderedVariants.map((variant) => ({
        id: variant.id,
        title: variant.title,
        price: formatPrice(variant.price, currency),
        selectedOptions: variant.selectedOptions,
      })),
      variantsTruncated: availableVariants.length > renderedVariants.length,
    };
  });
}

export function getReplyProductCards(
  reply: string,
  catalogProducts: CatalogProduct[],
  currency: CurrencyInfo,
): ChatProductCard[] {
  const byHandle = new Map(
    catalogProducts
      .filter((product) => product.handle)
      .map((product) => [product.handle.toLowerCase(), product]),
  );
  const replyText = normalizeComparableText(reply);
  const linkedHandles = Array.from(
    reply.matchAll(/\/products\/([a-z0-9][a-z0-9-]*)/gi),
  ).map((match) => match[1].toLowerCase());
  const linkedProducts = linkedHandles
    .map((handle) => byHandle.get(handle))
    .filter((product): product is CatalogProduct => Boolean(product));
  const namedProducts = catalogProducts.filter((product) => {
    const title = normalizeComparableText(product.title);
    return title.length >= 3 && replyText.includes(title);
  });
  const seen = new Set<string>();

  const products = [...linkedProducts, ...namedProducts]
    .filter((product) => {
      if (seen.has(product.id)) return false;
      seen.add(product.id);
      return true;
    })
    .slice(0, 4);
  return getCatalogProductCards(products, currency);
}

export function resolveRequestedCartSelection(
  userMessage: string,
  history: ChatMessageHistory | undefined,
  catalogProducts: CatalogProduct[],
): RequestedCartSelection | null {
  const product = findRequestedCartProduct(
    userMessage,
    history,
    catalogProducts,
  );
  if (!product) return null;

  const availableVariants = product.variants.filter(
    (variant) => variant.availableForSale,
  );
  if (availableVariants.length === 0) {
    return { product, variant: null, needsSelection: true };
  }
  if (availableVariants.length === 1) {
    return { product, variant: availableVariants[0], needsSelection: false };
  }

  const message = normalizeComparableText(userMessage);
  const requestedOptions = new Map<string, string>();
  for (const variant of availableVariants) {
    for (const option of variant.selectedOptions) {
      if (containsComparablePhrase(message, option.value)) {
        requestedOptions.set(
          normalizeComparableText(option.name),
          normalizeComparableText(option.value),
        );
      }
    }
  }
  const exactTitleMatches = availableVariants.filter((variant) => {
    const title = normalizeComparableText(variant.title);
    return title.length >= 2 && containsComparablePhrase(message, title);
  });
  if (exactTitleMatches.length === 1) {
    return {
      product,
      variant: exactTitleMatches[0],
      needsSelection: false,
    };
  }

  const matches = availableVariants.filter((variant) =>
    Array.from(requestedOptions.entries()).every(([name, value]) =>
      variant.selectedOptions.some(
        (option) =>
          normalizeComparableText(option.name) === name &&
          normalizeComparableText(option.value) === value,
      ),
    ),
  );
  if (requestedOptions.size > 0 && matches.length === 1) {
    return { product, variant: matches[0], needsSelection: false };
  }
  return { product, variant: null, needsSelection: true };
}

export function findRequestedCartProduct(
  userMessage: string,
  history: ChatMessageHistory | undefined,
  catalogProducts: CatalogProduct[],
) {
  if (
    /\b(?:don['\u2019]?t|do not|never|stop|cancel|not now)\b[^.!?]*\b(?:add|buy|purchase)\b/i.test(
      userMessage,
    ) ||
    /\b(?:add|buy|purchase)\b[^.!?]*\b(?:don['\u2019]?t|do not|never|stop|cancel|not now)\b/i.test(
      userMessage,
    )
  ) {
    return null;
  }
  const recentAssistantMessages = (history || [])
    .filter((message) => message.role === "assistant")
    .slice(-3)
    .map((message) => message.content);
  const lastAssistantMessage = recentAssistantMessages.at(-1) || "";
  const explicitAddRequest =
    /\b(add|buy|purchase|get|take)\b.*\b(cart|it|this|one|product|bag|item)\b/i.test(
      userMessage,
    ) || /\badd to cart\b/i.test(userMessage);
  const affirmativeAddRequest =
    /^(yes|yes please|yep|yeah|sure|ok|okay|please|do it|go ahead|add it|add this)\s*[.!?]*$/i.test(
      userMessage.trim(),
    ) &&
    /\b(would you like to add|want to add|should i add|add (it|this|.+) to your cart|add (it|this|.+) to cart)\b/i.test(
      lastAssistantMessage,
    );

  if (!explicitAddRequest && !affirmativeAddRequest) return null;

  return findProductMention(
    [userMessage, ...recentAssistantMessages.reverse()].join("\n"),
    catalogProducts,
  );
}

export function enforceReplyCurrency(
  reply: string,
  fallback: string,
  currency: CurrencyInfo,
) {
  if (currency.code === "USD") return reply;
  if (/\$\s*\d|\bUSD\b|\bdollars?\b/i.test(reply)) return fallback;
  return reply;
}

export function formatPrice(value: unknown, currency: CurrencyInfo) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) return "price unavailable";
  const moneyFormat =
    currency.moneyFormat || currency.moneyWithCurrencyFormat || "";
  if (moneyFormat) {
    return applyShopifyMoneyFormat(amount, moneyFormat, currency.code);
  }

  try {
    return new Intl.NumberFormat(currency.locale || undefined, {
      style: "currency",
      currency: currency.code,
      currencyDisplay: "symbol",
    }).format(amount);
  } catch {
    return `${currency.code} ${amount.toFixed(2)}`.trim();
  }
}

export function normalizeCurrencyCode(value: unknown, fallback = "USD") {
  const code = String(value || "")
    .trim()
    .toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : fallback;
}

export function classifyMessageIntent(value: string) {
  const declinedCartAction =
    /\b(?:don['\u2019]?t|do not|never|stop|cancel|not now)\b[^.!?]*\b(?:add|buy|purchase)\b/i.test(
      value,
    );
  if (
    !declinedCartAction &&
    (/\b(?:add|buy|purchase|get|take)\b.*\b(?:cart|bag|it|this|one|item|product)\b/i.test(
      value,
    ) ||
      /\badd to (?:my |the )?(?:cart|bag)\b/i.test(value))
  ) {
    return "cart_action";
  }

  if (
    /\b(cart|bag|basket)\b/i.test(value) ||
    /\b(?:what(?:'s| is)|how much)\b.*\b(?:my\s+)?(?:total|subtotal)\b/i.test(
      value,
    )
  ) {
    return "cart_summary";
  }

  if (
    /\b(expensive|cheaper|cheap|discount|coupon|promo|deal|sale|price|afford|budget|cost)\b/i.test(
      value,
    )
  ) {
    return "price_sensitive";
  }

  if (/\b(compare|versus|vs|alternative|similar|difference)\b/i.test(value)) {
    return "comparison";
  }

  if (/\b(return|refund|exchange|money back)\b/i.test(value)) {
    return "returns_policy";
  }

  if (/\b(ship|shipping|deliver|delivery|dispatch|ships to)\b/i.test(value)) {
    return "shipping_policy";
  }

  if (
    /\b(privacy|personal data|data policy|terms of service|terms and conditions)\b/i.test(
      value,
    )
  ) {
    return "store_policy";
  }

  if (
    /\b(contact|email|phone|customer service|support team|speak to (?:a )?(?:human|person))\b/i.test(
      value,
    )
  ) {
    return "human_support";
  }

  if (
    /\b(do you (?:have|sell|stock)|in stock|available|availability|sold out)\b/i.test(
      value,
    )
  ) {
    return "product_availability";
  }

  if (
    /\b(recommend|suggest|show me|find me|looking for|i need|what do you sell|pair(?:s|ed)? with|go(?:es)? with|complement(?:ary)?|accessor(?:y|ies)|add-on)\b/i.test(
      value,
    )
  ) {
    return "product_search";
  }

  if (
    /\b(warranty|protect|support|installment|payment|pay later)\b/i.test(value)
  ) {
    return "checkout_assistance";
  }

  return "general";
}

function findProductMention(
  textValue: string,
  catalogProducts: CatalogProduct[],
) {
  const byHandle = new Map(
    catalogProducts
      .filter((product) => product.handle)
      .map((product) => [product.handle.toLowerCase(), product]),
  );
  const linkedHandle = Array.from(
    textValue.matchAll(/\/products\/([a-z0-9][a-z0-9-]*)/gi),
  )
    .map((match) => match[1].toLowerCase())
    .find((handle) => byHandle.has(handle));
  if (linkedHandle) return byHandle.get(linkedHandle) || null;

  const normalized = normalizeComparableText(textValue);
  return (
    catalogProducts
      .filter((product) => {
        const title = normalizeComparableText(product.title);
        return title.length >= 3 && normalized.includes(title);
      })
      .sort((left, right) => right.title.length - left.title.length)[0] || null
  );
}

function validateGroundedChatAction(
  value: unknown,
  products: CatalogProduct[],
): GroundedChatAction | null {
  const action = asRecord(value);
  if (action.type !== "show_products" && action.type !== "add_to_cart") {
    return null;
  }
  const productId = String(action.productId || "");
  const product = products.find((candidate) => candidate.id === productId);
  if (!product) return null;

  if (action.type === "show_products") {
    return {
      type: "show_products",
      productId: product.id,
      variantId: "",
      quantity: 1,
    };
  }

  const variantId = String(action.variantId || "");
  const variant = product.variants.find(
    (candidate) => candidate.id === variantId && candidate.availableForSale,
  );
  const quantity = boundedInteger(action.quantity, 1, 10);
  if (!variant || quantity === null) return null;
  return {
    type: "add_to_cart",
    productId: product.id,
    variantId: variant.id,
    quantity,
  };
}

function buildGroundedProductLead(
  products: CatalogProduct[],
  userMessage: string,
  currency: CurrencyInfo,
) {
  const message = normalizeComparableText(userMessage);
  if (products.length === 1) {
    const product = products[0];
    const requestedOptions = new Map<string, string>();
    for (const variant of product.variants.filter(
      (candidate) => candidate.availableForSale,
    )) {
      for (const option of variant.selectedOptions) {
        if (containsComparablePhrase(message, option.value)) {
          requestedOptions.set(option.name, option.value);
        }
      }
    }
    if (requestedOptions.size > 0) {
      const labels = Array.from(requestedOptions.entries())
        .map(([name, value]) => `${name}: ${value}`)
        .join(", ");
      return `${product.title} has a currently sellable variant with ${labels}.`;
    }
    return "I found one verified in-store option that matches your request:";
  }

  if (/\b(compare|versus|vs|difference)\b/i.test(userMessage)) {
    const comparisons = products
      .slice(0, 4)
      .map((product) => {
        const options = getAvailableProductOptionSummary(product);
        return `${product.title}: ${formatPrice(product.price, currency)}${options ? `; options: ${options}` : ""}`;
      })
      .join(" | ");
    return `Here are the verified differences I can confirm: ${comparisons}.`;
  }
  return `I found ${products.length} verified in-store options that match your request:`;
}

function getAvailableProductOptionSummary(product: CatalogProduct) {
  const groups = new Map<string, Set<string>>();
  for (const variant of product.variants.filter(
    (candidate) => candidate.availableForSale,
  )) {
    for (const option of variant.selectedOptions) {
      const values = groups.get(option.name) || new Set<string>();
      values.add(option.value);
      groups.set(option.name, values);
    }
  }
  return Array.from(groups.entries())
    .map(([name, values]) => `${name}: ${Array.from(values).join("/")}`)
    .join("; ");
}

function normalizeComparableText(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsComparablePhrase(textValue: string, phraseValue: string) {
  const textTokens = ` ${normalizeComparableText(textValue)} `;
  const phrase = normalizeComparableText(phraseValue);
  return Boolean(phrase) && textTokens.includes(` ${phrase} `);
}

function scoreProduct(product: CatalogProduct, queryTokens: string[]) {
  if (queryTokens.length === 0) return 0;

  const titleTokens = new Set(tokenize(`${product.title} ${product.handle}`));
  const categoryTokens = new Set(
    tokenize(`${product.productType} ${product.category}`),
  );
  const tagTokens = new Set(tokenize(product.tags.join(" ")));
  const vendorTokens = new Set(tokenize(product.vendor));
  const descriptionTokens = new Set(tokenize(product.description));

  return queryTokens.reduce((score, token) => {
    const variants = [
      token,
      ...(token.length > 4 && token.endsWith("ies")
        ? [`${token.slice(0, -3)}y`]
        : token.length > 3 && token.endsWith("s")
          ? [token.slice(0, -1)]
          : []),
    ];
    if (variants.some((value) => titleTokens.has(value))) return score + 10;
    if (variants.some((value) => tagTokens.has(value))) return score + 6;
    if (variants.some((value) => categoryTokens.has(value))) return score + 6;
    if (variants.some((value) => vendorTokens.has(value))) return score + 4;
    if (variants.some((value) => descriptionTokens.has(value)))
      return score + 2;
    return score;
  }, 0);
}

function isOpenEndedDiscoveryRequest(value: string) {
  return /\b(recommend|suggest|popular|best sellers?|browse|show me (?:something|products?)|what do you sell|surprise me|gift ideas?)\b/i.test(
    value,
  );
}

function containsModelSuppliedPrice(value: string) {
  return /(?:(?:[$€£¥]|\b(?:USD|KES|EUR|GBP|CAD|AUD|JPY|KSH)\b)\s*\d|\d(?:[\d,.]*\d)?\s*\b(?:USD|KES|EUR|GBP|CAD|AUD|JPY|KSH)\b)/i.test(
    value,
  );
}

function productLookupKeys(product: CatalogProduct) {
  const id = String(product.id || "");
  const handle = String(product.handle || "");
  const numericId = id.split("/").filter(Boolean).pop() || "";
  return [id, numericId, handle, `/products/${handle}`]
    .filter(Boolean)
    .map((value) => value.toLowerCase());
}

function unavailableCartContext(): GroundedCartContext {
  return {
    status: "unavailable",
    currencyCode: "",
    itemCount: 0,
    subtotalPrice: null,
    totalPrice: null,
    totalDiscount: null,
    discounts: [],
    items: [],
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function boundedInteger(value: unknown, minimum: number, maximum: number) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    return null;
  }
  return number;
}

function boundedMoney(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1_000_000_000) {
    return null;
  }
  return Math.round(number * 100) / 100;
}

function cleanCartVariantTitle(value: unknown) {
  const title = cleanPromptText(value, 160);
  return /^(default|default title)$/i.test(title) ? "" : title;
}

function formatCartMoney(amount: number, currency: CurrencyInfo) {
  if (amount > 0) return formatPrice(amount, currency);
  const moneyFormat =
    currency.moneyFormat || currency.moneyWithCurrencyFormat || "";
  if (moneyFormat) {
    return applyShopifyMoneyFormat(0, moneyFormat, currency.code);
  }
  try {
    return new Intl.NumberFormat(currency.locale || undefined, {
      style: "currency",
      currency: currency.code,
      currencyDisplay: "symbol",
    }).format(0);
  } catch {
    return `${currency.code} 0.00`.trim();
  }
}

function cleanPromptText(value: unknown, maxLength: number) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function tokenize(value: string) {
  const stopWords = new Set([
    "about",
    "anything",
    "best",
    "find",
    "have",
    "help",
    "need",
    "product",
    "recommend",
    "sell",
    "show",
    "stock",
    "with",
  ]);

  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !stopWords.has(token));
}

function applyShopifyMoneyFormat(
  amount: number,
  format: string,
  currencyCode: string,
) {
  const safeFormat = stripHtml(format);
  const match = safeFormat.match(/\{\{\s*(amount[a-z_]*)\s*\}\}/i);
  const placeholder = match?.[1] || "amount";
  const formattedAmount = formatShopifyAmount(amount, placeholder);
  const output = match
    ? safeFormat.replace(match[0], formattedAmount)
    : `${safeFormat}${formattedAmount}`;
  return output.replace(/\{\{\s*currency\s*\}\}/gi, currencyCode);
}

function formatShopifyAmount(amount: number, placeholder: string) {
  switch (placeholder) {
    case "amount_no_decimals":
      return formatNumber(amount, 0, ",", ".");
    case "amount_with_comma_separator":
      return formatNumber(amount, 2, ".", ",");
    case "amount_no_decimals_with_comma_separator":
      return formatNumber(amount, 0, ".", ",");
    case "amount_with_apostrophe_separator":
      return formatNumber(amount, 2, "'", ".");
    case "amount_no_decimals_with_space_separator":
      return formatNumber(amount, 0, " ", ".");
    case "amount_with_space_separator":
      return formatNumber(amount, 2, " ", ".");
    default:
      return formatNumber(amount, 2, ",", ".");
  }
}

function formatNumber(
  amount: number,
  decimals: number,
  thousandsSeparator: string,
  decimalSeparator: string,
) {
  const fixed =
    decimals > 0 ? amount.toFixed(decimals) : String(Math.round(amount));
  const [integerPart, decimalPart] = fixed.split(".");
  const integer = integerPart.replace(
    /\B(?=(\d{3})+(?!\d))/g,
    thousandsSeparator,
  );
  return decimalPart ? `${integer}${decimalSeparator}${decimalPart}` : integer;
}

function stripHtml(value: string) {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");
}
