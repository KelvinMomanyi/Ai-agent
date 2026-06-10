import type { SessionManager } from "./sessionManager";

type EventPayload = Record<string, unknown>;

export type AovboostEvent = {
  type: string;
  ts: number;
  sessionId: string;
  shop: string;
  url: string;
  referrer: string;
  [key: string]: unknown;
};

type EventBusOptions = {
  shop: string;
  sessionManager: SessionManager;
  apiBase?: string;
};

export class EventBus {
  private queue: AovboostEvent[] = [];
  private flushTimer: number | undefined;
  private scrollDepths = new Set<number>();
  private originalFetch: typeof window.fetch | null = null;
  private authFlushInFlight = false;

  constructor(private options: EventBusOptions) {}

  init(): void {
    this.installNavigationTracking();
    this.installCartFetchTracking();
    this.installCartDomTracking();
    this.installScrollTracking();
    this.installHoverTracking();
    this.installSearchTracking();

    document.addEventListener("add-to-cart", ((event: CustomEvent) => {
      this.track("add_to_cart", normalizePayload(event.detail));
    }) as EventListener);
    document.addEventListener("aovboost:track", ((event: CustomEvent) => {
      const detail = normalizePayload(event.detail);
      this.track(String(detail.type || "widget_event"), detail);
    }) as EventListener);
    window.addEventListener("pagehide", () => this.flush());

    this.trackPageView();
  }

  track(type: string, payload: EventPayload = {}): void {
    const event: AovboostEvent = {
      type,
      ts: Date.now(),
      sessionId: this.options.sessionManager.anonymousId,
      shop: this.options.shop,
      url: window.location.href,
      referrer: document.referrer,
      ...payload,
    };

    this.options.sessionManager.recordEvent(event);
    this.queue.push(event);
    document.dispatchEvent(
      new CustomEvent("aovboost:event", { detail: event }),
    );
    this.scheduleFlush();
  }

  flush(): void {
    if (this.flushTimer) {
      window.clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }

    if (this.queue.length === 0) return;
    if (!this.options.sessionManager.getAuthPayload().sessionToken) {
      void this.flushAfterAuth();
      return;
    }

    const events = this.queue.splice(0);
    void this.postEvents(events);
  }

  private async flushAfterAuth(): Promise<void> {
    if (this.authFlushInFlight) return;
    this.authFlushInFlight = true;
    try {
      if (await this.options.sessionManager.ensureAuthenticated()) {
        this.flush();
      }
    } finally {
      this.authFlushInFlight = false;
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = window.setTimeout(() => this.flush(), 2000);
  }

  private endpoint(path: string): string {
    const base = this.options.apiBase || "/apps/aovboost";
    return `${base.replace(/\/$/, "")}${path}`;
  }

  private async postEvents(
    events: AovboostEvent[],
    retriedAuth = false,
  ): Promise<void> {
    const auth = await this.options.sessionManager.getSignedAuthPayload();
    if (!auth) {
      this.queue.unshift(...events);
      return;
    }

    try {
      const response = await fetch(this.endpoint("/events"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AOVBoost-Shop": this.options.shop,
        },
        body: JSON.stringify({
          ...auth,
          events,
        }),
        keepalive: true,
      });

      if (response.status === 401 && !retriedAuth) {
        const recovered =
          await this.options.sessionManager.applySessionFromResponse(response);
        if (!recovered) await this.options.sessionManager.refreshAuth();
        if (!this.options.sessionManager.getAuthPayload().sessionToken) {
          this.queue.unshift(...events);
          return;
        }
        await this.postEvents(events, true);
        return;
      }

      if (!response.ok && response.status !== 401) {
        this.queue.unshift(...events);
      }
    } catch {
      this.queue.unshift(...events);
    }
  }

  private installNavigationTracking(): void {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = (...args) => {
      const result = originalPushState.apply(history, args);
      window.setTimeout(() => this.trackPageView(), 0);
      return result;
    };

    history.replaceState = (...args) => {
      const result = originalReplaceState.apply(history, args);
      window.setTimeout(() => this.trackPageView(), 0);
      return result;
    };

    window.addEventListener("popstate", () => this.trackPageView());
  }

  private trackPageView(): void {
    this.track("page_view", { pageType: getPageType() });

    if (isCheckoutPage()) {
      this.track("checkout_start", { path: window.location.pathname });
    }

    const product = getShopifyProduct();
    if (product) {
      this.track("product_view", {
        productId: toProductGid(product.gid || product.id),
        handle: product.handle,
        title: product.title,
      });
    }

    const collection = getShopifyCollection();
    if (collection || window.location.pathname.includes("/collections/")) {
      this.track("collection_view", {
        collectionId: String(collection?.id || ""),
        handle: collection?.handle || getHandleFromPath("/collections/"),
        title: collection?.title,
      });
    }
  }

  private installCartFetchTracking(): void {
    if (this.originalFetch) return;
    this.originalFetch = window.fetch.bind(window);

    window.fetch = async (...args) => {
      const requestUrl = getRequestUrl(args[0]);
      const init = args[1] as RequestInit | undefined;
      const response = await this.originalFetch!(...args);

      try {
        if (isCartAddUrl(requestUrl)) {
          this.track("add_to_cart", {
            ...getCartPayload(init?.body),
            requestUrl,
          });
        } else if (isCartChangeUrl(requestUrl)) {
          this.track("remove_from_cart", {
            ...getCartPayload(init?.body),
            requestUrl,
          });
        } else if (isSearchUrl(requestUrl)) {
          this.track("search", {
            query: getSearchQuery(requestUrl),
            requestUrl,
          });
        }
      } catch {
        // Fetch interception must never change the theme's request behavior.
      }

      return response;
    };
  }

