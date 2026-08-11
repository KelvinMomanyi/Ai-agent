// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveUpdates } from "./liveUpdates";

const auth = {
  shop: "example.myshopify.com",
  sessionId: "session-123",
  sessionToken: "signed-token",
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("LiveUpdates", () => {
  it("polls with signed auth and forwards the existing system-event shape", async () => {
    const received: unknown[] = [];
    document.addEventListener(
      "aovboost:system-event",
      (event) => received.push((event as CustomEvent).detail),
      { once: true },
    );
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        enabled: true,
        pollAfterMs: 10_000,
        events: [
          {
            id: "event-1",
            type: "price_drop_webhook",
            productId: "gid://shopify/Product/123",
            occurredAt: "2026-08-11T12:09:00.000Z",
            oldPrice: 120,
            newPrice: 99,
          },
        ],
      }),
    );
    const liveUpdates = new LiveUpdates({
      apiBase: "/apps/aovboost",
      sessionManager: sessionManagerStub() as any,
    });

    liveUpdates.init();
    await vi.advanceTimersByTimeAsync(2500);

    expect(fetchMock).toHaveBeenCalledWith(
      "/apps/aovboost/live",
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify(auth),
      }),
    );
    expect(received).toEqual([
      expect.objectContaining({
        id: "event-1",
        type: "price_drop_webhook",
        productId: "gid://shopify/Product/123",
      }),
    ]);
    liveUpdates.destroy();
  });

  it("stops future polls on pagehide and resumes on pageshow", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ enabled: true, events: [] }));
    const liveUpdates = new LiveUpdates({
      apiBase: "/apps/aovboost",
      sessionManager: sessionManagerStub() as any,
    });

    liveUpdates.init();
    await vi.advanceTimersByTimeAsync(2500);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("pagehide"));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("pageshow"));
    await vi.advanceTimersByTimeAsync(2500);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    liveUpdates.destroy();
  });

  it("stops permanently when the server reports the flag disabled", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ enabled: false, events: [] }));
    const liveUpdates = new LiveUpdates({
      apiBase: "/apps/aovboost",
      sessionManager: sessionManagerStub() as any,
    });

    liveUpdates.init();
    await vi.advanceTimersByTimeAsync(2500);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    liveUpdates.destroy();
  });
});

function sessionManagerStub() {
  return {
    getSignedAuthPayload: vi.fn().mockResolvedValue(auth),
    applySessionFromResponse: vi.fn().mockResolvedValue(false),
    refreshAuth: vi.fn().mockResolvedValue(undefined),
  };
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
