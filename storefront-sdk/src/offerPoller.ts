import type { EventBus } from "./eventBus";
import type { SessionManager } from "./sessionManager";
import type { OfferDecision, WidgetManager } from "./widgets/widgetManager";
import {
  getStorefrontCurrency,
  setStorefrontCurrency,
} from "./widgets/BaseWidget";

type OfferPollerOptions = {
  shop: string;
  apiBase: string;
  eventBus: EventBus;
  sessionManager: SessionManager;
  widgetManager: WidgetManager;
  pollMs?: number;
};

type PendingOfferRequest = {
  trigger: string;
  triggerPayload: Record<string, unknown>;
  queuedAt: number;
};

export type OfferRuntimeEntry = {
  trigger: string;
  outcome: "mounted" | "local_fallback" | "no_offer" | "request_failed";
  widgetType: string | null;
  reasoning: string;
  httpStatus?: number;
  timestamp: number;
};

const OFFER_REQUEST_TIMEOUT_MS = 8_000;
const STOREFRONT_READ_TIMEOUT_MS = 1_500;

export class OfferPoller {
  private timer: number | undefined;
  private inFlight = false;
  private stopped = false;
  private startupTimers = new Set<number>();
  private pendingRequests = new Map<string, PendingOfferRequest>();
  private runtimeHistory: OfferRuntimeEntry[] = [];
  private abortController = new AbortController();
  private options: OfferPollerOptions;

  constructor(options: OfferPollerOptions) {
    this.options = options;
  }

  init(): void {
    this.scheduleStartupRequest("initial", 650);
    if (getCurrentPageType() === "product") {
      this.scheduleStartupRequest("social_proof", 950);
    }
    this.scheduleStartupRequest("assistant_bootstrap", 1300);
    if (this.options.pollMs) {
      this.timer = window.setInterval(
        () => this.requestOffer("poll"),
        this.options.pollMs,
      );
    }

    document.addEventListener(
      "aovboost:request-offer",
      () => {
        this.requestOffer("manual");
      },
      { signal: this.abortController.signal },
    );
    document.addEventListener("aovboost:event", this.handleNavigationEvent, {
      signal: this.abortController.signal,
    });
  }

  destroy(): void {
    this.stopped = true;
    this.abortController.abort();
    if (this.timer) window.clearInterval(this.timer);
    this.startupTimers.forEach((timer) => window.clearTimeout(timer));
    this.startupTimers.clear();
    this.pendingRequests.clear();
  }

  getStatus() {
    return {
      inFlight: this.inFlight,
      pendingTriggers: Array.from(this.pendingRequests.keys()),
      recentDecisions: [...this.runtimeHistory],
      widgets: this.options.widgetManager.getStatus(),
    };
  }

