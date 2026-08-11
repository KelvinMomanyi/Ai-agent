export type WidgetPayload = {
  offerId?: string;
  copy?: Record<string, unknown>;
  [key: string]: unknown;
};

const DISMISSED_KEY = "aovboost_dismissed_widgets";
const DEFAULT_CURRENCY = "USD";

type StorefrontCurrency = {
  code: string;
  moneyFormat?: string;
  moneyWithCurrencyFormat?: string;
  locale?: string;
  source?: string;
};

export type WidgetVariant = {
  id: string;
  title: string;
  sku: string;
  price: string;
  compareAtPrice: string | null;
  quantityAvailable: number | null;
  availableForSale: boolean;
  selectedOptions: Array<{ name: string; value: string }>;
};

export type WidgetProduct = {
  id: string;
  variantId: string;
  title: string;
  handle: string;
  imageUrl: string;
  price: string;
  quantity: number;
  reason: string;
  orderCount: number;
  variants: WidgetVariant[];
};

export abstract class BaseWidget {
  protected root: ShadowRoot;
  protected container: HTMLElement;

  constructor(protected payload: WidgetPayload) {
    this.container = document.createElement("div");
    this.container.setAttribute("data-aovboost-widget", this.getWidgetType());
    this.root = this.container.attachShadow({ mode: "open" });
    this.injectStyles();
  }

  abstract getWidgetType(): string;
  abstract render(): void;

  destroy(): void {
    this.container.remove();
  }

  mount(target = document.body): void {
    target.appendChild(this.container);
    this.render();
    this.trackImpression();
  }

  protected injectStyles(): void {
    const style = document.createElement("style");
    style.textContent = BASE_WIDGET_CSS;
    this.root.appendChild(style);
  }

  protected trackImpression(): void {
    this.track("widget_impression", {});
  }

  protected trackClick(action: string): void {
    this.track("widget_click", { action });
  }

  protected trackDismiss(): void {
    this.track("widget_dismiss", {});
    try {
      const dismissed = JSON.parse(localStorage.getItem(DISMISSED_KEY) || "[]");
      const entries = Array.isArray(dismissed)
        ? dismissed.filter((entry) => typeof entry === "object" && entry)
        : [];
      const next = [
        ...entries.filter(
          (entry: any) => entry.widgetType !== this.getWidgetType(),
        ),
        { widgetType: this.getWidgetType(), dismissedAt: Date.now() },
      ];
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage failures.
    }
  }

  protected track(type: string, extra: Record<string, unknown>): void {
    const globalTrack = (window as any).AOVBoostSDK?.track;
    const payload = {
      type,
      widgetType: this.getWidgetType(),
      offerId: this.payload.offerId,
      ...extra,
    };

    if (typeof globalTrack === "function") {
      globalTrack(type, payload);
      return;
    }

    document.dispatchEvent(
      new CustomEvent("aovboost:track", { detail: payload }),
    );
  }

  protected html(markup: string): void {
    const existing = this.root.querySelector("[data-aovboost-content]");
    if (existing) existing.remove();

    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-aovboost-content", "true");
    wrapper.innerHTML = markup;
    this.root.appendChild(wrapper);
  }
}

export function text(value: unknown, fallback = "") {
  return escapeHtml(
    typeof value === "string" && value.trim() ? value : fallback,
  );
}

export function getStorefrontCurrency(): StorefrontCurrency {
  const config = ((window as any).AOVBoost || {}) as Record<string, unknown>;
  const shopify = ((window as any).Shopify || {}) as Record<string, any>;
  const analytics = ((window as any).ShopifyAnalytics || {}) as Record<
    string,
    any
  >;
  const candidates: Array<{ value: unknown; source: string }> = [
    { value: config.currency, source: "aovboost_config" },
    { value: config.currencyCode, source: "aovboost_config" },
    { value: shopify.currency?.active, source: "shopify_currency" },
    { value: shopify.checkout?.currency, source: "shopify_checkout" },
    { value: analytics.meta?.currency, source: "shopify_analytics" },
  ];
  const match = candidates.find(
    (candidate) => normalizeCurrencyCode(candidate.value, "") !== "",
  );
  const code = normalizeCurrencyCode(match?.value);

  return {
    code,
    source: match?.source || "fallback",
    moneyFormat: stringOrEmpty(config.moneyFormat),
    moneyWithCurrencyFormat: stringOrEmpty(config.moneyWithCurrencyFormat),
    locale:
      stringOrEmpty(config.locale) ||
      document.documentElement.lang ||
      navigator.language,
  };
}

export function setStorefrontCurrency(currency: unknown): void {
  const code = normalizeCurrencyCode(currency, "");
  if (!code) return;
  const config = ((window as any).AOVBoost || {}) as Record<string, unknown>;
  (window as any).AOVBoost = {
    ...config,
    currency: code,
  };
}

