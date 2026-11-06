import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
const { sign, verify } = createRequire(import.meta.url)(
  "jsonwebtoken",
) as typeof import("jsonwebtoken");
import prisma from "../db.server";
import { claimExpiringKey } from "../redis.server";
import { getAdminOfferPreview } from "./offerPreview.server";
import { getCatalogProductsByIds } from "./catalogCache.server";
import { filterCatalogProducts } from "./catalogGuard.server";
import {
  getThemeConfig,
  identityFields,
  parseThemeReport,
} from "./themeCompatibility.server";
import { safeThemeIdentity } from "../../shared/themeCompatibility";
export const THEME_PREVIEW_TTL_SECONDS = 300;
type PreviewClaims = {
  shop: string;
  sourceProductId: string;
  jti: string;
  purpose: "theme_preview";
};
function previewSecret() {
  const secret =
    process.env.AOVBOOST_STOREFRONT_SESSION_SECRET ||
    process.env.SHOPIFY_API_SECRET;
  if (!secret) throw new Error("Preview signing unavailable");
  return secret;
}
export function issueThemePreview(shop: string, sourceProductId: string) {
  return sign(
    { shop, sourceProductId, jti: randomUUID(), purpose: "theme_preview" },
    previewSecret(),
    {
      algorithm: "HS256",
      expiresIn: THEME_PREVIEW_TTL_SECONDS,
      audience: "aovboost-theme-preview",
    },
  );
}
export function verifyThemePreview(token: string, shop: string): PreviewClaims {
  const claims = verify(token, previewSecret(), {
    algorithms: ["HS256"],
    audience: "aovboost-theme-preview",
  }) as PreviewClaims;
  if (
    claims.shop !== shop ||
    claims.purpose !== "theme_preview" ||
    !/^[\w-]{1,80}$/.test(claims.jti) ||
    !/^gid:\/\/shopify\/Product\/\d+$/.test(claims.sourceProductId)
  )
    throw new Error("Invalid preview");
  return claims;
}
export async function bootstrapThemePreview(
  shop: string,
  claims: PreviewClaims,
  identity: unknown,
) {
  const preview = await getAdminOfferPreview(shop, claims.sourceProductId);
  const [source] = filterCatalogProducts(
    await getCatalogProductsByIds(shop, [claims.sourceProductId]),
  );
  if (
    !preview.source ||
    !preview.products.length ||
    !source ||
    !(await claimExpiringKey(
      `theme-preview-start:${shop}:${claims.jti}`,
      THEME_PREVIEW_TTL_SECONDS,
    ))
  )
    throw new Error("Preview unavailable or already started");
  return {
    source: {
      id: source.id,
      handle: source.handle,
      variantIds: source.variants
        .filter((v) => v.availableForSale)
        .map((v) => v.id),
    },
    payload: {
      previewMode: true,
      products: preview.products.map((product) => ({
        productId: product.id,
        product,
        reason: product.reason,
      })),
      copy: { headline: "Preview: recommendations for this cart" },
      maxProductRecommendations: 2,
    },
    config: await getThemeConfig(shop, identity),
  };
}
export async function saveThemePreview(
  shop: string,
  claims: PreviewClaims,
  value: unknown,
) {
  const report = parseThemeReport(value);
  const identity = safeThemeIdentity(report.identity);
  if (
    !(await claimExpiringKey(
      `theme-preview-result:${shop}:${claims.jti}`,
      THEME_PREVIEW_TTL_SECONDS,
    ))
  )
    throw new Error("Preview result already recorded");
  const lastPreviewResult = {
    strategy: report.strategy,
    verified: report.verified,
    reason: report.reason,
    cartUi: report.cartUi,
    at: new Date().toISOString(),
  };
  await prisma.themeProfile.upsert({
    where: { shop_themeId: { shop, themeId: identity.themeId } },
    create: { shop, ...identityFields(identity), lastPreviewResult },
    update: { lastPreviewResult },
  });
  return lastPreviewResult;
}
