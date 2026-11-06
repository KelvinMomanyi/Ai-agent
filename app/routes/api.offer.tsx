import { isInstalledShop } from "../models/installedShop.server";
import { findProductIdsByVariants } from "../models/productLookup.server";
import {
  data as json,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import type { AppSettings, Experiment } from "@prisma/client";
import prisma from "../db.server";
import { getOfferDecision } from "../ai/decisionEngine.server";
import type { CurrentPageType, OfferDecision } from "../ai/types";
import {
  cachedProductsMatchCandidates,
  enforcePairingDecisionPolicy,
} from "../models/pairingRecommendations.server";
import {
  buildOfferCandidates,
  createOfferRecord,
} from "../models/offer.server";
import {
  applyExperimentConfig,
  type ExperimentVariant,
} from "../models/experimentConfig";
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
import { getStorefrontSessionRecovery } from "../utils/storefrontSessionRecovery.server";
import {
  evaluateProactiveMessage,
  getProactiveMessage,
} from "../sales/proactiveEngine";
import { reserveProactiveMessage } from "../sales/proactiveEngine.server";
import { normalizeSalesState } from "../sales/salesStateMachine";
import { toMerchantSalesSettings } from "../sales/settings";
import { enrollHoldout } from "../models/holdout.server";
import { getEntitlements, limitsFor } from "../models/entitlements.server";
import { getUsage, reserveOfferDisplay } from "../models/usage.server";
import {
  buildCartRecommendation,
  noCartOffer,
} from "../models/cartRecommendations.server";

// Forward client disconnects to cancellable UI work on Vercel.
export const config = { runtime: "nodejs", supportsCancellation: true };

type OfferBody = {
  sessionId?: string;
  sessionToken?: string;
  shop?: string;
  currentProductId?: string;
  currentPageType?: string;
  cartProductIds?: string[];
  cartVariantIds?: string[];
  cartItems?: Array<Record<string, unknown>>;
  cartItemCount?: number;
  cartValue?: number;
  currency?: string;
  market?: string;
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
    const { shop, sessionId, customerId } = auth;
    if (
      [body.cartProductIds, body.cartVariantIds, body.cartItems].some(
        (value) =>
          value !== undefined && (!Array.isArray(value) || value.length > 100),
      )
    )
      return json(noCartOffer("cart_context_too_large"), {
        status: 400,
        headers: withCors(),
      });

    if (!shop || !(await isInstalledShop(shop))) {
      return json(
        { widgetType: null, payload: {} },
        { status: 400, headers: withCors() },
      );
    }

    const requestCount = await incrementRateLimit(
      cacheKeys.offerRateLimit(sessionId),
      60,
    );
    const cartUpsellTrigger =
      body.trigger === "cart_item_added" || body.trigger === "add_to_cart";
    if (requestCount > 30 || (requestCount > 10 && !cartUpsellTrigger)) {
      return json(
        { widgetType: null, payload: {}, reason: "rate_limited" },
        { status: 429, headers: withCors({ "Retry-After": "60" }) },
      );
    }

    const requestCartProductIds = await resolveCartProductIds(shop, body);
    const requestCartVariantIds = uniqueStrings([
      ...toStringArray(body.cartVariantIds),
      ...extractCartItemVariantIds(body.cartItems),
    ]);
    const requestCartItemCount =
      typeof body.cartItemCount === "number"
        ? body.cartItemCount
        : body.cartItems?.length ||
          requestCartVariantIds.length ||
          requestCartProductIds.length;
    const triggerProductId = toProductGid(body.triggerPayload?.productId);
    const cacheKey = cacheKeys.offer(
      sessionId,
      [
        "v3",
        body.currentProductId || "none",
        triggerProductId || "no-trigger-product",
        body.trigger || "manual",
        requestCartProductIds.join(",") ||
          requestCartVariantIds.join(",") ||
          "empty",
      ].join(":"),
    );
    const settings = await getCachedAppSettings(shop);
    const cached = cartUpsellTrigger
      ? null
      : await getJsonCache<OfferDecision>(cacheKey);

    const session = await getShopperSession(shop, sessionId).then(async (s) => {
      if (s) return s;
      return upsertShopperSessionFromEvents({
        shop,
        sessionId,
        customerId,
        events: [
          {
            type: "session_sync",
            cartProductIds: requestCartProductIds,
            cartVariantIds: requestCartVariantIds,
            cartItemCount: requestCartItemCount,
            cartValue: body.cartValue,
          },
        ],
      });
    });

    const snapshot = toShopperSessionSnapshot(session);
    const measurement = await enrollHoldout(shop, sessionId, settings);
    if (measurement?.arm === "holdout")
      return json(
        { ...noCartOffer("holdout_assigned"), measurement },
        { headers: withCors() },
      );
    const decisionSession = {
      ...snapshot,
      journeyStage:
        requestCartProductIds.length > 0 ||
        requestCartVariantIds.length > 0 ||
        requestCartItemCount > 0
          ? "buying"
          : snapshot.journeyStage,
      cartProductIds: requestCartProductIds,
      context: {
        ...snapshot.context,
        cartVariantIds: requestCartVariantIds,
        cartItemCount: requestCartItemCount,
        cartValue:
          typeof body.cartValue === "number"
            ? body.cartValue
            : (snapshot.context as Record<string, unknown>).cartValue,
      },
    };
    const entitlement = await getEntitlements(shop);
    const plan = limitsFor(entitlement);
    if (plan.monthlyDisplays !== null) {
      if (settings.analyticsEnabled === false)
        return json(
          { ...noCartOffer("plan_usage_requires_analytics"), measurement },
          { headers: withCors() },
        );
      const usage = await getUsage(shop);
      if (
        !usage.available ||
        usage.displayed + usage.pending >= plan.monthlyDisplays
      )
        return json(
          { ...noCartOffer("plan_display_allowance"), measurement },
          { headers: withCors() },
        );
    }
    if (!cartUpsellTrigger && !plan.features.advancedPlacements)
      return json(
        { ...noCartOffer("plan_advanced_placements"), measurement },
        { headers: withCors() },
      );
    if (cartUpsellTrigger) {
      const decision = await buildCartRecommendation({
        shop,
        session: decisionSession,
        settings,
        signal: request.signal,
        sourceProductId: triggerProductId || requestCartProductIds[0],
        sourceVariantId: String(
          body.triggerPayload?.variantId || requestCartVariantIds[0] || "",
        ),
        cartProductIds: requestCartProductIds,
        cartVariantIds: requestCartVariantIds,
        cartItems: (body.cartItems || []).slice(0, 100),
        cartItemCount: requestCartItemCount,
        mutationId: String(body.triggerPayload?.mutationId || "").slice(0, 100),
        confirmed:
          body.triggerPayload?.confirmed === true &&
          body.triggerPayload?.recommendationOrigin !== true,
        currency: String(body.currency || "").slice(0, 3),
        market: String(body.market || "").slice(0, 80),
        dismissedWidgets: body.dismissedWidgets || [],
      });
      if (!decision.widgetType) return json(decision, { headers: withCors() });
      const offer = await createOfferRecord({
        shop,
        sessionId: session.id,
        decision,
        triggerContext: {
          trigger: "cart_item_added",
          mutationId: body.triggerPayload?.mutationId,
          currentProductId: triggerProductId,
          cartProductIds: requestCartProductIds,
          cartVariantIds: requestCartVariantIds,
          cartItems: body.cartItems || [],
          cartValue: body.cartValue,
        },
      });
      if (!offer || !(await reserveOfferDisplay(shop, offer.id, entitlement)))
        return json(
          { ...noCartOffer("plan_display_allowance"), measurement },
          { headers: withCors() },
        );
      return json(
        {
          ...decision,
          measurement,
          payload: { ...decision.payload, offerId: offer?.id },
        },
        { headers: withCors() },
      );
    }
    if (
      body.trigger === "cart_restored" ||
      settings.focusedMode ||
      (body.currentPageType === "cart" &&
        ["initial", "navigation", "poll"].includes(body.trigger || "initial"))
    )
      return json(noCartOffer("cart_waits_for_confirmed_add"), {
        headers: withCors(),
      });
    const proactiveTrigger = isProactiveChatTrigger(body);
    const sessionContext = asRecord(snapshot.context);
    const proactiveDecision = proactiveTrigger
      ? evaluateProactiveMessage({
          triggerType: body.trigger || "manual",
          pageType: normalizePageType(body.currentPageType),
          dwellSeconds: Number(
            body.triggerPayload?.dwellSeconds || snapshot.sessionDuration || 0,
          ),
          scrollDepth: Number(
            body.triggerPayload?.depth || sessionContext.maxScrollDepth || 0,
          ),
          intentScore: snapshot.intentScore,
          hesitationScore: snapshot.hesitationScore,
          salesState: normalizeSalesState(snapshot.salesState),
          promptCount: Number(sessionContext.proactivePromptCount || 0),
          dismissed: (body.dismissedWidgets || []).includes("chat"),
          lastPromptAt: parsePromptTimestamp(
            sessionContext.lastProactivePromptAt,
          ),
          settings: toMerchantSalesSettings(settings),
        })
      : null;
    if (proactiveDecision && !proactiveDecision.allowed) {
      return json(
        {
          widgetType: null,
          payload: {},
          reasoning: `proactive_${proactiveDecision.reason}`,
          confidence: 0,
        },
        { headers: withCors() },
      );
    }

    const sourceProductId =
      triggerProductId ||
      body.currentProductId ||
      requestCartProductIds[0] ||
      snapshot.viewedProductIds.at(-1);
    const candidates = proactiveDecision
      ? []
      : await buildOfferCandidates({
          shop,
          session: decisionSession,
          currentProductId: body.currentProductId,
          sourceProductId,
          excludeProductIds: settings.blockedProductIds,
          settings,
        });
    // Never reuse proactive decisions; product decisions must still match today's
    // approved selection and exclusions, not only the cached catalog IDs.
    if (
      cached &&
      !proactiveTrigger &&
      cached.widgetType !== "chat" &&
      cached.widgetType !== "upsell_drawer" &&
      cached.widgetType &&
      !cached.payload.abVariant &&
      cachedProductsMatchCandidates(cached, candidates) &&
      !(body.dismissedWidgets || []).includes(cached.widgetType) &&
      !["CHECKOUT", "PURCHASED"].includes(snapshot.salesState) &&
      (cached.widgetType !== "upsell" || settings.upsellEnabled) &&
      (!["rec_strip", "social_proof"].includes(cached.widgetType) ||
        settings.upsellEnabled) &&
      (cached.widgetType !== "bundle" || settings.bundlesEnabled)
    ) {
      const safeCached = await enforcePairingDecisionPolicy({
        shop,
        decision: cached,
        sourceProductId,
        cartProductIds: requestCartProductIds,
        settings,
      });
      if (safeCached.widgetType) {
        const offer = await createOfferRecord({
          shop,
          sessionId: session.id,
          decision: safeCached,
          triggerContext: {
            trigger: body.trigger,
            sourceProductId,
            currentProductId: body.currentProductId,
            cartProductIds: requestCartProductIds,
            cartVariantIds: requestCartVariantIds,
          },
        });
        if (!offer || !(await reserveOfferDisplay(shop, offer.id, entitlement)))
          return json(
            { ...noCartOffer("plan_display_allowance"), measurement },
            { headers: withCors() },
          );
        return json(
          {
            ...safeCached,
            payload: { ...safeCached.payload, offerId: offer.id },
            measurement,
          },
          { headers: withCors() },
        );
      }
    }

    const rawDecision: OfferDecision = proactiveDecision
      ? {
          widgetType: "chat",
          payload: {
            triggerType: body.trigger,
            proactive: true,
            greeting: getProactiveMessage(proactiveDecision.messageType),
            copy: {
              greeting: getProactiveMessage(proactiveDecision.messageType),
              ctaAccept: "Let me help",
              ctaDecline: "Not now",
            },
          },
          reasoning: `proactive_${proactiveDecision.messageType}`,
          confidence: proactiveDecision.confidence,
          aiProvider: "heuristic",
        }
      : await getOfferDecision({
          shop,
          signal: request.signal,
          session: decisionSession,
          currentProductId: body.currentProductId,
          currentPageType: normalizePageType(body.currentPageType),
          cartProductIds: requestCartProductIds,
          cartVariantIds: requestCartVariantIds,
          cartItemCount: requestCartItemCount,
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
              cartVariantIds: requestCartVariantIds,
              cartItemCount: requestCartItemCount,
              cartItems: body.cartItems || [],
            },
          },
        });
    if (rawDecision.widgetType === "upsell_drawer")
      return json(noCartOffer("cart_waits_for_confirmed_add"), {
        headers: withCors(),
      });
    if (
      rawDecision.widgetType === "chat" &&
      !proactiveDecision &&
      body.trigger !== "manual"
    ) {
      return json(
        {
          widgetType: null,
          payload: {},
          reasoning: "proactive_not_eligible",
          confidence: 0,
        },
        { headers: withCors() },
      );
    }
    if (proactiveDecision) {
      const reserved = await reserveProactiveMessage(
        shop,
        session.id,
        toMerchantSalesSettings(settings),
        proactiveDecision.messageType,
      );
      if (!reserved)
        return json(
          {
            widgetType: null,
            payload: {},
            reasoning: "proactive_reservation_denied",
            confidence: 0,
          },
          { headers: withCors() },
        );
    }
    const catalogGuardedDecision = await enforcePairingDecisionPolicy({
      shop,
      decision: rawDecision,
      sourceProductId,
      cartProductIds: requestCartProductIds,
      settings,
    });
    const experimentAssignment = catalogGuardedDecision.widgetType
      ? await getCachedExperimentAssignment(
          shop,
          catalogGuardedDecision.widgetType,
          sessionId,
        )
      : null;
    const decision = experimentAssignment
      ? applyExperimentConfig({
          decision: catalogGuardedDecision,
          config:
            experimentAssignment.variant === "treatment"
              ? experimentAssignment.experiment.treatmentConfig
              : experimentAssignment.experiment.controlConfig,
          experimentId: experimentAssignment.experiment.id,
          variant: experimentAssignment.variant,
        })
      : catalogGuardedDecision;
    const abVariant = experimentAssignment?.variant || null;

    const offer = await createOfferRecord({
      shop,
      sessionId: session.id,
      decision,
      triggerContext: {
        trigger: body.trigger,
        triggerCategory: body.triggerCategory,
        triggerPayload: body.triggerPayload || {},
        sourceProductId,
        currentProductId: body.currentProductId,
        currentPageType: body.currentPageType,
        cartProductIds: requestCartProductIds,
        cartVariantIds: requestCartVariantIds,
        cartItems: body.cartItems || [],
        cartItemCount: requestCartItemCount,
        cartValue: body.cartValue,
        session: decisionSession,
      },
      abVariant,
      experimentId: experimentAssignment?.experiment.id,
    });

    const response: OfferDecision = {
      ...decision,
      payload: {
        ...decision.payload,
        offerId: offer?.id,
        abVariant,
      },
    };

    if (
      decision.widgetType &&
      (!offer || !(await reserveOfferDisplay(shop, offer.id, entitlement)))
    )
      return json(
        { ...noCartOffer("plan_display_allowance"), measurement },
        { headers: withCors() },
      );

    await setJsonCache(cacheKey, response, 30);
    return json({ ...response, measurement }, { headers: withCors() });
  } catch (error) {
    if (isStorefrontAuthError(error)) {
      const storefrontSession = await getStorefrontSessionRecovery(request);
      logStorefrontAuthError(request, "api.offer", error);
      return json(
        {
          widgetType: null,
          payload: {},
          reasoning: "unauthorized",
          confidence: 0,
          reauth: Boolean(storefrontSession),
          storefrontSession,
        },
        {
          status: error.status,
          headers: withCors(
            storefrontSession ? { "X-AOVBoost-Reauth": "true" } : undefined,
          ),
        },
      );
    }

    console.error("AOVBoost offer route failed:", getErrorMessage(error));
    return json(
      {
        widgetType: null,
        payload: {},
        reasoning: "failed_closed",
        confidence: 0,
      },
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

function isProactiveChatTrigger(body: OfferBody) {
  if (body.trigger === "manual") return false;
  if (body.triggerPayload?.widgetHint === "chat") return true;
  return [
    "long_product_dwell",
    "collection_dwell",
    "repeated_product_view",
    "scroll_depth_interest",
    "comparison_page_visit",
    "inactivity_timeout",
    "purchase_history_match",
    "returning_shopper",
    "crm_segment_update",
  ].includes(String(body.trigger || ""));
}

function parsePromptTimestamp(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp : null;
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

async function resolveCartProductIds(shop: string, body: OfferBody) {
  const directProductIds = uniqueStrings([
    ...toStringArray(body.cartProductIds),
    ...extractCartItemProductIds(body.cartItems),
  ]);
  if (directProductIds.length > 0) return directProductIds;

  const cartVariantIds = uniqueStrings([
    ...toStringArray(body.cartVariantIds),
    ...extractCartItemVariantIds(body.cartItems),
  ]);
  if (cartVariantIds.length === 0) return [];

  return findProductIdsByVariants(shop, cartVariantIds);
}

function extractCartItemProductIds(items: OfferBody["cartItems"]) {
  if (!Array.isArray(items)) return [];
  return items
    .map(
      (item) =>
        item.productId ||
        item.product_id ||
        item.productGid ||
        item.product_gid,
    )
    .map(String)
    .filter(Boolean);
}

function extractCartItemVariantIds(items: OfferBody["cartItems"]) {
  if (!Array.isArray(items)) return [];
  return items
    .map(
      (item) =>
        item.variantId ||
        item.variant_id ||
        item.variantGid ||
        item.variant_gid,
    )
    .map(String)
    .filter(Boolean);
}

function toStringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function toProductGid(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return "";
  const id = text.split("?")[0].split("/").filter(Boolean).pop() || text;
  return text.startsWith("gid://shopify/Product/")
    ? text
    : `gid://shopify/Product/${id}`;
}

function uniqueStrings(values: unknown[]) {
  return Array.from(
    new Set(
      values
        .map(String)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function getCachedAppSettings(shop: string): Promise<AppSettings> {
  const key = `settings:${shop}`;
  const cached = await getJsonCache<AppSettings>(key);
  if (cached) return cached;

  const settings = await prisma.appSettings.upsert({
    where: { shop },
    update: {},
    create: { shop, pairingMode: "autopilot" },
  });
  await setJsonCache(key, settings, 3600); // Cache 1 hour
  return settings;
}

async function getCachedExperimentAssignment(
  shop: string,
  widgetType: string,
  sessionId: string,
) {
  const key = cacheKeys.experiment(shop, widgetType);
  const experiment = await getJsonCache<Experiment>(key);

  const exp =
    experiment ||
    (await prisma.experiment.findFirst({
      where: { shop, isActive: true, widgetType },
      orderBy: { startedAt: "desc" },
    }));

  if (!exp) return null;

  if (!experiment) {
    await setJsonCache(key, exp, 600); // Cache 10 minutes
  }

  const bucket = hash(sessionId + exp.id) / 100;
  const variant: ExperimentVariant =
    bucket < exp.trafficSplit ? "treatment" : "control";
  return { experiment: exp, variant };
}
