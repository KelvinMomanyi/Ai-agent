import type { AovboostEvent, EventBus } from "./eventBus";
import type { OfferPoller } from "./offerPoller";
import type { SessionManager } from "./sessionManager";

type TriggerDefinition = {
  category: string;
  widgetHint: string;
  oncePerSession?: boolean;
  requestOffer?: boolean;
  throttleMs?: number;
  requestDelayMs?: number;
};

type TriggerPayload = Record<string, unknown>;

const CART_IDLE_MS = 10 * 60 * 1000;
const INACTIVITY_MS = 5 * 60 * 1000;
const PRODUCT_DWELL_MS = 30 * 1000;

const TRIGGERS = {
  long_product_dwell: {
    category: "browsing_behavior",
    widgetHint: "chat",
    throttleMs: 60 * 1000,
  },
  repeated_product_view: {
    category: "browsing_behavior",
    widgetHint: "bundle",
    throttleMs: 60 * 1000,
  },
  scroll_depth_interest: {
    category: "browsing_behavior",
    widgetHint: "chat",
    oncePerSession: true,
  },
  comparison_page_visit: {
    category: "browsing_behavior",
    widgetHint: "chat",
    oncePerSession: true,
  },
  search_query: {
    category: "browsing_behavior",
    widgetHint: "rec_strip",
    throttleMs: 15 * 1000,
  },
  exit_intent: {
    category: "browsing_behavior",
    widgetHint: "exit_intent",
    oncePerSession: true,
  },
  cart_item_added: {
    category: "cart_checkout",
    widgetHint: "upsell_drawer",
    throttleMs: 2500,
    requestDelayMs: 50,
  },
  cart_abandoned: {
    category: "cart_checkout",
    widgetHint: "discount_nudge",
    oncePerSession: true,
  },
  cart_value_threshold: {
    category: "cart_checkout",
    widgetHint: "discount_nudge",
    throttleMs: 30 * 1000,
  },
  cart_item_removed: {
    category: "cart_checkout",
    widgetHint: "rec_strip",
    throttleMs: 5000,
  },
  checkout_started: {
    category: "cart_checkout",
    widgetHint: "upsell_drawer",
    oncePerSession: true,
  },
  price_hesitation: {
    category: "user_intent",
    widgetHint: "toast",
    throttleMs: 30 * 1000,
  },
  price_sensitive_chat: {
    category: "user_intent",
    widgetHint: "toast",
    requestOffer: false,
    throttleMs: 30 * 1000,
  },
  wishlist_save: {
    category: "user_intent",
    widgetHint: "toast",
    throttleMs: 30 * 1000,
  },
  coupon_field_focus: {
    category: "user_intent",
    widgetHint: "toast",
    oncePerSession: true,
  },
  purchase_history_match: {
    category: "customer_profile_loyalty",
    widgetHint: "chat",
    throttleMs: 60 * 1000,
  },
  loyalty_tier_reached: {
    category: "customer_profile_loyalty",
    widgetHint: "chat",
    throttleMs: 60 * 1000,
  },
  subscription_renewal_due: {
    category: "customer_profile_loyalty",
    widgetHint: "toast",
    throttleMs: 60 * 1000,
  },
  first_time_visitor: {
    category: "customer_profile_loyalty",
    widgetHint: "chat",
    oncePerSession: true,
  },
  flash_sale_window: {
    category: "time_based",
    widgetHint: "countdown_banner",
    oncePerSession: true,
  },
  post_purchase_window: {
    category: "time_based",
    widgetHint: "post_purchase",
    oncePerSession: true,
  },
  inactivity_timeout: {
    category: "time_based",
    widgetHint: "chat",
    oncePerSession: true,
  },
  seasonal_calendar: {
    category: "time_based",
    widgetHint: "countdown_banner",
    oncePerSession: true,
  },
  low_inventory_alert: {
    category: "external_system",
    widgetHint: "inline_alert",
    throttleMs: 60 * 1000,
  },
  price_drop_webhook: {
    category: "external_system",
    widgetHint: "inline_alert",
    throttleMs: 60 * 1000,
  },
  crm_segment_update: {
    category: "external_system",
    widgetHint: "chat",
    throttleMs: 60 * 1000,
  },
  payment_failure: {
    category: "external_system",
    widgetHint: "toast",
    throttleMs: 60 * 1000,
  },
} satisfies Record<string, TriggerDefinition>;

type KnownTrigger = keyof typeof TRIGGERS;

type TriggerRouterOptions = {
  eventBus: EventBus;
  offerPoller: OfferPoller;
  sessionManager: SessionManager;
};

