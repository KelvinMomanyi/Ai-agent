import { callAi, getLastAiProvider, parseAiJson } from "./client.server";
import { generateWidgetCopy } from "./copyWriter.server";
import { DECISION_ENGINE_SYSTEM } from "./prompts";
import type { DecisionInput, OfferDecision } from "./types";
import { getActiveBundlesForProduct } from "../models/bundle.server";
import { getTopAffinities } from "../models/product.server";

const WIDGET_TYPES = new Set([
  "chat",
  "bundle",
  "upsell_drawer",
  "discount_nudge",
  "rec_strip",
  "social_proof",
  "exit_intent",
  "post_purchase",
]);

export async function getOfferDecision(
  input: DecisionInput,
): Promise<OfferDecision> {
  const [affinities, bundles] = await Promise.all([
    input.currentProductId
      ? getTopAffinities(input.shop, input.currentProductId, 5)
      : Promise.resolve([]),
    getActiveBundlesForProduct(input.shop, input.currentProductId),
  ]);

  const context = {
    shop: input.shop,
    session: input.session,
    currentProductId: input.currentProductId,
    currentPageType: input.currentPageType,
    cartProductIds: input.cartProductIds,
    recentlyDismissedWidgets: input.recentlyDismissedWidgets,
    settings: {
      chatEnabled: input.settings.chatEnabled,
      chatGreeting: input.settings.chatGreeting,
      bundlesEnabled: input.settings.bundlesEnabled,
      upsellEnabled: input.settings.upsellEnabled,
      discountNudgeEnabled: input.settings.discountNudgeEnabled,
      discountThreshold: input.settings.discountThreshold.toString(),
      exitIntentEnabled: input.settings.exitIntentEnabled,
      postPurchaseEnabled: input.settings.postPurchaseEnabled,
      aiTone: input.settings.aiTone,
      brandVoice: input.settings.brandVoice,
      blockedProductIds: input.settings.blockedProductIds,
    },
    candidates: input.candidates,
    affinityProducts: affinities,
    activeBundles: bundles,
    responseSchema: {
      widgetType:
        "chat|bundle|upsell_drawer|discount_nudge|rec_strip|social_proof|exit_intent|post_purchase|null",
      payload: "object",
      reasoning: "string",
      confidence: "number 0-1",
    },
  };

  const raw = await callAi(DECISION_ENGINE_SYSTEM, JSON.stringify(context));
  const parsed = normalizeDecision(
    parseAiJson<Partial<OfferDecision>>(raw),
    getLastAiProvider() === "none" ? "heuristic" : getLastAiProvider(),
  );
  const decision = parsed ?? heuristicFallback(input, bundles.length);

  if (!decision.widgetType) return noOffer(decision.reasoning, decision.aiProvider);
  if (input.recentlyDismissedWidgets.includes(decision.widgetType)) {
    return noOffer("Widget was recently dismissed.", decision.aiProvider);
  }

  const enrichedPayload = enrichPayload(decision.widgetType, decision.payload, {
    bundles,
    affinities,
    currentProductId: input.currentProductId,
    cartProductIds: input.cartProductIds,
    discountThreshold: input.settings.discountThreshold.toString(),
  });
  const copy = await generateWidgetCopy(
    decision.widgetType,
    {
      currentProductId: input.currentProductId,
      currentPageType: input.currentPageType,
      affinities,
    },
    enrichedPayload,
    input.settings,
  );

  return {
    ...decision,
    payload: {
      ...enrichedPayload,
      copy,
    },
  };
}

function normalizeDecision(
  parsed: Partial<OfferDecision> | null,
  provider: "gemini" | "groq" | "heuristic",
): OfferDecision | null {
  if (!parsed) return null;

  const widgetType =
    parsed.widgetType === null
      ? null
      : typeof parsed.widgetType === "string" && WIDGET_TYPES.has(parsed.widgetType)
        ? parsed.widgetType
        : undefined;

  if (widgetType === undefined) return null;

  return {
    widgetType,
    payload:
      parsed.payload && typeof parsed.payload === "object" && !Array.isArray(parsed.payload)
        ? parsed.payload
        : {},
    reasoning:
      typeof parsed.reasoning === "string" && parsed.reasoning.trim()
        ? parsed.reasoning
        : widgetType
          ? "AI selected a contextual widget."
          : "AI selected no widget.",
    confidence:
      typeof parsed.confidence === "number"
        ? Math.min(Math.max(parsed.confidence, 0), 1)
        : widgetType
          ? 0.5
          : 0,
    aiProvider: provider,
  };
}

function heuristicFallback(
  input: DecisionInput,
  activeBundleCount: number,
): OfferDecision {
  const context = input.session.context || {};
  const lastEventType = String(context.lastEventType || "");
  const cartValue = Number(context.cartValue || context.cartTotal || 0);
  const threshold = Number(input.settings.discountThreshold || 0);

  if (
    input.settings.upsellEnabled &&
    input.cartProductIds.length > 0 &&
    (lastEventType === "add_to_cart" ||
      input.session.journeyStage === "buying" ||
      input.currentPageType === "cart")
  ) {
    return {
      widgetType: "upsell_drawer",
      payload: { cartProductIds: input.cartProductIds },
      reasoning: "Add-to-cart or buying-stage session is eligible for an upsell.",
      confidence: 0.64,
      aiProvider: "heuristic",
    };
  }

  if (
    input.currentPageType === "product" &&
    input.settings.bundlesEnabled &&
    activeBundleCount > 0
  ) {
    return {
      widgetType: "bundle",
      payload: { currentProductId: input.currentProductId },
      reasoning: "Product page has an active triggered bundle.",
      confidence: 0.72,
      aiProvider: "heuristic",
    };
  }

  if (input.settings.chatEnabled && input.session.hesitationScore > 60) {
    return {
      widgetType: "chat",
      payload: { greeting: input.settings.chatGreeting },
      reasoning: "High hesitation score can be helped by chat.",
      confidence: 0.6,
      aiProvider: "heuristic",
    };
  }

  if (
    input.settings.discountNudgeEnabled &&
    threshold > 0 &&
    cartValue >= threshold * 0.8 &&
    cartValue < threshold
  ) {
    return {
      widgetType: "discount_nudge",
      payload: { threshold: threshold.toString(), cartValue },
      reasoning: "Cart value is within 20% of the configured discount threshold.",
      confidence: 0.55,
      aiProvider: "heuristic",
    };
  }

  return noOffer("No deterministic intervention matched.", "heuristic");
}

function enrichPayload(
  widgetType: string,
  payload: Record<string, unknown>,
  context: {
    bundles: unknown[];
    affinities: unknown[];
    currentProductId?: string;
    cartProductIds: string[];
    discountThreshold: string;
  },
) {
  if (widgetType === "bundle" && !payload.bundle && context.bundles.length > 0) {
    return { ...payload, bundle: context.bundles[0], bundles: context.bundles };
  }

  if (
    (widgetType === "upsell_drawer" ||
      widgetType === "rec_strip" ||
      widgetType === "social_proof") &&
    !payload.products
  ) {
    return { ...payload, products: context.affinities, cartProductIds: context.cartProductIds };
  }

  if (widgetType === "discount_nudge" && !payload.threshold) {
    return { ...payload, threshold: context.discountThreshold };
  }

  return payload;
}

function noOffer(
  reasoning: string,
  aiProvider: "gemini" | "groq" | "heuristic",
): OfferDecision {
  return {
    widgetType: null,
    payload: {},
    reasoning,
    confidence: 0,
    aiProvider,
  };
}
