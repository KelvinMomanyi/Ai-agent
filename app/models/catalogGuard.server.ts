import type { OfferDecision } from "../ai/types";
import {
  getCatalogSnapshot,
  type CatalogCacheProduct,
} from "./catalogCache.server";

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
  const variantId = getDefaultVariantId(product.metafields);

  return {
    id: product.id,
    productId: product.id,
    variantId,
    title: product.title,
    handle: product.handle,
    imageUrl: product.imageUrl || null,
    price: product.price.toString(),
    compareAtPrice: product.compareAtPrice?.toString(),
    tags: product.tags || [],
  };
}

export function filterCatalogProducts(
  products: CatalogProduct[],
  excludedProductIds: string[] = [],
) {
  const excluded = new Set(excludedProductIds);
  return products.filter((product) => !excluded.has(product.id));
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
    input.catalog.map((product) => product.handle).filter(Boolean),
  );
  const linkedHandles = Array.from(
    input.reply.matchAll(/\/products\/([a-z0-9][a-z0-9-]*)/gi),
  ).map((match) => match[1]);

  if (linkedHandles.some((handle) => !allowedHandles.has(handle))) {
    return input.fallback;
  }

  if (
    linkedHandles.length === 0 &&
    shouldReplyWithCatalogProducts(input.userMessage, input.messageIntent)
  ) {
    return input.fallback;
  }

  return input.reply;
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
    quantity: Math.max(1, Number(record.quantity || 1)),
    reason: String(record.reason || asRecord(record.affinity).reason || ""),
    product: safeProduct,
    target: safeProduct,
  };
}

function hasRenderableProducts(widgetType: string, payload: Record<string, unknown>) {
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
  const excluded = new Set(excludedProductIds);
  const byId = new Map<string, CatalogProduct>();
  const byHandle = new Map<string, CatalogProduct>();

  for (const product of catalog) {
    if (excluded.has(product.id)) continue;
    byId.set(product.id, product);
    if (product.handle) byHandle.set(product.handle, product);
  }

  return { byId, byHandle };
}

function shouldReplyWithCatalogProducts(userMessage: string, messageIntent: string) {
  if (messageIntent !== "general") return true;
  return /\b(recommend|suggest|show|find|buy|bundle|upsell|cross-sell|alternative|similar|cheaper|compare|pair|go with|add-on|accessor)/i.test(
    userMessage,
  );
}

function getDefaultVariantId(metafields: unknown) {
  const record = asRecord(metafields);
  const candidates = [
    record.defaultVariantId,
    record.variantId,
    record["aovboost.defaultVariantId"],
    asRecord(record.defaultVariantId).value,
    asRecord(record.variantId).value,
    asRecord(record["aovboost.defaultVariantId"]).value,
  ];

  return String(candidates.find((value) => typeof value === "string" && value) || "");
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
    product: _product,
    target: _target,
    products: _products,
    items: _items,
    ...rest
  } = record;

  return rest;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
