import type { OfferDecision } from "../ai/types";
import {
  getCatalogSnapshot,
  type CatalogCacheProduct,
} from "./catalogCache.server";
import {
  getSafeDefaultVariantId,
  getSyncedProductVariants,
  isCatalogProductAvailable,
  type SyncedProductVariant,
} from "./productCatalogMapping";

export type CatalogProduct = CatalogCacheProduct;

type ProductWidgetSource = {
  id: string;
  handle: string;
  title: string;
  imageUrl?: string | null;
  price: string | number | { toString(): string };
  compareAtPrice?: string | number | { toString(): string } | null;
  tags?: string[] | null;
  metafields?: unknown;
  variants?: unknown;
  orderCount?: number;
};

type WidgetProduct = ReturnType<typeof catalogProductToWidgetProduct>;
type SanitizedProductItem = Record<string, unknown> & {
  productId: string;
  targetId: string;
  variantId: string;
  quantity: number;
  reason: string;
  product: WidgetProduct;
  target: WidgetProduct;
};

const PRODUCT_WIDGET_TYPES = new Set([
  "bundle",
  "upsell_drawer",
  "rec_strip",
  "social_proof",
  "post_purchase",
]);

export async function getFullProductCatalog(shop: string) {
  return (await getCatalogSnapshot(shop)).products;
}

export async function enforceCatalogBackedDecision(input: {
  shop: string;
  decision: OfferDecision;
  excludedProductIds?: string[];
}): Promise<OfferDecision> {
  if (!input.decision.widgetType) return input.decision;

  const catalog = await getFullProductCatalog(input.shop);
  const index = buildCatalogIndex(catalog, input.excludedProductIds || []);
  const payload = sanitizePayloadProducts(input.decision.payload, index);

  if (
    PRODUCT_WIDGET_TYPES.has(input.decision.widgetType) &&
    !hasRenderableProducts(input.decision.widgetType, payload)
  ) {
    return {
      ...input.decision,
      widgetType: null,
      payload: {},
      reasoning: "No catalog-backed products were available for this widget.",
      confidence: 0,
    };
  }

  return {
    ...input.decision,
    payload,
  };
}

export function catalogProductToWidgetProduct(product: ProductWidgetSource) {
  const storedVariants = getSyncedProductVariants(product.metafields);
  const variants =
    storedVariants.length > 0
      ? storedVariants
      : normalizeCatalogVariants(product.variants);
  const requestedVariantId = getSafeDefaultVariantId(product.metafields);
  const defaultVariant =
    variants.find(
      (variant) =>
        variant.id === requestedVariantId && variant.availableForSale,
    ) || variants.find((variant) => variant.availableForSale);
  const variantId = defaultVariant?.id || requestedVariantId;

  return {
    id: product.id,
    productId: product.id,
    variantId,
    title: product.title,
    handle: product.handle,
    imageUrl: product.imageUrl || null,
    price: defaultVariant?.price || product.price.toString(),
    compareAtPrice:
      defaultVariant?.compareAtPrice || product.compareAtPrice?.toString(),
    tags: product.tags || [],
    variants,
    defaultVariantId: variantId,
    hasMultipleVariants: variants.length > 1,
    orderCount: Math.max(0, Number(product.orderCount || 0)),
  };
}

export function filterCatalogProducts(
  products: CatalogProduct[],
  excludedProductIds: string[] = [],
) {
  const excluded = new Set(excludedProductIds.flatMap(toProductLookupKeys));
  return products.filter(
    (product) =>
      !toProductLookupKeys(product.id).some((id) => excluded.has(id)) &&
      product.availableForSale !== false &&
      isCatalogProductAvailable(product.metafields),
  );
}

export function filterBundlesToCatalog<T extends { items?: unknown[] }>(
  bundles: T[],
  catalog: CatalogProduct[],
) {
  const catalogIds = new Set(catalog.map((product) => product.id));

  return bundles.filter((bundle) => {
    const items = Array.isArray(bundle.items) ? bundle.items : [];
    return (
      items.length > 0 &&
      items.every((item) => {
        const record = asRecord(item);
        const product = asRecord(record.product);
        const productId = String(record.productId || product.id || "");
        return productId && catalogIds.has(productId);
      })
    );
  });
}

