// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { OfferPoller } from "./offerPoller";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("OfferPoller", () => {
  it("queues revenue and assistant requests instead of dropping an in-flight trigger", async () => {
    const firstOffer = deferred<Response>();
    const firstOfferStarted = deferred<void>();
    const offerBodies: Array<Record<string, unknown>> = [];
    const mountDecision = vi.fn();

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
