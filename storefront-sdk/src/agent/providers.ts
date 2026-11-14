import { AGENT_LIMITS as L } from "./constants";
import type { OfferDecision } from "../widgets/widgetManager";
import type { WidgetPayload } from "../widgets/BaseWidget";
import type { RecommendationService } from "./RecommendationService";
import { FACT_TYPES, type OfferFacts } from "./OfferFacts";
import type {
  AgentContext,
  OfferProvider,
  SignalName,
  SurfaceClass,
  WidgetBridge,
} from "./types";

export const WIDGET_PROVIDERS: Record<
  string,
  { id: string; surfaceClass: SurfaceClass; slot: string; score: number }
> = {
  chat: {
    id: "chat",
    surfaceClass: "conversational",
    slot: "assistant",
    score: 100,
  },
  toast: {
    id: "toast",
    surfaceClass: "interruptive",
    slot: "attention",
    score: 50,
  },
  countdown_banner: {
    id: "countdown",
    surfaceClass: "ambient",
    slot: "campaign",
    score: 30,
  },
  inline_alert: {
    id: "inline_alert",
    surfaceClass: "ambient",
    slot: "notice",
    score: 40,
  },
  bundle: {
    id: "bundle",
    surfaceClass: "ambient",
    slot: "merchandising",
    score: 60,
  },
  upsell_drawer: {
    id: "cart_upsell",
    surfaceClass: "contextual",
    slot: "cart",
    score: 90,
  },
  discount_nudge: {
    id: "discount_nudge",
    surfaceClass: "ambient",
    slot: "notice",
    score: 45,
  },
  rec_strip: {
    id: "rec_strip",
    surfaceClass: "ambient",
    slot: "merchandising",
    score: 50,
  },
  social_proof: {
    id: "social_proof",
    surfaceClass: "ambient",
    slot: "notice",
    score: 20,
  },
  exit_intent: {
    id: "exit_intent",
    surfaceClass: "interruptive",
    slot: "attention",
    score: 70,
  },
  post_purchase: {
    id: "post_purchase",
    surfaceClass: "ambient",
    slot: "post_purchase",
    score: 20,
  },
};
export type ProviderAdapter = OfferProvider & {
  update: (decision: OfferDecision, trigger: string) => void;
};
export function createProvider(
  type: string,
  bridge: WidgetBridge,
  enabled: (type: string) => boolean,
  hasMoment: (name: SignalName) => boolean,
  healthResult: (ok: boolean) => void,
  onClosed: () => void,
  recommendations?: RecommendationService,
  decorate?: (type: string, payload: WidgetPayload, ctx: AgentContext) => void,
  facts?: OfferFacts,
): ProviderAdapter {
  const definition = WIDGET_PROVIDERS[type];
  let decision: OfferDecision | undefined;
  let trigger = "";
  let receivedAt = 0;
  let mounting = false;
  let preparing: AbortController | undefined;
  let mountedDismissalKey = "";
  return {
    ...definition,
    attribution: () => ({
      offer_id: decision?.payload?.offerId,
      trigger_signal: trigger,
    }),
    signals: [
      "offer_ready",
      "page_view",
      "cart_add_confirmed",
      "price_hesitation",
      "exit_intent_desktop",
      "exit_intent_mobile",
      "chat_open",
      "checkout_start",
      "health_change",
    ],
    update(next, nextTrigger) {
      if (mounting) return;
      decision = next;
      trigger = nextTrigger;
      receivedAt = Date.now();
    },
    isEligible(ctx: AgentContext) {
      const deny = (reason: string) => ({ ok: false, reason });
      if (!decision) return deny("no_offer");
      if (
        mounting &&
        recommendations &&
        !recommendations.isSelectionCurrent(definition.id, ctx)
      )
        return deny("recommendations_already_present");
      if (!enabled(type)) return deny("merchant_disabled");
      if (
        type === "chat" &&
        ["checkout", "thankyou", "other"].includes(ctx.page.type)
      )
        return deny("protected_page");
      if (!mounting && Date.now() - receivedAt > L.OFFER_TTL_MS)
        return deny("stale_offer");
      const payload = decision.payload || {};
      if (facts && FACT_TYPES.includes(type)) {
        const result = facts.evaluate(type, payload, ctx);
        if (!result.ok) return deny(result.reason);
      }
      if (
        ["chat", "toast"].includes(type) &&
        ((!ctx.agent.aiHealthy &&
          !(
            type === "chat" &&
            bridge.agentExperience &&
            ctx.session.chatOpen
          )) ||
          !ctx.agent.chatEnabled)
      )
        return deny("assistant_unavailable");
      const shadowAssistant =
        ctx.agent.holdout &&
        bridge.agentExperience &&
        enabled("chat") &&
        !ctx.session.disabledProviders.includes("chat");
      if (
        type === "toast" &&
        !shadowAssistant &&
        !bridge.getProviderElement("chat")?.isConnected
      )
        return deny("assistant_not_mounted");
      if (type === "toast" && !hasMoment("price_hesitation"))
        return deny("price_hesitation_required");
      if (
        type === "upsell_drawer" &&
        (ctx.cart.lastChangeSource !== "shopper" ||
          !hasMoment("cart_add_confirmed") ||
          payload.triggerType !== "cart_item_added" ||
          !payload.mutationId)
      )
        return deny("confirmed_shopper_add_required");
      if (type === "exit_intent") {
        if (
          !hasMoment(
            ctx.device.isMobile ? "exit_intent_mobile" : "exit_intent_desktop",
          ) ||
          ![
            "exit_intent",
            "exit_intent_desktop",
            "exit_intent_mobile",
          ].includes(trigger)
        )
          return deny("exit_signal_required");
        if (
          !ctx.cart.items.length &&
          ctx.session.pageViews < L.ENGAGED_PAGE_VIEWS
        )
          return deny("engagement_required");
        if (
          !ctx.cart.items.length &&
          (!ctx.agent.aiHealthy || !ctx.agent.chatEnabled)
        )
          return deny("assistant_unavailable");
        if (
          !ctx.cart.items.length &&
          !shadowAssistant &&
          !bridge.getProviderElement("chat")?.isConnected
        )
          return deny("assistant_not_mounted");
      }
      if (
        !facts &&
        type === "countdown_banner" &&
        !(Date.parse(String(payload.endsAt || "")) > Date.now())
      )
        return deny("future_end_time_required");
      return { ok: true, reason: "eligible" };
    },
    dismissalKey(ctx) {
      if (mountedDismissalKey) return mountedDismissalKey;
      const result =
        type === "inline_alert"
          ? facts?.evaluate(type, decision?.payload || {}, ctx)
          : undefined;
      return result?.ok && result.view.type === "inline_alert"
        ? result.view.dismissalKey
        : definition.id;
    },
    score: () => definition.score,
    async mount(ctx, api) {
      mounting = true;
      preparing = new AbortController();
      const signal = preparing.signal;
      let prepared = decision!;
      if (facts && FACT_TYPES.includes(type)) {
        const result = facts.evaluate(type, prepared.payload || {}, ctx);
        if (!result.ok) return { status: "suppressed", reason: result.reason };
        if (result.view.type === "inline_alert")
          mountedDismissalKey = result.view.dismissalKey;
      }
      if (recommendations?.handles(prepared.widgetType)) {
        const result = await recommendations.prepare(
          prepared,
          definition.id,
          ctx,
          signal,
        );
        if (!result.decision || signal.aborted)
          return { status: "suppressed", reason: result.reason };
        prepared = result.decision;
      }
      let closed = false;
      const payload: WidgetPayload = {
        ...prepared.payload,
        agentOnDestroy: () => {
          if (closed) return;
          closed = true;
          api.closed();
          onClosed();
        },
        agentHealthResult: healthResult,
        agentChatTimeoutMs: L.CHAT_RESPONSE_TIMEOUT_MS,
      };
      // Keep the storefront cart action, while removing its completed-order claim
      // only in the flagged path. The checkout extension remains read-only.
      if (type === "post_purchase")
        payload.copy = {
          ...payload.copy,
          headline: "More from this store",
          ctaText: "Add to cart",
          oneLineReason: "A product to consider for your next cart.",
        };
      if (type === "exit_intent") {
        payload.immediate = true;
        payload.cartHasItems = ctx.cart.items.length > 0;
      }
      decorate?.(type, payload, ctx);
      if (signal.aborted)
        return { status: "suppressed", reason: "stale_recommendation" };
      return bridge.mountProvider({ ...prepared, payload });
    },
    unmount: () => {
      preparing?.abort();
      bridge.unmountProvider(type);
    },
    element: () => bridge.getProviderElement(type),
    consume() {
      recommendations?.release(definition.id);
      decision = undefined;
      mounting = false;
      mountedDismissalKey = "";
    },
  };
}