  async requestOffer(
    trigger = "manual",
    triggerPayload: Record<string, unknown> = {},
  ): Promise<OfferDecision | null> {
    if (this.stopped) return null;
    if (this.inFlight) {
      this.enqueuePendingRequest(trigger, triggerPayload);
      return null;
    }
    this.inFlight = true;

    try {
      const snapshot = this.options.sessionManager.getSnapshot();
      const cart = await readCart();
      const hasLiveCart = cart.cartItemCount > 0 || cart.cartValue > 0;
      const cartProductIds = Array.isArray(triggerPayload.cartProductIds)
        ? triggerPayload.cartProductIds.map(String)
        : hasLiveCart
          ? cart.cartProductIds
          : snapshot.cartProductIds;
      const cartVariantIds = Array.isArray(triggerPayload.cartVariantIds)
        ? triggerPayload.cartVariantIds.map(String)
        : hasLiveCart
          ? cart.cartVariantIds
          : Array.isArray(snapshot.context.cartVariantIds)
            ? snapshot.context.cartVariantIds.map(String)
            : [];
      const cartItems = Array.isArray(triggerPayload.cartItems)
        ? triggerPayload.cartItems
        : hasLiveCart
          ? cart.cartItems
          : [];
      const cartItemCount =
        typeof triggerPayload.cartItemCount === "number"
          ? triggerPayload.cartItemCount
          : hasLiveCart
            ? cart.cartItemCount
            : Number(snapshot.context.cartItemCount || 0);
      const cartValue =
        typeof triggerPayload.cartValue === "number"
          ? triggerPayload.cartValue
          : hasLiveCart
            ? cart.cartValue
            : snapshot.cartValue;
      const auth = await this.options.sessionManager.getSignedAuthPayload();
      if (!auth) {
        return this.mountLocalFallback(
          trigger,
          triggerPayload,
          "Storefront session unavailable; catalog-backed widgets require the app proxy connection.",
        );
      }
      const currency = getStorefrontCurrency();
      const currentProductId = await getCurrentProductId();

      const body = {
        ...auth,
        currentProductId,
        currentPageType: getCurrentPageType(),
        cartProductIds,
        cartVariantIds,
        cartItems,
        cartItemCount,
        cartValue,
        currency: currency.code,
        moneyFormat: currency.moneyFormat,
        moneyWithCurrencyFormat: currency.moneyWithCurrencyFormat,
        locale: currency.locale,
        dismissedWidgets: this.options.widgetManager.getDismissedWidgets(),
        trigger,
        triggerCategory: triggerPayload.triggerCategory,
        triggerPayload,
      };

      let response = await this.postOffer({ ...body, ...auth });

      if (response.status === 401) {
        const recovered =
          await this.options.sessionManager.applySessionFromResponse(response);
        if (!recovered) await this.options.sessionManager.refreshAuth();
        const refreshedAuth =
          await this.options.sessionManager.getSignedAuthPayload();
        if (!refreshedAuth) {
          return this.mountLocalFallback(
            trigger,
            triggerPayload,
            "Storefront authentication could not be refreshed.",
            response.status,
          );
        }
        response = await this.postOffer({ ...body, ...refreshedAuth });
      }

      if (!response.ok) {
        return this.mountLocalFallback(
          trigger,
          triggerPayload,
          `Offer request failed with HTTP ${response.status}.`,
          response.status,
        );
      }

      const decision = (await response.json()) as OfferDecision;
      if (!decision.widgetType) {
        return this.mountLocalFallback(
          trigger,
          triggerPayload,
          decision.reasoning || "The server found no eligible offer.",
          response.status,
        );
      }

      this.options.widgetManager.mountDecision(decision);
      this.recordRuntime({
        trigger,
        outcome: "mounted",
        widgetType: decision.widgetType,
        reasoning: decision.reasoning || "Server decision mounted.",
        httpStatus: response.status,
      });
      return decision;
    } catch (error) {
      return this.mountLocalFallback(
        trigger,
        triggerPayload,
        error instanceof Error ? error.message : "Offer request failed.",
      );
    } finally {
      this.inFlight = false;
      this.drainPendingRequest();
    }
  }

  private scheduleStartupRequest(trigger: string, delayMs: number) {
    const timer = window.setTimeout(() => {
      this.startupTimers.delete(timer);
      void this.requestOffer(trigger);
    }, delayMs);
    this.startupTimers.add(timer);
  }

  private handleNavigationEvent = (event: Event) => {
    const detail = (event as CustomEvent).detail as
      Record<string, unknown> | undefined;
    if (detail?.type !== "page_view") return;
    this.options.widgetManager.resetPageContext();
    this.scheduleStartupRequest("navigation", 300);
    if (getCurrentPageType() === "product") {
      this.scheduleStartupRequest("social_proof", 600);
    }
  };

  private enqueuePendingRequest(
    trigger: string,
    triggerPayload: Record<string, unknown>,
  ) {
    this.pendingRequests.set(trigger, {
      trigger,
      triggerPayload,
      queuedAt: Date.now(),
    });

    if (this.pendingRequests.size <= 6) return;
    const lowestPriority = Array.from(this.pendingRequests.values()).sort(
      (left, right) =>
        getTriggerPriority(left.trigger) - getTriggerPriority(right.trigger) ||
        left.queuedAt - right.queuedAt,
    )[0];
    if (lowestPriority) this.pendingRequests.delete(lowestPriority.trigger);
  }

