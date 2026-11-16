// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FactFeed } from "./FactFeed";
import { AGENT_LIMITS as L } from "./constants";

let feed: FactFeed,
  fetcher: ReturnType<typeof vi.fn>,
  changed: ReturnType<typeof vi.fn>;
let ctx: any;
const snapshot = (title = "Campaign") => ({
  agentFacts: { version: 1 },
  campaign: { headline: title },
  automaticPlacements: true,
  offers: [{ widgetType: "countdown_banner", payload: { offerId: title } }],
});
beforeEach(() => {
  vi.useFakeTimers();
  ctx = {
    page: { type: "product", productId: "gid://shopify/Product/1" },
    cart: { currency: "KES" },
  };
  changed = vi.fn();
  fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(snapshot())));
  vi.stubGlobal("fetch", fetcher);
  feed = new FactFeed(
    "/apps/aovboost",
    async () => ({ sessionId: "anonymous", sessionToken: "synthetic" }),
    () => ctx,
    changed,
  );
});
afterEach(() => {
  feed.destroy();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe("verified fact feed", () => {
  it("waits for a page signal, coalesces it, and refreshes without duplicate simultaneous requests", async () => {
    expect(fetcher).not.toHaveBeenCalled();
    feed.refresh();
    feed.refresh();
    feed.refresh();
    await vi.advanceTimersByTimeAsync(L.FACT_REQUEST_DEBOUNCE_MS);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({
      pageType: "product",
      productId: ctx.page.productId,
      currency: "KES",
    });
    expect(document.querySelectorAll("[data-aovboost-auto-slot]")).toHaveLength(
      1,
    );
    feed.refresh();
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockImplementation(
      async () => new Response(JSON.stringify(snapshot())),
    );
    await vi.advanceTimersByTimeAsync(
      L.FACT_REFRESH_MS + L.FACT_REQUEST_DEBOUNCE_MS,
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("ignores late responses after a navigation", async () => {
    let finish: (v: Response) => void = () => {};
    fetcher.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    feed.refresh();
    await vi.advanceTimersByTimeAsync(L.FACT_REQUEST_DEBOUNCE_MS);
    ctx = { ...ctx, page: { type: "cart" } };
    fetcher.mockImplementationOnce(
      async () => new Response(JSON.stringify(snapshot("Cart"))),
    );
    feed.refresh();
    await vi.advanceTimersByTimeAsync(L.FACT_REQUEST_DEBOUNCE_MS);
    finish(new Response(JSON.stringify(snapshot("Old product"))));
    await vi.advanceTimersByTimeAsync(0);
    expect(feed.data.campaign?.headline).toBe("Cart");
    expect(changed).toHaveBeenCalledTimes(1);
  });
  it("revokes stale facts and overlays on an upstream failure", async () => {
    feed.refresh();
    await vi.advanceTimersByTimeAsync(L.FACT_REQUEST_DEBOUNCE_MS);
    fetcher.mockRejectedValue(new Error("offline"));
    await vi.advanceTimersByTimeAsync(
      L.FACT_REFRESH_MS + L.FACT_REQUEST_DEBOUNCE_MS,
    );
    expect(feed.data.offers).toEqual([]);
    expect(document.querySelector("[data-aovboost-fact-slots]")).toBeNull();
  });
  it("prefers explicit app slots and does not create placements for an empty response", async () => {
    document.body.innerHTML =
      '<div data-aovboost-slot="countdown_banner"></div>';
    feed.refresh();
    await vi.advanceTimersByTimeAsync(L.FACT_REQUEST_DEBOUNCE_MS);
    expect(document.querySelector("[data-aovboost-auto-slot]")).toBeNull();
    feed.destroy();
    expect(document.querySelector("[data-aovboost-slot]")).not.toBeNull();
  });
  it("does not publish or create slots after destruction", async () => {
    feed.refresh();
    feed.destroy();
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetcher).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
  });
});
