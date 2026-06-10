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
  return prisma.bundle.findMany({
    where: {
      shop,
      isActive: true,
      triggerProductIds: { has: productId },
    },
    include: { items: { include: { product: true } } },
    orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
    take: 5,
  });
}

type ActiveBundle = Awaited<ReturnType<typeof findActiveBundlesForProduct>>[number];

export async function getActiveBundlesForProduct(
  shop: string,
  productId?: string,
  options: { excludeProductIds?: string[] } = {},
) {
  if (!productId) return [];

  const key = `bundles:${shop}:${productId}`;
  const cached = await getJsonCache<ActiveBundle[]>(key);
  if (cached) {
    const validCached = await filterBundlesToExistingProducts(shop, productId, cached);
    const allowedCached = filterBundlesToAllowedProducts(
      validCached,
      options.excludeProductIds || [],
    );
    if (validCached.length === cached.length) return allowedCached;
    await redis.del(key);
  }

  const bundles = await findActiveBundlesForProduct(shop, productId);
  const validBundles = await filterBundlesToExistingProducts(shop, productId, bundles);

  await setJsonCache(key, validBundles, 3600); // Cache 1 hour
  return filterBundlesToAllowedProducts(validBundles, options.excludeProductIds || []);
}

export async function saveBundle(shop: string, id: string | null, input: BundleInput) {
  const sanitizedInput = sanitizeBundleInput(input);
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
    for (const productId of unique([...existing.triggerProductIds, ...data.triggerProductIds])) {
      await redis.del(`bundles:${shop}:${productId}`);
    }

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
  for (const productId of data.triggerProductIds) {
    await redis.del(`bundles:${shop}:${productId}`);
  }

  return result;
}

export async function toggleBundle(shop: string, id: string, isActive: boolean) {
  const bundle = await getBundle(shop, id);
  const result = await prisma.bundle.updateMany({
    where: { shop, id },
    data: { isActive },
  });

  if (bundle) {
    for (const productId of bundle.triggerProductIds) {
      await redis.del(`bundles:${shop}:${productId}`);
    }
  }

  return result;
}

export async function deleteBundle(shop: string, id: string) {
  const bundle = await getBundle(shop, id);
  const result = await prisma.bundle.deleteMany({
    where: { shop, id },
  });

  if (bundle) {
    for (const productId of bundle.triggerProductIds) {
      await redis.del(`bundles:${shop}:${productId}`);
    }
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
      ...bundle.triggerProductIds,
      ...bundle.items.map((item) => item.productId),
      ...bundle.items.map((item) => item.product?.id || ""),
    ]),
  );
  const products = await prisma.product.findMany({
    where: { shop, id: { in: productIds } },
    select: { id: true },
  });
  const existingIds = new Set(products.map((product) => product.id));

  return bundles.filter((bundle) => {
    const currentProductExists = existingIds.has(currentProductId);
    const allItemsExist =
      bundle.items.length > 0 &&
      bundle.items.every(
        (item) =>
          existingIds.has(item.productId) &&
          Boolean(item.product) &&
          item.product.shop === shop,
      );

    return (
      currentProductExists &&
      bundle.triggerProductIds.includes(currentProductId) &&
      allItemsExist
    );
  });
}

function filterBundlesToAllowedProducts<T extends ActiveBundle>(
  bundles: T[],
  excludedProductIds: string[],
) {
  if (excludedProductIds.length === 0) return bundles;

  const excluded = new Set(excludedProductIds);
  return bundles.filter(
    (bundle) =>
      !bundle.triggerProductIds.some((productId) => excluded.has(productId)) &&
      bundle.items.every((item) => !excluded.has(item.productId)),
  );
}

async function assertBundleProductsExist(shop: string, input: BundleInput) {
  if (input.triggerProductIds.length === 0 || input.items.length === 0) {
    throw new Error("Bundle must include trigger products and bundle items from this store.");
  }

  const requestedProductIds = unique([
    ...input.triggerProductIds,
    ...input.items.map((item) => item.productId),
  ]);

  const products = await prisma.product.findMany({
    where: { shop, id: { in: requestedProductIds } },
    select: { id: true },
  });
  const existingIds = new Set(products.map((product) => product.id));
  const missingIds = requestedProductIds.filter((productId) => !existingIds.has(productId));

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

function unique(values: string[]) {
  return Array.from(new Set(values.map(String).filter(Boolean)));
}