  private drainPendingRequest() {
    if (this.stopped || this.inFlight || this.pendingRequests.size === 0) {
      return;
    }
    const next = Array.from(this.pendingRequests.values()).sort(
      (left, right) =>
        getTriggerPriority(right.trigger) - getTriggerPriority(left.trigger) ||
        left.queuedAt - right.queuedAt,
    )[0];
    if (!next) return;
    this.pendingRequests.delete(next.trigger);
    window.setTimeout(() => {
      void this.requestOffer(next.trigger, next.triggerPayload);
    }, 0);
  }

  private endpoint(path: string): string {
    return `${this.options.apiBase.replace(/\/$/, "")}${path}`;
  }

  private async postOffer(body: Record<string, unknown>) {
    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => controller.abort(),
      OFFER_REQUEST_TIMEOUT_MS,
    );
    try {
      return await fetch(this.endpoint("/offer"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AOVBoost-Shop": this.options.shop,
        },
        body: JSON.stringify(body),
        keepalive: true,
        signal: controller.signal,
      });
    } finally {
      window.clearTimeout(timeout);
    }
  }

  private mountLocalFallback(
    trigger: string,
    triggerPayload: Record<string, unknown>,
    reasoning = "Server decision unavailable.",
    httpStatus?: number,
  ): OfferDecision | null {
    const settings = this.options.sessionManager.getSettings();
    const decision = buildLocalFallbackDecision(trigger, {
      ...triggerPayload,
      threshold:
        triggerPayload.threshold === undefined
          ? settings.discountThreshold
          : triggerPayload.threshold,
    });
    if (!decision) {
      this.recordRuntime({
        trigger,
        outcome:
          typeof httpStatus === "number" && httpStatus >= 400
            ? "request_failed"
            : "no_offer",
        widgetType: null,
        reasoning,
        httpStatus,
      });
      return null;
    }

    this.options.widgetManager.mountDecision(decision);
    this.recordRuntime({
      trigger,
      outcome: "local_fallback",
      widgetType: decision.widgetType,
      reasoning,
      httpStatus,
    });
    return decision;
  }

  private recordRuntime(
    entry: Omit<OfferRuntimeEntry, "timestamp">,
  ) {
    const runtimeEntry = { ...entry, timestamp: Date.now() };
    this.runtimeHistory = [...this.runtimeHistory.slice(-9), runtimeEntry];
    document.dispatchEvent(
      new CustomEvent("aovboost:offer-status", { detail: runtimeEntry }),
    );
  }
}