export function money(
  value: unknown,
  currency: string | Partial<StorefrontCurrency> = getStorefrontCurrency(),
) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return "";
  const currencyInfo = normalizeCurrencyInput(currency);
  const moneyFormat =
    currencyInfo.moneyFormat || currencyInfo.moneyWithCurrencyFormat || "";

  if (moneyFormat) {
    return applyShopifyMoneyFormat(amount, moneyFormat, currencyInfo.code);
  }

  try {
    return new Intl.NumberFormat(currencyInfo.locale || undefined, {
      style: "currency",
      currency: currencyInfo.code,
      currencyDisplay: "symbol",
    }).format(amount);
  } catch {
    return `${currencyInfo.code} ${amount.toFixed(2)}`.trim();
  }
}

function normalizeCurrencyInput(
  currency: string | Partial<StorefrontCurrency>,
): StorefrontCurrency {
  if (typeof currency === "string") {
    return {
      ...getStorefrontCurrency(),
      code: normalizeCurrencyCode(currency),
    };
  }

  const fallback = getStorefrontCurrency();
  return {
    ...fallback,
    ...currency,
    code:
      currency.code === undefined
        ? fallback.code
        : normalizeCurrencyCode(currency.code),
  };
}

function normalizeCurrencyCode(value: unknown, fallback = DEFAULT_CURRENCY) {
  const code = String(value || "")
    .trim()
    .toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : fallback;
}

function stringOrEmpty(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
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

export function getProducts(payload: WidgetPayload): WidgetProduct[] {
  const productSources = [
    payload.products,
    (payload.bundle as any)?.items,
    payload.items,
  ];
  const source = productSources.find((value) => Array.isArray(value));
  if (!Array.isArray(source)) return [];

  return source.map((item) => {
    const product = item.product || item.target || item;
    const requestedVariantId = String(
      product.variantId || item.variantId || "",
    );
    const variants = normalizeWidgetVariants(product.variants || item.variants);
    if (variants.length === 0 && requestedVariantId) {
      variants.push({
        id: requestedVariantId,
        title: "Default",
        sku: "",
        price: String(product.price || item.price || "0"),
        compareAtPrice: null,
        quantityAvailable: null,
        availableForSale: true,
        selectedOptions: [],
      });
    }
    const defaultVariant =
      variants.find(
        (variant) =>
          variant.id === requestedVariantId && variant.availableForSale,
      ) || variants.find((variant) => variant.availableForSale);

    return {
      id: product.id || item.productId || item.targetId,
      variantId: defaultVariant?.id || "",
      title: product.title || item.title || "Recommended product",
      handle: product.handle || item.handle || "",
      imageUrl:
        product.imageUrl || product.image || item.imageUrl || item.image || "",
      price: String(defaultVariant?.price || product.price || item.price || ""),
      quantity: Number(item.quantity || 1),
      reason: String(
        item.reason || item.affinity?.reason || item.reasoning || "",
      ),
      orderCount: Number(item.orderCount || item.affinity?.orderCount || 0),
      variants,
    };
  });
}

export function renderVariantPicker(product: WidgetProduct, key: string) {
  if (product.variants.length <= 1) return "";
  return `
    <label class="variant-picker">
      <span>Choose options</span>
      <select data-variant-picker="${text(key)}" aria-label="Choose ${text(product.title)} options">
        ${product.variants
          .map(
            (variant) => `
              <option value="${text(variant.id)}"
                ${variant.id === product.variantId ? "selected" : ""}
                ${variant.availableForSale ? "" : "disabled"}>
                ${text(formatVariantLabel(variant))}${variant.availableForSale ? "" : " - Sold out"}
              </option>
            `,
          )
          .join("")}
      </select>
    </label>
  `;
}

export function resolveProductVariant(
  root: ParentNode,
  product: WidgetProduct,
  key: string,
) {
  const picker = Array.from(
    root.querySelectorAll<HTMLSelectElement>("[data-variant-picker]"),
  ).find((element) => element.dataset.variantPicker === key);
  const selectedId = picker?.value || product.variantId;
  return (
    product.variants.find(
      (variant) => variant.id === selectedId && variant.availableForSale,
    ) ||
    product.variants.find((variant) => variant.availableForSale) ||
    null
  );
}

export function formatVariantLabel(variant: WidgetVariant) {
  const options = variant.selectedOptions
    .map((option) => `${option.name}: ${option.value}`)
    .join(" / ");
  return options || variant.title || "Default";
}

function normalizeWidgetVariants(value: unknown): WidgetVariant[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value
    .map((entry) =>
      entry && typeof entry === "object" && !Array.isArray(entry)
        ? (entry as Record<string, any>)
        : {},
    )
    .map((variant) => {
      const id = String(variant.id || "");
      const price = Number(variant.price);
      if (
        !id.startsWith("gid://shopify/ProductVariant/") ||
        !Number.isFinite(price)
      ) {
        return null;
      }
      const selectedOptions = Array.isArray(variant.selectedOptions)
        ? variant.selectedOptions
            .map((option: unknown) =>
              option && typeof option === "object" && !Array.isArray(option)
                ? (option as Record<string, unknown>)
                : {},
            )
            .map((option: Record<string, unknown>) => ({
              name: String(option.name || ""),
              value: String(option.value || ""),
            }))
            .filter(
              (option: { name: string; value: string }) =>
                option.name && option.value,
            )
        : [];
      const quantity =
        variant.quantityAvailable === null ||
        variant.quantityAvailable === undefined
          ? null
          : Number(variant.quantityAvailable);
      return {
        id,
        title: String(variant.title || "Default"),
        sku: String(variant.sku || ""),
        price: String(variant.price),
        compareAtPrice:
          variant.compareAtPrice === null ||
          variant.compareAtPrice === undefined
            ? null
            : String(variant.compareAtPrice),
        quantityAvailable:
          quantity !== null && Number.isFinite(quantity) ? quantity : null,
        availableForSale: variant.availableForSale === true,
        selectedOptions,
      } satisfies WidgetVariant;
    })
    .filter((variant): variant is WidgetVariant => Boolean(variant))
    .filter((variant) => {
      if (seen.has(variant.id)) return false;
      seen.add(variant.id);
      return true;
    });
}

export async function addVariantToCart(
  variantId: unknown,
  quantity = 1,
  offerId?: unknown,
) {
  if (!variantId) return null;
  const numericId = String(variantId).split("/").pop();
  const response = await fetch("/cart/add.js", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: numericId,
      quantity,
      properties: offerLineProperties(offerId),
    }),
  });
  return response.ok ? response.json() : null;
}