export function sanitizeAssistantReplyToCatalog(input: {
  reply: string;
  userMessage: string;
  messageIntent: string;
  catalog: CatalogProduct[];
  fallback: string;
}) {
  const allowedHandles = new Set(
    input.catalog
      .map((product) => product.handle.toLowerCase())
      .filter(Boolean),
  );
  const linkedHandles = Array.from(
    input.reply.matchAll(/\/products\/([a-z0-9][a-z0-9-]*)/gi),
  ).map((match) => match[1].toLowerCase());

  if (linkedHandles.some((handle) => !allowedHandles.has(handle))) {
    return input.fallback;
  }

  if (
    linkedHandles.length === 0 &&
    shouldReplyWithCatalogProducts(input.userMessage, input.messageIntent)
  ) {
    return input.fallback;
  }

  const groundedLines = input.reply
    .split("\n")
    .filter((line) => {
      if (!looksLikeProductClaim(line) || isGroundedCatalogDenial(line)) {
        return true;
      }
      return Array.from(
        line.matchAll(/\/products\/([a-z0-9][a-z0-9-]*)/gi),
      ).some((match) => allowedHandles.has(match[1].toLowerCase()));
    })
    .join("\n")
    .trim();

  return groundedLines || input.fallback;
}

function looksLikeProductClaim(value: string) {
  return (
    /\b(?:we|this store)\s+(?:have|has|carry|carries|sell|sells|stock|stocks|offer|offers)\b/i.test(
      value,
    ) ||
    /\b(?:in stock|sold out|available in|comes? in|pairs? (?:well )?with|goes? (?:well )?with|you (?:may|might|would) (?:also )?like)\b/i.test(
      value,
    ) ||
    /\b(?:recommend|suggest)\b[^.!?]*\b(?:product|item|option|choice|pick|this|that|the)\b/i.test(
      value,
    ) ||
    /\b(?:is|are|would be|makes?)\s+(?:a|an|the)?\s*(?:great|good|best|ideal|perfect|excellent|popular)\s+(?:choice|option|pick|fit|match|product|item)\b/i.test(
      value,
    )
  );
}

function isGroundedCatalogDenial(value: string) {
  return /\b(?:can(?:not|'t|\u2019t) verify|could(?: not|n't|n\u2019t) find|do not see|don't see|don\u2019t see|won't guess|won\u2019t guess|not in (?:the|this) (?:catalog|store)|no exact match)\b/i.test(
    value,
  );
}

type CatalogIndex = {
  byId: Map<string, CatalogProduct>;
  byHandle: Map<string, CatalogProduct>;
};

function sanitizePayloadProducts(
  payload: Record<string, unknown>,
  index: CatalogIndex,
) {
  const next: Record<string, unknown> = { ...payload };

  if (Array.isArray(next.products)) {
    next.products = sanitizeProductList(next.products, index);
  }

  if (Array.isArray(next.items)) {
    next.items = sanitizeProductList(next.items, index);
  }

  if (next.product) {
    const product = sanitizeProductItem(next.product, index);
    if (product) {
      next.product = product.product;
    } else {
      delete next.product;
    }
  }

  if (next.bundle) {
    const bundle = sanitizeBundle(next.bundle, index);
    if (bundle) {
      next.bundle = bundle;
      next.products = sanitizeProductList(
        Array.isArray(bundle.items) ? bundle.items : [],
        index,
      );
    } else {
      delete next.bundle;
      delete next.bundles;
      delete next.products;
    }
  }

  if (Array.isArray(next.bundles)) {
    next.bundles = next.bundles
      .map((bundle) => sanitizeBundle(bundle, index))
      .filter(Boolean);
  }

  return next;
}

function sanitizeBundle(bundle: unknown, index: CatalogIndex) {
  const record = asRecord(bundle);
  const rawItems = Array.isArray(record.items) ? record.items : [];
  const items = sanitizeProductList(rawItems, index);

  if (rawItems.length === 0 || items.length !== rawItems.length) {
    return null;
  }

  return {
    ...record,
    items,
  };
}

function sanitizeProductList(items: unknown[], index: CatalogIndex) {
  const seen = new Set<string>();

  return items
    .map((item) => sanitizeProductItem(item, index))
    .filter((item): item is SanitizedProductItem => Boolean(item))
    .filter((item) => {
      const productId = String(item.productId || "");
      if (!productId || seen.has(productId)) return false;
      seen.add(productId);
      return true;
    });
}

