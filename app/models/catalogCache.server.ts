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
const HOT_CATALOG_TTL_SECONDS = 4 * 60 * 60;
const CATEGORY_CATALOG_TTL_SECONDS = 60 * 60;
const HOT_PRODUCT_LIMIT = 500;
const CATEGORY_PRODUCT_LIMIT = 250;

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
    include: { orderStats: true },
    orderBy: [{ updatedAt: "desc" }],
  });
  const snapshot = buildCatalogSnapshot(shop, products);
  const hotSnapshot = buildCatalogSnapshot(
    shop,
    rankProducts(products).slice(0, HOT_PRODUCT_LIMIT),
    products.length,
  );

  await Promise.all([
    setJsonCache(catalogKey(shop), snapshot, CATALOG_TTL_SECONDS),
    setJsonCache(staleCatalogKey(shop), snapshot, STALE_TTL_SECONDS),
    setJsonCache(hotCatalogKey(shop), hotSnapshot, HOT_CATALOG_TTL_SECONDS),
  ]);
  console.log("AOVBoost catalog cache refreshed:", {
    shop,
    productCount: snapshot.productCount,
    refreshedAt: snapshot.refreshedAt,
  });
  return snapshot;
}

export async function getRecommendationCatalog(input: {
  shop: string;
  sourceProductId?: string;
  category?: string;
}) {
  const sourceProduct = input.sourceProductId
    ? await getCatalogProductById(input.shop, input.sourceProductId)
    : null;
  const category = input.category || sourceProduct?.category || "";

  const [hotCatalog, categoryCatalog] = await Promise.all([
    getHotCatalogSnapshot(input.shop),
    category ? getCategoryCatalogSnapshot(input.shop, category) : Promise.resolve(null),
  ]);

  return buildCatalogSnapshotFromCatalogProducts(
    input.shop,
    mergeCatalogProducts([
      sourceProduct ? [sourceProduct] : [],
      categoryCatalog?.products || [],
      hotCatalog.products,
    ]),
    Math.max(hotCatalog.productCount, categoryCatalog?.productCount || 0),
  );
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

async function getHotCatalogSnapshot(shop: string) {
  const cached = await getJsonCache<CatalogSnapshot>(hotCatalogKey(shop));
  if (cached) return cached;

  const [stats, recentProducts, productCount] = await Promise.all([
    prisma.productOrderStat.findMany({
      where: { shop },
      include: { product: true },
      orderBy: [{ orderCount: "desc" }],
      take: HOT_PRODUCT_LIMIT,
    }),
    prisma.product.findMany({
      where: { shop },
      include: { orderStats: true },
      orderBy: [{ updatedAt: "desc" }],
      take: HOT_PRODUCT_LIMIT,
    }),
    prisma.product.count({ where: { shop } }),
  ]);

  const products = mergeProducts([
    stats.map((stat) => stat.product).filter(Boolean),
    recentProducts,
  ]).slice(0, HOT_PRODUCT_LIMIT);
  const snapshot = buildCatalogSnapshot(shop, products, productCount);
  await setJsonCache(hotCatalogKey(shop), snapshot, HOT_CATALOG_TTL_SECONDS);
  return snapshot;
}

async function getCategoryCatalogSnapshot(shop: string, category: string) {
  const key = categoryCatalogKey(shop, category);
  const cached = await getJsonCache<CatalogSnapshot>(key);
  if (cached) return cached;

  const categoryWhere =
    category === "uncategorized"
      ? { shop, OR: [{ productType: null }, { productType: "" }] }
      : { shop, productType: category };
  const [products, productCount] = await Promise.all([
    prisma.product.findMany({
      where: categoryWhere,
      include: { orderStats: true },
      orderBy: [{ updatedAt: "desc" }],
      take: CATEGORY_PRODUCT_LIMIT,
    }),
    prisma.product.count({ where: { shop } }),
  ]);
  const snapshot = buildCatalogSnapshot(
    shop,
    rankProducts(products).slice(0, CATEGORY_PRODUCT_LIMIT),
    productCount,
  );
  await setJsonCache(key, snapshot, CATEGORY_CATALOG_TTL_SECONDS);
  return snapshot;
}

async function getCatalogProductById(shop: string, productId: string) {
  const hotCatalog = await getJsonCache<CatalogSnapshot>(hotCatalogKey(shop));
  const hotProduct = hotCatalog?.byId[productId];
  if (hotProduct) return hotProduct;

  const product = await prisma.product.findFirst({
    where: { shop, id: productId },
    include: { orderStats: true },
  });
  return product ? toCatalogProduct(product) : null;
}

function buildCatalogSnapshot(
  shop: string,
  products: ProductWithStats[],
  productCount = products.length,
): CatalogSnapshot {
  return buildCatalogSnapshotFromCatalogProducts(
    shop,
    products.map(toCatalogProduct),
    productCount,
  );
}

function buildCatalogSnapshotFromCatalogProducts(
  shop: string,
  catalogProducts: CatalogCacheProduct[],
  productCount = catalogProducts.length,
): CatalogSnapshot {
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
    productCount,
    products: catalogProducts,
    byId,
    byCategory,
    byTag,
  };
}

type ProductWithStats = Product & {
  orderStats?: { orderCount: number } | null;
};

function toCatalogProduct(product: ProductWithStats): CatalogCacheProduct {
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

function mergeProducts(groups: ProductWithStats[][]) {
  const byId = new Map<string, ProductWithStats>();
  for (const products of groups) {
    for (const product of products) {
      if (!byId.has(product.id)) byId.set(product.id, product);
    }
  }
  return rankProducts(Array.from(byId.values()));
}

function mergeCatalogProducts(groups: CatalogCacheProduct[][]) {
  const byId = new Map<string, CatalogCacheProduct>();
  for (const products of groups) {
    for (const product of products) {
      if (!byId.has(product.id)) byId.set(product.id, product);
    }
  }
  return Array.from(byId.values());
}

function rankProducts(products: ProductWithStats[]) {
  return products.slice().sort((left, right) => {
    const orderDelta =
      Number(right.orderStats?.orderCount || 0) -
      Number(left.orderStats?.orderCount || 0);
    if (orderDelta !== 0) return orderDelta;
    return right.updatedAt.getTime() - left.updatedAt.getTime();
  });
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

function hotCatalogKey(shop: string) {
  return `catalog:${shop}:hot`;
}

function categoryCatalogKey(shop: string, category: string) {
  return `catalog:${shop}:category:${safeCacheKey(category)}`;
}

function safeCacheKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9:_-]+/g, "-").slice(0, 80);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
