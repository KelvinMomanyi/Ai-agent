import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import { getOfferDecision } from "../ai/decisionEngine.server";
import type { CurrentPageType, OfferDecision } from "../ai/types";
import { buildOfferCandidates, createOfferRecord } from "../models/offer.server";
import {
  getShopperSession,
  toShopperSessionSnapshot,
  upsertShopperSessionFromEvents,
} from "../models/session.server";
import {
  cacheKeys,
  getJsonCache,
  incrementRateLimit,
  setJsonCache,
} from "../redis.server";
import { optionsResponse, withCors } from "../utils/cors.server";

type OfferBody = {
  sessionId?: string;
  shop?: string;
  currentProductId?: string;
  currentPageType?: string;
  cartProductIds?: string[];
  dismissedWidgets?: string[];
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") return optionsResponse();
  return json({ ok: true }, { headers: withCors() });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") return optionsResponse();

  try {
    const body = (await request.json()) as OfferBody;
    const headerShop = request.headers.get("X-AOVBoost-Shop");
    const shop = body.shop || headerShop || "";

    if (!shop || headerShop !== shop || !body.sessionId || !(await isInstalledShop(shop))) {
      return json({ widgetType: null, payload: {} }, { status: 400, headers: withCors() });
    }

    const requestCount = await incrementRateLimit(
      cacheKeys.offerRateLimit(body.sessionId),
      60,
    );
    if (requestCount > 10) {
      return json(
        { widgetType: null, payload: {}, reason: "rate_limited" },
        { status: 429, headers: withCors({ "Retry-After": "60" }) },
      );
    }

    const cacheKey = cacheKeys.offer(body.sessionId, body.currentProductId || "none");
    const cached = await getJsonCache<OfferDecision>(cacheKey);
    if (cached) return json(cached, { headers: withCors() });

    let session = await getShopperSession(shop, body.sessionId);
    if (!session) {
      session = await upsertShopperSessionFromEvents({
        shop,
        sessionId: body.sessionId,
        events: [{ type: "session_sync", cartProductIds: body.cartProductIds || [] }],
      });
    }

    const settings = await prisma.appSettings.upsert({
      where: { shop },
      update: {},
      create: { shop },
    });
    const snapshot = toShopperSessionSnapshot(session);
    const candidates = await buildOfferCandidates({
      shop,
      session: snapshot,
      currentProductId: body.currentProductId,
    });
    const decision = await getOfferDecision({
      shop,
      session: snapshot,
      currentProductId: body.currentProductId,
      currentPageType: normalizePageType(body.currentPageType),
      cartProductIds: body.cartProductIds || session.cartProductIds,
      recentlyDismissedWidgets: body.dismissedWidgets || [],
      settings,
      candidates,
    });
    const abVariant = decision.widgetType
      ? await chooseExperimentVariant(shop, decision.widgetType, body.sessionId)
      : null;

    const offer = await createOfferRecord({
      shop,
      sessionId: session.id,
      decision,
      triggerContext: {
        currentProductId: body.currentProductId,
        currentPageType: body.currentPageType,
        cartProductIds: body.cartProductIds || [],
        session: snapshot,
      },
      abVariant,
    });

    const response: OfferDecision = {
      ...decision,
      payload: {
        ...decision.payload,
        offerId: offer?.id,
        abVariant,
      },
    };

    await setJsonCache(cacheKey, response, 30);
    return json(response, { headers: withCors() });
  } catch (error) {
    console.error("AOVBoost offer route failed:", getErrorMessage(error));
    return json(
      { widgetType: null, payload: {}, reasoning: "failed_closed", confidence: 0 },
      { headers: withCors() },
    );
  }
};

async function chooseExperimentVariant(
  shop: string,
  widgetType: string,
  sessionId: string,
) {
  const experiment = await prisma.experiment.findFirst({
    where: { shop, isActive: true, widgetType },
    orderBy: { startedAt: "desc" },
  });
  if (!experiment) return null;

  const bucket = hash(sessionId + experiment.id) / 100;
  return bucket < experiment.trafficSplit ? "treatment" : "control";
}

function normalizePageType(value?: string): CurrentPageType {
  if (
    value === "home" ||
    value === "collection" ||
    value === "product" ||
    value === "cart" ||
    value === "checkout" ||
    value === "thankyou"
  ) {
    return value;
  }
  return "other";
}

function hash(value: string) {
  let result = 0;
  for (let index = 0; index < value.length; index += 1) {
    result = (result * 31 + value.charCodeAt(index)) % 10000;
  }
  return result % 100;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function isInstalledShop(shop: string) {
  const [session, legacyShop] = await Promise.all([
    prisma.session.findFirst({ where: { shop }, select: { id: true } }),
    prisma.shop.findUnique({ where: { shopDomain: shop }, select: { shopDomain: true } }),
  ]);

  return Boolean(session || legacyShop);
}
