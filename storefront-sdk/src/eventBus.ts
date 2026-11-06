import type { SessionManager } from "./sessionManager";
import { hasTrackingConsent } from "./consent";
import { newMutationId } from "./cartState";

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
  private originalXhrOpen: typeof XMLHttpRequest.prototype.open | null = null;
  private originalXhrSend: typeof XMLHttpRequest.prototype.send | null = null;
  private authFlushInFlight = false;
  private searchTimer: number | undefined;
  private lastSearchQuery = "";
  private recentEventKeys = new Map<string, number>();
  private heartbeatTimer: number | undefined;
  private destroyed = false;
  private lastFlushAt = 0;
  private inFlight = 0;
  private retryAt = 0;
  private lastSnapshotSignature = "";
  private listeners = new AbortController();

  constructor(private options: EventBusOptions) {}

  init(): void {
    this.installNavigationTracking();
    this.installCartFetchTracking();
    this.installCartXhrTracking();
    this.installScrollTracking();
    this.installHoverTracking();
    this.installSearchTracking();
    this.installCommerceInteractionTracking();

    document.addEventListener(
      "add-to-cart",
      ((event: CustomEvent) => {
        this.track("cart_hint", {
          ...normalizePayload(event.detail),
          confirmed: false,
        });
      }) as EventListener,
      { signal: this.listeners.signal },
    );
    document.addEventListener(
      "aovboost:track",
      ((event: CustomEvent) => {
        const detail = normalizePayload(event.detail);
        this.track(String(detail.type || "widget_event"), detail);
      }) as EventListener,
      { signal: this.listeners.signal },
    );
    window.addEventListener("pagehide", this.handlePageHide);
    document.addEventListener("visibilitychange", this.handleVisibility);
    this.heartbeatTimer = window.setInterval(() => {
      if (
        Date.now() - this.lastFlushAt >= 120_000 &&
        this.options.sessionManager.isActive?.()
      )
        this.flush(true);
    }, 30_000);

    this.trackPageView();
  }

  track(type: string, payload: EventPayload = {}): void {
    if (this.destroyed) return;
    if (!hasTrackingConsent(window.AOVBoost || {})) {
      this.queue = [];
      return;
    }
    const now = Date.now();
    const dedupeKey = getDedupeKey(type, payload);
    if (dedupeKey) {
      const previous = this.recentEventKeys.get(dedupeKey) || 0;
      if (previous && (payload.mutationId || now - previous < 750)) return;
      this.recentEventKeys.set(dedupeKey, now);
      if (this.recentEventKeys.size > 100) {
        for (const [key, timestamp] of this.recentEventKeys) {
          if (!key.startsWith("mutation:") && now - timestamp > 5_000)
            this.recentEventKeys.delete(key);
        }
        if (this.recentEventKeys.size > 200)
          this.recentEventKeys.delete(
            this.recentEventKeys.keys().next().value!,
          );
      }
    }
    const event: AovboostEvent = {
      type,
      ts: now,
      sessionId: this.options.sessionManager.anonymousId,
      shop: this.options.shop,
      url: window.location.href,
      referrer: document.referrer,
      ...payload,
    };

    this.options.sessionManager.recordEvent(event);
    if (
      this.options.sessionManager.getSettings?.().analyticsEnabled !== false
    ) {
      // Bound offline buffering; a broken service must not grow storefront memory.
      this.queue.push(event);
      if (this.queue.length > 200)
        this.queue.splice(0, this.queue.length - 200);
    }
    document.dispatchEvent(
      new CustomEvent("aovboost:event", { detail: event }),
    );
    this.scheduleFlush(
      [
        "add_to_cart",
        "remove_from_cart",
        "cart_update",
        "checkout_started",
        "checkout_start",
        "widget_click",
        "recommendation_added",
      ].includes(type)
        ? 100
        : 5000,
    );
  }

  destroy(): void {
    this.flush(true);
    this.destroyed = true;
    this.listeners.abort();
    if (this.originalFetch) window.fetch = this.originalFetch;
    if (this.originalXhrOpen)
      XMLHttpRequest.prototype.open = this.originalXhrOpen;
    if (this.originalXhrSend)
      XMLHttpRequest.prototype.send = this.originalXhrSend;
    window.clearInterval(this.heartbeatTimer);
    window.clearTimeout(this.flushTimer);
    window.clearTimeout(this.searchTimer);
    window.removeEventListener("pagehide", this.handlePageHide);
    document.removeEventListener("visibilitychange", this.handleVisibility);
  }

  private handlePageHide = () => this.flush(true);
  private handleVisibility = () => {
    if (document.visibilityState === "hidden") this.flush(true);
    else if (this.queue.length) this.scheduleFlush(100);
  };

  flush(includeSnapshot = false): void {
    if (
      this.destroyed ||
      !hasTrackingConsent(window.AOVBoost || {}) ||
      this.options.sessionManager.getSettings?.().analyticsEnabled === false
    ) {
      this.queue = [];
      return;
    }
    if (this.flushTimer) {
      window.clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }

    if (this.queue.length === 0 && !includeSnapshot) return;
    if (!includeSnapshot && Date.now() < this.retryAt) {
      this.scheduleFlush(this.retryAt - Date.now());
      return;
    }
    if (this.inFlight > 0 && !includeSnapshot) {
      if (this.queue.length) this.scheduleFlush(5000);
      return;
    }
    if (document.visibilityState === "hidden" && !includeSnapshot) return;
    if (!this.options.sessionManager.getAuthPayload().sessionToken) {
      void this.flushAfterAuth();
      return;
    }

    const snapshot = this.options.sessionManager.getTelemetryEvent?.();
    const signature = snapshot ? JSON.stringify({ ...snapshot, ts: 0 }) : "";
    if (!this.queue.length && signature === this.lastSnapshotSignature) return;
    const events: AovboostEvent[] = [];
    let bytes = snapshot
      ? new TextEncoder().encode(JSON.stringify(snapshot)).length
      : 0;
    while (this.queue.length && events.length < 24) {
      const next = this.queue[0];
      const size = new TextEncoder().encode(JSON.stringify(next)).length;
      if (size > 40_000) {
        this.queue.shift();
        continue;
      }
      if (bytes + size > 48_000) break;
      events.push(this.queue.shift()!);
      bytes += size;
    }
    if (snapshot && bytes < 48_000 && this.queue.length === 0) {
      events.push(snapshot);
      this.lastSnapshotSignature = signature;
    }
    if (this.queue.length) this.scheduleFlush();
    if (!events.length) return;
    this.lastFlushAt = Date.now();
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

  private scheduleFlush(delay = 5000): void {
    if (this.destroyed) return;
    if (this.flushTimer) {
      if (delay !== 100) return;
      window.clearTimeout(this.flushTimer);
    }
    this.flushTimer = window.setTimeout(() => this.flush(), delay);
  }

  private endpoint(path: string): string {
    const base = this.options.apiBase || "/apps/aovboost";
    return `${base.replace(/\/$/, "")}${path}`;
  }

  private requeue(events: AovboostEvent[]) {
    this.queue.unshift(
      ...events.filter((event) => event.type !== "session_sync"),
    );
    if (this.queue.length > 200) this.queue.length = 200;
  }

  private async postEvents(
    events: AovboostEvent[],
    retriedAuth = false,
  ): Promise<void> {
    if (!retriedAuth) this.inFlight += 1;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    try {
      const auth = await this.options.sessionManager.getSignedAuthPayload();
      if (!auth) {
        this.requeue(events);
        this.retryAt = Date.now() + 30_000;
        return;
      }
      const response = await fetch(this.endpoint("/events"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AOVBoost-Shop": this.options.shop,
          Authorization: `Bearer ${auth.sessionToken}`,
        },
        body: JSON.stringify({ ...auth, events }),
        keepalive: true,
        signal: controller.signal,
      });
      if (response.status === 401 && !retriedAuth) {
        const recovered =
          await this.options.sessionManager.applySessionFromResponse(response);
        if (!recovered) await this.options.sessionManager.refreshAuth();
        await this.postEvents(events, true);
      } else if (
        response.status === 429 ||
        response.status >= 500 ||
        response.status === 401
      ) {
        this.requeue(events);
        const seconds = Number(response.headers.get("Retry-After"));
        this.retryAt =
          Date.now() +
          (Number.isFinite(seconds) && seconds > 0
            ? Math.min(seconds * 1000, 120_000)
            : 30_000);
      }
    } catch {
      this.requeue(events);
      this.retryAt = Date.now() + 30_000;
    } finally {
      window.clearTimeout(timeout);
      if (!retriedAuth) {
        this.inFlight -= 1;
        if (this.queue.length)
          this.scheduleFlush(Math.max(5000, this.retryAt - Date.now()));
      }
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
      this.track("checkout_started", { path: window.location.pathname });
    }

    if (/\/cart(?:\/|$)/.test(window.location.pathname)) {
      this.track("cart_opened", { source: "cart_page" });
    }

    const product = getShopifyProduct();
    if (product) {
      const productId = toProductGid(product.gid || product.id);
      const revisited = this.options.sessionManager
        .getSnapshot()
        .viewedProductIds.includes(productId);
      this.track(revisited ? "product_revisited" : "product_viewed", {
        productId,
        handle: product.handle,
        title: product.title,
      });
    }

    const collection = getShopifyCollection();
    if (collection || window.location.pathname.includes("/collections/")) {
      this.track("collection_viewed", {
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
      const mutationId = newMutationId();
      const method = String(
        init?.method || (args[0] instanceof Request ? args[0].method : "GET"),
      ).toUpperCase();
      const bodyCopy =
        method === "POST" && isCartAddUrl(requestUrl)
          ? init?.body !== undefined
            ? Promise.resolve(init.body)
            : args[0] instanceof Request
              ? args[0]
                  .clone()
                  .text()
                  .catch(() => "")
              : Promise.resolve(undefined)
          : Promise.resolve(undefined);
      const response = await this.originalFetch!(...args);

      try {
        if (
          new Headers(
            init?.headers ||
              (args[0] instanceof Request ? args[0].headers : undefined),
          ).get("X-AOVBoost-Measurement") === "1"
        )
          return response;
        if (method === "POST" && isCartAddUrl(requestUrl) && response.ok) {
          const headers = new Headers(
            init?.headers ||
              (args[0] instanceof Request ? args[0].headers : undefined),
          );
          void Promise.all([bodyCopy, readCartAddResponse(response)])
            .then(([requestBody, responsePayload]) => {
              const requestPayload = getCartPayload(requestBody);
              if (
                !responsePayload.variantId ||
                Number(requestPayload.quantity) <= 0
              )
                return;
              this.track("add_to_cart", {
                ...requestPayload,
                ...responsePayload,
                source: "verified_fetch_response",
                requestUrl,
                confirmed: true,
                mutationId,
                recommendationOrigin:
                  headers.get("X-AOVBoost-Recommendation") === "1" ||
                  requestPayload.recommendationOrigin === true,
              });
            })
            .catch(() => {});
        } else if (
          method === "POST" &&
          isCartChangeUrl(requestUrl) &&
          response.ok
        ) {
          const payload = getCartPayload(init?.body);
          this.track(
            Number(payload.quantity) === 0
              ? "remove_from_cart"
              : "quantity_changed",
            {
              ...payload,
              requestUrl,
              confirmed: true,
              mutationId,
            },
          );
        } else if (isSearchUrl(requestUrl)) {
          this.track("search_performed", {
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

  private installCartXhrTracking(): void {
    if (
      typeof XMLHttpRequest === "undefined" ||
      this.originalXhrOpen ||
      this.originalXhrSend
    ) {
      return;
    }

    const trackVerifiedAdd = (payload: EventPayload) =>
      this.track("add_to_cart", payload);
    const trackVerifiedMutation = (type: string, payload: EventPayload) =>
      this.track(type, payload);
    const prototype = XMLHttpRequest.prototype;
    this.originalXhrOpen = prototype.open;
    this.originalXhrSend = prototype.send;
    const originalOpen = this.originalXhrOpen;
    const originalSend = this.originalXhrSend;

    prototype.open = function (
      method: string,
      url: string | URL,
      async?: boolean,
      username?: string | null,
      password?: string | null,
    ) {
      (this as XMLHttpRequest & { __aovboostUrl?: string }).__aovboostUrl =
        String(url || "");
      (
        this as XMLHttpRequest & { __aovboostMethod?: string }
      ).__aovboostMethod = method.toUpperCase();
      if (typeof async === "boolean") {
        return (originalOpen as any).call(
          this,
          method,
          url,
          async,
          username,
          password,
        );
      }
      return (originalOpen as any).call(this, method, url);
    };

    prototype.send = function (
      body?: Document | XMLHttpRequestBodyInit | null,
    ) {
      const requestUrl =
        (this as XMLHttpRequest & { __aovboostUrl?: string }).__aovboostUrl ||
        "";
      const requestPayload = getCartPayload(body as BodyInit | null);
      const mutationId = newMutationId();
      const isPost =
        (this as XMLHttpRequest & { __aovboostMethod?: string })
          .__aovboostMethod === "POST";
      if (isPost && isCartAddUrl(requestUrl)) {
        this.addEventListener(
          "load",
          () => {
            if (this.status < 200 || this.status >= 300) return;
            const responsePayload = parseCartAddResponse(
              this.responseType === "json" ? this.response : this.responseText,
            );
            if (
              !responsePayload.variantId ||
              Number(requestPayload.quantity) <= 0
            )
              return;
            trackVerifiedAdd({
              ...requestPayload,
              ...responsePayload,
              source: "verified_xhr_response",
              requestUrl,
              confirmed: true,
              mutationId,
              recommendationOrigin:
                requestPayload.recommendationOrigin === true,
            });
          },
          { once: true },
        );
      } else if (isPost && isCartChangeUrl(requestUrl)) {
        this.addEventListener(
          "load",
          () => {
            if (this.status < 200 || this.status >= 300) return;
            trackVerifiedMutation(
              Number(requestPayload.quantity) === 0
                ? "remove_from_cart"
                : "quantity_changed",
              {
                ...requestPayload,
                source: "verified_xhr_response",
                requestUrl,
                confirmed: true,
                mutationId,
              },
            );
          },
          { once: true },
        );
      }
      return originalSend.call(this, body);
    };
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
          const maxScroll =
            document.documentElement.scrollHeight - window.innerHeight;
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
        const name =
          `${target.name || ""} ${target.id || ""} ${target.type || ""}`.toLowerCase();
        if (!name.includes("search")) return;
        const query = target.value.trim();
        if (query.length < 2) return;
        if (this.searchTimer) window.clearTimeout(this.searchTimer);
        this.searchTimer = window.setTimeout(() => {
          if (query === this.lastSearchQuery) return;
          this.lastSearchQuery = query;
          this.track("search_performed", {
            query,
            source: "predictive_input",
          });
        }, 500);
      },
      true,
    );
  }

  private installCommerceInteractionTracking(): void {
    document.addEventListener(
      "click",
      (event) => {
        const target = event.target as HTMLElement | null;
        if (!target) return;
        const checkout = target.closest(
          "a[href*='/checkout'], button[name='checkout'], [data-checkout]",
        );
        if (checkout) {
          this.track("checkout_clicked", { source: "storefront_control" });
          return;
        }
        const cartOpen = target.closest(
          "a[href='/cart'], [data-cart-open], [aria-controls*='cart'], .cart-icon-bubble",
        );
        if (cartOpen) {
          this.track("cart_opened", { source: "storefront_control" });
          return;
        }
        const cartClose = target.closest(
          "[data-cart-close], .drawer__close, [aria-label*='Close cart'], [aria-label*='close cart']",
        );
        if (cartClose) {
          this.track("cart_closed", { source: "storefront_control" });
        }
      },
      true,
    );

    document.addEventListener(
      "change",
      (event) => {
        const target = event.target as
          HTMLInputElement | HTMLSelectElement | null;
        if (!target) return;
        const identity =
          `${target.name || ""} ${target.id || ""}`.toLowerCase();
        if (/quantity|updates\[/.test(identity)) {
          this.track("quantity_changed", {
            productId: getCurrentProductId(),
            quantity: Number(target.value || 0),
            source: "storefront_control",
          });
          return;
        }
        if (/variant|option|size|color|colour/.test(identity)) {
          this.track("variant_selected", {
            productId: getCurrentProductId(),
            variantId: /variant/.test(identity)
              ? toVariantGid(target.value)
              : "",
            optionName: target.name || target.id || "",
            optionValue: target.value,
            source: "storefront_control",
          });
        }
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
  return (
    win.Shopify?.collection || win.ShopifyAnalytics?.meta?.collection || null
  );
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
  return (
    window.location.pathname.slice(index + prefix.length).split("/")[0] || ""
  );
}

function getRequestUrl(request: RequestInfo | URL) {
  if (typeof request === "string") return request;
  if (request instanceof URL) return request.toString();
  return request.url || "";
}

function isCartAddUrl(url: string) {
  return isCartUrl(url, "add");
}

function isCartChangeUrl(url: string) {
  return isCartUrl(url, "change|update|clear");
}
function isCartUrl(value: string, actions: string) {
  try {
    const url = new URL(value, window.location.origin);
    return (
      url.origin === window.location.origin &&
      new RegExp(`/cart/(?:${actions})(?:\\.js)?$`).test(url.pathname)
    );
  } catch {
    return false;
  }
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

function getCartPayload(body: BodyInit | null | undefined): EventPayload {
  if (!body) return {};
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    return {
      variantId: String(body.get("id") || body.get("items[0][id]") || ""),
      quantity: Number(body.get("quantity") || 1),
      recommendationOrigin: Boolean(
        body.get("properties[_aovboost_offer_id]") ||
        body.get("items[0][properties][_aovboost_offer_id]"),
      ),
    };
  }
  if (
    typeof URLSearchParams !== "undefined" &&
    body instanceof URLSearchParams
  ) {
    return {
      variantId: String(body.get("id") || body.get("items[0][id]") || ""),
      quantity: Number(body.get("quantity") || 1),
      recommendationOrigin: Boolean(
        body.get("properties[_aovboost_offer_id]") ||
        body.get("items[0][properties][_aovboost_offer_id]"),
      ),
    };
  }

  try {
    const text = String(body);
    if (text.trim().startsWith("{")) {
      const parsed = JSON.parse(text);
      return {
        productId: parsed.productId || parsed.product_id,
        variantId: parsed.id || parsed.items?.[0]?.id,
        quantity: parsed.quantity ?? parsed.items?.[0]?.quantity ?? 1,
        recommendationOrigin: Boolean(
          parsed.properties?._aovboost_offer_id ||
          parsed.items?.some(
            (item: any) => item.properties?._aovboost_offer_id,
          ),
        ),
      };
    }

    const params = new URLSearchParams(text);
    return {
      variantId: String(params.get("id") || params.get("items[0][id]") || ""),
      quantity: Number(params.get("quantity") || 1),
      recommendationOrigin: Boolean(
        params.get("properties[_aovboost_offer_id]") ||
        params.get("items[0][properties][_aovboost_offer_id]"),
      ),
    };
  } catch {
    return {};
  }
}

function getDedupeKey(type: string, payload: EventPayload) {
  if (
    payload.mutationId &&
    ["add_to_cart", "remove_from_cart", "quantity_changed"].includes(type)
  )
    return `mutation:${type}:${payload.mutationId}`;
  if (
    ![
      "add_to_cart",
      "remove_from_cart",
      "quantity_changed",
      "cart_opened",
      "cart_closed",
    ].includes(type)
  ) {
    return "";
  }
  return [
    type,
    String(payload.productId || ""),
    String(payload.variantId || ""),
    String(payload.quantity || ""),
  ].join(":");
}

function getCurrentProductId() {
  const product = getShopifyProduct();
  return product ? toProductGid(product.gid || product.id) : "";
}

async function readCartAddResponse(response: Response): Promise<EventPayload> {
  try {
    return parseCartAddResponse(await response.clone().json());
  } catch {
    return {};
  }
}

function parseCartAddResponse(value: unknown): EventPayload {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return {};
    }
  }
  const record = normalizePayload(parsed);
  const firstItem = Array.isArray(record.items)
    ? normalizePayload(record.items[0])
    : record;
  return {
    productId: toProductGid(
      firstItem.product_id ||
        firstItem.productId ||
        normalizePayload(firstItem.product).id,
    ),
    variantId: toVariantGid(
      firstItem.variant_id || firstItem.variantId || firstItem.id,
    ),
    quantity: Number(firstItem.quantity || 1),
  };
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
