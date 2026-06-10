import type { EventBus } from "./eventBus";
import type { SessionManager } from "./sessionManager";
import type { OfferDecision, WidgetManager } from "./widgets/widgetManager";

type OfferPollerOptions = {
  shop: string;
  apiBase: string;
  eventBus: EventBus;
  sessionManager: SessionManager;
  widgetManager: WidgetManager;
  pollMs?: number;
};

export class OfferPoller {
  private timer: number | undefined;
  private inFlight = false;
  private stopped = false;
  private options: OfferPollerOptions;

  constructor(options: OfferPollerOptions) {
    this.options = options;
  }

  init(): void {
    window.setTimeout(() => this.requestOffer("initial"), 1200);
    if (this.options.pollMs) {
      this.timer = window.setInterval(
        () => this.requestOffer("poll"),
        this.options.pollMs,
      );
    }

    document.addEventListener("aovboost:request-offer", () => {
      this.requestOffer("manual");
    });
    window.addEventListener("popstate", () => {
      window.setTimeout(() => this.requestOffer("navigation"), 300);
    });
  }

  destroy(): void {
    this.stopped = true;
    if (this.timer) window.clearInterval(this.timer);
  }

  async requestOffer(
    trigger = "manual",
    triggerPayload: Record<string, unknown> = {},
  ): Promise<OfferDecision | null> {
    if (this.inFlight || this.stopped) return null;
    this.inFlight = true;

    try {
      const snapshot = this.options.sessionManager.getSnapshot();
      const cartProductIds = Array.isArray(triggerPayload.cartProductIds)
        ? triggerPayload.cartProductIds.map(String)
        : snapshot.cartProductIds;
      const cartValue =
        typeof triggerPayload.cartValue === "number"
          ? triggerPayload.cartValue
          : snapshot.cartValue;
      const body = {
        ...this.options.sessionManager.getAuthPayload(),
        currentProductId: getCurrentProductId(),
        currentPageType: getCurrentPageType(),
        cartProductIds,
        cartValue,
        dismissedWidgets: this.options.widgetManager.getDismissedWidgets(),
        trigger,
        triggerCategory: triggerPayload.triggerCategory,
        triggerPayload,
      };

      if (!this.options.sessionManager.getAuthPayload().sessionToken) {
        return this.mountLocalFallback(trigger, triggerPayload);
      }

      let response = await fetch(this.endpoint("/offer"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AOVBoost-Shop": this.options.shop,
        },
        body: JSON.stringify(body),
        keepalive: true,
      });

      if (response.status === 401) {
        await this.options.sessionManager.refreshAuth();
        response = await fetch(this.endpoint("/offer"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-AOVBoost-Shop": this.options.shop,
          },
          body: JSON.stringify({
            ...body,
            ...this.options.sessionManager.getAuthPayload(),
          }),
          keepalive: true,
        });
      }

      if (!response.ok) return this.mountLocalFallback(trigger, triggerPayload);

      const decision = (await response.json()) as OfferDecision;
      if (!decision.widgetType) {
        return this.mountLocalFallback(trigger, triggerPayload);
      }

      this.options.widgetManager.mountDecision(decision);
      return decision;
    } catch {
      return this.mountLocalFallback(trigger, triggerPayload);
    } finally {
      this.inFlight = false;
    }
  }

  private endpoint(path: string): string {
    return `${this.options.apiBase.replace(/\/$/, "")}${path}`;
  }

  private mountLocalFallback(
    trigger: string,
    triggerPayload: Record<string, unknown>,
  ): OfferDecision | null {
    const decision = buildLocalFallbackDecision(trigger, triggerPayload);
    if (!decision) return null;

    this.options.widgetManager.mountDecision(decision);
    return decision;
  }
}

function buildLocalFallbackDecision(
  trigger: string,
  payload: Record<string, unknown>,
): OfferDecision | null {
  const cartValue = Number(payload.cartValue || 0);

  switch (trigger) {
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
          greeting: "Hi. I can help you compare products and find useful add-ons.",
          copy: {
            greeting: "Hi. I can help you compare products and find useful add-ons.",
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
      return {
        widgetType: "discount_nudge",
        payload: {
          offerId: `local:${trigger}`,
          cartValue,
          threshold: Number(payload.threshold || 50),
          copy: {
            progressLabel: "You are close to a reward",
            rewardDescription: "Add one more item to unlock the offer.",
            ctaText: "View picks",
          },
        },
        reasoning: "Local fallback for cart value or idle cart trigger.",
        confidence: 0.4,
        aiProvider: "heuristic",
      };

    case "flash_sale_window":
    case "seasonal_calendar":
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
              trigger === "price_drop_webhook" ? "Price update" : "Limited stock",
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
  if (/\/thank_you(?:\/|$)/.test(path) || Boolean((window as any).Shopify?.checkout)) {
    return "thankyou";
  }
  return "other";
}

function getCurrentProductId() {
  const product =
    (window as any).Shopify?.product ||
    (window as any).ShopifyAnalytics?.meta?.product ||
    null;
  if (!product) return undefined;

  const id = String(product.gid || product.id || "");
  if (!id) return undefined;
  return id.startsWith("gid://shopify/Product/")
    ? id
    : `gid://shopify/Product/${id}`;
}
