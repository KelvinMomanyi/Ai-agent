import { AgentHealth } from "./AgentHealth";
import { Arbiter } from "./Arbiter";
import { AGENT_LIMITS as L } from "./constants";
import { Debug, aovDebug } from "./Debug";
import { cartSource } from "./flag";
import {
  createProvider,
  WIDGET_PROVIDERS,
  type ProviderAdapter,
} from "./providers";
import { SessionStore } from "./SessionStore";
import { SignalBus } from "./SignalBus";
import { Telemetry } from "./Telemetry";
import { RecommendationService } from "./RecommendationService";
import { AgentVoice } from "./AgentVoice";
import { createDock, createExit, createToast } from "./Surfaces";
import { MobileExitSignals } from "./MobileExitSignals";
import { OfferFacts, FACT_TYPES } from "./OfferFacts";
import { createFactSurface } from "./FactSurfaces";
import { Holdout } from "./Holdout";
import type { Experience } from "./experienceTypes";
import type { StorefrontSettings } from "../sessionManager";
import type { OfferDecision, PlacementOutcome } from "../widgets/widgetManager";
import type {
  AgentContext,
  SignalName,
  WidgetBridge,
  WidgetCoordinator,
} from "./types";

type Options = {
  shop: string;
  apiBase: string;
  settings: StorefrontSettings;
  visitorId?: string;
  measurement?: () => unknown;
  serverHoldout?: () => boolean;
  analyticsEnabled?: () => boolean;
  bridge: WidgetBridge;
  enabled: (type: string) => boolean;
  track: (type: string, data: Record<string, unknown>) => void;
  trigger: (type: string, data: Record<string, unknown>) => void;
};
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}
function pageType() {
  const path = location.pathname;
  if (/\/checkouts?(?:\/|$)/.test(path)) return "checkout";
  if (/\/(?:thank_you|thank-you|orders)(?:\/|$)/.test(path)) return "thankyou";
  if (/\/products\/[^/]+/.test(path)) return "product";
  if (/\/collections(?:\/|$)/.test(path)) return "collection";
  if (/\/cart(?:\/|$)/.test(path)) return "cart";
  if (/\/search(?:\/|$)/.test(path)) return "search";
  if (/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/?)?$/i.test(path)) return "home";
  return "other";
}
const safeProductId = (id: unknown) =>
  /^gid:\/\/shopify\/Product\/\d+$/.test(String(id))
    ? String(id)
    : /^\d+$/.test(String(id))
      ? `gid://shopify/Product/${id}`
      : "";
const positive = (value: unknown) =>
  Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;

