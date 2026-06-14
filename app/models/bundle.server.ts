import prisma from "../db.server";
import { getJsonCache, setJsonCache, redis } from "../redis.server";

export type BundleInput = {
  name: string;
  description?: string;
  discountType: "percentage" | "fixed" | "none";
  discountValue: string | number;
  triggerProductIds: string[];
  isActive?: boolean;
  priority?: number;
  items: Array<{ productId: string; quantity: number }>;
};

export async function listBundles(shop: string) {
  return prisma.bundle.findMany({
    where: { shop },
    include: { items: { include: { product: true } } },
    orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
  });
}

export async function getBundle(shop: string, id: string) {
  return prisma.bundle.findFirst({
    where: { shop, id },
    include: { items: { include: { product: true } } },
  });
}

function findActiveBundlesForProduct(shop: string, productId: string) {
  const productIds = toProductLookupKeys(productId);

  return prisma.bundle.findMany({
    where: {
      shop,
      isActive: true,
      OR: productIds.map((id) => ({ triggerProductIds: { has: id } })),
    },
    include: { items: { include: { product: true } } },
    orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
    take: 5,
  });
}

type ActiveBundle = Awaited<
  ReturnType<typeof findActiveBundlesForProduct>
>[number];

export async function getActiveBundlesForProduct(
  shop: string,
  productId?: string,
  options: { excludeProductIds?: string[] } = {},
) {
  if (!productId) return [];

  const key = bundleCacheKey(shop, productId);
  const cached = await getJsonCache<ActiveBundle[]>(key);
  if (cached) {
    const validCached = await filterBundlesToExistingProducts(
      shop,
      productId,
      cached,
    );
    const allowedCached = filterBundlesToAllowedProducts(
      validCached,
      options.excludeProductIds || [],
    );
    if (validCached.length === cached.length) return allowedCached;
    await invalidateBundleCaches(shop, [productId]);
  }

  const bundles = await findActiveBundlesForProduct(shop, productId);
  const validBundles = await filterBundlesToExistingProducts(
    shop,
    productId,
    bundles,
  );

  await setJsonCache(key, validBundles, 3600); // Cache 1 hour
  return filterBundlesToAllowedProducts(
    validBundles,
    options.excludeProductIds || [],
  );
}

export async function saveBundle(
  shop: string,
  id: string | null,
  input: BundleInput,
) {
  const sanitizedInput = await normalizeBundleProductIds(
    shop,
    sanitizeBundleInput(input),
  );
  await assertBundleProductsExist(shop, sanitizedInput);
  const data = toBundleData(sanitizedInput);

  if (id && id !== "new") {
    const existing = await getBundle(shop, id);
    if (!existing) {
      throw new Error("Bundle not found");
    }

    await prisma.bundleItem.deleteMany({
      where: {
        bundle: { shop, id },
      },
    });

    const result = await prisma.bundle.update({
      where: { id },
      data: {
        ...data,
        items: { create: sanitizedInput.items },
      },
      include: { items: true },
    });

    // Invalidate cache for all affected products
    await invalidateBundleCaches(shop, [
      ...existing.triggerProductIds,
      ...data.triggerProductIds,
    ]);

    return result;
  }

  const result = await prisma.bundle.create({
    data: {
      shop,
      ...data,
      items: { create: sanitizedInput.items },
    },
    include: { items: true },
  });

  // Invalidate cache for all products in trigger
  await invalidateBundleCaches(shop, data.triggerProductIds);

  return result;
}

export async function toggleBundle(
  shop: string,
  id: string,
  isActive: boolean,
) {
  const bundle = await getBundle(shop, id);
  const result = await prisma.bundle.updateMany({
    where: { shop, id },
    data: { isActive },
  });

  if (bundle) {
    await invalidateBundleCaches(shop, bundle.triggerProductIds);
  }

  return result;
}

export async function deleteBundle(shop: string, id: string) {
  const bundle = await getBundle(shop, id);
  const result = await prisma.bundle.deleteMany({
    where: { shop, id },
  });

  if (bundle) {
    await invalidateBundleCaches(shop, bundle.triggerProductIds);
  }

  return result;
}

function toBundleData(input: BundleInput) {
  return {
    name: input.name,
    description: input.description || null,
    discountType: input.discountType,
    discountValue: String(input.discountValue || 0),
    triggerProductIds: input.triggerProductIds,
    isActive: input.isActive ?? true,
    priority: input.priority ?? 0,
  };
}

async function filterBundlesToExistingProducts(
  shop: string,
  currentProductId: string,
  bundles: ActiveBundle[],
) {
  if (bundles.length === 0) return [];

  const productIds = unique(
    bundles.flatMap((bundle) => [
      ...bundle.triggerProductIds.flatMap(toProductLookupKeys),
      ...bundle.items.flatMap((item) => toProductLookupKeys(item.productId)),
      ...bundle.items.flatMap((item) => toProductLookupKeys(item.product?.id)),
      ...toProductLookupKeys(currentProductId),
    ]),
  );
  const products = await prisma.product.findMany({
    where: { shop, id: { in: productIds } },
    select: { id: true },
  });
  const existingIds = new Set(
    products.flatMap((product) => toProductLookupKeys(product.id)),
  );

  return bundles.filter((bundle) => {
    const currentProductExists = toProductLookupKeys(currentProductId).some(
      (id) => existingIds.has(id),
    );
    const triggerMatches = bundle.triggerProductIds.some((productId) =>
      productIdsMatch(productId, currentProductId),
    );
    const allItemsExist =
      bundle.items.length > 0 &&
      bundle.items.every((item) => {
        const itemIds = unique([
          ...toProductLookupKeys(item.productId),
          ...toProductLookupKeys(item.product?.id),
        ]);

        return (
          itemIds.some((id) => existingIds.has(id)) &&
          Boolean(item.product) &&
          item.product.shop === shop
        );
      });

    return currentProductExists && triggerMatches && allItemsExist;
  });
}

