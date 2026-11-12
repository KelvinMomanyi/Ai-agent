import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  cache: new Map<string, unknown>(),
  claim: vi.fn(),
  products: vi.fn(),
  stats: vi.fn(),
  count: vi.fn(),
  fallback: vi.fn(),
}));
vi.mock("./catalogDatabaseFallback.server", () => ({
  readCatalogDuringCacheOutage: mocks.fallback,
}));
vi.mock("../redis.server", () => ({
  getJsonCache: async (key: string) => mocks.cache.get(key) || null,
  setJsonCache: async (key: string, value: unknown) => {
    mocks.cache.set(key, value);
  },
  claimExpiringKeyStatus: mocks.claim,
  redis: {
    get: async (key: string) => mocks.cache.get(key) || null,
    set: async (key: string, value: unknown) => {
      mocks.cache.set(key, value);
    },
    del: async (key: string) => {
      mocks.cache.delete(key);
    },
  },
}));
vi.mock("../db.server", () => ({
  default: {
    product: { findMany: mocks.products, count: mocks.count },
    productOrderStat: { findMany: mocks.stats },
  },
}));
import {
  getRecommendationCatalog,
  invalidateCatalogCache,
} from "./catalogCache.server";
import { CatalogUnavailableError } from "../utils/catalogAvailability.server";

const shop = "shop.test";
const product = (id: string) => ({
  id,
  shop,
  title: id,
  handle: id,
  price: "10",
  compareAtPrice: null,
  imageUrl: null,
  tags: [],
  collectionIds: [],
  metafields: {},
  updatedAt: new Date("2026-11-02"),
  orderStats: null,
});
beforeEach(async () => {
  vi.clearAllMocks();
  mocks.cache.clear();
  mocks.claim.mockResolvedValue("acquired");
  mocks.products.mockResolvedValue([product("p1")]);
  mocks.stats.mockResolvedValue([]);
  mocks.count.mockResolvedValue(1);
  mocks.fallback.mockRejectedValue(new CatalogUnavailableError());
  await invalidateCatalogCache(shop);
  mocks.cache.clear();
});
afterEach(() => vi.useRealTimers());