export class TriggerRouter {
  private abortController = new AbortController();
  private firedAt = new Map<string, number>();
  private timers = new Map<string, number>();
  private activePriceTarget: HTMLElement | null = null;
  private options: TriggerRouterOptions;

  constructor(options: TriggerRouterOptions) {
    this.options = options;
  }

  init(): void {
    document.addEventListener("aovboost:event", this.handleStorefrontEvent, {
      signal: this.abortController.signal,
    });
    document.addEventListener("aovboost:trigger", this.handleCustomTrigger, {
      signal: this.abortController.signal,
    });
    document.addEventListener("aovboost:profile-event", this.handleProfileEvent, {
      signal: this.abortController.signal,
    });
    document.addEventListener("aovboost:system-event", this.handleSystemEvent, {
      signal: this.abortController.signal,
    });

    this.installProductDwellTracking();
    this.installComparisonTracking();
    this.installExitIntentTracking();
    this.installPriceHoverTracking();
    this.installCouponFocusTracking();
    this.installWishlistTracking();
    this.installInactivityTracking();
    this.installFirstTimeVisitorTracking();
    this.installInitialCartTracking();
    this.installPostPurchaseTracking();
    this.installScheduledCampaignTracking();
  }

  destroy(): void {
    this.abortController.abort();
    this.timers.forEach((timer) => window.clearTimeout(timer));
    this.timers.clear();
  }

  trigger(type: string, payload: TriggerPayload = {}): void {
    this.fire(type, payload);
  }

  private handleStorefrontEvent = (event: Event) => {
    const detail = normalizePayload((event as CustomEvent).detail) as AovboostEvent;
    if (!detail.type) return;

    if (detail.type === "product_view") {
      this.scheduleProductDwell(String(detail.productId || ""));
      this.handleRepeatedProductView(String(detail.productId || ""));
    }

    if (detail.type === "scroll_depth" && Number(detail.depth || 0) >= 75) {
      this.fire("scroll_depth_interest", {
        depth: Number(detail.depth || 0),
      });
    }

    if (detail.type === "search" && String(detail.query || "").trim().length >= 2) {
      this.fire("search_query", {
        query: String(detail.query || "").trim(),
      });
    }

    if (detail.type === "add_to_cart") {
      this.syncCartAndFire("cart_item_added", detail);
    }

    if (detail.type === "remove_from_cart") {
      this.syncCartAndFire("cart_item_removed", detail);
    }

    if (detail.type === "cart_update") {
      this.handleCartState(detail);
    }

    if (detail.type === "checkout_start") {
      this.fire("checkout_started", {
        path: detail.path || window.location.pathname,
      });
    }
  };

  private handleCustomTrigger = (event: Event) => {
    const detail = normalizePayload((event as CustomEvent).detail);
    const type = String(detail.type || detail.trigger || "").trim();
    if (type) this.fire(type, detail);
  };

  private handleProfileEvent = (event: Event) => {
    const detail = normalizePayload((event as CustomEvent).detail);
    const type = String(detail.type || "crm_segment_update");
    this.fire(type, detail);
  };

  private handleSystemEvent = (event: Event) => {
    const detail = normalizePayload((event as CustomEvent).detail);
    const type = String(detail.type || "external_system_event");
    this.fire(type, detail);
  };

  private installProductDwellTracking(): void {
    this.scheduleProductDwell(getCurrentProductId());
  }

  private scheduleProductDwell(productId?: string): void {
    this.clearTimer("product_dwell");
    if (!productId || !isProductPage()) return;

    this.setTimer("product_dwell", () => {
      this.fire("long_product_dwell", {
        productId,
        dwellSeconds: PRODUCT_DWELL_MS / 1000,
      });
    }, PRODUCT_DWELL_MS);
  }

  private handleRepeatedProductView(productId: string): void {
    if (!productId) return;
    const counts = normalizePayload(
      this.options.sessionManager.getSnapshot().context.productViewCounts,
    );
    const viewCount = Number(counts[productId] || 0);
    if (viewCount >= 2) {
      this.fire("repeated_product_view", {
        productId,
        viewCount,
      });
    }
  }

  private installComparisonTracking(): void {
    const text = `${window.location.pathname} ${document.title}`.toLowerCase();
    if (/\b(compare|comparison|versus|vs|alternative|competitor)\b/.test(text)) {
      window.setTimeout(() => {
        this.fire("comparison_page_visit", { path: window.location.pathname });
      }, 800);
    }
  }

  private installExitIntentTracking(): void {
    document.addEventListener(
      "mouseleave",
      (event) => {
        const mouseEvent = event as MouseEvent;
        if (mouseEvent.clientY <= 8) {
          this.fire("exit_intent", {
            immediate: true,
            path: window.location.pathname,
          });
        }
      },
      { signal: this.abortController.signal },
    );
  }

