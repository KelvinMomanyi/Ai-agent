import prisma from "../db.server";
import {
  issueStorefrontSession,
  verifyAppProxyRequest,
} from "./storefrontAuth.server";

export async function getStorefrontSessionRecovery(request: Request) {
  try {
    const { shop } = verifyAppProxyRequest(request);
    if (!shop || !(await isInstalledShop(shop))) return null;
    return issueStorefrontSession(shop);
  } catch {
    return null;
  }
}

async function isInstalledShop(shop: string) {
  const [session, legacyShop] = await Promise.all([
    prisma.session.findFirst({ where: { shop }, select: { id: true } }),
    prisma.shop.findUnique({ where: { shopDomain: shop }, select: { shopDomain: true } }),
  ]);

  return Boolean(session || legacyShop);
}
