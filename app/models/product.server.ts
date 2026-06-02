import type { Prisma, Product, ProductAffinity } from "@prisma/client";
import prisma from "../db.server";
import { cacheKeys, getJsonCache, redis, setJsonCache } from "../redis.server";

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
): Promise<ProductAffinity[]> {
  const key = cacheKeys.affinity(shop, productId);
  const cached = await getJsonCache<ProductAffinity[]>(key);
  if (cached) return cached;

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

  await setJsonCache(key, affinities, 3600);
  return affinities;
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
    take: 500,
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
  admin: { graphql: Function },
  onProgress?: (progress: { total?: number; done: number; status: string }) => Promise<void>,
) {
  let cursor: string | null = null;
  let hasNextPage = true;
  let synced = 0;
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
                edges { node { price compareAtPrice } }
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
      synced += 1;
    }
    await onProgress?.({
      done: synced,
      status: hasNextPage ? "fetching" : "building_affinities",
    });

    cursor = result.data?.products?.pageInfo?.endCursor || null;
    hasNextPage = Boolean(result.data?.products?.pageInfo?.hasNextPage);
  }

  const products = await prisma.product.findMany({ where: { shop }, take: 1000 });
  await onProgress?.({ total: products.length, done: synced, status: "building_affinities" });
  for (const product of products) {
    await recomputeInitialAffinities(shop, product, products);
    await onProgress?.({ total: products.length, done: synced, status: "building_affinities" });
  }

  return { synced };
}

async function recomputeInitialAffinities(
  shop: string,
  source: Product,
  products: Product[],
) {
  await Promise.all(
    products
      .filter((target) => target.id !== source.id)
      .map(async (target) => {
        const sharedTags = intersection(source.tags, target.tags).length;
        const sharedCollections = intersection(
          source.collectionIds,
          target.collectionIds,
        ).length;
        if (sharedCollections === 0 && sharedTags < 2) return;

        await prisma.productAffinity.upsert({
          where: {
            shop_sourceId_targetId: {
              shop,
              sourceId: source.id,
              targetId: target.id,
            },
          },
          update: {
            score: computeAffinityScore(source, target, 0),
            reason: sharedCollections ? "same collection" : "shared tags",
          },
          create: {
            shop,
            sourceId: source.id,
            targetId: target.id,
            score: computeAffinityScore(source, target, 0),
            reason: sharedCollections ? "same collection" : "shared tags",
          },
        });
      }),
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
    metafields: Object.fromEntries(
      (node.metafields?.edges || []).map((edge: any) => [
        `${edge.node.namespace}.${edge.node.key}`,
        { value: edge.node.value, type: edge.node.type },
      ]),
    ),
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
