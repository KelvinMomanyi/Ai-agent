import { Prisma, type Product } from "@prisma/client";
import { randomUUID } from "node:crypto";
import prisma from "../db.server";
import {
  getJsonCache,
  setJsonCache,
  redis,
  claimExpiringKey,
} from "../redis.server";
import {
  getSafeDefaultVariantId,
  getSyncedProductVariants,
  isCatalogProductAvailable,
} from "./productCatalogMapping";

export type CatalogCacheProduct = {
  id: string;
  handle: string;
  title: string;
  name: string;
  description: string;
  vendor: string;
  productType: string;
  category: string;
  collectionIds?: string[];
  tags: string[];
  price: string;
  compareAtPrice: string | null;
  priceRegular: string | null;
  priceSale: string | null;
  image: string | null;
  imageUrl: string | null;
  imageAlt: string;
  inventory: number | null;
  availableForSale: boolean;
  orderCount?: number;
  defaultVariantId: string;
  variants: Array<{
    id: string;
    title: string;
    sku: string;
    price: string;
    compareAtPrice: string | null;
    quantityAvailable: number | null;
    availableForSale: boolean;
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

const HOT_CATALOG_TTL_SECONDS = 4 * 60 * 60;
const CATEGORY_CATALOG_TTL_SECONDS = 60 * 60;
const HOT_PRODUCT_LIMIT = 500;
const CATEGORY_PRODUCT_LIMIT = 250;

export async function getCatalogReadiness(shop: string) {
  const key = `catalog:${shop}:readiness:v2`;
  const cached =
    await getJsonCache<import("./productCatalogMapping").CatalogReadiness>(key);
  if (cached) return cached;
  const [row] = await prisma.$queryRaw<
    Array<{
      total: number;
      available: number;
      actionable: number;
      missing: number;
    }>
  >(Prisma.sql`
    WITH variants AS (
      SELECT p.*, v.n, v.sellable FROM "Product" p
      CROSS JOIN LATERAL (
        SELECT COUNT(*)::int n, COALESCE(bool_or(x->>'availableForSale' = 'true'), false) sellable
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p.metafields->'aovboost.variants') = 'array'
          THEN p.metafields->'aovboost.variants' ELSE '[]'::jsonb END) x
        WHERE x->>'id' LIKE 'gid://shopify/ProductVariant/%' AND x->>'price' ~ '^[0-9]+(\\.[0-9]+)?$'
      ) v WHERE p.shop = ${shop}
    ), availability AS (
      SELECT *, CASE COALESCE(metafields#>>'{aovboost.availableForSale,value}', metafields->>'aovboost.availableForSale')
        WHEN 'true' THEN true WHEN '1' THEN true WHEN 'false' THEN false WHEN '0' THEN false
        ELSE n = 0 OR sellable END AS available FROM variants
    ) SELECT COUNT(*)::int total, COUNT(*) FILTER (WHERE available)::int available,
      COUNT(*) FILTER (WHERE available AND sellable)::int actionable, COUNT(*) FILTER (WHERE n = 0)::int missing
      FROM availability
  `);
  const result = {
    storedProductCount: row.total,
    availableProductCount: row.available,
    actionableProductCount: row.actionable,
    missingVariantDataCount: row.missing,
    unavailableProductCount: row.total - row.available,
    resyncRequired: row.total > 0 && (row.missing > 0 || row.actionable === 0),
  };
  await setJsonCache(key, result, 30);
  return result;
}

export async function getCatalogSnapshot(shop: string) {
  return getHotCatalogSnapshot(shop);
}

export async function refreshCatalogCache(shop: string) {
  await invalidateCatalogCache(shop);
  return getHotCatalogSnapshot(shop);
}

/** Versioned keys prevent an in-flight old rebuild from overwriting newer data. */
export async function invalidateCatalogCache(shop: string) {
  await redis.set(`catalog:${shop}:version`, randomUUID(), "EX", 7 * 24 * 3600);
  await redis.del(`catalog:${shop}:readiness:v2`);
}

async function catalogVersion(shop: string) {
  return (await redis.get(`catalog:${shop}:version`)) || "0";
}

/** Fresh, bounded reads for validation; cached decisions never attest to inventory. */
export async function getCatalogProductsByIds(
  shop: string,
  ids: string[],
  handles: string[] = [],
) {
  const productIds = Array.from(new Set(ids.filter(Boolean))).slice(0, 100);
  const productHandles = Array.from(new Set(handles.filter(Boolean))).slice(
    0,
    100,
  );
  if (!productIds.length && !productHandles.length) return [];
  const products = await prisma.product.findMany({
    where: {
      shop,
      OR: [{ id: { in: productIds } }, { handle: { in: productHandles } }],
    },
    include: { orderStats: true },
    take: 100,
  });
  return products
    .map(toCatalogProduct)
    .filter((product) => product.availableForSale);
}

export async function getChatCatalog(input: {
  shop: string;
  query?: string;
  productIds?: string[];
  handle?: string;
}) {
  const tokens = tokenize(input.query || "")
    .filter((word) => word.length > 2)
    .slice(0, 8);
  const predicates = tokens.map(
    (token) =>
      Prisma.sql`(p.title ILIKE ${`%${token}%`} OR p.handle ILIKE ${`%${token}%`} OR p."productType" ILIKE ${`%${token}%`} OR ${token} = ANY(p.tags))`,
  );
  const rank = tokens.map(
    (token) =>
      Prisma.sql`(CASE WHEN p.title ILIKE ${`%${token}%`} THEN 10 ELSE 0 END + CASE WHEN ${token} = ANY(p.tags) THEN 5 ELSE 0 END)`,
  );
  const [context, matches, count] = await Promise.all([
    getCatalogProductsByIds(
      input.shop,
      input.productIds || [],
      input.handle ? [input.handle] : [],
    ),
    prisma.$queryRaw<ProductWithStats[]>(Prisma.sql`
      SELECT p.*, jsonb_build_object('orderCount', COALESCE(s."orderCount", 0)) "orderStats"
      FROM "Product" p LEFT JOIN "ProductOrderStat" s ON s.shop = p.shop AND s."productId" = p.id
      WHERE p.shop = ${input.shop} ${predicates.length ? Prisma.sql`AND (${Prisma.join(predicates, " OR ")})` : Prisma.empty}
      ORDER BY ${rank.length ? Prisma.sql`${Prisma.join(rank, " + ")} DESC,` : Prisma.empty} COALESCE(s."orderCount", 0) DESC, p."updatedAt" DESC LIMIT 60
    `),
    prisma.product.count({ where: { shop: input.shop } }),
  ]);
  return buildCatalogSnapshotFromCatalogProducts(
    input.shop,
    mergeCatalogProducts([
      context,
      matches
        .map(toCatalogProduct)
        .filter((product) => product.availableForSale),
    ]),
    count,
  );
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
    category
      ? getCategoryCatalogSnapshot(input.shop, category)
      : Promise.resolve(null),
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
  preferredProductIds?: string[];
  includeContextProducts?: boolean;
  query?: string;
  limit?: number;
}) {
  const limit = input.limit || 5;
  const contextProductIds = new Set(
    [
      ...(input.cartProductIds || []),
      ...(input.preferredProductIds || []),
      input.sourceProductId || "",
    ].filter(Boolean),
  );
  const excluded = new Set([
    ...(input.excludeProductIds || []),
    ...(input.includeContextProducts ? [] : Array.from(contextProductIds)),
  ]);
  const source = input.sourceProductId
    ? input.catalog.byId[input.sourceProductId]
    : undefined;
  const queryTokens = tokenize(input.query || "");

  return input.catalog.products
    .filter((product) => !excluded.has(product.id))
    .map((product) => ({
      product,
      score:
        scoreCatalogProduct(product, source, queryTokens) +
        (contextProductIds.has(product.id) ? 100 : 0),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((entry) => entry.product);
}

async function getHotCatalogSnapshot(shop: string) {
  const key = `${hotCatalogKey(shop)}:${await catalogVersion(shop)}`;
  const cached = await readSnapshot(key);
  if (cached) return cached;
  // Coalesce cache fills across instances and webhook invalidation bursts. The
  // renderer validates referenced products against fresh, tenant-scoped rows.
  if (!(await claimExpiringKey(`catalog:${shop}:hot-fill`, 5))) {
    return (
      (await readSnapshot(`catalog:${shop}:last-hot`)) ||
      buildCatalogSnapshot(shop, [])
    );
  }

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
  await Promise.all([
    writeSnapshot(key, snapshot, HOT_CATALOG_TTL_SECONDS),
    writeSnapshot(
      `catalog:${shop}:last-hot`,
      snapshot,
      HOT_CATALOG_TTL_SECONDS,
    ),
  ]);
  return snapshot;
}

async function getCategoryCatalogSnapshot(shop: string, category: string) {
  const key = `${categoryCatalogKey(shop, category)}:${await catalogVersion(shop)}`;
  const cached = await readSnapshot(key);
  if (cached) return cached;
  if (
    !(await claimExpiringKey(
      `catalog:${shop}:category-fill:${safeCacheKey(category)}`,
      5,
    ))
  )
    return null;

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
  await writeSnapshot(key, snapshot, CATEGORY_CATALOG_TTL_SECONDS);
  return snapshot;
}

async function getCatalogProductById(shop: string, productId: string) {
  const hotCatalog = await readSnapshot(
    `${hotCatalogKey(shop)}:${await catalogVersion(shop)}`,
  );
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
    products
      .map(toCatalogProduct)
      .filter((product) => product.availableForSale),
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

// Persist each product once. Rebuild indexes after parsing rather than storing
// another complete copy of every variant in both products[] and byId{}.
async function writeSnapshot(key: string, value: CatalogSnapshot, ttl: number) {
  const { shop, refreshedAt, productCount, products } = value;
  await setJsonCache(key, { shop, refreshedAt, productCount, products }, ttl);
}

async function readSnapshot(key: string): Promise<CatalogSnapshot | null> {
  const stored =
    await getJsonCache<
      Pick<
        CatalogSnapshot,
        "shop" | "refreshedAt" | "productCount" | "products"
      >
    >(key);
  if (!stored || !Array.isArray(stored.products)) return null;
  return {
    ...buildCatalogSnapshotFromCatalogProducts(
      stored.shop,
      stored.products,
      stored.productCount,
    ),
    refreshedAt: stored.refreshedAt,
  };
}

type ProductWithStats = Product & {
  orderStats?: { orderCount: number } | null;
};

function toCatalogProduct(product: ProductWithStats): CatalogCacheProduct {
  const metafields = asRecord(product.metafields);
  const description = summarizeDescription(
    getMetafieldValue(metafields, [
      "description",
      "body",
      "global.description_tag",
      "aovboost.description",
    ]),
  );
  const availableForSale = isCatalogProductAvailable(metafields);
  const variantId = getSafeDefaultVariantId(metafields);
  const syncedVariants = getSyncedProductVariants(metafields);
  const sku = getMetafieldValue(metafields, ["sku", "aovboost.sku"]);
  const inventory = toNullableNumber(
    getMetafieldValue(metafields, [
      "inventory",
      "quantityAvailable",
      "aovboost.quantityAvailable",
      "aovboost.sellableOnlineQuantity",
    ]),
  );
  const defaultVariant = syncedVariants.find(
    (variant) => variant.id === variantId,
  );
  const price = defaultVariant?.price || product.price.toString();
  const compareAtPrice =
    defaultVariant?.compareAtPrice ||
    product.compareAtPrice?.toString() ||
    null;
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
    collectionIds: product.collectionIds || [],
    tags: product.tags || [],
    price,
    compareAtPrice,
    priceRegular: compareAtPrice || price,
    priceSale,
    image: product.imageUrl,
    imageUrl: product.imageUrl,
    imageAlt: product.title,
    inventory,
    availableForSale,
    orderCount: Math.max(0, Number(product.orderStats?.orderCount || 0)),
    defaultVariantId: variantId,
    variants:
      syncedVariants.length > 0
        ? syncedVariants
        : variantId
          ? [
              {
                id: variantId,
                title: "Default",
                sku,
                price,
                compareAtPrice,
                quantityAvailable: inventory,
                availableForSale,
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
  const titleTokens = new Set(tokenize(product.title));
  const vendorTokens = new Set(tokenize(product.vendor));
  const typeTokens = new Set(
    tokenize(`${product.productType} ${product.category}`),
  );
  const tagTokens = new Set(tokenize(product.tags.join(" ")));
  const descriptionTokens = new Set(tokenize(product.description));
  const normalizedTitle = normalizeSearchText(product.title);
  const normalizedQuery = queryTokens.join(" ");
  const exactTitleScore =
    normalizedQuery.length >= 3 && normalizedTitle.includes(normalizedQuery)
      ? 30
      : 0;
  const queryScore = queryTokens.reduce((score, token) => {
    const variants = tokenVariants(token);
    if (variants.some((candidate) => titleTokens.has(candidate))) {
      return score + 10;
    }
    if (variants.some((candidate) => tagTokens.has(candidate))) {
      return score + 6;
    }
    if (variants.some((candidate) => typeTokens.has(candidate))) {
      return score + 5;
    }
    if (variants.some((candidate) => vendorTokens.has(candidate))) {
      return score + 4;
    }
    if (variants.some((candidate) => descriptionTokens.has(candidate))) {
      return score + 2;
    }
    return score;
  }, exactTitleScore);
  if (!source) return queryScore + 0.1;

  const sourceTags = new Set(source.tags.map((tag) => tag.toLowerCase()));
  const sharedTags = product.tags.filter((tag) =>
    sourceTags.has(tag.toLowerCase()),
  ).length;
  const sameCategory =
    product.category && product.category === source.category ? 3 : 0;
  const sameVendor = product.vendor && product.vendor === source.vendor ? 1 : 0;

  return queryScore + sameCategory + sharedTags + sameVendor;
}

function tokenize(value: string) {
  const stopWords = new Set([
    "about",
    "anything",
    "best",
    "could",
    "find",
    "have",
    "help",
    "looking",
    "need",
    "please",
    "product",
    "recommend",
    "show",
    "something",
    "that",
    "this",
    "want",
    "what",
    "with",
    "would",
    "your",
  ]);
  return normalizeSearchText(value)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !stopWords.has(token));
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenVariants(token: string) {
  const variants = [token];
  if (token.length > 4 && token.endsWith("ies")) {
    variants.push(`${token.slice(0, -3)}y`);
  } else if (token.length > 3 && token.endsWith("s")) {
    variants.push(token.slice(0, -1));
  }
  return variants;
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

function summarizeDescription(value: unknown) {
  const text = String(value || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= 360) return text;
  const shortened = text.slice(0, 360);
  const sentenceEnd = Math.max(
    shortened.lastIndexOf(". "),
    shortened.lastIndexOf("! "),
    shortened.lastIndexOf("? "),
  );
  return `${(sentenceEnd >= 120 ? shortened.slice(0, sentenceEnd + 1) : shortened).trim()}\u2026`;
}

function toNullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function hotCatalogKey(shop: string) {
  return `catalog:${shop}:hot`;
}

function categoryCatalogKey(shop: string, category: string) {
  return `catalog:${shop}:category:${safeCacheKey(category)}`;
}

function safeCacheKey(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "-")
    .slice(0, 80);
}
