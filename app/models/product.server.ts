import type { Prisma, Product, ProductAffinity } from "@prisma/client";
import prisma from "../db.server";
import { cacheKeys, getJsonCache, redis, setJsonCache } from "../redis.server";

export type ProductAffinityWithTarget = ProductAffinity & {
  target?: Product | null;
};

type ShopifyAdminGraphql = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<{ json: () => Promise<any> }>;
};

export type ShopifyProductInput = {
  id: string;
  title: string;
  handle: string;
  vendor?: string | null;
  productType?: string | null;
  tags?: string[];
  price?: string | number;
  compareAtPrice?: string | number | null;
  imageUrl?: string | null;
  collectionIds?: string[];
  metafields?: Prisma.InputJsonValue;
};

const INITIAL_AFFINITY_PRODUCT_LIMIT = 500;
const INITIAL_AFFINITY_TARGET_LIMIT = 20;

export async function upsertProduct(shop: string, product: ShopifyProductInput) {
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
    if (validCached.length === cached.length) return validCached.slice(0, limit);
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

  const validAffinities = await filterAffinitiesToExistingProducts(shop, affinities);
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
  const sharedCollections = intersection(source.collectionIds, target.collectionIds).length;
  const sameProductType =
    source.productType && target.productType && source.productType === target.productType
      ? 1
      : 0;
  const sameVendor = source.vendor && target.vendor && source.vendor === target.vendor ? 1 : 0;

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
    return target.orderStats?.orderCount
      ? "popular item"
      : "new arrival";
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
      const score = computeAffinityScore(source, target, existing?.orderCount || 0);
      const reason = getAffinityReason(source, target, existing?.orderCount || 0);

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
) {
  const uniqueProductIds = Array.from(new Set(productIds.filter(Boolean)));
  if (uniqueProductIds.length < 1) return;

  for (const productId of uniqueProductIds) {
    await prisma.productOrderStat.upsert({
      where: { shop_productId: { shop, productId } },
      update: { orderCount: { increment: 1 } },
      create: { shop, productId, orderCount: 1 },
    });
  }

  for (let index = 0; index < uniqueProductIds.length; index += 1) {
    for (let targetIndex = 0; targetIndex < uniqueProductIds.length; targetIndex += 1) {
      if (index === targetIndex) continue;
      const sourceId = uniqueProductIds[index];
      const targetId = uniqueProductIds[targetIndex];
      await prisma.productAffinity.upsert({
        where: {
          shop_sourceId_targetId: {
            shop,
            sourceId,
            targetId,
          },
        },
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
      await recomputeAffinities(shop, sourceId);
    }
  }
}

export async function syncProductsFromAdmin(
  shop: string,
  admin: ShopifyAdminGraphql,
  onProgress?: (progress: { total?: number; done: number; status: string }) => Promise<void>,
) {
  let cursor: string | null = null;
  let hasNextPage = true;
  let synced = 0;
  const syncedProductIds = new Set<string>();
  await onProgress?.({ done: 0, status: "fetching" });

  while (hasNextPage) {
    const response = await admin.graphql(
      `#graphql
      query AOVBoostProducts($cursor: String) {
        products(first: 250, after: $cursor) {
          edges {
            cursor
            node {
              id
              title
              handle
              vendor
              productType
              tags
              featuredImage { url }
              collections(first: 50) { edges { node { id } } }
              variants(first: 1) {
                edges { node { id price compareAtPrice } }
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
    const edges = result.data?.products?.edges || [];

    for (const edge of edges) {
      await upsertProduct(shop, mapGraphqlProduct(edge.node));
      if (edge.node?.id) syncedProductIds.add(edge.node.id);
      synced += 1;
    }
    await onProgress?.({
      done: synced,
      status: hasNextPage ? "fetching" : "building_affinities",
    });

    cursor = result.data?.products?.pageInfo?.endCursor || null;
    hasNextPage = Boolean(result.data?.products?.pageInfo?.hasNextPage);
  }

  await onProgress?.({ done: synced, status: "pruning_deleted" });
  const deleted = syncedProductIds.size
    ? await prisma.product.deleteMany({
        where: {
          shop,
          id: { notIn: Array.from(syncedProductIds) },
        },
      })
    : await prisma.product.deleteMany({ where: { shop } });

  const products = await prisma.product.findMany({
    where: { shop },
    include: { orderStats: true },
    orderBy: [{ updatedAt: "desc" }],
    take: INITIAL_AFFINITY_PRODUCT_LIMIT,
  });
  let affinityDone = 0;
  await onProgress?.({
    total: products.length,
    done: affinityDone,
    status: "building_affinities",
  });
  for (const product of products) {
    await recomputeInitialAffinities(shop, product, products);
    affinityDone += 1;
    await onProgress?.({
      total: products.length,
      done: affinityDone,
      status: "building_affinities",
    });
  }

  return { synced, deleted: deleted.count };
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

function getAffinityReason(source: Product, target: Product, orderCount: number) {
  if (orderCount > 0) return "frequently bought together";
  if (intersection(source.collectionIds, target.collectionIds).length > 0) {
    return "same collection";
  }
  if (intersection(source.tags, target.tags).length >= 2) return "shared tags";
  return "weak affinity";
}

function mapGraphqlProduct(node: any): ShopifyProductInput {
  const variant = node.variants?.edges?.[0]?.node;
  const metafields = Object.fromEntries(
    (node.metafields?.edges || []).map((edge: any) => [
      `${edge.node.namespace}.${edge.node.key}`,
      { value: edge.node.value, type: edge.node.type },
    ]),
  );
  if (variant?.id) {
    metafields["aovboost.defaultVariantId"] = {
      value: variant.id,
      type: "single_line_text_field",
    };
  }

  return {
    id: node.id,
    title: node.title,
    handle: node.handle,
    vendor: node.vendor,
    productType: node.productType,
    tags: node.tags || [],
    price: variant?.price || 0,
    compareAtPrice: variant?.compareAtPrice || null,
    imageUrl: node.featuredImage?.url || null,
    collectionIds: (node.collections?.edges || []).map((edge: any) => edge.node.id),
    metafields,
  };
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
