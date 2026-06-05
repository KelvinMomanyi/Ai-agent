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

export async function getActiveBundlesForProduct(shop: string, productId?: string) {
  if (!productId) return [];

  const key = `bundles:${shop}:${productId}`;
  const cached = await getJsonCache(key);
  if (cached) return cached;

  const bundles = await prisma.bundle.findMany({
    where: {
      shop,
      isActive: true,
      triggerProductIds: { has: productId },
    },
    include: { items: { include: { product: true } } },
    orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
    take: 5,
  });

  await setJsonCache(key, bundles, 3600); // Cache 1 hour
  return bundles;
}

export async function saveBundle(shop: string, id: string | null, input: BundleInput) {
  const data = toBundleData(input);

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
        items: { create: input.items },
      },
      include: { items: true },
    });

    // Invalidate cache for all affected products
    for (const productId of data.triggerProductIds) {
      await redis.del(`bundles:${shop}:${productId}`);
    }

    return result;
  }

  const result = await prisma.bundle.create({
    data: {
      shop,
      ...data,
      items: { create: input.items },
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
