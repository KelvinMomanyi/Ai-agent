import { Prisma, type Product, type ProductAffinity } from "@prisma/client";
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
      take: 100,
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

/** Refresh only a fixed candidate set; never fan out over the whole catalog. */
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
      OR: [
        ...(source.productType ? [{ productType: source.productType }] : []),
        { tags: { hasSome: source.tags } },
        { collectionIds: { hasSome: source.collectionIds } },
      ],
    },
    include: { orderStats: true },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  const existing = await prisma.productAffinity.findMany({
    where: {
      shop,
      sourceId: productId,
      targetId: { in: products.map((p) => p.id) },
    },
  });
  const counts = new Map(
    existing.map((entry) => [entry.targetId, entry.orderCount]),
  );
  for (let offset = 0; offset < products.length; offset += 4) {
    await Promise.all(
      products.slice(offset, offset + 4).map((target) => {
        const orderCount = counts.get(target.id) || 0;
        const data = {
          score: computeAffinityScore(source, target, orderCount),
          reason: getAffinityReason(source, target, orderCount),
        };
        return prisma.productAffinity.upsert({
          where: {
            shop_sourceId_targetId: {
              shop,
              sourceId: source.id,
              targetId: target.id,
            },
          },
          update: data,
          create: {
            shop,
            sourceId: source.id,
            targetId: target.id,
            orderCount,
            ...data,
          },
        });
      }),
    );
  }
  await redis.del(cacheKeys.affinity(shop, productId));
}

/** One idempotent transaction; cost depends on the order, never catalog size. */
export async function incrementOrderAffinities(
  shop: string,
  productIds: string[],
  orderId: string,
  lineItems: Array<{ productId: string; variantId: string }> = [],
) {
  const ids = Array.from(new Set(productIds.filter(Boolean)));
  if (!ids.length || !orderId) return;
  let knownIds: string[];
  try {
    knownIds = await prisma.$transaction(
      async (tx) => {
        const marker = {
          event: "order_affinities_processed",
          orderId,
          storeId: shop,
        };
        if (
          await tx.event.findUnique({
            where: { event_orderId_storeId: marker },
            select: { id: true },
          })
        )
          return [];
        const products = await tx.product.findMany({
          where: { shop, id: { in: ids } },
          select: { id: true },
        });
        const known = products.map((p) => p.id).sort();
        await tx.event.create({
          data: {
            ...marker,
            timestamp: new Date(),
            data: { productIds: known },
          },
        });
        if (!known.length) return known;
        await tx.productOrderStat.createMany({
          data: known.map((productId) => ({ shop, productId, orderCount: 0 })),
          skipDuplicates: true,
        });
        await tx.productOrderStat.updateMany({
          where: { shop, productId: { in: known } },
          data: { orderCount: { increment: 1 } },
        });
        const knownSet = new Set(known);
        const variants = Array.from(
          new Map(
            lineItems
              .filter(
                (line) =>
                  knownSet.has(line.productId) &&
                  line.variantId.startsWith("gid://shopify/ProductVariant/"),
              )
              .map((line) => [line.variantId, line]),
          ).values(),
        );
        if (variants.length) {
          await tx.productVariantOrderStat.createMany({
            data: variants.map((line) => ({ shop, ...line, orderCount: 0 })),
            skipDuplicates: true,
          });
          await tx.productVariantOrderStat.updateMany({
            where: { shop, OR: variants },
            data: { orderCount: { increment: 1 } },
          });
        }
        // Limit each source to 20 co-purchase neighbors, even on unusually large orders.
        const pairs = known.flatMap((sourceId) =>
          known
            .filter((id) => id !== sourceId)
            .slice(0, 20)
            .map((targetId) => ({ sourceId, targetId })),
        );
        if (pairs.length) {
          await tx.$executeRaw(Prisma.sql`
          INSERT INTO "ProductAffinity" (id, shop, "sourceId", "targetId", score, reason, "orderCount")
          SELECT 'pair:' || md5(${shop} || ':' || x."sourceId" || ':' || x."targetId"), ${shop}, x."sourceId", x."targetId", 0.5, 'frequently bought together', 1
          FROM jsonb_to_recordset(${JSON.stringify(pairs)}::jsonb) AS x("sourceId" text, "targetId" text)
          ON CONFLICT (shop, "sourceId", "targetId") DO UPDATE SET "orderCount" = "ProductAffinity"."orderCount" + 1
        `);
          await tx.$executeRaw(Prisma.sql`
          UPDATE "ProductAffinity" a SET score = LEAST(1.0,
            0.5 * a."orderCount" / sqrt(GREATEST(1.0, sa."orderCount"::float * sb."orderCount"))
            + 0.3 * (SELECT COUNT(*)::float FROM (SELECT unnest(pa.tags) INTERSECT SELECT unnest(pb.tags)) t) /
              GREATEST(1, (SELECT COUNT(*) FROM (SELECT unnest(pa.tags) UNION SELECT unnest(pb.tags)) t))
            + 0.2 * (SELECT COUNT(*)::float FROM (SELECT unnest(pa."collectionIds") INTERSECT SELECT unnest(pb."collectionIds")) t) /
              GREATEST(1, (SELECT COUNT(*) FROM (SELECT unnest(pa."collectionIds") UNION SELECT unnest(pb."collectionIds")) t))),
            reason = 'frequently bought together'
          FROM jsonb_to_recordset(${JSON.stringify(pairs)}::jsonb) AS x("sourceId" text, "targetId" text),
            "ProductOrderStat" sa, "ProductOrderStat" sb, "Product" pa, "Product" pb
          WHERE a.shop = ${shop} AND a."sourceId" = x."sourceId" AND a."targetId" = x."targetId"
            AND sa.shop = a.shop AND sa."productId" = a."sourceId" AND sb.shop = a.shop AND sb."productId" = a."targetId"
            AND pa.shop = a.shop AND pa.id = a."sourceId" AND pb.shop = a.shop AND pb.id = a."targetId"
        `);
        }
        return known;
      },
      { timeout: 15_000 },
    );
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return;
    throw error;
  }
  for (let offset = 0; offset < knownIds.length; offset += 4) {
    await Promise.all(
      knownIds
        .slice(offset, offset + 4)
        .map((id) => redis.del(cacheKeys.affinity(shop, id))),
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
            description
            vendor
            productType
            tags
            onlineStoreUrl
            hasOnlyDefaultVariant
            featuredMedia { preview { image { url } } }
            collections(first: 50) { edges { node { id title } } }
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
  if (productNodes.length > 0 && products.length === 0) {
    throw new Error(
      `Shopify returned ${productNodes.length} active products, but none could be mapped into the catalog`,
    );
  }
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
