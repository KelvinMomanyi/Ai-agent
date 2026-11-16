import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import {
  verifyAppProxyRequest,
  isStorefrontAuthError,
} from "../utils/storefrontAuth.server";
import { isInstalledShop } from "../models/installedShop.server";
import { getAppSettings } from "../models/settings.server";
import { readStorefrontConfig } from "../models/storefrontConfig";
import { enforcePairingDecisionPolicy } from "../models/pairingRecommendations.server";
import { renderNextCartPage } from "../utils/nextCartPage.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const headers = {
    "Content-Type": "application/liquid; charset=utf-8",
    "Cache-Control": "no-store",
  };
  const unavailable = (status = 404) =>
    new Response(
      '<section><h1>This product pick is unavailable</h1><p><a href="/collections/all">Continue shopping</a></p></section>',
      { status, headers },
    );
  try {
    const { shop } = verifyAppProxyRequest(request);
    if (!(await isInstalledShop(shop))) return unavailable(401);
    const settings = await getAppSettings(shop);
    if (
      !readStorefrontConfig(settings.storefrontConfig).agentCoreEnabled ||
      settings.focusedMode ||
      !settings.postPurchaseEnabled
    )
      return unavailable();
    const id = new URL(request.url).searchParams.get("offer") || "";
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) return unavailable();
    const offer = await prisma.offer.findFirst({
      where: {
        id,
        shop,
        widgetType: "post_purchase",
        createdAt: { gte: new Date(Date.now() - 3600_000) },
      },
    });
    if (!offer) return unavailable();
    const context = offer.triggerContext as Record<string, unknown>;
    if (context?.trigger !== "order_status_next_cart") return unavailable();
    const guarded = await enforcePairingDecisionPolicy({
      shop,
      settings,
      sourceProductId: String(context.sourceProductId || ""),
      cartProductIds: Array.isArray(context.purchasedProductIds)
        ? (context.purchasedProductIds as string[])
        : [],
      decision: {
        widgetType: "post_purchase",
        payload: offer.payload as Record<string, unknown>,
        confidence: 1,
        reasoning: "next_cart_catalog_pick",
        aiProvider: "heuristic",
      },
    });
    const product = guarded.widgetType && guarded.payload.product;
    if (!product || typeof product !== "object") return unavailable();
    return new Response(
      renderNextCartPage(product as Record<string, any>, offer.id),
      { headers },
    );
  } catch (error) {
    return unavailable(isStorefrontAuthError(error) ? error.status : 503);
  }
};
