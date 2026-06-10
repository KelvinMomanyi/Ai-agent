import type { Product } from "@prisma/client";
import prisma from "../db.server";
import { getJsonCache, setJsonCache } from "../redis.server";

export type CatalogCacheProduct = {
  id: string;
  handle: string;
  title: string;
  name: string;
  description: string;
  vendor: string;
  productType: string;
  category: string;
  tags: string[];
  price: string;
  compareAtPrice: string | null;
  priceRegular: string | null;
  priceSale: string | null;
  image: string | null;
  imageUrl: string | null;
  imageAlt: string;
  inventory: number | null;
  variants: Array<{
    id: string;
    title: string;
    sku: string;
    price: string;
    quantityAvailable: number | null;
    selectedOptions: Array<{ name: string; value: string }>;
  }>;
  searchText: string;
  metafields: unknown;
};

export type CatalogSnapshot = {
  shop: string;
  refreshedAt: string;
  productCount: number;
  products: CatalogCacheProduct[];
  byId: Record<string, CatalogCacheProduct>;
  byCategory: Record<string, string[]>;
  byTag: Record<string, string[]>;
};

const CATALOG_TTL_SECONDS = 60 * 60;
const STALE_TTL_SECONDS = 7 * 24 * 60 * 60;

export async function getCatalogSnapshot(shop: string) {
  const cached = await getJsonCache<CatalogSnapshot>(catalogKey(shop));
  if (cached) return cached;

  try {
    return await refreshCatalogCache(shop);
  } catch (error) {
    const stale = await getJsonCache<CatalogSnapshot>(staleCatalogKey(shop));
    if (stale) {
      console.warn("AOVBoost using stale catalog cache:", {
        shop,
        productCount: stale.productCount,
        refreshedAt: stale.refreshedAt,
        error: getErrorMessage(error),
      });
      return stale;
    }
    throw error;
  }
}

export async function refreshCatalogCache(shop: string) {
  const products = await prisma.product.findMany({
    where: { shop },
    orderBy: [{ updatedAt: "desc" }],
  });
  const snapshot = buildCatalogSnapshot(shop, products);

  await Promise.all([
    setJsonCache(catalogKey(shop), snapshot, CATALOG_TTL_SECONDS),
    setJsonCache(staleCatalogKey(shop), snapshot, STALE_TTL_SECONDS),
  ]);
  console.log("AOVBoost catalog cache refreshed:", {
    shop,
    productCount: snapshot.productCount,
    refreshedAt: snapshot.refreshedAt,
  });
  return snapshot;
}

export function pickCatalogProducts(input: {
  catalog: CatalogSnapshot;
  sourceProductId?: string;
  cartProductIds?: string[];
  excludeProductIds?: string[];
  query?: string;
  limit?: number;
}) {
  const limit = input.limit || 5;
  const excluded = new Set([
    ...(input.cartProductIds || []),
    ...(input.excludeProductIds || []),
    input.sourceProductId || "",
  ].filter(Boolean));
  const source = input.sourceProductId
    ? input.catalog.byId[input.sourceProductId]
    : undefined;
  const queryTokens = tokenize(input.query || "");

  return input.catalog.products
    .filter((product) => !excluded.has(product.id))
    .map((product) => ({
      product,
      score: scoreCatalogProduct(product, source, queryTokens),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((entry) => entry.product);
}

function buildCatalogSnapshot(shop: string, products: Product[]): CatalogSnapshot {
  const catalogProducts = products.map(toCatalogProduct);
  const byId: Record<string, CatalogCacheProduct> = {};
  const byCategory: Record<string, string[]> = {};
  const byTag: Record<string, string[]> = {};

  for (const product of catalogProducts) {
    byId[product.id] = product;
    if (product.category) {
      byCategory[product.category] = byCategory[product.category] || [];
      byCategory[product.category].push(product.id);
    }
    for (const tag of product.tags) {
      const key = tag.toLowerCase();
      byTag[key] = byTag[key] || [];
      byTag[key].push(product.id);
    }
  }

  return {
    shop,
    refreshedAt: new Date().toISOString(),
    productCount: catalogProducts.length,
    products: catalogProducts,
    byId,
    byCategory,
    byTag,
  };
}

function toCatalogProduct(product: Product): CatalogCacheProduct {
  const metafields = asRecord(product.metafields);
  const description = getMetafieldValue(metafields, [
    "description",
    "body",
    "global.description_tag",
    "aovboost.description",
  ]);
  const variantId = getMetafieldValue(metafields, [
    "defaultVariantId",
    "variantId",
    "aovboost.defaultVariantId",
  ]);
  const sku = getMetafieldValue(metafields, ["sku", "aovboost.sku"]);
  const inventory = toNullableNumber(
    getMetafieldValue(metafields, [
      "inventory",
      "quantityAvailable",
      "aovboost.quantityAvailable",
    ]),
  );
  const price = product.price.toString();
  const compareAtPrice = product.compareAtPrice?.toString() || null;
  const priceSale =
    compareAtPrice && Number(compareAtPrice) > Number(price) ? price : null;
  const category = product.productType || "uncategorized";

  return {
    id: product.id,
    handle: product.handle,
    title: product.title,
    name: product.title,
    description,
    vendor: product.vendor || "",
    productType: product.productType || "",
    category,
    tags: product.tags || [],
    price,
    compareAtPrice,
    priceRegular: compareAtPrice || price,
    priceSale,
    image: product.imageUrl,
    imageUrl: product.imageUrl,
    imageAlt: product.title,
    inventory,
    variants: variantId
      ? [
          {
            id: variantId,
            title: "Default",
            sku,
            price,
            quantityAvailable: inventory,
            selectedOptions: [],
          },
        ]
      : [],
    searchText: [
      product.title,
      description,
      product.vendor,
      product.productType,
      ...(product.tags || []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase(),
    metafields: product.metafields,
  };
}

function scoreCatalogProduct(
  product: CatalogCacheProduct,
  source: CatalogCacheProduct | undefined,
  queryTokens: string[],
) {
  const queryScore = queryTokens.reduce(
    (score, token) => score + (product.searchText.includes(token) ? 2 : 0),
    0,
  );
  if (!source) return queryScore + 0.1;

  const sharedTags = product.tags.filter((tag) => source.tags.includes(tag)).length;
  const sameCategory = product.category && product.category === source.category ? 3 : 0;
  const sameVendor = product.vendor && product.vendor === source.vendor ? 1 : 0;

  return queryScore + sameCategory + sharedTags + sameVendor;
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2);
}

function getMetafieldValue(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value) return value;
    const nested = asRecord(value);
    if (typeof nested.value === "string" && nested.value) return nested.value;
  }
  return "";
}

function toNullableNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function catalogKey(shop: string) {
  return `catalog:${shop}:snapshot`;
}

function staleCatalogKey(shop: string) {
  return `catalog:${shop}:stale`;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