function buildLocalFallbackDecision(
  trigger: string,
  payload: Record<string, unknown>,
): OfferDecision | null {
  const cartValue = Number(payload.cartValue || 0);

  switch (trigger) {
    case "assistant_bootstrap":
    case "first_time_visitor":
    case "long_product_dwell":
    case "scroll_depth_interest":
    case "comparison_page_visit":
    case "inactivity_timeout":
    case "purchase_history_match":
    case "loyalty_tier_reached":
    case "crm_segment_update":
      return {
        widgetType: "chat",
        payload: {
          offerId: `local:${trigger}`,
          greeting:
            "Hi. I can help you compare products and find useful add-ons.",
          copy: {
            greeting:
              "Hi. I can help you compare products and find useful add-ons.",
            ctaAccept: "Chat with AI",
            ctaDecline: "Browse myself",
          },
        },
        reasoning: "Local fallback for proactive chat trigger.",
        confidence: 0.4,
        aiProvider: "heuristic",
      };

    case "exit_intent":
      return {
        widgetType: "exit_intent",
        payload: {
          offerId: "local:exit_intent",
          immediate: true,
          offerLine: "Before you go, I can help find a better match or bundle.",
          copy: {
            headline: "Wait before you go",
            offerLine: "I can help find a better match or bundle.",
            ctaText: "Open assistant",
            dismissText: "No thanks",
          },
        },
        reasoning: "Local fallback for exit intent.",
        confidence: 0.4,
        aiProvider: "heuristic",
      };

    case "cart_value_threshold":
    case "cart_abandoned":
      if (
        !Number.isFinite(Number(payload.threshold)) ||
        Number(payload.threshold) <= 0
      ) {
        return null;
      }
      return {
        widgetType: "discount_nudge",
        payload: {
          offerId: `local:${trigger}`,
          cartValue,
          threshold: Number(payload.threshold),
          copy: {
            progressLabel: "You are close to your cart goal",
            rewardDescription: "Your cart goal is reached.",
            ctaText: "View picks",
          },
        },
        reasoning: "Local fallback for cart value or idle cart trigger.",
        confidence: 0.4,
        aiProvider: "heuristic",
      };

    case "flash_sale_window":
    case "seasonal_calendar":
      if (!isFutureDate(payload.endsAt)) return null;
      return {
        widgetType: "countdown_banner",
        payload: {
          offerId: `local:${trigger}`,
          endsAt: payload.endsAt,
          body: "Limited-time product picks are available right now.",
          copy: {
            headline: "Limited-time offer",
            subheadline: "Relevant bundles and add-ons are available now.",
            ctaText: "View offer",
          },
        },
        reasoning: "Local fallback for scheduled campaign trigger.",
        confidence: 0.4,
        aiProvider: "heuristic",
      };

    case "low_inventory_alert":
    case "price_drop_webhook":
      return {
        widgetType: "inline_alert",
        payload: {
          offerId: `local:${trigger}`,
          body:
            trigger === "price_drop_webhook"
              ? "The price on this product has changed."
              : "Inventory is limited for this product.",
          copy: {
            headline:
              trigger === "price_drop_webhook"
                ? "Price update"
                : "Limited stock",
            subheadline:
              trigger === "price_drop_webhook"
                ? "The price on this product has changed."
                : "Inventory is limited for this product.",
          },
        },
        reasoning: "Local fallback for system alert trigger.",
        confidence: 0.4,
        aiProvider: "heuristic",
      };

    case "cart_item_added":
    case "cart_item_removed":
    case "search_query":
    case "repeated_product_view":
    case "price_hesitation":
    case "wishlist_save":
    case "coupon_field_focus":
    case "subscription_renewal_due":
    case "payment_failure":
      return {
        widgetType: "toast",
        payload: {
          offerId: `local:${trigger}`,
          headline: getToastHeadline(trigger),
          body: getToastBody(trigger),
          copy: {
            headline: getToastHeadline(trigger),
            subheadline: getToastBody(trigger),
            ctaText: "Open assistant",
            dismissText: "No thanks",
          },
        },
        reasoning: "Local fallback for low-disruption trigger.",
        confidence: 0.4,
        aiProvider: "heuristic",
      };

    default:
      return null;
  }
}

function getTriggerPriority(trigger: string) {
  if (trigger === "cart_item_added" || trigger === "checkout_started") {
    return 100;
  }
  if (trigger === "exit_intent" || trigger === "payment_failure") return 95;
  if (
    trigger === "cart_value_threshold" ||
    trigger === "cart_abandoned" ||
    trigger === "coupon_field_focus"
  ) {
    return 85;
  }
  if (
    trigger === "search_query" ||
    trigger === "repeated_product_view" ||
    trigger === "cart_item_removed"
  ) {
    return 70;
  }
  if (trigger === "initial" || trigger === "navigation") return 60;
  if (trigger === "social_proof") return 55;
  if (trigger === "assistant_bootstrap") return 50;
  if (trigger === "poll") return 10;
  return 40;
}

function isFutureDate(value: unknown) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) && timestamp > Date.now();
}

function getToastHeadline(trigger: string) {
  if (trigger === "cart_item_added") return "Complete the set";
  if (trigger === "coupon_field_focus") return "Looking for a code?";
  if (trigger === "price_hesitation") return "Need a better fit?";
  if (trigger === "wishlist_save") return "Saved for later";
  if (trigger === "search_query") return "Need help choosing?";
  return "Need help deciding?";
}

function getToastBody(trigger: string) {
  if (trigger === "cart_item_added") {
    return "I can help find matching accessories or add-ons.";
  }
  if (trigger === "cart_item_removed") {
    return "I can help find a better alternative.";
  }
  if (trigger === "coupon_field_focus") {
    return "I can help find a relevant offer or lower-priced option.";
  }
  if (trigger === "price_hesitation") {
    return "I can help compare value and find a lower-priced alternative.";
  }
  if (trigger === "wishlist_save") {
    return "I can compare this with related products when you are ready.";
  }
  return "I can help find the right product or useful add-on.";
}