  private installPriceHoverTracking(): void {
    document.addEventListener(
      "mouseover",
      (event) => {
        const target = closestPriceElement(event.target);
        if (!target || target === this.activePriceTarget) return;

        this.activePriceTarget = target;
        this.clearTimer("price_hover");
        this.setTimer("price_hover", () => {
          this.fire("price_hesitation", {
            productId: getCurrentProductId(),
            priceText: target.textContent?.trim().slice(0, 80) || "",
          });
        }, 1200);
      },
      { signal: this.abortController.signal },
    );

    document.addEventListener(
      "mouseout",
      (event) => {
        const target = this.activePriceTarget;
        if (!target) return;
        const related = (event as MouseEvent).relatedTarget as Node | null;
        if (related && target.contains(related)) return;
        this.activePriceTarget = null;
        this.clearTimer("price_hover");
      },
      { signal: this.abortController.signal },
    );
  }

  private installCouponFocusTracking(): void {
    document.addEventListener(
      "focusin",
      (event) => {
        const target = event.target as HTMLInputElement | HTMLTextAreaElement | null;
        if (!target || !isCouponField(target)) return;
        this.fire("coupon_field_focus", {
          fieldName: target.name || target.id || "",
        });
      },
      { signal: this.abortController.signal },
    );
  }

  private installWishlistTracking(): void {
    document.addEventListener(
      "click",
      (event) => {
        const target = event.target as HTMLElement | null;
        const control = target?.closest?.(
          "[data-wishlist], [data-save-product], .wishlist, .wishlist-button, [aria-label*='wishlist'], [aria-label*='Wishlist'], [aria-label*='save'], [aria-label*='Save']",
        );
        if (!control) return;
        this.fire("wishlist_save", {
          productId: getCurrentProductId(),
        });
      },
      { signal: this.abortController.signal },
    );
  }

  private installInactivityTracking(): void {
    const reset = () => {
      this.clearTimer("inactivity");
      this.setTimer("inactivity", () => {
        this.fire("inactivity_timeout", {
          idleSeconds: INACTIVITY_MS / 1000,
        });
      }, INACTIVITY_MS);
    };

    ["click", "keydown", "scroll", "touchstart"].forEach((eventName) => {
      window.addEventListener(eventName, reset, {
        passive: true,
        signal: this.abortController.signal,
      });
    });
    reset();
  }

  private installFirstTimeVisitorTracking(): void {
    try {
      const key = "aovboost_returning_visitor";
      if (window.localStorage.getItem(key) === "true") return;
      window.localStorage.setItem(key, "true");
      window.setTimeout(() => {
        this.fire("first_time_visitor", { path: window.location.pathname });
      }, 1800);
    } catch {
      // Storage failures should not break the SDK.
    }
  }

  private installInitialCartTracking(): void {
    if (!/\/cart(?:\/|$)/.test(window.location.pathname)) return;

    window.setTimeout(async () => {
      const cart = await this.readCart();
      if (cart.cartItemCount <= 0) return;

      const payload = {
        ...cart,
        source: "initial_cart_state",
      };
      this.options.eventBus.track("cart_update", payload);
      this.fire("cart_item_added", payload);
      this.handleCartState(payload);
    }, 900);
  }

  private installPostPurchaseTracking(): void {
    if (!isThankYouPage()) return;
    window.setTimeout(() => {
      this.fire("post_purchase_window", { path: window.location.pathname });
    }, 1200);
  }

  private installScheduledCampaignTracking(): void {
    const campaign = normalizePayload((window as any).AOVBoost?.campaign);
    const type = String(campaign.type || "");
    if (!type) return;

    const startsAt = Date.parse(String(campaign.startsAt || ""));
    const endsAt = Date.parse(String(campaign.endsAt || ""));
    const now = Date.now();
    const isActive =
      (!Number.isFinite(startsAt) || startsAt <= now) &&
      (!Number.isFinite(endsAt) || endsAt > now);
    if (!isActive) return;

    this.fire(type === "seasonal" ? "seasonal_calendar" : "flash_sale_window", {
      campaign,
      endsAt: campaign.endsAt,
    });
  }

  private syncCartAndFire(trigger: KnownTrigger, basePayload: TriggerPayload): void {
    window.setTimeout(async () => {
      const cart = await this.readCart();
      const payload = { ...basePayload, ...cart };
      this.fire(trigger, payload);
      if (cart.cartProductIds.length > 0 || cart.cartValue > 0) {
        this.options.eventBus.track("cart_update", payload);
      }
      this.handleCartState(payload);
    }, 350);
  }

