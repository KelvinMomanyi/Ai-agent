import { createHash, randomUUID } from "node:crypto";
import prisma from "../db.server";
import { ingestStorefrontEvents } from "../models/event.server";
import {
  data as json,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { authenticate } from "../shopify.server";
import { isInstalledShop } from "../models/installedShop.server";
import { getAppSettings } from "../models/settings.server";
import { readStorefrontConfig } from "../models/storefrontConfig";
import { selectPairingRecommendations } from "../models/pairingRecommendations.server";
import { catalogProductToWidgetProduct } from "../models/catalogGuard.server";
import { stripPrivateSignals } from "../utils/storefrontPayload.server";
import { getEntitlements, limitsFor } from "../models/entitlements.server";
import { upsertShopperSessionFromEvents } from "../models/session.server";
import { enrollHoldout } from "../models/holdout.server";
import { createOfferRecord } from "../models/offer.server";
import { reserveOfferDisplay } from "../models/usage.server";
import { incrementRateLimit } from "../redis.server";
import { withCors, optionsResponse } from "../utils/cors.server";
import { cappedJson } from "../utils/cappedJson.server";

export const loader = ({ request }: LoaderFunctionArgs) =>
  request.method === "OPTIONS"
    ? optionsResponse()
    : json({}, { status: 405, headers: withCors() });
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") return optionsResponse();
  const headers = withCors({ "Cache-Control": "no-store" });
  try {
    const { sessionToken } = await authenticate.public.customerAccount(request);
    const shop = new URL(sessionToken.dest).hostname;
    if (
      !/^[a-zA-Z0-9-]+\.myshopify\.com$/.test(shop) ||
      !(await isInstalledShop(shop))
    )
      return json({}, { status: 401, headers });
    if ((await incrementRateLimit(`order-picks:${shop}`, 60)) > 30)
      return json({}, { status: 429, headers });
    const body = await cappedJson(request);
    // These are public catalog ids, never authority to read or alter an order.
    // The extension reads the real order from Shopify's sandboxed target API.
    const ids: string[] = Array.isArray(body.productIds)
      ? [
          ...new Set<string>(
            body.productIds.filter(
              (id: unknown) =>
                typeof id === "string" &&
                /^gid:\/\/shopify\/Product\/\d+$/.test(id),
            ),
          ),
        ].slice(0, 100)
      : [];
    const settings = await getAppSettings(shop),
      config = readStorefrontConfig(settings.storefrontConfig);
    if (
      !config.agentCoreEnabled ||
      settings.focusedMode ||
      !settings.postPurchaseEnabled
    )
      return json({}, { headers });
    const entitlement = await getEntitlements(shop);
    if (!limitsFor(entitlement).features.advancedPlacements)
      return json({}, { headers });
    const anonymousId =
      typeof body.anonymousId === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        body.anonymousId,
      )
        ? body.anonymousId
        : randomUUID();
    const sessionId = `order_status_${anonymousId}`;
    if ((await enrollHoldout(shop, sessionId, settings))?.arm === "holdout")
      return json({ anonymousId }, { headers });
    if (["impression", "interaction"].includes(body.intent)) {
      const offerId = typeof body.offerId === "string" ? body.offerId : "";
      if (
        anonymousId !== body.anonymousId ||
        !/^[a-zA-Z0-9_-]{1,128}$/.test(offerId)
      )
        return json({}, { status: 400, headers });
      const existing = await prisma.offer.findFirst({
        where: {
          id: offerId,
          shop,
          sessionId,
          widgetType: "post_purchase",
          createdAt: { gte: new Date(Date.now() - 3600_000) },
        },
        select: { id: true },
      });
      if (!existing) return json({}, { status: 404, headers });
      await ingestStorefrontEvents({
        shop,
        sessionId,
        events: [
          {
            type: body.intent === "interaction" ? "widget_click" : "impression",
            offer_id: offerId,
            provider_id: "post_purchase",
            surface_class: "ambient",
            trigger_signal: "order_status",
            page_type: "thankyou",
            session_id: sessionId,
            holdout: false,
            ai_healthy: false,
            ts: Date.now(),
          },
        ],
      });
      return json({ ok: true }, { headers });
    }
    if (!ids.length) return json({}, { headers });
    const selected = await selectPairingRecommendations({
      shop,
      sourceProductId: ids[0],
      cartProductIds: ids,
      excludeProductIds: ids,
      settings,
      limit: 1,
    });
    if (!selected.length) return json({ anonymousId }, { headers });
    const product = stripPrivateSignals(
      catalogProductToWidgetProduct(selected[0].product),
    );
    const session = await upsertShopperSessionFromEvents({
      shop,
      sessionId,
      events: [],
    });
    const key = createHash("sha256")
      .update(JSON.stringify([[...ids].sort(), selected[0].product.id]))
      .digest("hex");
    const prior = await prisma.offer.findFirst({
      where: {
        shop,
        sessionId: session.id,
        widgetType: "post_purchase",
        triggerContext: { path: ["nextCartKey"], equals: key },
        createdAt: { gte: new Date(Date.now() - 3600_000) },
      },
      select: { id: true },
    });
    const offer =
      prior ||
      (await createOfferRecord({
        shop,
        sessionId: session.id,
        decision: {
          widgetType: "post_purchase",
          payload: { product },
          reasoning: "next_cart_catalog_pick",
          confidence: 1,
          aiProvider: "heuristic",
        },
        triggerContext: {
          trigger: "order_status_next_cart",
          sourceProductId: ids[0],
          purchasedProductIds: ids,
          nextCartKey: key,
        },
      }));
    if (!offer || !(await reserveOfferDisplay(shop, offer.id, entitlement)))
      return json({ anonymousId }, { headers });
    return json(
      {
        anonymousId,
        product,
        offerId: offer.id,
        path: `/apps/aovboost/postadd?offer=${encodeURIComponent(offer.id)}`,
      },
      { headers },
    );
  } catch (error) {
    if (error instanceof Response)
      return new Response(null, { status: error.status, headers });
    return json({}, { status: 503, headers });
  }
};
