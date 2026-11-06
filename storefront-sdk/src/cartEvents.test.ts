// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "./eventBus";
import { TriggerRouter } from "./triggerRouter";
let bus: EventBus | undefined;
let router: TriggerRouter | undefined;
const cart = {
  items: [{ product_id: 1, variant_id: 101, quantity: 1 }],
  item_count: 1,
  total_price: 1200,
  currency: "USD",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  router?.destroy();
  bus?.destroy();
  router = undefined;
  bus = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function setupBus() {
  const recordEvent = vi.fn();
  bus = new EventBus({
    shop: "one.myshopify.com",
    sessionManager: {
      anonymousId: "anon",
      recordEvent,
      getSnapshot: () => ({ viewedProductIds: [] }),
      getAuthPayload: () => ({ sessionToken: "fake" }),
      getSignedAuthPayload: async () => null,
    } as any,
  });
  bus.init();
  return recordEvent;
}
describe("confirmed cart mutation identity", () => {
  it("returns the original successful response before asynchronous instrumentation finishes", async () => {
    let finish!: (value: unknown) => void;
    const body = new Promise((resolve) => {
      finish = resolve;
    });
    const response = {
      ok: true,
      clone: () => ({ json: () => body }),
    } as unknown as Response;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const events = setupBus();
    expect(
      await fetch("/cart/add.js", {
        method: "POST",
        body: JSON.stringify({ id: 101 }),
      }),
    ).toBe(response);
    expect(
      events.mock.calls.filter(([event]) => event.type === "add_to_cart"),
    ).toHaveLength(0);
    finish({ id: 101, product_id: 1, quantity: 1 });
    await vi.waitFor(() =>
      expect(
        events.mock.calls.filter(([event]) => event.type === "add_to_cart"),
      ).toHaveLength(1),
    );
  });
  it("ignores custom hints, failed responses, reads and other origins", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(json({ id: 101, product_id: 1, quantity: 1 })),
    );
    const events = setupBus();
    document.dispatchEvent(
      new CustomEvent("add-to-cart", { detail: { productId: 1 } }),
    );
    await fetch("https://other.example/cart/add.js", { method: "POST" });
    await fetch("/cart/add.js");
    await Promise.resolve();
    expect(
      events.mock.calls.filter(([e]) => e.type === "add_to_cart"),
    ).toHaveLength(0);
  });
  it("tracks rapid same-variant adds separately and batches only once", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () =>
        json({
          items: [
            { id: 101, product_id: 1, quantity: 1 },
            { id: 102, product_id: 2, quantity: 1 },
          ],
        }),
      ),
    );
    const events = setupBus();
    await fetch("/cart/add.js", {
      method: "POST",
      body: JSON.stringify({ items: [{ id: 101 }, { id: 102 }] }),
    });
    await fetch("/cart/add.js", {
      method: "POST",
      body: JSON.stringify({ id: 101 }),
    });
    await vi.waitFor(() =>
      expect(
        events.mock.calls.filter(([e]) => e.type === "add_to_cart"),
      ).toHaveLength(2),
    );
    const adds = events.mock.calls
      .map(([e]) => e)
      .filter((e) => e.type === "add_to_cart");
    expect(new Set(adds.map((e) => e.mutationId)).size).toBe(2);
    expect(adds[0]).toMatchObject({
      confirmed: true,
      productId: "gid://shopify/Product/1",
      variantId: "gid://shopify/ProductVariant/101",
    });
    bus!.track("add_to_cart", adds[0]);
    expect(
      events.mock.calls.filter(([e]) => e.type === "add_to_cart"),
    ).toHaveLength(2);
  });
  it("tags recommendation adds from headers and line properties", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(async () =>
          json({ id: 101, product_id: 1, quantity: 1 }),
        ),
    );
    const events = setupBus();
    await fetch("/cart/add.js", {
      method: "POST",
      headers: { "X-AOVBoost-Recommendation": "1" },
      body: JSON.stringify({ id: 101 }),
    });
    const form = new FormData();
    form.set("id", "101");
    form.set("properties[_aovboost_offer_id]", "offer-one");
    await fetch("/cart/add.js", { method: "POST", body: form });
    await vi.waitFor(() =>
      expect(
        events.mock.calls.filter(([e]) => e.type === "add_to_cart"),
      ).toHaveLength(2),
    );
    expect(
      events.mock.calls
        .map(([e]) => e)
        .filter((e) => e.type === "add_to_cart")
        .every((e) => e.recommendationOrigin === true),
    ).toBe(true);
  });
  it("normalizes a successful XHR and rejects its failed counterpart", () => {
    class Xhr extends EventTarget {
      status = 200;
      responseType = "json";
      response = { id: 101, product_id: 1 };
      responseText = "";
      open() {}
      send() {
        this.dispatchEvent(new Event("load"));
      }
    }
    vi.stubGlobal("XMLHttpRequest", Xhr);
    vi.stubGlobal("fetch", vi.fn());
    const events = setupBus();
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/cart/add.js");
    xhr.send(JSON.stringify({ id: 101 }));
    const failed = new XMLHttpRequest();
    (failed as any).status = 422;
    failed.open("POST", "/cart/add.js");
    failed.send();
    const adds = events.mock.calls
      .map(([e]) => e)
      .filter((e) => e.type === "add_to_cart");
    expect(adds).toHaveLength(1);
    expect(adds[0]).toMatchObject({
      confirmed: true,
      source: "verified_xhr_response",
      mutationId: expect.any(String),
    });
  });
});
function setupRouter() {
  const track = vi.fn((type, payload) =>
    document.dispatchEvent(
      new CustomEvent("aovboost:event", { detail: { type, ...payload } }),
    ),
  );
  const requestOffer = vi.fn();
  router = new TriggerRouter({
    eventBus: { track } as any,
    offerPoller: { requestOffer } as any,
    sessionManager: {
      getSettings: () => ({ focusedMode: true }),
      getSnapshot: () => ({
        context: {},
        hesitationScore: 0,
        viewedProductIds: [],
      }),
    } as any,
  });
  router.init();
  return { track, requestOffer };
}
function mutation(detail: Record<string, unknown>) {
  document.dispatchEvent(
    new CustomEvent("aovboost:event", {
      detail: {
        type: "add_to_cart",
        confirmed: true,
        mutationId: "one",
        ...detail,
      },
    }),
  );
}
describe("restored vs added cart routing", () => {
  it("restores state on any page without requesting an unsolicited offer", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(cart)));
    const { track, requestOffer } = setupRouter();
    await vi.advanceTimersByTimeAsync(1000);
    expect(track).toHaveBeenCalledWith(
      "cart_restored",
      expect.objectContaining({ cartItemCount: 1 }),
    );
    expect(requestOffer).not.toHaveBeenCalled();
  });
  it("fires once for a confirmed mutation, ignores hints/duplicates and self-origin adds", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => json(cart)),
    );
    const { requestOffer } = setupRouter();
    mutation({ confirmed: false, mutationId: "hint" });
    mutation({
      productId: "gid://shopify/Product/1",
      variantId: "gid://shopify/ProductVariant/101",
    });
    mutation({});
    await vi.advanceTimersByTimeAsync(400);
    expect(requestOffer).toHaveBeenCalledTimes(1);
    expect(requestOffer).toHaveBeenCalledWith(
      "cart_item_added",
      expect.objectContaining({
        mutationId: "one",
        confirmed: true,
        cartProductIds: ["gid://shopify/Product/1"],
      }),
    );
    mutation({ mutationId: "own", recommendationOrigin: true });
    await vi.advanceTimersByTimeAsync(400);
    expect(requestOffer).toHaveBeenCalledTimes(1);
  });
  it("does not request after an authoritative empty cart or failed read", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(async () =>
          json({ ...cart, items: [], item_count: 0, total_price: 0 }),
        ),
    );
    const { requestOffer, track } = setupRouter();
    mutation({});
    await vi.advanceTimersByTimeAsync(400);
    expect(requestOffer).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith(
      "cart_update",
      expect.objectContaining({ cartProductIds: [], cartItemCount: 0 }),
    );
  });
  it("rejects a custom cart trigger even if it claims confirmation", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(cart)));
    const { requestOffer } = setupRouter();
    router!.trigger("cart_item_added", {
      confirmed: true,
      mutationId: "custom",
    });
    document.dispatchEvent(
      new CustomEvent("aovboost:trigger", {
        detail: { type: "cart_item_added", confirmed: true },
      }),
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(requestOffer).not.toHaveBeenCalled();
  });
});
