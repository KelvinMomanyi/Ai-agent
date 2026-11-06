import prisma from "../db.server";
import {
  issueStorefrontSession,
  verifyAppProxyRequest,
  renewalSessionId,
} from "./storefrontAuth.server";
import { enrollHoldout } from "../models/holdout.server";

export async function getStorefrontSessionRecovery(request: Request) {
  try {
    const { shop } = verifyAppProxyRequest(request);
    if (!shop || !(await isInstalledShop(shop))) return null;
    const sessionId = renewalSessionId(request, shop);
    const initial = sessionId
      ? issueStorefrontSession(shop, { sessionId })
      : issueStorefrontSession(shop);
    const measurement = await enrollHoldout(shop, initial.sessionId);
    return {
      ...(measurement
        ? issueStorefrontSession(shop, {
            sessionId: initial.sessionId,
            holdout: {
              arm: measurement.arm,
              version: measurement.version,
              percent: measurement.percent,
            },
          })
        : initial),
      measurement,
    };
  } catch {
    return null;
  }
}

async function isInstalledShop(shop: string) {
  const [session, legacyShop] = await Promise.all([
    prisma.session.findFirst({ where: { shop }, select: { id: true } }),
    prisma.shop.findUnique({
      where: { shopDomain: shop },
      select: { shopDomain: true },
    }),
  ]);

  return Boolean(session || legacyShop);
}
