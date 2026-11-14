// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RecommendationService,
  RECOMMENDATION_LIMITS as L,
  type RecommendationScope,
} from "./RecommendationService";
import { getProducts, type WidgetProduct } from "../widgets/BaseWidget";
import type { AgentContext } from "./types";
import type { OfferDecision } from "../widgets/widgetManager";
import { SessionStore } from "./SessionStore";
let service: RecommendationService,
  scope: RecommendationScope,
  ctx: AgentContext;
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
const gid = (id: number) => `gid://shopify/Product/${id}`;
const variant = (id: number) => `gid://shopify/ProductVariant/${id * 100}`;
function product(id: number): WidgetProduct {
  return {
    id: gid(id),
    variantId: variant(id),
    handle: `product-${id}`,
    title: `Product ${id}`,
    imageUrl: "",
    price: "999",
    quantity: 1,
    reason: "AI ranking",
    orderCount: 0,
    variants: [
      {
        id: variant(id),
        title: "Default",
        sku: "",
        price: "999",
        compareAtPrice: null,
        quantityAvailable: null,
        availableForSale: true,
        selectedOptions: [],
      },
    ],
  };
}
function decision(ids = [2], type = "rec_strip"): OfferDecision {
  return {
    widgetType: type,
    aiProvider: "heuristic",
    payload: {
      offerId: "approved-offer",
      products: ids.map(product),
      triggerType: "cart_item_added",
      mutationId: "m1",
    },
  };
}
const live = (id: number, available = true, price = id * 1000) => ({
  id,
  available,
  variants: [{ id: id * 100, available, price }],
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
beforeEach(() => {
  vi.useFakeTimers();
  scope = { root: "/en-ke/", currency: "KES", locale: "en-KE", market: "KE" };
  ctx = {
    page: { type: "product", productId: gid(1) },
    cart: {
      items: [],
      subtotal: 0,
      currency: "KES",
      lastChangeSource: "shopper",
    },
    session: new SessionStore("recommendations.test").snapshot(),
    device: { isMobile: false, prefersReducedMotion: false },
    agent: { aiHealthy: true, chatEnabled: true, holdout: false },
    config: {},
  };
  service = new RecommendationService({
    shop: "test.shop",
    scope: () => scope,
    normalize: getProducts,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) =>
      json(live(Number(/product-(\d+)\.js/.exec(String(url))?.[1] || 2))),
    ),
  );
});
afterEach(() => {
  service.destroy();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("shared recommendation catalog", () => {
  it("shares product-page context lookup with later bundle hydration", async () => {
    expect(await service.resolveProductId("product-2")).toBe(gid(2));
    const bundle = await service.prepare(
      decision([2, 3], "bundle"),
      "bundle",
      ctx,
    );
    expect(bundle.decision?.widgetType).toBe("bundle");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(service.getStatus().cacheHits).toBe(1);
  });
  it("reserves only cart cards that can actually display under the existing recommendation limit", async () => {
    ctx = { ...ctx, config: { maxProductRecommendations: 1 } };
    const cart = await service.prepare(
      decision([2, 3], "upsell_drawer"),
      "cart_upsell",
      ctx,
    );
    expect(
      getProducts(cart.decision!.payload!).map((product) => product.id),
    ).toEqual([gid(2)]);
    expect(
      (await service.prepare(decision([3]), "rec_strip", ctx)).decision,
    ).not.toBeNull();
  });
  it("supports larger configured bundles while bounding parallel catalog hydration", async () => {
    let active = 0,
      peak = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active--;
        return json(live(Number(/product-(\d+)\.js/.exec(String(url))?.[1])));
      }),
    );
    const ids = Array.from({ length: 12 }, (_, index) => index + 1);
    const pending = service.prepare(decision(ids, "bundle"), "bundle", ctx);
    await vi.advanceTimersByTimeAsync(20);
    expect(getProducts((await pending).decision!.payload!)).toHaveLength(12);
    expect(peak).toBe(L.HYDRATION_CONCURRENCY);
  });
  it("does not start an obsolete queued offer after invalidation or destruction", async () => {
    const request = vi.fn().mockResolvedValue(decision());
    const invalid = service.coalesceOffer("old", request);
    service.invalidate();
    expect(await invalid).toBeNull();
    expect(request).not.toHaveBeenCalled();
    const stopped = service.coalesceOffer("stopped", request);
    service.destroy();
    expect(await stopped).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });
  it("coalesces product reads across providers, caches public data and returns market prices", async () => {
    const pending = deferred<Response>();
    const fetch = vi.fn().mockReturnValue(pending.promise);
    vi.stubGlobal("fetch", fetch);
    const bundle = decision([2, 3], "bundle");
    const first = service.prepare(decision(), "rec_strip", ctx);
    const second = service.prepare(bundle, "bundle", ctx);
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(2);
    // A shared response cannot match both product IDs; product 3 is unavailable.
    pending.resolve(json(live(2)));
    const [strip, configured] = await Promise.all([first, second]);
    expect(getProducts(strip.decision!.payload!)[0].price).toBe("20.00");
    expect(configured.decision).toBeNull();
    service.release("rec_strip");
    const again = await service.prepare(decision(), "cart_upsell", ctx);
    expect(again.decision?.widgetType).toBe("rec_strip");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(service.getStatus()).toMatchObject({
      coalescedReads: 1,
      cacheHits: 1,
    });
  });
  it("expires cached inventory and isolates locale, currency and market", async () => {
    await service.prepare(decision(), "rec_strip", ctx);
    service.release("rec_strip");
    await service.prepare(decision(), "rec_strip", ctx);
    service.release("rec_strip");
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(L.CACHE_TTL_MS + 1);
    await service.prepare(decision(), "rec_strip", ctx);
    service.release("rec_strip");
    expect(fetch).toHaveBeenCalledTimes(2);
    scope = { root: "/fr/", currency: "EUR", locale: "fr", market: "FR" };
    await service.prepare(decision(), "rec_strip", ctx);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(vi.mocked(fetch).mock.calls.at(-1)?.[0]).toBe(
      "/fr/products/product-2.js",
    );
  });
  it("bounds the cache and clears it on cart/navigation invalidation", async () => {
    for (let id = 1; id <= L.CACHE_ENTRIES + 1; id++) {
      await service.prepare(decision([id]), "rec_strip", ctx);
      service.release("rec_strip");
    }
    expect(service.getStatus().cachedReads).toBe(L.CACHE_ENTRIES);
    service.invalidate();
    expect(service.getStatus().cachedReads).toBe(0);
  });
  it("dedupes against all cart variants of a product and other reserved surfaces", async () => {
    ctx = {
      ...ctx,
      cart: {
        ...ctx.cart,
        items: [
          { productId: gid(2), variantId: "another-variant", quantity: 1 },
        ],
      },
    };
    const strip = await service.prepare(decision([2, 3, 3]), "rec_strip", ctx);
    expect(
      getProducts(strip.decision!.payload!).map((product) => product.id),
    ).toEqual([gid(3)]);
    const upsell = await service.prepare(
      decision([2, 3, 4], "upsell_drawer"),
      "cart_upsell",
      ctx,
    );
    expect(
      getProducts(upsell.decision!.payload!).map((product) => product.id),
    ).toEqual([gid(4)]);
    service.release("rec_strip");
    expect(
      (await service.prepare(decision([3]), "bundle", ctx)).decision,
    ).not.toBeNull();
  });
  it("preserves configured bundle quantities/discount metadata and rejects partial or duplicate components", async () => {
    const configured = decision([2, 3], "bundle");
    configured.payload!.bundle = {
      id: "bundle-1",
      discountVersion: 4,
      discountType: "percentage",
      discountValue: 10,
    };
    (configured.payload!.products as WidgetProduct[])[1].quantity = 2;
    const prepared = await service.prepare(configured, "bundle", ctx);
    expect(prepared.decision?.payload?.bundle).toEqual(
      configured.payload!.bundle,
    );
    expect(
      getProducts(prepared.decision!.payload!).map(
        (product) => product.quantity,
      ),
    ).toEqual([1, 2]);
    service.release("bundle");
    ctx = {
      ...ctx,
      cart: {
        ...ctx.cart,
        items: [{ productId: gid(2), variantId: variant(2), quantity: 1 }],
      },
    };
    expect((await service.prepare(configured, "bundle", ctx)).reason).toBe(
      "bundle_overlap",
    );
    ctx = { ...ctx, cart: { ...ctx.cart, items: [] } };
    service.invalidate();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) =>
        json(
          live(
            String(url).includes("product-2") ? 2 : 3,
            String(url).includes("product-2"),
          ),
        ),
      ),
    );
    expect((await service.prepare(configured, "bundle", ctx)).reason).toBe(
      "bundle_component_unavailable",
    );
  });
  it("invalidates a mounted selection when a newly added cart product overlaps", async () => {
    await service.prepare(decision(), "rec_strip", ctx);
    expect(service.isSelectionCurrent("rec_strip", ctx)).toBe(true);
    const changed = {
      ...ctx,
      cart: {
        ...ctx.cart,
        items: [{ productId: gid(2), variantId: variant(2), quantity: 1 }],
      },
    };
    expect(service.isSelectionCurrent("rec_strip", changed)).toBe(false);
  });
  it("cancels one consumer without aborting a shared catalog read needed by another", async () => {
    const pending = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(pending.promise));
    const controller = new AbortController();
    const first = service.prepare(
      decision(),
      "rec_strip",
      ctx,
      controller.signal,
    );
    const second = service.prepare(decision(), "cart_upsell", ctx);
    controller.abort();
    pending.resolve(json(live(2)));
    expect((await first).decision).toBeNull();
    expect((await second).decision).not.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("discards a stale request after mutation even if the underlying fetch ignores abort", async () => {
    const old = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockReturnValueOnce(old.promise)
        .mockResolvedValueOnce(json(live(2, true, 3000))),
    );
    const stale = service.prepare(decision(), "rec_strip", ctx);
    await Promise.resolve();
    service.invalidate();
    const next = service.prepare(decision(), "rec_strip", ctx);
    old.resolve(json(live(2, true, 1000)));
    expect((await stale).decision).toBeNull();
    expect(getProducts((await next).decision!.payload!)[0].price).toBe("30.00");
  });
  it("discards prices when currency changes while a request is pending", async () => {
    const pending = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(pending.promise));
    const result = service.prepare(decision(), "rec_strip", ctx);
    scope = { ...scope, currency: "USD" };
    pending.resolve(json(live(2)));
    expect((await result).decision).toBeNull();
    expect(service.getStatus().cachedReads).toBe(0);
  });
  it("times out a stuck body/read and leaves a failed cache entry retryable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));
    const pending = service.prepare(decision(), "rec_strip", ctx);
    await vi.advanceTimersByTimeAsync(L.REQUEST_TIMEOUT_MS);
    expect((await pending).decision).toBeNull();
    expect(service.getStatus()).toMatchObject({
      pendingReads: 0,
      cachedReads: 0,
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(live(2))));
    expect(
      (await service.prepare(decision(), "rec_strip", ctx)).decision,
    ).not.toBeNull();
  });
  it("uses complementary/related results to rank only the app-approved pool when AI is unavailable", async () => {
    ctx = { ...ctx, agent: { ...ctx.agent, aiHealthy: false } };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) =>
        String(url).includes("recommendations/")
          ? json({ products: [{ id: 999 }, { id: 3 }, { id: 2 }] })
          : json(live(Number(/product-(\d+)\.js/.exec(String(url))?.[1]))),
      ),
    );
    const source = decision([2, 3], "upsell_drawer");
    source.aiProvider = "gemini";
    const result = await service.prepare(source, "cart_upsell", ctx);
    expect(result.reason).toBe("catalog_rule_fallback");
    expect(result.decision?.aiProvider).toBe("heuristic");
    expect(
      getProducts(result.decision!.payload!).map((product) => product.id),
    ).toEqual([gid(3), gid(2)]);
    expect(result.decision?.payload?.offerId).toBe("approved-offer");
    expect(vi.mocked(fetch).mock.calls.at(-1)?.[0]).toContain(
      "intent=complementary",
    );
    expect(JSON.stringify(result)).not.toContain("999");
  });
  it("falls back deterministically without inventing products when native recommendations fail", async () => {
    ctx = { ...ctx, agent: { ...ctx.agent, aiHealthy: false } };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) =>
        String(url).includes("recommendations/")
          ? json({}, 503)
          : json(live(Number(/product-(\d+)\.js/.exec(String(url))?.[1]))),
      ),
    );
    const source = decision([3, 2]);
    source.aiProvider = "groq";
    const result = await service.prepare(source, "rec_strip", ctx);
    expect(
      getProducts(result.decision!.payload!).map((product) => product.id),
    ).toEqual([gid(2), gid(3)]);
    expect(getProducts(result.decision!.payload!)[0].reason).toBe(
      "Selected from this store's available products.",
    );
  });
  it("avoids catalog traffic for holdout, checkout, missing data or a server no-offer", async () => {
    expect(
      (
        await service.prepare(decision(), "rec_strip", {
          ...ctx,
          agent: { ...ctx.agent, holdout: true },
        })
      ).decision,
    ).toBeNull();
    await service.prepare(decision(), "rec_strip", {
      ...ctx,
      page: { type: "checkout" },
    });
    await service.prepare({ widgetType: "bundle" }, "bundle", ctx);
    const denied = { widgetType: null, reasoning: "plan_display_allowance" };
    expect((await service.prepare(denied, "rec_strip", ctx)).decision).toEqual(
      denied,
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it("coalesces identical pending offers but never caches authorization or joins different mutations", async () => {
    const pending = deferred<OfferDecision | null>();
    const request = vi.fn(() => pending.promise);
    const first = service.coalesceOffer("mutation-1", request),
      second = service.coalesceOffer("mutation-1", request);
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(1);
    pending.resolve(decision());
    await Promise.all([first, second]);
    await service.coalesceOffer("mutation-1", request);
    expect(request).toHaveBeenCalledTimes(2);
    const a = service.coalesceOffer("mutation-2", request),
      b = service.coalesceOffer("mutation-3", request);
    await Promise.all([a, b]);
    expect(request).toHaveBeenCalledTimes(4);
  });
});
