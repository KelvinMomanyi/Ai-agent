import prisma from "../db.server";
import { getThemeSummary } from "./themeCompatibility.server";
import type { CatalogReadiness } from "./productCatalogMapping";
import {
  computeSetupChecklist,
  STOREFRONT_CONNECTION_EVENT,
  STOREFRONT_VERIFICATION_DAYS,
} from "./onboarding";

export async function recordAuthenticatedStorefrontSession(
  shop: string,
  now = new Date(),
) {
  // One bounded receipt per tenant, separate from offer impressions and orders.
  const id = `onboarding:storefront:${shop}`;
  await prisma.event.upsert({
    where: { id, storeId: shop },
    update: { timestamp: now },
    create: {
      id,
      storeId: shop,
      event: STOREFRONT_CONNECTION_EVENT,
      timestamp: now,
      data: {},
    },
  });
}

export async function getSetupChecklist(
  shop: string,
  readiness: CatalogReadiness,
  syncProgress: { status?: string; emptyCatalog?: boolean } | null,
  now = new Date(),
  theme?: { status: string; lastVerifiedAt: Date | null } | null,
) {
  const since = new Date(
    now.getTime() - STOREFRONT_VERIFICATION_DAYS * 86_400_000,
  );
  const [settings, connection, session, approvedPairingCount] =
    await Promise.all([
      prisma.appSettings.findUnique({
        where: { shop },
        select: { onboardingPreviewedAt: true },
      }),
      prisma.event.findFirst({
        where: {
          storeId: shop,
          event: STOREFRONT_CONNECTION_EVENT,
          timestamp: { gte: since, lte: now },
        },
        orderBy: { timestamp: "desc" },
        select: { timestamp: true },
      }),
      prisma.shopperSession.findFirst({
        where: { shop, lastActivityAt: { gte: since, lte: now } },
        orderBy: { lastActivityAt: "desc" },
        select: { lastActivityAt: true },
      }),
      prisma.productRelationship.count({
        where: {
          shop,
          kind: "complement",
          status: { in: ["approved", "auto_approved"] },
        },
      }),
    ]);
  const profile =
    theme === undefined ? (await getThemeSummary(shop)).profile : theme;
  return computeSetupChecklist({
    themeStatus: profile?.status,
    themeVerifiedAt: profile?.lastVerifiedAt || null,
    actionableProductCount: readiness.actionableProductCount,
    storedProductCount: readiness.storedProductCount,
    approvedPairingCount,
    syncProgress,
    now,
    previewedAt: settings?.onboardingPreviewedAt || null,
    lastStorefrontActivityAt:
      connection?.timestamp || session?.lastActivityAt || null,
  });
}
