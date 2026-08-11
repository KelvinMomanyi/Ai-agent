import type { Prisma, Product, ProductAffinity } from "@prisma/client";
import prisma from "../db.server";
import { cacheKeys, getJsonCache, redis, setJsonCache } from "../redis.server";
import {
  getSyncedProductVariants,
  mapAdminCatalogProductNode,
  type ShopifyProductInput,
} from "./productCatalogMapping";

export type { ShopifyProductInput } from "./productCatalogMapping";

export type ProductAffinityWithTarget = ProductAffinity & {
  target?: Product | null;
};

type ShopifyAdminGraphql = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<{ json: () => Promise<any> }>;
};

const INITIAL_AFFINITY_PRODUCT_LIMIT = 500;
const INITIAL_AFFINITY_TARGET_LIMIT = 20;

export async function upsertProduct(
  shop: string,
  product: ShopifyProductInput,
) {
  return prisma.product.upsert({
    where: {
      shop_id: {
        shop,
        id: product.id,
      },
    },
    update: toProductData(shop, product),
    create: toProductData(shop, product),
  });
}

export async function deleteProduct(shop: string, productId: string) {
  await prisma.product.deleteMany({
    where: { shop, id: productId },
  });
}

export async function getProductsByIds(shop: string, productIds: string[]) {
  if (productIds.length === 0) return [];
  return prisma.product.findMany({
    where: {
      shop,
      id: { in: productIds },
    },
  });
}

export async function getTopAffinities(
  shop: string,
  productId: string,
  limit = 5,
): Promise<ProductAffinityWithTarget[]> {
  const key = cacheKeys.affinity(shop, productId);
  const cached = await getJsonCache<ProductAffinityWithTarget[]>(key);
  if (cached) {
    const validCached = await filterAffinitiesToExistingProducts(shop, cached);
    if (validCached.length === cached.length)
      return validCached.slice(0, limit);
    await redis.del(key);
  }

  const affinities = await prisma.productAffinity.findMany({
    where: {
      shop,
      sourceId: productId,
    },
    include: {
      target: true,
    },
    orderBy: { score: "desc" },
    take: limit,
  });

  const validAffinities = await filterAffinitiesToExistingProducts(
    shop,
    affinities,
  );
  await setJsonCache(key, validAffinities, 3600);
  return validAffinities;
}

export async function getTopAffinitiesOrFallback(input: {
  shop: string;
  productId?: string;
  limit?: number;
  excludeProductIds?: string[];
}): Promise<ProductAffinityWithTarget[]> {
  const limit = input.limit || 5;
  const excludedIds = new Set(input.excludeProductIds || []);
  if (input.productId) excludedIds.add(input.productId);

  const affinities = input.productId
    ? (await getTopAffinities(input.shop, input.productId, limit)).filter(
        (affinity) => !excludedIds.has(affinity.targetId),
      )
    : [];
  if (affinities.length >= limit) return affinities.slice(0, limit);

  const fallback = await getCatalogFallbackRecommendations({
    shop: input.shop,
    sourceProductId: input.productId,
    limit: limit - affinities.length,
    excludeProductIds: [
      ...Array.from(excludedIds),
      ...affinities.map((affinity) => affinity.targetId),
    ],
  });

  return [...affinities, ...fallback].slice(0, limit);
}

