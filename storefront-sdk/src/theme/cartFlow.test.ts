// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./loader", async () => {
  const engine = await import("./engine");
  return { loadThemeEngine: async () => engine };
});
import { EventBus } from "../eventBus";
import { TriggerRouter } from "../triggerRouter";
import { OfferPoller } from "../offerPoller";
import { WidgetManager } from "../widgets/widgetManager";
import {
  defaultThemeConfig,
  type ThemeRuntimeConfig,
} from "../../../shared/themeCompatibility";
import { NATIVE_CART_INTENT_KEY } from "../nativeCartContinuation";
let active: { destroy: () => void } | undefined;
let hasItem = false;
let themeAfterAdd = "dawn-drawer";
let network: ReturnType<typeof vi.fn>;
let recorded: ReturnType<typeof vi.fn>;
const fixture = (name: string) => {
  document.body.innerHTML = readFileSync(
    resolve(process.cwd(), `storefront-sdk/test/fixtures/themes/${name}.html`),
    "utf8",
  );
};
const card = {
  productId: "gid://shopify/Product/2",
  reason: "Selected from the verified catalog.",
  product: {
    id: "gid://shopify/Product/2",
    handle: "conditioner",
    title: "Conditioner",
    price: "12.00",
    variantId: "gid://shopify/ProductVariant/102",
    variants: [
      {
        id: "gid://shopify/ProductVariant/102",
        title: "Default",
        price: "12.00",
        availableForSale: true,
      },
    ],
  },
};
const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  });
const auth = {
  shop: "one.myshopify.com",
  sessionId: "signed-shopper",
  sessionToken: "synthetic-signed-token",
};
function flow(config: ThemeRuntimeConfig = defaultThemeConfig("123")) {
  recorded = vi.fn();
  const settings = {
    focusedMode: true,
    analyticsEnabled: false,
    upsellEnabled: true,
    themeCompatibility: config,
  };
  const session = {
    anonymousId: auth.sessionId,
    getSettings: () => settings,
    getAuthPayload: () => auth,
    getSignedAuthPayload: async () => auth,
    recordEvent: recorded,
    getSnapshot: () => ({
      cartProductIds: [],
      cartValue: 0,
      viewedProductIds: [],
      context: {},
      hesitationScore: 0,
      sessionDuration: 0,
    }),
  } as any;
  const manager = new WidgetManager(settings);
  const bus = new EventBus({
    shop: auth.shop,
    sessionManager: session,
    apiBase: "/apps/aovboost",
  });
  const poller = new OfferPoller({
    shop: auth.shop,
    apiBase: "/apps/aovboost",
    sessionManager: session,
    widgetManager: manager,
    eventBus: bus,
  });
  const router = new TriggerRouter({
    eventBus: bus,
    offerPoller: poller,
    sessionManager: session,
  });
  window.AOVBoostSDK = { getSignedAuthPayload: async () => auth } as any;
  router.init();
  bus.init();
  poller.init();
  active = {
    destroy: () => {
      router.destroy();
      poller.destroy();
      bus.destroy();
      manager.destroy();
    },
  };
  return { manager, bus };
}
const impressions = () =>
  recorded.mock.calls
    .map(([event]) => event)
    .filter((event) => event.type === "widget_impression");
const offerRequests = () =>
  network.mock.calls.filter(([url]) => String(url).endsWith("/offer"));
