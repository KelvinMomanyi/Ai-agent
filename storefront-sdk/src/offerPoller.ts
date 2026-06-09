import type { EventBus } from "./eventBus";
import type { SessionManager } from "./sessionManager";
import { type OfferDecision, WidgetManager } from "./widgets/widgetManager";

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

  constructor(private options: OfferPollerOptions) {}

  init(): void {
    window.setTimeout(() => this.requestOffer("initial"), 1200);
    if (this.options.pollMs) {
      this.timer = window.setInterval(
        () => this.requestOffer("poll"),
        this.options.pollMs,
      );
    }

    document.addEventListener("add-to-cart", () => {
      window.setTimeout(() => this.requestOffer("add_to_cart"), 250);
    });
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

  async requestOffer(trigger = "manual"): Promise<OfferDecision | null> {
    if (this.inFlight || this.stopped) return null;
    this.inFlight = true;

    try {
      const snapshot = this.options.sessionManager.getSnapshot();
      const body = {
        ...this.options.sessionManager.getAuthPayload(),
        currentProductId: getCurrentProductId(),
        currentPageType: getCurrentPageType(),
        cartProductIds: snapshot.cartProductIds,
        dismissedWidgets: this.options.widgetManager.getDismissedWidgets(),
        trigger,
      };

      const response = await fetch(this.endpoint("/offer"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AOVBoost-Shop": this.options.shop,
        },
        body: JSON.stringify(body),
        keepalive: true,
      });

      if (!response.ok) return null;

      const decision = (await response.json()) as OfferDecision;
      this.options.widgetManager.mountDecision(decision);
      return decision;
    } catch {
      return null;
    } finally {
      this.inFlight = false;
    }
  }

  private endpoint(path: string): string {
    return `${this.options.apiBase.replace(/\/$/, "")}${path}`;
  }
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
