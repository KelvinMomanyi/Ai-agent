import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import { getOfferDecision } from "../ai/decisionEngine.server";
import type { CurrentPageType, OfferDecision } from "../ai/types";
import { enforceCatalogBackedDecision } from "../models/catalogGuard.server";
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
  logStorefrontAuthError,
} from "../utils/storefrontAuth.server";

type OfferBody = {
  sessionId?: string;
  sessionToken?: string;
  shop?: string;
  currentProductId?: string;
  currentPageType?: string;
  cartProductIds?: string[];
  cartValue?: number;
  dismissedWidgets?: string[];
  trigger?: string;
  triggerCategory?: string;
  triggerPayload?: Record<string, unknown>;
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

    const cacheKey = cacheKeys.offer(
      sessionId,
      [
        body.currentProductId || "none",
        body.trigger || "manual",
        (body.cartProductIds || []).join(",") || "empty",
      ].join(":"),
    );
    const settings = await getCachedAppSettings(shop);
    const cached = await getJsonCache<OfferDecision>(cacheKey);
    if (cached) {
      const safeCached = await enforceCatalogBackedDecision({
        shop,
        decision: cached,
        excludedProductIds: settings.blockedProductIds,
      });
      return json(safeCached, { headers: withCors() });
    }

    const session = await getShopperSession(shop, sessionId).then(async (s) => {
      if (s) return s;
      return upsertShopperSessionFromEvents({
        shop,
        sessionId,
        events: [{ type: "session_sync", cartProductIds: body.cartProductIds || [] }],
      });
    });

    const snapshot = toShopperSessionSnapshot(session);
    const requestCartProductIds = body.cartProductIds || session.cartProductIds;
    const decisionSession = {
      ...snapshot,
      cartProductIds: requestCartProductIds,
      context: {
        ...snapshot.context,
        cartValue:
          typeof body.cartValue === "number"
            ? body.cartValue
            : (snapshot.context as Record<string, unknown>).cartValue,
      },
    };
    const candidates = await buildOfferCandidates({
      shop,
      session: decisionSession,
      currentProductId: body.currentProductId,
      excludeProductIds: settings.blockedProductIds,
    });
    const rawDecision = await getOfferDecision({
      shop,
      session: decisionSession,
      currentProductId: body.currentProductId,
      currentPageType: normalizePageType(body.currentPageType),
      cartProductIds: requestCartProductIds,
      recentlyDismissedWidgets: body.dismissedWidgets || [],
      settings,
      candidates,
      trigger: {
        type: body.trigger || "manual",
        category: body.triggerCategory,
        widgetHint:
          typeof body.triggerPayload?.widgetHint === "string"
            ? body.triggerPayload.widgetHint
            : undefined,
        payload: {
          ...(body.triggerPayload || {}),
          cartValue: body.cartValue,
        },
      },
    });
    const decision = await enforceCatalogBackedDecision({
      shop,
      decision: rawDecision,
      excludedProductIds: settings.blockedProductIds,
    });
    const abVariant = decision.widgetType
      ? await getCachedExperimentVariant(shop, decision.widgetType, sessionId)
      : null;

    const offer = await createOfferRecord({
      shop,
      sessionId: session.id,
      decision,
      triggerContext: {
        trigger: body.trigger,
        triggerCategory: body.triggerCategory,
        triggerPayload: body.triggerPayload || {},
        currentProductId: body.currentProductId,
        currentPageType: body.currentPageType,
        cartProductIds: requestCartProductIds,
        cartValue: body.cartValue,
        session: decisionSession,
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
      logStorefrontAuthError(request, "api.offer", error);
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