  private async readCart() {
    try {
      const response = await fetch("/cart.js", {
        headers: { Accept: "application/json" },
        keepalive: true,
      });
      if (!response.ok) throw new Error(`Cart read failed: ${response.status}`);
      const cart = await response.json();
      const items = Array.isArray(cart.items) ? cart.items : [];
      const cartProductIds = items
        .map((item: Record<string, unknown>) => toProductGid(item.product_id))
        .filter(Boolean);

      return {
        cartToken: cart.token || "",
        cartProductIds,
        cartItemCount: Number(cart.item_count || items.length || 0),
        cartValue: Number(cart.total_price || 0) / 100,
      };
    } catch {
      return {
        cartToken: "",
        cartProductIds: [],
        cartItemCount: 0,
        cartValue: 0,
      };
    }
  }

  private handleCartState(payload: TriggerPayload): void {
    const cartValue = Number(payload.cartValue || 0);
    const cartItemCount = Number(payload.cartItemCount || 0);
    if (cartValue > 0) {
      this.fire("cart_value_threshold", payload);
    }

    this.clearTimer("cart_idle");
    if (cartItemCount > 0) {
      this.setTimer("cart_idle", () => {
        this.fire("cart_abandoned", {
          ...payload,
          idleSeconds: CART_IDLE_MS / 1000,
        });
      }, CART_IDLE_MS);
    }
  }

  private fire(type: string, payload: TriggerPayload = {}): void {
    const definition = getTriggerDefinition(type);
    const now = Date.now();
    const throttleMs = definition.throttleMs ?? 10 * 1000;
    const lastFiredAt = this.firedAt.get(type) || 0;
    if (now - lastFiredAt < throttleMs) return;

    if (definition.oncePerSession && hasSessionTrigger(type)) return;
    if (definition.oncePerSession) markSessionTrigger(type);

    this.firedAt.set(type, now);
    const triggerPayload = {
      ...payload,
      triggerType: type,
      triggerCategory: definition.category,
      widgetHint: definition.widgetHint,
    };

    this.options.eventBus.track(type, triggerPayload);
    if (definition.requestOffer !== false) {
      window.setTimeout(() => {
        this.options.offerPoller.requestOffer(type, triggerPayload);
      }, definition.requestDelayMs ?? 150);
    }
  }

  private setTimer(key: string, callback: () => void, delayMs: number): void {
    this.clearTimer(key);
    this.timers.set(key, window.setTimeout(callback, delayMs));
  }

  private clearTimer(key: string): void {
    const timer = this.timers.get(key);
    if (timer) window.clearTimeout(timer);
    this.timers.delete(key);
  }
}

function getTriggerDefinition(type: string): TriggerDefinition {
  return TRIGGERS[type as KnownTrigger] || {
    category: "external_system",
    widgetHint: "chat",
    throttleMs: 30 * 1000,
  };
}

function normalizePayload(value: unknown): TriggerPayload {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as TriggerPayload)
    : {};
}

function hasSessionTrigger(type: string) {
  try {
    return sessionStorage.getItem(`aovboost_trigger:${type}`) === "true";
  } catch {
    return false;
  }
}

function markSessionTrigger(type: string) {
  try {
    sessionStorage.setItem(`aovboost_trigger:${type}`, "true");
  } catch {
    // Ignore storage failures.
  }
}

function isProductPage() {
  return /\/products(?:\/|$)/.test(window.location.pathname) || Boolean(getCurrentProductId());
}

function isThankYouPage() {
  return (
    /\/thank_you(?:\/|$)/.test(window.location.pathname) ||
    Boolean((window as any).Shopify?.checkout)
  );
}

function getCurrentProductId() {
  const product =
    (window as any).Shopify?.product ||
    (window as any).ShopifyAnalytics?.meta?.product ||
    null;
  if (!product) return "";

  return toProductGid(product.gid || product.id);
}

function toProductGid(value: unknown) {
  const text = String(value || "");
  if (!text) return "";
  return text.startsWith("gid://shopify/Product/")
    ? text
    : `gid://shopify/Product/${text}`;
}

function closestPriceElement(target: EventTarget | null) {
  const element = target instanceof HTMLElement ? target : null;
  if (!element) return null;
  return element.closest(
    "[data-price], .price, .product-price, .product__price, [class*='price'], [class*='Price'], [id*='price'], [id*='Price']",
  ) as HTMLElement | null;
}

function isCouponField(target: HTMLInputElement | HTMLTextAreaElement) {
  const haystack = [
    target.name,
    target.id,
    target.placeholder,
    target.getAttribute("aria-label"),
    target.getAttribute("autocomplete"),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return /\b(coupon|discount|promo|promotion|voucher|code)\b/.test(haystack);
}
