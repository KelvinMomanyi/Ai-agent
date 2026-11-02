import prisma from "../db.server";
import { getJsonCache, setJsonCache } from "../redis.server";

export async function isInstalledShop(shop: string): Promise<boolean> {
  if (await getJsonCache<boolean>(`installed:${shop}`)) return true;
  const session = await prisma.session.findFirst({
    where: { shop },
    select: { id: true },
  });
  const installed = Boolean(
    session ||
    (await prisma.shop.findUnique({
      where: { shopDomain: shop },
      select: { shopDomain: true },
    })),
  );
  if (installed) await setJsonCache(`installed:${shop}`, true, 60);
  return installed;
}
