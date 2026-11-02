// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "./eventBus";

const auth = { shop: "shop.test", sessionId: "s1", sessionToken: "token" };
let bus: EventBus;
let fetched: ReturnType<typeof vi.fn>;
let snapshotCount = 0;
const originalPush = history.pushState,
  originalReplace = history.replaceState;
const originalOpen = XMLHttpRequest.prototype.open,
  originalSend = XMLHttpRequest.prototype.send;

beforeEach(() => {
  vi.useFakeTimers();
  snapshotCount = 0;
  fetched = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetched);
  bus = new EventBus({
    shop: auth.shop,
    sessionManager: {
      anonymousId: auth.sessionId,
      recordEvent: vi.fn(),
      getSettings: () => ({ analyticsEnabled: true }),
      getAuthPayload: () => auth,
      getSignedAuthPayload: async () => auth,
      isActive: () => document.visibilityState !== "hidden",
      getTelemetryEvent: () => ({
        type: "session_sync",
        ts: Date.now(),
        sessionId: auth.sessionId,
        shop: auth.shop,
        url: location.href,
        referrer: "",
        totalPageViews: ++snapshotCount,
      }),
    } as any,
  });
});
afterEach(async () => {
  bus?.destroy();
  await vi.advanceTimersByTimeAsync(0);
  history.pushState = originalPush;
  history.replaceState = originalReplace;
  XMLHttpRequest.prototype.open = originalOpen;
  XMLHttpRequest.prototype.send = originalSend;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("one bounded telemetry transport", () => {
  it("merges the snapshot after events and avoids a separate 30-second heartbeat", async () => {
    bus.init();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetched).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetched.mock.calls[0][1].body);
    expect(body.events[0].type).toBe("page_view");
    expect(body.events.at(-1).type).toBe("session_sync");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetched).toHaveBeenCalledTimes(1);
  });

  it("flushes cart signals promptly and stops nonessential background requests", async () => {
    bus.init();
    bus.track("add_to_cart", { productId: "p1" });
    await vi.advanceTimersByTimeAsync(100);
    expect(fetched).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(fetched.mock.calls[0][1].body).events.some(
        (e: { type: string }) => e.type === "add_to_cart",
      ),
    ).toBe(true);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    const finalCount = fetched.mock.calls.length;
    await vi.advanceTimersByTimeAsync(300_000);
    expect(fetched).toHaveBeenCalledTimes(finalCount);
  });

  it("honors Retry-After instead of repeatedly sending a throttled batch", async () => {
    fetched.mockResolvedValueOnce(
      new Response("{}", { status: 429, headers: { "Retry-After": "60" } }),
    );
    bus.init();
    await vi.advanceTimersByTimeAsync(5000);
    bus.track("scroll_depth", { depth: 25 });
    await vi.advanceTimersByTimeAsync(59_000);
    expect(fetched).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetched).toHaveBeenCalledTimes(2);
  });
});