  private installCartDomTracking(): void {
    document.addEventListener(
      "submit",
      (event) => {
        const form = event.target as HTMLFormElement | null;
        if (!form || !isCartAddUrl(form.action || "")) return;

        try {
          this.track("add_to_cart", {
            ...getCartPayload(new FormData(form)),
            source: "cart_form_submit",
            requestUrl: form.action,
          });
        } catch {
          this.track("add_to_cart", {
            source: "cart_form_submit",
            requestUrl: form.action,
          });
        }
      },
      true,
    );

    document.addEventListener(
      "click",
      (event) => {
        const target = event.target as HTMLElement | null;
        const button = target?.closest?.(
          "button[name='add'], [type='submit'][name='add'], [data-add-to-cart]",
        ) as HTMLElement | null;
        if (!button) return;
        const form = button.closest("form") as HTMLFormElement | null;
        if (form && !isCartAddUrl(form.action || "")) return;

        this.track("add_to_cart", {
          source: "add_button_click",
          requestUrl: form?.action || "",
        });
      },
      true,
    );
  }

  private installScrollTracking(): void {
    let waiting = false;
    window.addEventListener(
      "scroll",
      () => {
        if (waiting) return;
        waiting = true;
        window.setTimeout(() => {
          waiting = false;
          const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
          if (maxScroll <= 0) return;
          const percent = Math.round((window.scrollY / maxScroll) * 100);
          [25, 50, 75, 90].forEach((depth) => {
            if (percent >= depth && !this.scrollDepths.has(depth)) {
              this.scrollDepths.add(depth);
              this.track("scroll_depth", { depth });
            }
          });
        }, 200);
      },
      { passive: true },
    );
  }

  private installHoverTracking(): void {
    document.addEventListener(
      "mouseenter",
      (event) => {
        const target = event.target as HTMLElement | null;
        const card = target?.closest?.(".product-card") as HTMLElement | null;
        if (!card) return;

        const timer = window.setTimeout(() => {
          this.track("product_hover", {
            productId: card.dataset.productId || card.dataset.productGid || "",
            handle: card.dataset.productHandle || "",
          });
        }, 800);

        card.addEventListener("mouseleave", () => window.clearTimeout(timer), {
          once: true,
        });
      },
      true,
    );
  }

  private installSearchTracking(): void {
    document.addEventListener(
      "input",
      (event) => {
        const target = event.target as HTMLInputElement | null;
        if (!target) return;
        const name = `${target.name || ""} ${target.id || ""} ${target.type || ""}`.toLowerCase();
        if (!name.includes("search")) return;
        const query = target.value.trim();
        if (query.length < 2) return;
        this.track("search", { query, source: "predictive_input" });
      },
      true,
    );
  }
}

function normalizePayload(value: unknown): EventPayload {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as EventPayload)
    : {};
}

function getShopifyProduct(): Record<string, unknown> | null {
  const win = window as any;
  return win.Shopify?.product || win.ShopifyAnalytics?.meta?.product || null;
}

function getShopifyCollection(): Record<string, unknown> | null {
  const win = window as any;
  return win.Shopify?.collection || win.ShopifyAnalytics?.meta?.collection || null;
}

function getPageType() {
  const win = window as any;
  return (
    win.ShopifyAnalytics?.meta?.page?.pageType ||
    document.body?.dataset?.template ||
    (window.location.pathname === "/" ? "home" : "other")
  );
}

function isCheckoutPage() {
  return /\/checkout(?:\/|$)/.test(window.location.pathname);
}

function getHandleFromPath(prefix: string) {
  const index = window.location.pathname.indexOf(prefix);
  if (index === -1) return "";
  return window.location.pathname.slice(index + prefix.length).split("/")[0] || "";
}

function getRequestUrl(request: RequestInfo | URL) {
  if (typeof request === "string") return request;
  if (request instanceof URL) return request.toString();
  return request.url || "";
}

function isCartAddUrl(url: string) {
  return /\/cart\/add(?:\.js)?/.test(url);
}

function isCartChangeUrl(url: string) {
  return /\/cart\/(?:change|update)(?:\.js)?/.test(url);
}

function isSearchUrl(url: string) {
  return url.includes("/search/suggest.json");
}

function getSearchQuery(url: string) {
  try {
    return new URL(url, window.location.origin).searchParams.get("q") || "";
  } catch {
    return "";
  }
}

function getCartPayload(body: BodyInit | null | undefined) {
  if (!body) return {};
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    return {
      variantId: String(body.get("id") || body.get("items[0][id]") || ""),
      quantity: Number(body.get("quantity") || 1),
    };
  }
  if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) {
    return {
      variantId: String(body.get("id") || body.get("items[0][id]") || ""),
      quantity: Number(body.get("quantity") || 1),
    };
  }

  try {
    const text = String(body);
    if (text.trim().startsWith("{")) {
      const parsed = JSON.parse(text);
      return {
        productId: parsed.productId || parsed.product_id,
        variantId: parsed.id || parsed.items?.[0]?.id,
        quantity: parsed.quantity || parsed.items?.[0]?.quantity || 1,
      };
    }

    const params = new URLSearchParams(text);
    return {
      variantId: String(params.get("id") || params.get("items[0][id]") || ""),
      quantity: Number(params.get("quantity") || 1),
    };
  } catch {
    return {};
  }
}

function toProductGid(value: unknown) {
  const text = String(value || "");
  if (!text) return "";
  return text.startsWith("gid://shopify/Product/")
    ? text
    : `gid://shopify/Product/${text}`;
}