function getCurrentPageType() {
  const path = window.location.pathname;
  const pageType = String(
    (window as any).ShopifyAnalytics?.meta?.page?.pageType ||
      document.body?.dataset?.template ||
      "",
  ).toLowerCase();

  if (path === "/") return "home";
  if (/\/collections(?:\/|$)/.test(path) || pageType.includes("collection")) {
    return "collection";
  }
  if (/\/products(?:\/|$)/.test(path) || pageType.includes("product")) {
    return "product";
  }
  if (/\/cart(?:\/|$)/.test(path) || pageType.includes("cart")) return "cart";
  if (/\/checkout(?:\/|$)/.test(path)) return "checkout";
  if (
    /\/thank_you(?:\/|$)/.test(path) ||
    Boolean((window as any).Shopify?.checkout)
  ) {
    return "thankyou";
  }
  return "other";
}

async function getCurrentProductId() {
  const product =
    (window as any).Shopify?.product ||
    (window as any).ShopifyAnalytics?.meta?.product ||
    null;
  const id = String(product?.gid || product?.id || "");
  if (id) return toProductGid(id);

  const handle = window.location.pathname.match(/\/products\/([^/?#]+)/)?.[1];
  if (!handle) return undefined;

  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    STOREFRONT_READ_TIMEOUT_MS,
  );
  try {
    const response = await fetch(`/products/${handle}.js`, {
      headers: { Accept: "application/json" },
      keepalive: true,
      signal: controller.signal,
    });
    if (!response.ok) return undefined;
    const storefrontProduct = await response.json();
    return toProductGid(storefrontProduct.id);
  } catch {
    return undefined;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function readCart() {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    STOREFRONT_READ_TIMEOUT_MS,
  );
  try {
    const response = await fetch("/cart.js", {
      headers: { Accept: "application/json" },
      keepalive: true,
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Cart read failed: ${response.status}`);
    const cart = await response.json();
    setStorefrontCurrency(cart.currency);
    const items = Array.isArray(cart.items) ? cart.items : [];
    const cartProductIds = items
      .map((item: Record<string, unknown>) => getCartItemProductId(item))
      .filter(Boolean);
    const cartVariantIds = items
      .map((item: Record<string, unknown>) => getCartItemVariantId(item))
      .filter(Boolean);

    return {
      cartToken: cart.token || "",
      cartProductIds,
      cartVariantIds,
      cartItems: items.map((item: Record<string, unknown>) => ({
        productId: getCartItemProductId(item),
        variantId: getCartItemVariantId(item),
        quantity: Number(item.quantity || 1),
        title: String(item.product_title || item.title || ""),
        handle:
          String(item.handle || item.url || "")
            .split("/products/")[1]
            ?.split(/[?#/]/)[0] || "",
      })),
      cartItemCount: Number(cart.item_count || items.length || 0),
      cartValue: Number(cart.total_price || 0) / 100,
      currency: String(cart.currency || ""),
    };
  } catch {
    return {
      cartToken: "",
      cartProductIds: [],
      cartVariantIds: [],
      cartItems: [],
      cartItemCount: 0,
      cartValue: 0,
      currency: "",
    };
  } finally {
    window.clearTimeout(timeout);
  }
}

function toProductGid(value: unknown) {
  const text = String(value || "");
  if (!text) return "";
  return text.startsWith("gid://shopify/Product/")
    ? text
    : `gid://shopify/Product/${text}`;
}

function toVariantGid(value: unknown) {
  const text = String(value || "");
  if (!text) return "";
  return text.startsWith("gid://shopify/ProductVariant/")
    ? text
    : `gid://shopify/ProductVariant/${text}`;
}

function getCartItemProductId(item: Record<string, unknown>) {
  const product = asRecord(item.product);
  return toProductGid(
    item.product_id ||
      item.productId ||
      item.product_gid ||
      item.productGid ||
      product.id,
  );
}

function getCartItemVariantId(item: Record<string, unknown>) {
  const variant = asRecord(item.variant);
  return toVariantGid(
    item.variant_id ||
      item.variantId ||
      item.id ||
      item.variant_gid ||
      item.variantGid ||
      variant.id,
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