function sanitizeProductItem(
  item: unknown,
  index: CatalogIndex,
): SanitizedProductItem | null {
  const record = asRecord(item);
  const product = asRecord(record.product);
  const target = asRecord(record.target);
  const directProduct = product.id ? product : target.id ? target : record;
  const productId = String(
    record.productId || record.targetId || directProduct.id || "",
  );
  const handle = String(directProduct.handle || record.handle || "");
  const catalogProduct =
    (productId && index.byId.get(productId)) ||
    (handle && index.byHandle.get(handle));

  if (!catalogProduct) return null;

  const safeProduct = catalogProductToWidgetProduct(catalogProduct);
  return {
    ...omitUnsafeProductFields(record),
    productId: safeProduct.id,
    targetId: safeProduct.id,
    variantId: safeProduct.variantId,
    variants: safeProduct.variants,
    quantity: Math.max(1, Number(record.quantity || 1)),
    reason: String(record.reason || asRecord(record.affinity).reason || ""),
    product: safeProduct,
    target: safeProduct,
  };
}

function hasRenderableProducts(
  widgetType: string,
  payload: Record<string, unknown>,
) {
  if (widgetType === "bundle") {
    const bundle = asRecord(payload.bundle);
    return Array.isArray(bundle.items) && bundle.items.length > 0;
  }

  if (!PRODUCT_WIDGET_TYPES.has(widgetType)) return true;
  return Array.isArray(payload.products) && payload.products.length > 0;
}

function buildCatalogIndex(
  catalog: CatalogProduct[],
  excludedProductIds: string[],
): CatalogIndex {
  const excluded = new Set(excludedProductIds.flatMap(toProductLookupKeys));
  const byId = new Map<string, CatalogProduct>();
  const byHandle = new Map<string, CatalogProduct>();

  for (const product of catalog) {
    if (
      toProductLookupKeys(product.id).some((productId) =>
        excluded.has(productId),
      )
    ) {
      continue;
    }
    for (const productId of toProductLookupKeys(product.id)) {
      byId.set(productId, product);
    }
    if (product.handle) byHandle.set(product.handle, product);
  }

  return { byId, byHandle };
}

function shouldReplyWithCatalogProducts(
  userMessage: string,
  messageIntent: string,
) {
  if (
    new Set([
      "price_sensitive",
      "comparison",
      "product_search",
      "product_question",
      "product_availability",
    ]).has(messageIntent)
  ) {
    return true;
  }
  return /\b(recommend|suggest|show|find|buy|bundle|upsell|cross-sell|alternative|similar|cheaper|compare|pair|go with|add-on|accessor|do you (?:have|sell|stock)|in stock|available)\b/i.test(
    userMessage,
  );
}

function toProductLookupKeys(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return [];

  const withoutQuery = text.split("?")[0];
  const lastSegment =
    withoutQuery.split("/").filter(Boolean).pop() || withoutQuery;
  return [
    text,
    withoutQuery,
    lastSegment,
    `gid://shopify/Product/${lastSegment}`,
  ].filter((id, index, ids) => id && ids.indexOf(id) === index);
}

function omitUnsafeProductFields(record: Record<string, unknown>) {
  const {
    id: _id,
    title: _title,
    handle: _handle,
    imageUrl: _imageUrl,
    image: _image,
    price: _price,
    compareAtPrice: _compareAtPrice,
    variantId: _variantId,
    defaultVariantId: _defaultVariantId,
    variants: _variants,
    product: _product,
    target: _target,
    products: _products,
    items: _items,
    ...rest
  } = record;

  return rest;
}

function normalizeCatalogVariants(value: unknown): SyncedProductVariant[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value
    .map((entry) => asRecord(entry))
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
            .map((option) => asRecord(option))
            .map((option) => ({
              name: String(option.name || ""),
              value: String(option.value || ""),
            }))
            .filter((option) => option.name && option.value)
        : [];
      const rawQuantity =
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
          rawQuantity !== null && Number.isFinite(rawQuantity)
            ? rawQuantity
            : null,
        availableForSale: variant.availableForSale === true,
        selectedOptions,
      } satisfies SyncedProductVariant;
    })
    .filter((variant): variant is SyncedProductVariant => Boolean(variant))
    .filter((variant) => {
      if (seen.has(variant.id)) return false;
      seen.add(variant.id);
      return true;
    });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