async function getCatalogFallbackRecommendations(input: {
  shop: string;
  sourceProductId?: string;
  limit: number;
  excludeProductIds: string[];
}): Promise<ProductAffinityWithTarget[]> {
  if (input.limit <= 0) return [];

  const [source, products] = await Promise.all([
    input.sourceProductId
      ? prisma.product.findFirst({
          where: { shop: input.shop, id: input.sourceProductId },
        })
      : Promise.resolve(null),
    prisma.product.findMany({
      where: {
        shop: input.shop,
        id: { notIn: input.excludeProductIds },
      },
      include: { orderStats: true },
      orderBy: [{ updatedAt: "desc" }],
    }),
  ]);

  return products
    .map((target) => {
      const score = source
        ? computeCatalogFallbackScore(source, target)
        : 0.2 + Math.min((target.orderStats?.orderCount || 0) / 100, 0.3);

      return {
        id: `fallback:${source?.id || "store"}:${target.id}`,
        shop: input.shop,
        sourceId: source?.id || target.id,
        targetId: target.id,
        score,
        reason: getCatalogFallbackReason(source, target),
        orderCount: target.orderStats?.orderCount || 0,
        target,
      };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, input.limit);
}

function computeCatalogFallbackScore(source: Product, target: Product) {
  const sharedTags = intersection(source.tags, target.tags).length;
  const sharedCollections = intersection(
    source.collectionIds,
    target.collectionIds,
  ).length;
  const sameProductType =
    source.productType &&
    target.productType &&
    source.productType === target.productType
      ? 1
      : 0;
  const sameVendor =
    source.vendor && target.vendor && source.vendor === target.vendor ? 1 : 0;

  return clamp(
    0.2 +
      Math.min(sharedTags * 0.12, 0.36) +
      Math.min(sharedCollections * 0.18, 0.36) +
      sameProductType * 0.12 +
      sameVendor * 0.08,
    0,
    1,
  );
}

function getCatalogFallbackReason(
  source: Product | null,
  target: Product & { orderStats?: { orderCount: number } | null },
) {
  if (!source) {
    return target.orderStats?.orderCount ? "popular item" : "new arrival";
  }
  if (intersection(source.collectionIds, target.collectionIds).length > 0) {
    return "same collection";
  }
  if (intersection(source.tags, target.tags).length > 0) return "shared tags";
  if (source.productType && source.productType === target.productType) {
    return "same product type";
  }
  if (source.vendor && source.vendor === target.vendor) return "same brand";
  return "recommended from the catalog";
}

async function filterAffinitiesToExistingProducts(
  shop: string,
  affinities: ProductAffinityWithTarget[],
) {
  if (affinities.length === 0) return [];

  const productIds = Array.from(
    new Set(
      affinities
        .flatMap((affinity) => [affinity.sourceId, affinity.targetId])
        .filter(Boolean),
    ),
  );
  const existingProducts = await prisma.product.findMany({
    where: { shop, id: { in: productIds } },
    select: { id: true },
  });
  const existingIds = new Set(existingProducts.map((product) => product.id));

  return affinities.filter(
    (affinity) =>
      existingIds.has(affinity.sourceId) &&
      existingIds.has(affinity.targetId) &&
      (!affinity.target || affinity.target.shop === shop),
  );
}

export async function recomputeAffinities(
  shop: string,
  productId: string,
): Promise<void> {
  const source = await prisma.product.findFirst({
    where: { shop, id: productId },
    include: { orderStats: true },
  });
  if (!source) return;

  const products = await prisma.product.findMany({
    where: {
      shop,
      id: { not: productId },
    },
    include: { orderStats: true },
  });

  await Promise.all(
    products.map(async (target) => {
      const existing = await prisma.productAffinity.findUnique({
        where: {
          shop_sourceId_targetId: {
            shop,
            sourceId: source.id,
            targetId: target.id,
          },
        },
      });
      const score = computeAffinityScore(
        source,
        target,
        existing?.orderCount || 0,
      );
      const reason = getAffinityReason(
        source,
        target,
        existing?.orderCount || 0,
      );

      if (score <= 0 && !existing) return;

      await prisma.productAffinity.upsert({
        where: {
          shop_sourceId_targetId: {
            shop,
            sourceId: source.id,
            targetId: target.id,
          },
        },
        update: { score, reason },
        create: {
          shop,
          sourceId: source.id,
          targetId: target.id,
          score,
          reason,
          orderCount: existing?.orderCount || 0,
        },
      });
    }),
  );

  await redis.del(cacheKeys.affinity(shop, productId));
}

export async function incrementOrderAffinities(
  shop: string,
  productIds: string[],
  orderId: string,
  lineItems: Array<{ productId: string; variantId: string }> = [],
) {
  const uniqueProductIds = Array.from(new Set(productIds.filter(Boolean)));
  if (uniqueProductIds.length < 1 || !orderId) return;

  let knownProductIds: string[];
  try {
    knownProductIds = await prisma.$transaction(async (tx) => {
      const marker = await tx.event.findUnique({
        where: {
          event_orderId_storeId: {
            event: "order_affinities_processed",
            orderId,
            storeId: shop,
          },
        },
        select: { id: true },
      });
      if (marker) return [];

      const products = await tx.product.findMany({
        where: { shop, id: { in: uniqueProductIds } },
        select: { id: true },
      });
      const knownIds = products.map(({ id }) => id);

      await tx.event.create({
        data: {
          event: "order_affinities_processed",
          orderId,
          storeId: shop,
          timestamp: new Date(),
          data: { productIds: knownIds },
        },
      });

      for (const productId of knownIds) {
        await tx.productOrderStat.upsert({
          where: { shop_productId: { shop, productId } },
          update: { orderCount: { increment: 1 } },
          create: { shop, productId, orderCount: 1 },
        });
      }

      const knownIdSet = new Set(knownIds);
      const orderedVariants = Array.from(
        new Map(
          lineItems
            .filter(
              (line) =>
                knownIdSet.has(line.productId) &&
                line.variantId.startsWith("gid://shopify/ProductVariant/"),
            )
            .map((line) => [`${line.productId}:${line.variantId}`, line]),
        ).values(),
      );
      for (const line of orderedVariants) {
        await tx.productVariantOrderStat.upsert({
          where: {
            shop_productId_variantId: {
              shop,
              productId: line.productId,
              variantId: line.variantId,
            },
          },
          update: { orderCount: { increment: 1 } },
          create: {
            shop,
            productId: line.productId,
            variantId: line.variantId,
            orderCount: 1,
          },
        });
      }

      for (const sourceId of knownIds) {
        for (const targetId of knownIds) {
          if (sourceId === targetId) continue;
          await tx.productAffinity.upsert({
            where: { shop_sourceId_targetId: { shop, sourceId, targetId } },
            update: { orderCount: { increment: 1 } },
            create: {
              shop,
              sourceId,
              targetId,
              score: 0.5,
              reason: "frequently bought together",
              orderCount: 1,
            },
          });
        }
      }

      return knownIds;
    });
  } catch (error) {
    // A concurrent delivery can race between the marker lookup and insert.
    // The unique marker makes the transaction exactly-once for this order.
    if ((error as { code?: string })?.code === "P2002") return;
    throw error;
  }

  for (let index = 0; index < knownProductIds.length; index += 4) {
    const batch = knownProductIds.slice(index, index + 4);
    await Promise.all(
      batch.map((productId) => recomputeAffinities(shop, productId)),
    );
  }
}

export async function syncProductsPageFromAdmin(
  shop: string,
  admin: ShopifyAdminGraphql,
  cursor: string | null,
) {
  const startedAt = Date.now();
  const response = await admin.graphql(
    `#graphql
    query AOVBoostProducts($cursor: String) {
      products(first: 250, after: $cursor, query: "status:active") {
        edges {
          node {
            id
            title
            handle
            vendor
            productType
            tags
            onlineStoreUrl
            hasOnlyDefaultVariant
            collections(first: 50) { edges { node { id } } }
            variants(first: 100) {
              edges {
                node {
                  id
                  title
                  sku
                  price
                  compareAtPrice
                  availableForSale
                  inventoryPolicy
                  sellableOnlineQuantity
                  selectedOptions { name value }
                }
              }
              pageInfo { hasNextPage }
            }
            metafields(first: 20) {
              edges { node { namespace key value type } }
            }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }`,
    { variables: { cursor } },
  );
  const result = await response.json();
  if (Array.isArray(result.errors) && result.errors.length > 0) {
    throw new Error(
      `Shopify product sync failed: ${result.errors
        .map((error: any) => String(error.message || "Unknown GraphQL error"))
        .join("; ")}`,
    );
  }
  const connection = result.data?.products;
  if (!connection || !Array.isArray(connection.edges)) {
    throw new Error("Shopify product sync returned an invalid response");
  }

  const productNodes = (connection.edges as any[])
    .map((edge: any) => edge?.node)
    .filter(Boolean);
  const productIdsForStats = productNodes.map((node: any) => String(node.id));
  const variantStats = productIdsForStats.length
    ? await prisma.productVariantOrderStat.findMany({
        where: { shop, productId: { in: productIdsForStats } },
        select: { variantId: true, orderCount: true },
      })
    : [];
  const variantOrderCounts = new Map(
    variantStats.map((stat) => [stat.variantId, stat.orderCount]),
  );
  const products: ShopifyProductInput[] = productNodes
    .map((node: any) =>
      mapAdminCatalogProductNode(node, { variantOrderCounts }),
    )
    .filter(
      (product: ShopifyProductInput | null): product is ShopifyProductInput =>
        Boolean(product),
    );
  await upsertProductBatch(shop, products);
  const syncedVariantCount = products.reduce(
    (total, product) =>
      total + getSyncedProductVariants(product.metafields).length,
    0,
  );
  const truncatedProductCount = productNodes.filter((node: any) =>
    Boolean(node.variants?.pageInfo?.hasNextPage),
  ).length;
  console.log("AOVBoost product sync page stored variants:", {
    shop,
    productCount: products.length,
    syncedVariantCount,
    truncatedProductCount,
    durationMs: Date.now() - startedAt,
  });
  const productIds = products.map((product) => product.id);
  const nextCursor = connection.pageInfo?.endCursor || null;
  const hasNextPage = Boolean(connection.pageInfo?.hasNextPage);
  if (hasNextPage && (!nextCursor || nextCursor === cursor)) {
    throw new Error("Shopify product sync pagination did not advance");
  }
  return { productIds, cursor: nextCursor, hasNextPage };
}

export async function pruneDeletedProducts(shop: string, productIds: string[]) {
  return productIds.length
    ? prisma.product.deleteMany({ where: { shop, id: { notIn: productIds } } })
    : prisma.product.deleteMany({ where: { shop } });
}

export async function recomputeInitialAffinityBatch(
  shop: string,
  offset: number,
  batchSize = 20,
) {
  const products = await prisma.product.findMany({
    where: { shop },
    include: { orderStats: true },
    orderBy: [{ updatedAt: "desc" }],
    take: INITIAL_AFFINITY_PRODUCT_LIMIT,
  });
  const batch = products.slice(offset, offset + batchSize);
  await Promise.all(
    batch.map((product) => recomputeInitialAffinities(shop, product, products)),
  );
  const done = Math.min(offset + batch.length, products.length);
  return { total: products.length, done, complete: done >= products.length };
}

async function upsertProductBatch(
  shop: string,
  products: ShopifyProductInput[],
) {
  for (let index = 0; index < products.length; index += 50) {
    const batch = products.slice(index, index + 50);
    await prisma.$transaction(
      batch.map((product) =>
        prisma.product.upsert({
          where: { shop_id: { shop, id: product.id } },
          update: toProductData(shop, product),
          create: toProductData(shop, product),
        }),
      ),
    );
  }
}

type ProductWithOptionalStats = Product & {
  orderStats?: { orderCount: number } | null;
};

async function recomputeInitialAffinities(
  shop: string,
  source: ProductWithOptionalStats,
  products: ProductWithOptionalStats[],
) {
  const targets = products
    .filter((target) => target.id !== source.id)
    .map((target) => {
      const sharedTags = intersection(source.tags, target.tags).length;
      const sharedCollections = intersection(
        source.collectionIds,
        target.collectionIds,
      ).length;
      const score = computeAffinityScore(source, target, 0);
      return { target, sharedCollections, sharedTags, score };
    })
    .filter((entry) => entry.sharedCollections > 0 || entry.sharedTags >= 2)
    .sort((left, right) => right.score - left.score)
    .slice(0, INITIAL_AFFINITY_TARGET_LIMIT);

  await Promise.all(
    targets.map(({ target, sharedCollections, score }) =>
      prisma.productAffinity.upsert({
        where: {
          shop_sourceId_targetId: {
            shop,
            sourceId: source.id,
            targetId: target.id,
          },
        },
        update: {
          score,
          reason: sharedCollections ? "same collection" : "shared tags",
        },
        create: {
          shop,
          sourceId: source.id,
          targetId: target.id,
          score,
          reason: sharedCollections ? "same collection" : "shared tags",
        },
      }),
    ),
  );
}

function computeAffinityScore(
  source: Product & { orderStats?: { orderCount: number } | null },
  target: Product & { orderStats?: { orderCount: number } | null },
  ordersContainingBoth: number,
) {
  const ordersContainingA = source.orderStats?.orderCount || 0;
  const ordersContainingB = target.orderStats?.orderCount || 0;
  const orderCoOccurrence =
    ordersContainingA > 0 && ordersContainingB > 0
      ? ordersContainingBoth / Math.sqrt(ordersContainingA * ordersContainingB)
      : 0;
  const tagSimilarity = jaccard(source.tags, target.tags);
  const collectionOverlap = jaccard(source.collectionIds, target.collectionIds);

  return clamp(
    0.5 * orderCoOccurrence + 0.3 * tagSimilarity + 0.2 * collectionOverlap,
    0,
    1,
  );
}

function getAffinityReason(
  source: Product,
  target: Product,
  orderCount: number,
) {
  if (orderCount > 0) return "frequently bought together";
  if (intersection(source.collectionIds, target.collectionIds).length > 0) {
    return "same collection";
  }
  if (intersection(source.tags, target.tags).length >= 2) return "shared tags";
  return "weak affinity";
}

function toProductData(shop: string, product: ShopifyProductInput) {
  return {
    id: product.id,
    shop,
    title: product.title,
    handle: product.handle,
    vendor: product.vendor || null,
    productType: product.productType || null,
    tags: product.tags || [],
    price: decimal(product.price),
    compareAtPrice:
      product.compareAtPrice === null || product.compareAtPrice === undefined
        ? null
        : decimal(product.compareAtPrice),
    imageUrl: product.imageUrl || null,
    collectionIds: product.collectionIds || [],
    metafields: (product.metafields || {}) as Prisma.InputJsonValue,
  };
}

function decimal(value: unknown) {
  return String(value || "0");
}

function jaccard(left: string[], right: string[]) {
  const union = new Set([...left, ...right]);
  if (union.size === 0) return 0;
  return intersection(left, right).length / union.size;
}

function intersection(left: string[], right: string[]) {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