function filterBundlesToAllowedProducts<T extends ActiveBundle>(
  bundles: T[],
  excludedProductIds: string[],
) {
  if (excludedProductIds.length === 0) return bundles;

  const excluded = new Set(excludedProductIds.flatMap(toProductLookupKeys));
  return bundles.filter(
    (bundle) =>
      !bundle.triggerProductIds.some((productId) =>
        toProductLookupKeys(productId).some((id) => excluded.has(id)),
      ) &&
      bundle.items.every(
        (item) =>
          !toProductLookupKeys(item.productId).some((id) => excluded.has(id)),
      ),
  );
}

async function assertBundleProductsExist(shop: string, input: BundleInput) {
  if (input.triggerProductIds.length === 0 || input.items.length === 0) {
    throw new Error(
      "Bundle must include trigger products and bundle items from this store.",
    );
  }

  const requestedProductIds = unique([
    ...input.triggerProductIds,
    ...input.items.map((item) => item.productId),
  ]);
  const lookupProductIds = unique(
    requestedProductIds.flatMap(toProductLookupKeys),
  );

  const products = await prisma.product.findMany({
    where: { shop, id: { in: lookupProductIds } },
    select: { id: true },
  });
  const existingIds = new Set(
    products.flatMap((product) => toProductLookupKeys(product.id)),
  );
  const missingIds = requestedProductIds.filter(
    (productId) =>
      !toProductLookupKeys(productId).some((id) => existingIds.has(id)),
  );

  if (missingIds.length > 0) {
    throw new Error(
      `Bundle contains products that are not present in this store: ${missingIds.join(", ")}`,
    );
  }
}

function sanitizeBundleInput(input: BundleInput): BundleInput {
  return {
    ...input,
    triggerProductIds: unique(input.triggerProductIds),
    items: input.items
      .filter((item) => item.productId)
      .map((item) => ({
        productId: item.productId,
        quantity: Math.max(1, Number(item.quantity || 1)),
      })),
  };
}

async function normalizeBundleProductIds(
  shop: string,
  input: BundleInput,
): Promise<BundleInput> {
  const requestedProductIds = unique([
    ...input.triggerProductIds,
    ...input.items.map((item) => item.productId),
  ]);
  const lookupProductIds = unique(
    requestedProductIds.flatMap(toProductLookupKeys),
  );
  if (lookupProductIds.length === 0) return input;

  const products = await prisma.product.findMany({
    where: { shop, id: { in: lookupProductIds } },
    select: { id: true },
  });
  const canonicalByLookupId = new Map<string, string>();
  for (const product of products) {
    for (const lookupId of toProductLookupKeys(product.id)) {
      canonicalByLookupId.set(lookupId, product.id);
    }
  }
  const normalizeProductId = (productId: string) =>
    toProductLookupKeys(productId)
      .map((lookupId) => canonicalByLookupId.get(lookupId))
      .find(Boolean) || productId;

  return {
    ...input,
    triggerProductIds: unique(input.triggerProductIds.map(normalizeProductId)),
    items: input.items.map((item) => ({
      ...item,
      productId: normalizeProductId(item.productId),
    })),
  };
}

async function invalidateBundleCaches(shop: string, productIds: string[]) {
  const keys = unique(
    productIds.flatMap((productId) => bundleCacheKeys(shop, productId)),
  );
  await Promise.all(keys.map((key) => redis.del(key)));
}

function bundleCacheKey(shop: string, productId: string) {
  return `bundles:v3:${shop}:${toProductLookupKeys(productId).sort().join("|")}`;
}

function bundleCacheKeys(shop: string, productId: string) {
  return unique([
    bundleCacheKey(shop, productId),
    ...toProductLookupKeys(productId).flatMap((id) => [
      `bundles:${shop}:${id}`,
      `bundles:v2:${shop}:${id}`,
      bundleCacheKey(shop, id),
    ]),
  ]);
}

function productIdsMatch(left: unknown, right: unknown) {
  const rightIds = new Set(toProductLookupKeys(right));
  return toProductLookupKeys(left).some((id) => rightIds.has(id));
}

function toProductLookupKeys(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return [];

  const withoutQuery = text.split("?")[0];
  const lastSegment =
    withoutQuery.split("/").filter(Boolean).pop() || withoutQuery;
  return unique([
    text,
    withoutQuery,
    lastSegment,
    `gid://shopify/Product/${lastSegment}`,
  ]);
}

function unique(values: string[]) {
  return Array.from(new Set(values.map(String).filter(Boolean)));
}
