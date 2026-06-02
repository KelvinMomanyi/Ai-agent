import prisma from "../db.server";

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

    return prisma.bundle.update({
      where: { id },
      data: {
        ...data,
        items: { create: input.items },
      },
      include: { items: true },
    });
  }

  return prisma.bundle.create({
    data: {
      shop,
      ...data,
      items: { create: input.items },
    },
    include: { items: true },
  });
}

export async function toggleBundle(shop: string, id: string, isActive: boolean) {
  return prisma.bundle.updateMany({
    where: { shop, id },
    data: { isActive },
  });
}

export async function deleteBundle(shop: string, id: string) {
  return prisma.bundle.deleteMany({
    where: { shop, id },
  });
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
