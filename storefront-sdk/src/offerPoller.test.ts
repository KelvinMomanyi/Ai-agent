// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { OfferPoller } from "./offerPoller";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/");
});

describe("OfferPoller", () => {
  it("queues revenue and assistant requests instead of dropping an in-flight trigger", async () => {
    const firstOffer = deferred<Response>();
    const firstOfferStarted = deferred<void>();
    const offerBodies: Array<Record<string, unknown>> = [];
    const mountDecision = vi
      .fn()
      .mockReturnValue({ status: "mounted", reason: "test_slot" });

    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/cart.js") {
          return jsonResponse({
            currency: "USD",
            items: [],
            item_count: 0,
            total_price: 0,
          });
        }
        if (url.endsWith("/offer")) {
          offerBodies.push(JSON.parse(String(init?.body || "{}")));
          if (offerBodies.length === 1) {
            firstOfferStarted.resolve();
            return firstOffer.promise;
          }
          return jsonResponse({
            widgetType: "chat",
            payload: { offerId: "offer-chat" },
          });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      },
    );

    const poller = new OfferPoller({
      shop: "example.myshopify.com",
      apiBase: "/apps/aovboost",
      eventBus: {} as any,
      sessionManager: sessionManagerStub() as any,
      widgetManager: {
        mountDecision,
        getDismissedWidgets: () => [],
        getStatus: () => ({ mountedWidgetTypes: [] }),
      } as any,
    });

    const initialRequest = poller.requestOffer("initial");
    await firstOfferStarted.promise;
    await expect(
      poller.requestOffer("assistant_bootstrap"),
    ).resolves.toBeNull();

    firstOffer.resolve(
      jsonResponse({
        widgetType: "rec_strip",
        payload: { offerId: "offer-rec" },
      }),
    );
    await initialRequest;

    await vi.waitFor(() => expect(offerBodies).toHaveLength(2));
    expect(offerBodies.map((body) => body.trigger)).toEqual([
      "initial",
      "assistant_bootstrap",
    ]);
    expect(mountDecision).toHaveBeenCalledTimes(2);
    expect(poller.getStatus().recentDecisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          trigger: "initial",
          outcome: "mounted",
          widgetType: "rec_strip",
        }),
      ]),
    );
    poller.destroy();
  });

  it("reports why a catalog-backed startup offer did not render", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input: RequestInfo | URL) => {
        if (String(input) === "/cart.js") {
          return jsonResponse({ items: [], item_count: 0, total_price: 0 });
        }
        return jsonResponse({
          widgetType: null,
          payload: {},
          reasoning:
            "No catalog-backed products were available for this widget.",
        });
      },
    );
    const poller = new OfferPoller({
      shop: "example.myshopify.com",
      apiBase: "/apps/aovboost",
      eventBus: {} as any,
      sessionManager: sessionManagerStub() as any,
      widgetManager: {
        mountDecision: vi.fn(),
        getDismissedWidgets: () => [],
        getStatus: () => ({ mountedWidgetTypes: [] }),
      } as any,
    });

    await expect(poller.requestOffer("initial")).resolves.toBeNull();
    expect(poller.getStatus().recentDecisions.at(-1)).toMatchObject({
      trigger: "initial",
      outcome: "no_offer",
      widgetType: null,
      reasoning: "No catalog-backed products were available for this widget.",
      httpStatus: 200,
    });
  });
  it("records placement suppression without claiming the offer was mounted", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      String(input) === "/cart.js"
        ? jsonResponse({ items: [], item_count: 0, total_price: 0 })
        : jsonResponse({ widgetType: "bundle", payload: {} }),
    );
    const mountDecision = vi
      .fn()
      .mockReturnValue({
        status: "suppressed",
        reason: "bundle_requires_product_page",
      });
    const poller = new OfferPoller({
      shop: "example.myshopify.com",
      apiBase: "/apps/aovboost",
      eventBus: {} as any,
      sessionManager: sessionManagerStub() as any,
      widgetManager: {
        mountDecision,
        getDismissedWidgets: () => [],
        getStatus: () => ({}),
      } as any,
    });
    await poller.requestOffer("initial");
    expect(mountDecision).toHaveBeenCalledTimes(1);
    expect(poller.getStatus().recentDecisions.at(-1)).toMatchObject({
      outcome: "suppressed",
      placementReason: "bundle_requires_product_page",
    });
    poller.destroy();
  });

  it("discards an offer response when the shopper has navigated elsewhere", async () => {
    const response = deferred<Response>();
    const started = deferred<void>();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input) === "/cart.js")
        return jsonResponse({ items: [], item_count: 0, total_price: 0 });
      started.resolve();
      return response.promise;
    });
    const mountDecision = vi.fn();
    const poller = new OfferPoller({
      shop: "example.myshopify.com",
      apiBase: "/apps/aovboost",
      eventBus: {} as any,
      sessionManager: sessionManagerStub() as any,
      widgetManager: { mountDecision, getDismissedWidgets: () => [] } as any,
    });
    const request = poller.requestOffer("initial");
    await started.promise;
    window.history.replaceState({}, "", "/collections/new");
    response.resolve(jsonResponse({ widgetType: "rec_strip", payload: {} }));
    await expect(request).resolves.toBeNull();
    expect(mountDecision).not.toHaveBeenCalled();
    poller.destroy();
  });

  it("sends product context for a collection-scoped product URL", async () => {
    window.history.replaceState({}, "", "/collections/snow/products/board");
    const bodies: Array<Record<string, unknown>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input) === "/cart.js")
        return jsonResponse({ items: [], item_count: 0, total_price: 0 });
      if (String(input) === "/products/board.js")
        return jsonResponse({ id: 123 });
      bodies.push(JSON.parse(String(init?.body)));
      return jsonResponse({ widgetType: null });
    });
    const poller = new OfferPoller({
      shop: "example.myshopify.com",
      apiBase: "/apps/aovboost",
      eventBus: {} as any,
      sessionManager: sessionManagerStub() as any,
      widgetManager: { getDismissedWidgets: () => [] } as any,
    });
    await poller.requestOffer("initial");
    expect(bodies[0]).toMatchObject({
      currentPageType: "product",
      currentProductId: "gid://shopify/Product/123",
    });
    poller.destroy();
  });
});

function sessionManagerStub() {
  return {
    getSnapshot: () => ({
      cartProductIds: [],
      cartValue: 0,
      context: {},
    }),
    getSignedAuthPayload: vi.fn().mockResolvedValue({
      shop: "example.myshopify.com",
      sessionId: "session-1",
      sessionToken: "signed-token",
    }),
    applySessionFromResponse: vi.fn().mockResolvedValue(false),
    refreshAuth: vi.fn().mockResolvedValue(undefined),
    getSettings: () => ({ discountThreshold: 100 }),
  };
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}