beforeEach(() => {
  vi.useFakeTimers();
  sessionStorage.clear();
  localStorage.clear();
  history.replaceState({}, "", "/products/shampoo");
  vi.spyOn(document, "referrer", "get").mockReturnValue(
    new URL("/products/shampoo", location.origin).href,
  );
  window.AOVBoost = { apiBase: "/apps/aovboost" };
  (window as any).Shopify = {
    routes: { root: "/fr/" },
    theme: { id: 123, name: "Dawn", schema_name: "Dawn" },
  };
  fixture("redirect-product");
  hasItem = false;
  themeAfterAdd = "dawn-drawer";
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 20,
    top: 20,
    right: 320,
    bottom: 220,
    width: 300,
    height: 200,
  } as DOMRect);
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: () =>
      document.querySelector("[data-aovboost-widget='upsell_drawer']") ||
      document.body,
  });
  network = vi.fn(async (input, init) => {
    const url = String(input);
    if (url.endsWith("cart/add.js")) {
      hasItem = true;
      fixture(themeAfterAdd);
      return json({ product_id: 1, id: 101, quantity: 1 });
    }
    if (url.endsWith("cart.js"))
      return json({
        currency: "USD",
        item_count: hasItem ? 1 : 0,
        total_price: hasItem ? 2000 : 0,
        items: hasItem
          ? [{ key: "line-one", product_id: 1, variant_id: 101, quantity: 1 }]
          : [],
      });
    if (url.endsWith("conditioner.js"))
      return json({
        id: 2,
        variants: [{ id: 102, price: 1200, available: true }],
      });
    if (url.endsWith("shampoo.js")) return json({ id: 1 });
    if (url.endsWith("/offer")) {
      const body = JSON.parse(String(init.body));
      return json({
        widgetType: "upsell_drawer",
        aiProvider: "heuristic",
        payload: {
          offerId: `offer-${body.triggerPayload.mutationId}`,
          triggerType: "cart_item_added",
          mutationId: body.triggerPayload.mutationId,
          products: [card],
        },
      });
    }
    return json({ ok: true });
  });
  vi.stubGlobal("fetch", network);
});
afterEach(() => {
  active?.destroy();
  active = undefined;
  document.body.innerHTML = "";
  delete (window as any).Shopify;
  delete (window as any).AOVBoostSDK;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("confirmed adds through the adaptive cart ladder", () => {
  it.each(["dawn-drawer", "custom-drawer"])(
    "verifies one additive card in the %s fixture without a second modal",
    async (name) => {
      themeAfterAdd = name;
      const config = defaultThemeConfig("123");
      if (name === "custom-drawer") {
        (window as any).Shopify.theme.schema_name = "Custom";
        Object.assign(config, {
          status: "verified",
          genericDrawer: true,
          drawerSelector: "#MiniCart",
        });
      }
      flow(config);
      await vi.advanceTimersByTimeAsync(150);
      expect(offerRequests()).toHaveLength(0);
      await fetch("/fr/cart/add.js", {
        method: "POST",
        body: JSON.stringify({ id: 101 }),
      });
      await vi.advanceTimersByTimeAsync(3000);
      expect(offerRequests()).toHaveLength(1);
      expect(impressions()).toHaveLength(1);
      expect(impressions()[0]).toMatchObject({
        verified: true,
        strategy: "native_drawer",
      });
      const host = document.querySelector(
        "[data-aovboost-widget='upsell_drawer']",
      )!;
      expect(host.closest("[role='dialog']")).not.toBeNull();
      expect(host.shadowRoot!.querySelector(".backdrop")).toBeNull();
      expect(host.shadowRoot!.querySelector("[data-add]")).not.toBeNull();
      expect(
        document.querySelectorAll("[data-aovboost-widget='upsell_drawer']"),
      ).toHaveLength(1);
      // A recommendation-origin add updates the cart without requesting another offer.
      document.dispatchEvent(
        new CustomEvent("aovboost:event", {
          detail: {
            type: "add_to_cart",
            confirmed: true,
            mutationId: "own-add",
            recommendationOrigin: true,
          },
        }),
      );
      await vi.advanceTimersByTimeAsync(500);
      expect(offerRequests()).toHaveLength(1);
    },
  );
  it("waits for a native popup to close before verifying the non-modal floating fallback", async () => {
    themeAfterAdd = "dawn-popup";
    flow();
    await vi.advanceTimersByTimeAsync(150);
    await fetch("/fr/cart/add.js", {
      method: "POST",
      body: JSON.stringify({ id: 101 }),
    });
    await vi.advanceTimersByTimeAsync(2200);
    expect(impressions()).toHaveLength(0);
    expect(
      document.querySelector("[data-aovboost-widget='upsell_drawer']"),
    ).toBeNull();
    document.querySelector("cart-notification")!.remove();
    await vi.advanceTimersByTimeAsync(1200);
    expect(impressions()).toHaveLength(1);
    expect(impressions()[0]).toMatchObject({
      strategy: "floating_card",
      verified: true,
    });
    expect(
      document.querySelector("[data-aovboost-widget='upsell_drawer']")!
        .parentElement,
    ).toBe(document.body);
  });
  it("continues a native POST into one verified cart-page offer and keeps the next reload silent", async () => {
    flow();
    await vi.advanceTimersByTimeAsync(150);
    const target = document.querySelector("form")!;
    target.dispatchEvent(
      new SubmitEvent("submit", {
        bubbles: true,
        cancelable: true,
        submitter: target.querySelector("button"),
      }),
    );
    await Promise.resolve();
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    active!.destroy();
    expect(sessionStorage.getItem(NATIVE_CART_INTENT_KEY)).not.toBeNull();
    hasItem = true; // Shopify's native request completed before this new document.
    history.replaceState({}, "", "/fr/cart");
    fixture("cart-page");
    flow();
    await vi.advanceTimersByTimeAsync(3000);
    expect(offerRequests()).toHaveLength(1);
    expect(impressions()).toHaveLength(1);
    expect(impressions()[0]).toMatchObject({
      strategy: "cart_page",
      verified: true,
    });
    expect(
      document
        .querySelector("[data-aovboost-widget='upsell_drawer']")!
        .closest("main"),
    ).not.toBeNull();
    const reports = network.mock.calls.filter(([url]) =>
      String(url).endsWith("/theme-report"),
    );
    expect(
      reports.some(
        ([, init]) =>
          JSON.parse(String(init.body)).report.cartUi === "page_redirect",
      ),
    ).toBe(true);
    active!.destroy();
    fixture("cart-page");
    flow();
    await vi.advanceTimersByTimeAsync(3000);
    expect(offerRequests()).toHaveLength(1);
    expect(impressions()).toHaveLength(0);
    expect(
      document.querySelector("[data-aovboost-widget='upsell_drawer']"),
    ).toBeNull();
  });
  it("consumes a native intent even when the destination cart read fails", async () => {
    flow();
    await vi.advanceTimersByTimeAsync(150);
    document
      .querySelector("form")!
      .dispatchEvent(
        new SubmitEvent("submit", { bubbles: true, cancelable: true }),
      );
    await Promise.resolve();
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    active!.destroy();
    history.replaceState({}, "", "/fr/cart");
    fixture("cart-page");
    network.mockImplementation(
      async () => new Response("unavailable", { status: 503 }),
    );
    flow();
    await vi.advanceTimersByTimeAsync(1000);
    expect(sessionStorage.getItem(NATIVE_CART_INTENT_KEY)).toBeNull();
    expect(offerRequests()).toHaveLength(0);
    expect(impressions()).toHaveLength(0);
  });
});
