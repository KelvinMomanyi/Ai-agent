import { callAi, getLastAiProvider, parseAiJson, type AiProvider } from "./client.server";
import { generateWidgetCopy } from "./copyWriter.server";
import { DECISION_ENGINE_SYSTEM } from "./prompts";
import type { DecisionInput, OfferDecision } from "./types";
import { getActiveBundlesForProduct } from "../models/bundle.server";
import { getTopAffinitiesOrFallback } from "../models/product.server";

const WIDGET_TYPES = new Set([
  "chat",
  "toast",
  "countdown_banner",
  "inline_alert",
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
  const recommendationSourceProductId =
    input.currentProductId ||
    input.cartProductIds[0] ||
    input.session.viewedProductIds.at(-1);
  const [affinities, bundles] = await Promise.all([
    getTopAffinitiesOrFallback({
      shop: input.shop,
      productId: recommendationSourceProductId,
      limit: 5,
      excludeProductIds: input.cartProductIds,
    }),
    getActiveBundlesForProduct(input.shop, input.currentProductId),
  ]);

  const context = {
    shop: input.shop,
    session: input.session,
    currentProductId: input.currentProductId,
    currentPageType: input.currentPageType,
    trigger: input.trigger,
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
        "chat|toast|countdown_banner|inline_alert|bundle|upsell_drawer|discount_nudge|rec_strip|social_proof|exit_intent|post_purchase|null",
      payload: "object",
      reasoning: "string",
      confidence: "number 0-1",
    },
  };

  const fallbackDecision = heuristicFallback(input, bundles.length);
  const hasNamedTrigger = Boolean(input.trigger?.type && input.trigger.type !== "manual");
  let decision = fallbackDecision;

  if (!hasNamedTrigger || !fallbackDecision.widgetType) {
    const raw = await callAi(DECISION_ENGINE_SYSTEM, JSON.stringify(context));
    const parsed = normalizeDecision(
      parseAiJson<Partial<OfferDecision>>(raw),
      getLastAiProvider() === "none" ? "heuristic" : (getLastAiProvider() as Exclude<AiProvider, "none">),
    );
    decision = parsed ?? fallbackDecision;
  }

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
    triggerType: input.trigger?.type,
    triggerPayload: input.trigger?.payload || {},
  });
  if (!enrichedPayload) {
    return noOffer(
      "No existing store products were available for the selected widget.",
      decision.aiProvider,
    );
  }

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
  provider: "gemini" | "groq" | "mistral" | "deepseek" | "heuristic",
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
  const triggerType = input.trigger?.type || String(context.lastEventType || "");
  const triggerPayload = input.trigger?.payload || {};
  const cartValue = Number(
    triggerPayload.cartValue || context.cartValue || context.cartTotal || 0,
  );
  const threshold = Number(input.settings.discountThreshold || 0);

  if (triggerType === "exit_intent" && input.settings.exitIntentEnabled) {
    return {
      widgetType: "exit_intent",
      payload: {
        immediate: true,
        offerLine: "Before you go, I can help find a better match or bundle.",
      },
      reasoning: "Exit intent should use the one-per-session modal.",
      confidence: 0.74,
      aiProvider: "heuristic",
    };
  }

  if (triggerType === "flash_sale_window" || triggerType === "seasonal_calendar") {
    return {
      widgetType: "countdown_banner",
      payload: {
        endsAt: triggerPayload.endsAt,
        body: "Relevant bundles and add-ons are available during this campaign.",
      },
      reasoning: "Scheduled urgency is best shown as a persistent countdown banner.",
      confidence: 0.68,
      aiProvider: "heuristic",
    };
  }

  if (triggerType === "low_inventory_alert" || triggerType === "price_drop_webhook") {
    return {
      widgetType: "inline_alert",
      payload: {
        body:
          triggerType === "price_drop_webhook"
            ? "The price on this product has changed."
            : "Inventory is limited for this product.",
      },
      reasoning: "System facts should be shown inline near the product context.",
      confidence: 0.66,
      aiProvider: "heuristic",
    };
  }

  if (triggerType === "post_purchase_window" && input.settings.postPurchaseEnabled) {
    return {
      widgetType: "post_purchase",
      payload: {},
      reasoning: "Thank-you page session is eligible for a post-purchase add-on.",
      confidence: 0.65,
      aiProvider: "heuristic",
    };
  }

  if (
    input.settings.upsellEnabled &&
    input.cartProductIds.length > 0 &&
    !isRecoveryOrThresholdTrigger(triggerType) &&
    (triggerType === "cart_item_added" ||
      triggerType === "checkout_started" ||
      triggerType === "add_to_cart" ||
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
    input.settings.discountNudgeEnabled &&
    (triggerType === "coupon_field_focus" ||
      triggerType === "price_hesitation" ||
      triggerType === "cart_abandoned" ||
      triggerType === "cart_value_threshold" ||
      triggerType === "payment_failure") &&
    (triggerType !== "cart_value_threshold" ||
      (threshold > 0 && cartValue >= threshold * 0.8 && cartValue < threshold))
  ) {
    return {
      widgetType:
        triggerType === "cart_abandoned" || triggerType === "cart_value_threshold"
          ? "discount_nudge"
          : "toast",
      payload: {
        cartValue,
        threshold: threshold.toString(),
        headline:
          triggerType === "coupon_field_focus"
            ? "Looking for a code?"
            : "Need a better fit?",
        body:
          triggerType === "cart_abandoned"
            ? "You are close to a useful offer for this cart."
            : "I can help find an offer or a lower-priced alternative.",
      },
      reasoning: "Price-sensitive or recovery signal should receive a low-disruption nudge.",
      confidence: 0.63,
      aiProvider: "heuristic",
    };
  }

  if (triggerType === "wishlist_save" || triggerType === "subscription_renewal_due") {
    return {
      widgetType: "toast",
      payload: {
        headline: "Saved for later",
        body: "I can help compare this with related products when you are ready.",
      },
      reasoning: "Saved-item intent should use an ephemeral toast.",
      confidence: 0.58,
      aiProvider: "heuristic",
    };
  }

  if (
    input.currentPageType === "product" &&
    input.settings.bundlesEnabled &&
    activeBundleCount > 0 &&
    (triggerType === "repeated_product_view" || triggerType === "manual" || !triggerType)
  ) {
    return {
      widgetType: "bundle",
      payload: { currentProductId: input.currentProductId },
      reasoning: "Product page has an active triggered bundle.",
      confidence: 0.72,
      aiProvider: "heuristic",
    };
  }

  if (
    (triggerType === "search_query" ||
      triggerType === "cart_item_removed" ||
      triggerType === "repeated_product_view") &&
    input.candidates.length > 0
  ) {
    return {
      widgetType: "rec_strip",
      payload: {},
      reasoning: "Search, remove, or repeated-view intent is suited to related products.",
      confidence: 0.61,
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
    input.settings.chatEnabled &&
    (triggerType === "long_product_dwell" ||
      triggerType === "scroll_depth_interest" ||
      triggerType === "comparison_page_visit" ||
      triggerType === "first_time_visitor" ||
      triggerType === "crm_segment_update" ||
      triggerType === "purchase_history_match" ||
      triggerType === "loyalty_tier_reached" ||
      triggerType === "inactivity_timeout")
  ) {
    return {
      widgetType: "chat",
      payload: { greeting: input.settings.chatGreeting },
      reasoning: "High-intent browsing/profile signal is best handled by proactive chat.",
      confidence: 0.62,
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

function isRecoveryOrThresholdTrigger(triggerType: string) {
  return [
    "coupon_field_focus",
    "price_hesitation",
    "cart_abandoned",
    "cart_value_threshold",
    "payment_failure",
  ].includes(triggerType);
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
    triggerType?: string;
    triggerPayload: Record<string, unknown>;
  },
) {
  if (widgetType === "bundle") {
    const bundle = context.bundles[0] as Record<string, unknown> | undefined;
    if (!bundle) return null;

    const products = getProductsFromBundle(bundle);
    if (products.length === 0) return null;

    return {
      ...omitUnsafeProductPayload(payload),
      bundle,
      bundles: context.bundles,
      products,
      currentProductId: context.currentProductId,
    };
  }

  if (
    (widgetType === "upsell_drawer" ||
      widgetType === "post_purchase" ||
      widgetType === "rec_strip" ||
      widgetType === "social_proof")
  ) {
    const products = getProductsFromAffinities(context.affinities);
    if (products.length === 0) return null;

    return {
      ...omitUnsafeProductPayload(payload),
      products: widgetType === "post_purchase" ? products.slice(0, 1) : products,
      cartProductIds: context.cartProductIds,
    };
  }

  if (widgetType === "discount_nudge") {
    return {
      ...payload,
      threshold: payload.threshold || context.discountThreshold,
      cartValue:
        payload.cartValue ||
        (typeof context.triggerPayload.cartValue === "number"
          ? context.triggerPayload.cartValue
          : undefined),
    };
  }

  if (widgetType === "exit_intent") {
    return {
      ...payload,
      immediate: payload.immediate || context.triggerPayload.immediate,
    };
  }

  if (widgetType === "countdown_banner") {
    return {
      ...payload,
      endsAt: payload.endsAt || context.triggerPayload.endsAt,
    };
  }

  return payload;
}

function getProductsFromBundle(bundle: Record<string, unknown>) {
  const items = Array.isArray(bundle.items) ? bundle.items : [];

  return items
    .map((item) => {
      const record = item as Record<string, unknown>;
      const product = asRecord(record.product);
      if (!product.id || !product.title) return null;

      return {
        product,
        productId: String(record.productId || product.id),
        quantity: Number(record.quantity || 1),
      };
    })
    .filter(Boolean);
}

function getProductsFromAffinities(affinities: unknown[]) {
  return affinities
    .filter((affinity) => {
      const record = asRecord(affinity);
      const target = asRecord(record.target);
      return Boolean(record.targetId && target.id && target.title);
    })
    .map((affinity) => affinity as Record<string, unknown>);
}

function omitUnsafeProductPayload(payload: Record<string, unknown>) {
  const {
    bundle: _bundle,
    bundles: _bundles,
    items: _items,
    product: _product,
    products: _products,
    ...rest
  } = payload;

  return rest;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function noOffer(
  reasoning: string,
  aiProvider: "gemini" | "groq" | "mistral" | "deepseek" | "heuristic",
): OfferDecision {
  return {
    widgetType: null,
    payload: {},
    reasoning,
    confidence: 0,
    aiProvider,
  };
}