describe("catalog cache fill budget", () => {
  it("expires the short-lived fallback without weakening fresh product validation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-12T04:00:00Z"));
    mocks.claim.mockResolvedValue("unavailable");
    mocks.fallback.mockResolvedValue({ products: [product("p1")], productCount: 1 });
    await getRecommendationCatalog({ shop });
    vi.advanceTimersByTime(5001);
    mocks.fallback.mockResolvedValue({ products: [product("p2")], productCount: 1 });
    expect((await getRecommendationCatalog({ shop })).products[0].id).toBe("p2");
    expect(mocks.fallback).toHaveBeenCalledTimes(2);
  });
  it("serves the durable catalog during a Redis outage and briefly caches the bounded result", async () => {
    mocks.claim.mockResolvedValue("unavailable");
    mocks.fallback.mockResolvedValue({
      products: [product("p1"), product("p2")],
      productCount: 2,
    });
    const result = await getRecommendationCatalog({ shop });
    expect(result.products.map(({ id }) => id)).toEqual(["p1", "p2"]);
    expect(result.productCount).toBe(2);
    expect((await getRecommendationCatalog({ shop })).products).toHaveLength(2);
    expect(mocks.fallback).toHaveBeenCalledTimes(1);
    expect(mocks.fallback).toHaveBeenCalledWith(shop);
    expect(mocks.products).not.toHaveBeenCalled();
  });

  it("invalidates fallback snapshots and keeps shops isolated", async () => {
    mocks.claim.mockResolvedValue("unavailable");
    mocks.fallback.mockResolvedValue({
      products: [product("p1")],
      productCount: 1,
    });
    await getRecommendationCatalog({ shop });
    mocks.fallback.mockResolvedValue({
      products: [product("p2")],
      productCount: 1,
    });
    expect(
      (await getRecommendationCatalog({ shop: "other.test" })).products[0].id,
    ).toBe("p2");
    await invalidateCatalogCache(shop);
    expect((await getRecommendationCatalog({ shop })).products[0].id).toBe(
      "p2",
    );
  });
  it("stores each product once and reconstructs indexes on cache hits", async () => {
    const first = await getRecommendationCatalog({ shop });
    const stored = mocks.cache.get(`catalog:${shop}:hot:0`) as Record<
      string,
      unknown
    >;
    expect(stored.products).toHaveLength(1);
    expect(stored.byId).toBeUndefined();
    expect(first.byId.p1.title).toBe("p1");
    expect((await getRecommendationCatalog({ shop })).byId.p1.title).toBe("p1");
    expect(mocks.products).toHaveBeenCalledTimes(1);
  });

  it("coalesces invalidations, then refreshes the latest generation after the lease window", async () => {
    await getRecommendationCatalog({ shop });
    await invalidateCatalogCache(shop);
    mocks.claim.mockResolvedValue("busy");
    expect((await getRecommendationCatalog({ shop })).products).toHaveLength(1);
    expect(mocks.products).toHaveBeenCalledTimes(1);
    mocks.claim.mockResolvedValue("acquired");
    mocks.products.mockResolvedValue([product("p1"), product("p2")]);
    mocks.count.mockResolvedValue(2);
    expect((await getRecommendationCatalog({ shop })).byId.p2.title).toBe("p2");
    expect(mocks.products).toHaveBeenCalledTimes(2);
  });

  it("does not launch a second database fill while the first instance is working", async () => {
    let resolve!: (value: unknown[]) => void, started!: () => void;
    const ready = new Promise<void>((r) => {
      started = r;
    });
    mocks.products.mockImplementation(() => {
      started();
      return new Promise((r) => {
        resolve = r;
      });
    });
    const first = getRecommendationCatalog({ shop });
    await ready;
    mocks.claim.mockResolvedValue("busy");
    const second = getRecommendationCatalog({ shop });
    expect(mocks.products).toHaveBeenCalledTimes(1);
    resolve([product("p1")]);
    await first;
    expect((await second).byId.p1.title).toBe("p1");
    expect((await getRecommendationCatalog({ shop })).byId.p1.title).toBe("p1");
  });

  it("reports a cold storage outage instead of a successful empty catalog and recovers", async () => {
    mocks.claim.mockResolvedValue("unavailable");
    await expect(getRecommendationCatalog({ shop })).rejects.toThrow(
      /temporarily unavailable/,
    );
    expect(mocks.products).not.toHaveBeenCalled();
    mocks.claim.mockResolvedValue("acquired");
    expect((await getRecommendationCatalog({ shop })).products).toHaveLength(1);
  });

  it("waits briefly for a cold fill on another instance without launching extra database work", async () => {
    mocks.claim.mockResolvedValue("busy");
    const timer = setTimeout(
      () =>
        mocks.cache.set(`catalog:${shop}:hot:0`, {
          shop,
          refreshedAt: new Date().toISOString(),
          productCount: 1,
          products: [
            { id: "p1", title: "p1", tags: [], availableForSale: true },
          ],
        }),
      20,
    );
    try {
      expect((await getRecommendationCatalog({ shop })).byId.p1.title).toBe(
        "p1",
      );
      expect(mocks.products).not.toHaveBeenCalled();
    } finally {
      clearTimeout(timer);
    }
  });

  it("reports an unfinished cold fill as temporary and preserves tenant isolation", async () => {
    mocks.claim.mockResolvedValue("busy");
    mocks.cache.set("catalog:other-shop:last-hot", {
      products: [product("foreign")],
    });
    await expect(getRecommendationCatalog({ shop })).rejects.toThrow(
      /temporarily unavailable/,
    );
    expect(mocks.products).not.toHaveBeenCalled();
  });
});
