import { callAI, parseAiJson, type AiGatewayRequest, type AiProvider } from "./client.server";
import { generateWidgetCopy } from "./copyWriter.server";
import { DECISION_ENGINE_SYSTEM } from "./prompts";
import type { DecisionInput, OfferDecision } from "./types";
import { getActiveBundlesForProduct } from "../models/bundle.server";
import { catalogProductToWidgetProduct } from "../models/catalogGuard.server";
import {
  getRecommendationCatalog,
  pickCatalogProducts,
  type CatalogCacheProduct,
} from "../models/catalogCache.server";

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
  const [catalog, bundles] = await Promise.all([
    getRecommendationCatalog({
      shop: input.shop,
      sourceProductId: recommendationSourceProductId,
    }),
    getActiveBundlesForProduct(input.shop, input.currentProductId, {
      excludeProductIds: input.settings.blockedProductIds,
    }),
  ]);
  const promptCatalogProducts = pickCatalogProducts({
    catalog,
    sourceProductId: recommendationSourceProductId,
    cartProductIds: input.cartProductIds,
    excludeProductIds: input.settings.blockedProductIds,
    query: getTriggerQuery(input.trigger?.payload),
    limit: 35,
  });
  const affinities = promptCatalogProducts
    .slice(0, 5)
    .map((product, index) =>
      catalogProductToAffinity(product, index, catalog.byId[recommendationSourceProductId || ""]),
    );

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
    catalogContext: {
      refreshedAt: catalog.refreshedAt,
      productCount: catalog.productCount,
      candidates: promptCatalogProducts.map(toPromptCatalogProduct),
    },
    responseSchema: {
      widgetType:
        "chat|toast|countdown_banner|inline_alert|bundle|upsell_drawer|discount_nudge|rec_strip|social_proof|exit_intent|post_purchase|null",
      payload: "object",
      reasoning: "string",
      confidence: "number 0-1",
    },
  };

  const fallbackDecision = heuristicFallback(input, bundles.length);
  let decision = fallbackDecision;

  if (shouldAskAi(input.trigger?.type, fallbackDecision)) {
    const aiResult = await callAI({
      triggerName: input.trigger?.type || "manual",
      systemPrompt: `${DECISION_ENGINE_SYSTEM}\n${getTriggerPromptGuidance(input.trigger?.type)}`,
      userPrompt: JSON.stringify(context),
      schemaType: "json",
      maxTokens: getDecisionMaxTokens(input.trigger?.type),
      timeoutProfile: getTimeoutProfile(input.trigger?.type),
      fallback: JSON.stringify(fallbackDecision),
    });
    const parsed = normalizeDecision(
      parseAiJson<Partial<OfferDecision>>(aiResult.content),
      toDecisionProvider(aiResult.provider),
    );
    decision = parsed ?? fallbackDecision;

    console.log("AOVBoost trigger decision:", {
      triggerName: input.trigger?.type || "manual",
      provider: aiResult.provider,
      executionMs: aiResult.executionMs,
      fallbackUsed: aiResult.fallbackUsed,
      outputFields: Object.keys(decision.payload || {}),
      widgetType: decision.widgetType,
    });
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

function shouldAskAi(_triggerType: string | undefined, _fallbackDecision: OfferDecision) {
  return process.env.AOVBOOST_DISABLE_AI !== "true";
}

function toDecisionProvider(
  provider: AiProvider,
): "gemini" | "groq" | "mistral" | "deepseek" | "heuristic" {
  return provider === "none" ? "heuristic" : provider;
}

function getTimeoutProfile(
  triggerType?: string,
): NonNullable<AiGatewayRequest["timeoutProfile"]> {
  if (
    triggerType === "exit_intent" ||
    triggerType === "flash_sale_window" ||
    triggerType === "seasonal_calendar" ||
    triggerType === "payment_failure"
  ) {
    return "urgent";
  }

  if (
    triggerType === "post_purchase_window" ||
    triggerType === "subscription_renewal_due" ||
    triggerType === "crm_segment_update"
  ) {
    return "relaxed";
  }

  return "normal";
}

function getDecisionMaxTokens(triggerType?: string) {
  if (triggerType === "cart_item_added" || triggerType === "add_to_cart") return 300;
  if (triggerType === "exit_intent") return 220;
  if (triggerType === "price_hesitation" || triggerType === "chat_intent") return 220;
  if (triggerType === "flash_sale_window" || triggerType === "seasonal_calendar") return 180;
  if (triggerType === "loyalty_tier_reached" || triggerType === "purchase_history_match") return 260;
  return 220;
}

function getTriggerPromptGuidance(triggerType?: string) {
  switch (triggerType) {
    case "cart_item_added":
    case "add_to_cart":
      return `
Trigger guidance: the shopper just added an item to cart. Prefer upsell_drawer with
complementary products chosen only from catalogContext.candidates. Do not invent
products, variants, discount codes, prices, inventory, reviews, or urgency.`;
    case "exit_intent":
      return `
Trigger guidance: the shopper is leaving. Prefer exit_intent only when the cart or
session context justifies it. Keep the payload headline-focused and cart-specific.
Do not invent discount codes; use null or general offer wording unless a real code is provided.`;
    case "price_hesitation":
    case "coupon_field_focus":
    case "chat_intent":
      return `
Trigger guidance: price sensitivity may be present. Prefer toast or discount_nudge.
Suggest lower-priced catalog products from catalogContext.candidates and never create
fake promo codes.`;
    case "flash_sale_window":
    case "seasonal_calendar":
      return `
Trigger guidance: scheduled urgency should use countdown_banner. Keep copy punchy,
with fields under 12 words where possible, and pick catalog-backed add-ons only.`;
    case "loyalty_tier_reached":
    case "purchase_history_match":
    case "first_time_visitor":
      return `
Trigger guidance: personalization should feel like helpful chat, not a generic pop-up.
Prefer chat with a concise personalized greeting, using catalog-backed products only.`;
    default:
      return "";
  }
}

function catalogProductToAffinity(
  product: CatalogCacheProduct,
  index: number,
  source?: CatalogCacheProduct,
) {
  const sharedTags = source
    ? product.tags.filter((tag) => source.tags.includes(tag)).length
    : 0;
  const sameCategory = source && product.category === source.category ? 0.18 : 0;
  const score = Math.max(0.25, 0.82 + sameCategory + sharedTags * 0.03 - index * 0.05);

  return {
    targetId: product.id,
    target: product,
    score,
    reason: source
      ? `Catalog match for ${source.title}.`
      : "Catalog-backed recommendation.",
    orderCount: 0,
  };
}

function toPromptCatalogProduct(product: CatalogCacheProduct) {
  return {
    id: product.id,
    handle: product.handle,
    url: `/products/${product.handle}`,
    title: product.title,
    price: product.price,
    category: product.category,
    vendor: product.vendor,
    tags: product.tags.slice(0, 8),
    inventory: product.inventory,
    variantId: product.variants[0]?.id || "",
  };
}

function getTriggerQuery(payload?: Record<string, unknown>) {
  if (!payload) return "";
  return [
    payload.query,
    payload.searchQuery,
    payload.searchTerm,
    payload.message,
    payload.productTitle,
    payload.title,
    payload.category,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ");
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
      const safeProduct = catalogProductToWidgetProduct(product as any);

      return {
        ...record,
        product: safeProduct,
        productId: safeProduct.id,
        targetId: safeProduct.id,
        variantId: safeProduct.variantId,
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
    .map((affinity) => {
      const record = affinity as Record<string, unknown>;
      const target = asRecord(record.target);
      const safeProduct = catalogProductToWidgetProduct(target as any);
      return {
        ...record,
        target: safeProduct,
        product: safeProduct,
        targetId: safeProduct.id,
        productId: safeProduct.id,
        variantId: safeProduct.variantId,
      };
    });
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
