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
import {
  authenticateStorefrontRequest,
  isStorefrontAuthError,
} from "../utils/storefrontAuth.server";

type OfferBody = {
  sessionId?: string;
  sessionToken?: string;
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
    const auth = authenticateStorefrontRequest(request, body);
    const { shop, sessionId } = auth;

    if (!shop || !(await isInstalledShop(shop))) {
      return json({ widgetType: null, payload: {} }, { status: 400, headers: withCors() });
    }

    const requestCount = await incrementRateLimit(
      cacheKeys.offerRateLimit(sessionId),
      60,
    );
    if (requestCount > 10) {
      return json(
        { widgetType: null, payload: {}, reason: "rate_limited" },
        { status: 429, headers: withCors({ "Retry-After": "60" }) },
      );
    }

    const cacheKey = cacheKeys.offer(sessionId, body.currentProductId || "none");
    const cached = await getJsonCache<OfferDecision>(cacheKey);
    if (cached) return json(cached, { headers: withCors() });

    // Batch: fetch session + settings in parallel
    const [session, settings] = await Promise.all([
      getShopperSession(shop, sessionId).then(async (s) => {
        if (s) return s;
        return upsertShopperSessionFromEvents({
          shop,
          sessionId,
          events: [{ type: "session_sync", cartProductIds: body.cartProductIds || [] }],
        });
      }),
      getCachedAppSettings(shop),
    ]);

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
      ? await getCachedExperimentVariant(shop, decision.widgetType, sessionId)
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
    if (isStorefrontAuthError(error)) {
      return json(
        { widgetType: null, payload: {}, reasoning: "unauthorized", confidence: 0 },
        { status: error.status, headers: withCors() },
      );
    }

    console.error("AOVBoost offer route failed:", getErrorMessage(error));
    return json(
      { widgetType: null, payload: {}, reasoning: "failed_closed", confidence: 0 },
      { headers: withCors() },
    );
  }
};

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

async function getCachedAppSettings(shop: string) {
  const key = `settings:${shop}`;
  const cached = await getJsonCache(key);
  if (cached) return cached;

  const settings = await prisma.appSettings.upsert({
    where: { shop },
    update: {},
    create: { shop },
  });
  await setJsonCache(key, settings, 3600); // Cache 1 hour
  return settings;
}

async function getCachedExperimentVariant(
  shop: string,
  widgetType: string,
  sessionId: string,
) {
  const key = `experiment:${shop}:${widgetType}`;
  const experiment = await getJsonCache(key);

  const exp = experiment || (await prisma.experiment.findFirst({
    where: { shop, isActive: true, widgetType },
    orderBy: { startedAt: "desc" },
  }));

  if (!exp) return null;

  if (!experiment) {
    await setJsonCache(key, exp, 600); // Cache 10 minutes
  }

  const bucket = hash(sessionId + exp.id) / 100;
  return bucket < exp.trafficSplit ? "treatment" : "control";
}
