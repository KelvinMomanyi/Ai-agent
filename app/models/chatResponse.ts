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
};

export type CurrencyInfo = {
  code: string;
  moneyFormat?: string;
  moneyWithCurrencyFormat?: string;
  locale?: string;
  source?: string;
};

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
) {
  if (catalogProducts.length === 0) {
    return "I do not see synced products in this store yet. Sync the product catalog first, then I can recommend exact items.";
  }

  const queryTokens = tokenize(userMessage);
  const scoredProducts = catalogProducts
    .map((product) => ({
      product,
      score: scoreProduct(product, queryTokens),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3);

  const matches =
    messageIntent === "price_sensitive"
      ? catalogProducts
          .slice()
          .sort(
            (left, right) => Number(left.price || 0) - Number(right.price || 0),
          )
          .slice(0, 3)
      : scoredProducts.length > 0
        ? scoredProducts.map((item) => item.product)
        : catalogProducts.slice(0, 3);

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

  return [...linkedProducts, ...namedProducts]
    .filter((product) => {
      if (seen.has(product.id)) return false;
      seen.add(product.id);
      return true;
    })
    .slice(0, 4)
    .map((product) => ({
      productId: product.id,
      title: product.title,
      handle: product.handle,
      variantId: getSafeDefaultVariantId(product.metafields),
      imageUrl: product.imageUrl || product.image || null,
      price: formatPrice(product.price, currency),
    }));
}

export function findRequestedCartProduct(
  userMessage: string,
  history: ChatMessageHistory | undefined,
  catalogProducts: CatalogProduct[],
) {
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

function normalizeComparableText(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreProduct(product: CatalogProduct, queryTokens: string[]) {
  if (queryTokens.length === 0) return 0;

  const searchable = [
    product.title,
    product.handle,
    ...(Array.isArray(product.tags) ? product.tags : []),
  ]
    .join(" ")
    .toLowerCase();

  return queryTokens.reduce((score, token) => {
    if (searchable.includes(token)) return score + 2;
    if (token.length > 4 && searchable.includes(token.slice(0, -1))) {
      return score + 1;
    }
    return score;
  }, 0);
}

function tokenize(value: string) {
  const stopWords = new Set([
    "about",
    "anything",
    "best",
    "find",
    "help",
    "need",
    "product",
    "recommend",
    "show",
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