export async function addManyToCart(
  items: Array<{ variantId: unknown; quantity: number }>,
  offerId?: unknown,
  properties?: Record<string, string>,
) {
  const cartItems = items
    .filter((item) => item.variantId)
    .map((item) => ({
      id: String(item.variantId).split("/").pop(),
      quantity: item.quantity || 1,
      properties: offerLineProperties(offerId, properties),
    }));
  if (cartItems.length === 0) return null;

  const response = await fetch("/cart/add.js", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: cartItems }),
  });
  return response.ok ? response.json() : null;
}

function offerLineProperties(
  offerId: unknown,
  properties: Record<string, string> = {},
) {
  const value = String(offerId || "").trim();
  const entries = Object.entries(properties).filter(
    ([key, propertyValue]) => key.startsWith("_aovboost_") && propertyValue,
  );
  const result = Object.fromEntries(entries);
  if (value) result._aovboost_offer_id = value;
  return Object.keys(result).length > 0 ? result : undefined;
}

function escapeHtml(value: unknown) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const BASE_WIDGET_CSS = `
:host {
  --aovboost-surface: #ffffff;
  --aovboost-ink: #111827;
  --aovboost-muted: #5b6472;
  --aovboost-line: rgba(17, 24, 39, 0.12);
  --aovboost-action: #111827;
  --aovboost-action-text: #ffffff;
  --aovboost-accent: #0f766e;
  color: var(--aovboost-ink);
  font-family: inherit;
}
* { box-sizing: border-box; letter-spacing: 0; }
button, input, select { font: inherit; }
.card, .drawer, .bar, .modal, .pill {
  background: var(--aovboost-surface);
  border: 1px solid var(--aovboost-line);
  box-shadow: 0 18px 45px rgba(17, 24, 39, 0.16);
}
.card { border-radius: 8px; padding: 16px; }
.title { margin: 0; font-size: 16px; line-height: 1.25; font-weight: 750; }
.body { margin: 6px 0 0; color: var(--aovboost-muted); font-size: 14px; line-height: 1.45; }
.row { display: flex; align-items: center; gap: 10px; }
.stack { display: grid; gap: 12px; }
.actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 14px; }
.primary, .secondary, .icon {
  border: 0;
  border-radius: 8px;
  cursor: pointer;
  min-height: 38px;
  padding: 9px 12px;
}
.primary { background: var(--aovboost-action); color: var(--aovboost-action-text); font-weight: 700; }
.secondary { background: #f3f4f6; color: var(--aovboost-ink); }
.icon { display: inline-grid; place-items: center; width: 30px; min-height: 30px; padding: 0; background: transparent; color: var(--aovboost-muted); }
.product-grid { display: grid; gap: 10px; }
.product-card { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 10px; align-items: center; padding: 8px; border: 1px solid var(--aovboost-line); border-radius: 8px; }
.product-card img, .tile img { width: 100%; aspect-ratio: 1; object-fit: contain; border-radius: 6px; background: #f8fafc; }
.product-name { margin: 0; font-size: 13px; font-weight: 700; line-height: 1.25; overflow-wrap: anywhere; }
.price { color: var(--aovboost-ink); font-size: 13px; font-weight: 700; }
.reason { color: var(--aovboost-muted); font-size: 12px; line-height: 1.35; }
.variant-picker { display: grid; gap: 4px; color: var(--aovboost-muted); font-size: 11px; }
.variant-picker select { width: 100%; min-height: 34px; border: 1px solid var(--aovboost-line); border-radius: 7px; background: var(--aovboost-surface); color: var(--aovboost-ink); padding: 6px 8px; }
`;
