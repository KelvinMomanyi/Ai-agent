// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OfferPoller } from "./offerPoller";
import { hydrateCartCardPrices } from "./cartCardPricing";
const cart = {
  currency: "KES",
  item_count: 1,
  total_price: 120000,
  items: [{ key: "one", product_id: 1, variant_id: 101, quantity: 1 }],
};
const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  });
const trigger = (mutationId: string) => ({
  mutationId,
  confirmed: true,
  productId: "gid://shopify/Product/1",
  variantId: "gid://shopify/ProductVariant/101",
});
const decision = (mutationId: string) => ({
  widgetType: "upsell_drawer",
  payload: {
    mutationId,
    triggerType: "cart_item_added",
    offerId: `offer-${mutationId}`,
    products: [
      {
        productId: "gid://shopify/Product/2",
        reason: "Approved",
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
      },
    ],
  },
});
let poller: OfferPoller;
beforeEach(() => {
  (window as any).AOVBoost = {};
  (window as any).Shopify = { routes: { root: "/en-ke/" }, country: "KE" };
});
afterEach(() => {
  poller?.destroy();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
  delete (window as any).Shopify;
  delete (window as any).AOVBoost;
});
function setup(focusedMode = true) {
  const mountDecision = vi
    .fn()
    .mockReturnValue({ status: "mounted", reason: "native_cart_drawer_slot" });
  const clearCartRecommendation = vi.fn();
  poller = new OfferPoller({
    shop: "one.myshopify.com",
    apiBase: "/apps/aovboost",
    eventBus: {} as any,
    sessionManager: {
      getSettings: () => ({ focusedMode }),
      getSnapshot: () => ({
        cartProductIds: ["stale-session-product"],
        cartValue: 500,
        context: { cartVariantIds: ["stale-variant"], cartItemCount: 1 },
      }),
      getSignedAuthPayload: async () => ({
        shop: "one.myshopify.com",
        sessionId: "anon",
        sessionToken: "signed",
      }),
    } as any,
    widgetManager: {
      mountDecision,
      clearCartRecommendation,
      getDismissedWidgets: () => [],
      getStatus: () => ({}),
    } as any,
  });
  return { mountDecision, clearCartRecommendation };
}
function productResponse() {
  return json({
    id: 2,
    variants: [{ id: 102, available: true, price: 155000 }],
  });
}
describe("cart request freshness and market safety", () => {
  it("honors plan suppression without mounting a local fallback widget", async () => {
    const { mountDecision } = setup(false);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) =>
        String(url).includes("cart.js")
          ? json(cart)
          : json({
              widgetType: null,
              payload: {},
              reasoning: "plan_display_allowance",
            }),
      ),
    );
    expect(await poller.requestOffer("manual")).toBeNull();
    expect(mountDecision).not.toHaveBeenCalled();
  });
  it("invalidates a card when another tab changes the cart and focus returns", async () => {
    let emptied = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        if (String(url).endsWith("cart.js"))
          return json(
            emptied
              ? { ...cart, items: [], item_count: 0, total_price: 0 }
              : cart,
          );
        if (String(url).endsWith("conditioner.js")) return productResponse();
        return json(decision("one"));
      }),
    );
    const { mountDecision, clearCartRecommendation } = setup();
    poller.init();
    await poller.requestOffer("cart_item_added", trigger("one"));
    expect(mountDecision).toHaveBeenCalledOnce();
    emptied = true;
    window.dispatchEvent(new Event("focus"));
    await vi.waitFor(() =>
      expect(clearCartRecommendation).toHaveBeenCalledTimes(2),
    );
    expect(mountDecision).toHaveBeenCalledOnce();
  });
  it("does not render after pagehide while presentment prices are loading", async () => {
    const live = deferred<Response>(),
      started = deferred<void>();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        if (String(url).endsWith("cart.js")) return json(cart);
        if (String(url).endsWith("conditioner.js")) {
          started.resolve();
          return live.promise;
        }
        return json(decision("one"));
      }),
    );
    const { mountDecision } = setup();
    poller.init();
    const pending = poller.requestOffer("cart_item_added", trigger("one"));
    await started.promise;
    window.dispatchEvent(new Event("pagehide"));
    live.resolve(productResponse());
    await pending;
    expect(mountDecision).not.toHaveBeenCalled();
  });
  it("treats a successful empty read as authoritative over trigger and session state", async () => {
    const bodies: any[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        if (String(url).endsWith("cart.js"))
          return json({ ...cart, items: [], item_count: 0, total_price: 0 });
        bodies.push(JSON.parse(init.body));
        return json({ widgetType: null });
      }),
    );
    setup(false);
    await poller.requestOffer("manual", {
      cartProductIds: ["stale-trigger"],
      cartItemCount: 4,
    });
    expect(bodies[0]).toMatchObject({
      cartProductIds: [],
      cartVariantIds: [],
      cartItems: [],
      cartItemCount: 0,
      cartValue: 0,
    });
  });
  it.each(["empty", "failed"])(
    "shows nothing for a confirmed add when the live read is %s",
    async (mode) => {
      const fetch = vi.fn(async () =>
        mode === "empty"
          ? json({ ...cart, items: [], item_count: 0 })
          : new Response("", { status: 500 }),
      );
      vi.stubGlobal("fetch", fetch);
      const { mountDecision } = setup();
      expect(
        await poller.requestOffer("cart_item_added", trigger("one")),
      ).toBeNull();
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(mountDecision).not.toHaveBeenCalled();
    },
  );
  it("discards a response superseded by a newer mutation, then renders the latest ranking", async () => {
    const first = deferred<Response>(),
      started = deferred<void>();
    const bodies: any[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        if (String(url).endsWith("cart.js")) return json(cart);
        if (String(url).endsWith("conditioner.js")) return productResponse();
        bodies.push(JSON.parse(init.body));
        if (bodies.length === 1) {
          started.resolve();
          return first.promise;
        }
        return json(decision("two"));
      }),
    );
    const { mountDecision, clearCartRecommendation } = setup();
    poller.init();
    const older = poller.requestOffer("cart_item_added", trigger("one"));
    await started.promise;
    document.dispatchEvent(
      new CustomEvent("aovboost:event", {
        detail: { type: "add_to_cart", ...trigger("two") },
      }),
    );
    await poller.requestOffer("cart_item_added", trigger("two"));
    first.resolve(json(decision("one")));
    await older;
    await vi.waitFor(() => expect(mountDecision).toHaveBeenCalledTimes(1));
    expect(mountDecision.mock.calls[0][0].payload).toMatchObject({
      mutationId: "two",
      offerId: "offer-two",
    });
    expect(
      mountDecision.mock.calls[0][0].payload.products[0].product.price,
    ).toBe("1550.00");
    expect(bodies[1]).toMatchObject({
      currency: "KES",
      market: "KE",
      cartItems: [{ key: "one", quantity: 1 }],
    });
    expect(clearCartRecommendation).toHaveBeenCalledTimes(2);
  });
  it("clears the card for an own add without making another offer request", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const { clearCartRecommendation } = setup();
    poller.init();
    document.dispatchEvent(
      new CustomEvent("aovboost:event", {
        detail: {
          type: "add_to_cart",
          ...trigger("own"),
          recommendationOrigin: true,
        },
      }),
    );
    expect(clearCartRecommendation).toHaveBeenCalledOnce();
    expect(
      await poller.requestOffer("cart_item_added", {
        ...trigger("own"),
        recommendationOrigin: true,
      }),
    ).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("never converts restored carts or focused startup into a recommendation request", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    setup();
    expect(await poller.requestOffer("initial")).toBeNull();
    expect(await poller.requestOffer("cart_restored")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("drops stale cards while market rehydration is pending across navigation", async () => {
    const live = deferred<Response>(),
      started = deferred<void>();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        if (String(url).endsWith("cart.js")) return json(cart);
        if (String(url).endsWith("conditioner.js")) {
          started.resolve();
          return live.promise;
        }
        return json(decision("one"));
      }),
    );
    const { mountDecision } = setup();
    const pending = poller.requestOffer("cart_item_added", trigger("one"));
    await started.promise;
    window.history.replaceState({}, "", "/pages/about");
    live.resolve(productResponse());
    await pending;
    expect(mountDecision).not.toHaveBeenCalled();
  });
  it.each([
    "unavailable",
    "wrong-product",
    "wrong-variant",
    "no-price",
    "failure",
  ])("withholds market cards for %s", async (mode) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        mode === "failure"
          ? new Response("", { status: 500 })
          : json({
              id: mode === "wrong-product" ? 999 : 2,
              variants: [
                {
                  id: mode === "wrong-variant" ? 999 : 102,
                  available: mode !== "unavailable",
                  price: mode === "no-price" ? null : 155000,
                },
              ],
            }),
      ),
    );
    expect(
      (await hydrateCartCardPrices(decision("one"))).widgetType,
    ).toBeNull();
  });
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