export class AgentCore implements WidgetCoordinator {
  private facts = new OfferFacts();
  readonly store: SessionStore;
  readonly signals: SignalBus;
  readonly health: AgentHealth;
  readonly arbiter: Arbiter;
  readonly recommendations?: RecommendationService;
  private debug = new Debug();
  private telemetry: Telemetry;
  private adapters = new Map<string, ProviderAdapter>();
  private moments = new Set<SignalName>();
  private listeners = new AbortController();
  private cart: AgentContext["cart"] = {
    items: [],
    subtotal: 0,
    currency: "",
    lastChangeSource: "shopper",
  };
  private productId = "";
  private productTitle = "";
  private productHandle = "";
  private experience: Experience;
  private mobile: MobileExitSignals;
  private collectionId = "";
  private assignment: Holdout;
  private get holdout(): boolean {
    return this.assignment.current().holdout;
  }
  readonly telemetryEvent = (event: Record<string, unknown>) =>
    this.telemetry.project(event);
  private path = location.pathname;
  private productStartedAt = 0;
  private dwellTimer?: ReturnType<typeof setTimeout>;
  private seenMutations = new Set<string>();
  private destroyed = false;
  constructor(private options: Options) {
    this.store = new SessionStore(options.shop);
    this.assignment = new Holdout(
      options.shop,
      options.visitorId || this.store.snapshot().id,
      {
        measurement: options.measurement || (() => null),
        serverHoldout:
          options.serverHoldout || (() => options.settings.holdout === true),
        percent: () => window.AOVBoost?.agent_holdout_percent,
        analytics:
          options.analyticsEnabled ||
          (() => options.settings.analyticsEnabled !== false),
      },
    );
    this.signals = new SignalBus(() =>
      aovDebug("signal_error", { reason: "subscriber_exception" }),
    );
    this.telemetry = new Telemetry(options.track, () => this.context());
    this.health = new AgentHealth(
      async (signal) => {
        // Existing GET is a reachability check only. It does not exercise AI,
        // billing or Redis. Actual chat results also feed the circuit breaker.
        const response = await fetch(
          `${options.apiBase.replace(/\/$/, "")}/chat`,
          {
            signal,
            cache: "no-store",
            headers: { Accept: "application/json" },
          },
        );
        return response.ok && (await response.json())?.ok === true;
      },
      () => this.signals.publish("health_change"),
    );
    this.experience = {
      voice: new AgentVoice((window as any).AOVBoost?.shopName),
      memory: { messages: [] },
      handoff: (trigger) => {
        const ctx = this.context();
        const forms = document.querySelectorAll(
          "main form[action*='/cart/add']",
        );
        const value =
          forms.length === 1
            ? forms[0].querySelector<HTMLSelectElement | HTMLInputElement>(
                "[name='id']",
              )?.value
            : undefined;
        const variantId = /^\d+$/.test(value || "")
          ? `gid://shopify/ProductVariant/${value}`
          : undefined;
        return this.experience.voice.handoff(
          { ...ctx, page: { ...ctx.page, variantId } },
          trigger,
        );
      },
      healthy: () => this.health.isHealthy,
      retry: () => this.health.probe(),
    };
    this.mobile = new MobileExitSignals(
      () => this.context(),
      (reason) => {
        this.signals.publish("exit_intent_mobile", { reason });
        this.options.trigger("exit_intent", {
          immediate: true,
          device: "mobile",
          intentReason: reason,
        });
      },
    );
    this.arbiter = new Arbiter(
      () => this.context(),
      this.store,
      this.telemetry,
      this.debug,
    );
    if (
      options.bridge.getRecommendationProducts &&
      options.bridge.getRecommendationScope
    )
      this.recommendations = new RecommendationService({
        shop: options.shop,
        normalize: (payload) =>
          options.bridge.getRecommendationProducts!(payload),
        scope: () => options.bridge.getRecommendationScope!(),
        productResolved: (product) => {
          let handle = location.pathname.match(/\/products\/([^/]+)/)?.[1];
          try {
            handle = decodeURIComponent(handle || "");
          } catch {
            return;
          }
          if (this.destroyed || handle !== product.handle) return;
          if (this.productId === product.id) {
            this.productTitle ||= product.title;
            this.productHandle ||= product.handle;
            return;
          }
          this.onEvent(
            new CustomEvent("aovboost:event", {
              detail: {
                type: "product_view",
                productId: product.id,
                title: product.title,
                handle: product.handle,
              },
            }),
          );
        },
      });
    for (const type of Object.keys(WIDGET_PROVIDERS)) {
      const adapter = createProvider(
        type,
        options.bridge,
        options.enabled,
        (name) => this.moments.has(name),
        (ok) => this.health.record(ok),
        () => {
          if (type !== "chat" || !this.store.snapshot().chatOpen) return;
          this.store.update((session) => {
            session.chatOpen = false;
          });
          this.signals.publish("chat_close");
        },
        this.recommendations,
        (type, payload, ctx) => {
          if (!options.bridge.agentExperience) return;
          payload.agentManaged = true;
          payload.agentIdentity = this.experience.voice.identity;
          if (FACT_TYPES.includes(type)) {
            const initial = this.facts.evaluate(type, payload, ctx);
            if (!initial.ok) return;
            payload.agentFactType = type;
            payload.agentMinHeight = initial.view.minHeight;
            payload.presentation = "inline";
            if (initial.view.type === "countdown_banner")
              payload.endsAt = new Date(initial.view.endsAt).toISOString();
            payload.agentFactory = (deps) =>
              createFactSurface(deps, payload, type, {
                voice: this.experience.voice,
                locale: () => options.bridge.getRecommendationScope?.().locale,
                view: () => {
                  const result = this.facts.evaluate(
                    type,
                    payload,
                    this.context(),
                  );
                  return result.ok && result.view.key === initial.view.key
                    ? result.view
                    : undefined;
                },
                subscribe: (listener) => this.signals.on("*", listener),
                failed: () => {
                  this.store.update((session) => {
                    const id = WIDGET_PROVIDERS[type].id;
                    if (!session.disabledProviders.includes(id))
                      session.disabledProviders.push(id);
                  });
                  aovDebug("provider_exception", {
                    provider_id: WIDGET_PROVIDERS[type].id,
                  });
                  queueMicrotask(() => {
                    if (!this.destroyed) this.signals.publish("offer_ready");
                  });
                },
              });
          }
          if (type === "chat")
            payload.agentFactory = (deps) =>
              createDock(deps, payload, this.experience);
          if (type === "toast")
            payload.agentFactory = (deps) =>
              createToast(deps, payload, this.experience, ctx);
          if (type === "exit_intent")
            payload.agentFactory = (deps) =>
              createExit(deps, payload, this.experience, ctx);
        },
        this.facts,
      );
      this.adapters.set(type, adapter);
      this.arbiter.register(adapter);
    }
    this.signals.on("*", (signal) => {
      if (signal.name === "health_change") this.ensureLauncher();
      this.moments.add(signal.name);
      aovDebug("signal", { name: signal.name, source: signal.data.source });
      this.arbiter.evaluate(signal);
    });
  }
  init(): void {
    document.addEventListener(
      "aovboost:measurement-updated",
      () => {
        this.assignment.sync();
        this.signals.publish("offer_ready");
      },
      { signal: this.listeners.signal },
    );
    this.mobile.init();
    window.addEventListener(
      "pagehide",
      () => this.recommendations?.invalidate(),
      { signal: this.listeners.signal },
    );
    document.addEventListener("aovboost:event", this.onEvent, {
      signal: this.listeners.signal,
    });
    if (
      this.options.settings.chatEnabled !== false &&
      !this.options.settings.focusedMode
    )
      void this.health.probe();
  }
  context(): AgentContext {
    return freeze({
      page: {
        type: pageType(),
        productId: this.productId || undefined,
        collectionId: this.collectionId || undefined,
        productTitle: this.productTitle || undefined,
        productHandle: this.productHandle || undefined,
      },
      cart: {
        ...this.cart,
        items: this.cart.items.map((item) => ({ ...item })),
      },
      session: this.store.snapshot(),
      device: {
        isMobile: innerWidth < L.DESKTOP_MIN_WIDTH,
        prefersReducedMotion:
          typeof matchMedia === "function" &&
          matchMedia("(prefers-reduced-motion: reduce)").matches,
      },
      agent: {
        aiHealthy: this.health.isHealthy,
        chatEnabled:
          this.options.settings.chatEnabled !== false &&
          !this.options.settings.focusedMode,
        holdout: this.holdout,
        assignment: this.assignment.current(),
      },
      config: JSON.parse(JSON.stringify(this.options.settings)),
    });
  }
  offer(decision: OfferDecision, trigger: string): PlacementOutcome {
    const adapter = this.adapters.get(decision.widgetType || "");
    if (!adapter || this.destroyed)
      return { status: "suppressed", reason: "unknown_widget" };
    if (this.arbiter.isActive(adapter.id))
      return { status: "unchanged", reason: "arbiter_provider_present" };
    adapter.update(decision, trigger);
    this.signals.publish("offer_ready");
    return {
      status: this.arbiter.isActive(adapter.id) ? "pending" : "suppressed",
      reason: this.arbiter.reason(adapter.id),
    };
  }
  setHoldout(value: boolean): void {
    this.assignment.setServerHoldout(value);
    this.signals.publish("offer_ready");
  }
  getDismissedWidgets(): string[] {
    const dismissed = this.store.snapshot().dismissed;
    return Object.entries(WIDGET_PROVIDERS)
      .filter(([, definition]) => {
        const entry = dismissed[definition.id];
        return (
          entry &&
          (entry.count >= L.DISMISS_BACKOFF_SESSION_COUNT ||
            Date.now() - entry.lastAt < L.DISMISS_BACKOFF_FIRST_MS)
        );
      })
      .map(([type]) => type);
  }
  navigation(): void {
    this.recommendations?.invalidate();
    this.arbiter.navigation();
    this.moments.clear();
    this.productId = "";
    this.productTitle = "";
    this.productHandle = "";
    this.collectionId = "";
    this.productStartedAt = 0;
    clearTimeout(this.dwellTimer);
    this.mobile.navigation();
  }
  private ensureLauncher(): void {
    if (
      !this.options.bridge.agentExperience ||
      !this.health.isHealthy ||
      !this.options.enabled("chat") ||
      this.arbiter.isActive("chat") ||
      ["checkout", "thankyou", "other"].includes(pageType())
    )
      return;
    this.adapters
      .get("chat")
      ?.update({ widgetType: "chat", payload: {} }, "launcher");
  }
  private onEvent = (event: Event) => {
    const detail = (event as CustomEvent<Record<string, unknown>>).detail;
    if (!detail || this.destroyed) return;
    const type = String(detail.type || "");
    if (
      detail.confirmed === true &&
      ["add_to_cart", "remove_from_cart", "quantity_changed"].includes(type)
    )
      this.recommendations?.invalidate();
    const publish = (name: SignalName, data: Record<string, unknown> = {}) =>
      this.signals.publish(name, data);
    if (type === "page_view") {
      if (this.path !== location.pathname) this.navigation();
      this.path = location.pathname;
      this.store.update((session) => {
        session.pageViews++;
        session.dwellOnProductMs = 0;
      });
      this.ensureLauncher();
      publish("page_view");
      this.mobile.refresh();
    } else if (
      ["product_view", "product_viewed", "product_revisited"].includes(type)
    ) {
      this.productId = safeProductId(detail.productId);
      if (!this.productId) return;
      this.productTitle =
        typeof detail.title === "string" ? detail.title.slice(0, 160) : "";
      this.productHandle =
        typeof detail.handle === "string" ? detail.handle.slice(0, 255) : "";
      this.store.update((session) => {
        if (!session.viewedProducts.includes(this.productId))
          session.viewedProducts.push(this.productId);
        session.returnsToProduct[this.productId] =
          (session.returnsToProduct[this.productId] || 0) + 1;
      });
      this.productStartedAt = Date.now();
      clearTimeout(this.dwellTimer);
      this.dwellTimer = setTimeout(() => {
        if (pageType() !== "product" || document.visibilityState === "hidden")
          return;
        const price = document.querySelector<HTMLElement>(
          "main .price, main [data-product-price], main [data-price]",
        );
        const rect = price?.getBoundingClientRect();
        if (
          !rect ||
          rect.height <= 0 ||
          rect.bottom <= 0 ||
          rect.top >= innerHeight
        )
          return;
        this.store.update((session) => {
          session.dwellOnProductMs = Date.now() - this.productStartedAt;
        });
        publish("price_hesitation");
        this.options.trigger("price_hesitation", { productId: this.productId });
      }, L.HESITATION_DWELL_MS);
      publish("product_view");
    } else if (type === "collection_viewed") {
      this.collectionId = /^\d+$/.test(String(detail.collectionId))
        ? String(detail.collectionId)
        : "";
    } else if (type === "cart_update" && Array.isArray(detail.cartItems)) {
      this.recommendations?.invalidate();
      const source = cartSource(detail);
      this.cart = {
        known:
          typeof detail.cartValue === "number" &&
          Number.isFinite(detail.cartValue) &&
          detail.cartValue >= 0,
        items: detail.cartItems.slice(0, 100).map((item) => ({
          productId: safeProductId(item?.productId),
          variantId: String(item?.variantId || "")
            .replace(/[^a-zA-Z0-9:/]/g, "")
            .slice(0, 100),
          quantity: positive(item?.quantity),
        })),
        subtotal: positive(detail.cartValue),
        currency: /^[A-Z]{3}$/.test(String(detail.currency))
          ? String(detail.currency)
          : "",
        lastChangeSource: source,
      };
      publish("cart_change", { source });
      const id = String(detail.mutationId || "");
      if (
        detail.cartMutationType === "add_to_cart" &&
        detail.confirmed === true &&
        id &&
        !this.seenMutations.has(id) &&
        detail.variantId &&
        this.cart.items.length &&
        positive(detail.quantity) > 0
      ) {
        this.seenMutations.add(id);
        if (this.seenMutations.size > 200)
          this.seenMutations.delete(this.seenMutations.values().next().value!);
        publish("cart_add_confirmed", { source });
        if (source !== "shopper" && detail.undo !== true) {
          const widget = (
            {
              aov_upsell: "upsell_drawer",
              aov_bundle: "bundle",
              aov_strip: "rec_strip",
              aov_chat: "chat",
              aov_exit: "exit_intent",
              aov_postadd: "post_purchase",
            } as const
          )[source];
          this.telemetry.emit(
            "accepted",
            this.adapters.get(widget)!,
            "cart_add_confirmed",
            undefined,
            { offer_id: detail.offerId, mutation_id: id, cart_source: source },
          );
          publish("offer_accepted", { source });
        }
      }
      this.mobile.refresh();
    } else if (
      ["checkout_start", "checkout_started", "checkout_clicked"].includes(type)
    ) {
      this.store.update((session) => {
        session.checkoutStarted = true;
      });
      publish("checkout_start");
    } else if (type === "chat_opened" || type === "chat_closed") {
      const open = type === "chat_opened";
      this.store.update((session) => {
        session.chatOpen = open;
        if (open) session.chatStartedAt = Date.now();
      });
      publish(open ? "chat_open" : "chat_close");
      this.mobile.refresh();
    } else if (type === "price_hesitation") {
      const returns =
        this.store.snapshot().returnsToProduct[this.productId] || 0;
      if (
        pageType() === "product" &&
        ((this.productStartedAt &&
          Date.now() - this.productStartedAt >= L.HESITATION_DWELL_MS) ||
          returns >= L.HESITATION_RETURNS)
      )
        publish("price_hesitation");
    } else if (type === "exit_intent")
      publish(
        innerWidth >= L.DESKTOP_MIN_WIDTH
          ? "exit_intent_desktop"
          : "exit_intent_mobile",
      );
    else if (type === "idle") publish("idle");
    else if (type === "cart_value_threshold") publish("threshold_progress");
    else if (type === "widget_dismiss") {
      const provider = this.adapters.get(String(detail.widgetType));
      if (provider) {
        this.arbiter.dismiss(provider.id);
        publish("offer_dismissed");
      }
    } else if (type === "widget_click") {
      const provider = this.adapters.get(String(detail.widgetType));
      if (provider)
        this.telemetry.emit("interaction", provider, "offer_ready", undefined, {
          offer_id: detail.offerId,
        });
      if (detail.action === "send_message") publish("chat_message");
    }
  };
  destroy(): void {
    this.mobile.destroy();
    this.recommendations?.destroy();
    this.destroyed = true;
    clearTimeout(this.dwellTimer);
    this.listeners.abort();
    this.health.destroy();
    this.arbiter.destroy();
    this.signals.destroy();
    this.debug.destroy();
  }
}
export function createAgentCore(options: Options): AgentCore {
  return new AgentCore(options);
}
