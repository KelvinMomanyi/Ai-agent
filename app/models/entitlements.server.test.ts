import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  save: vi.fn(),
  update: vi.fn(),
  cache: new Map<string, string>(),
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  graphql: vi.fn(),
}));
vi.mock("../db.server", () => ({
  default: {
    entitlementSnapshot: {
      findUnique: mocks.find,
      upsert: mocks.save,
      updateMany: mocks.update,
    },
  },
}));
vi.mock("../redis.server", () => ({
  billingRedis: { get: mocks.get, set: mocks.set, del: mocks.del },
}));
import {
  getEntitlements,
  mapSubscriptions,
  limitsFor,
  invalidateEntitlements,
  PLAN_CONFIG,
  entitlementCacheKey,
  hostedUpgradeUrl,
} from "./entitlements.server";
const original = structuredClone(PLAN_CONFIG);
const shop = "one.myshopify.com";
const admin = { graphql: mocks.graphql };
const subscriptions = (items: any[]) =>
  new Response(
    JSON.stringify({
      data: { currentAppInstallation: { activeSubscriptions: items } },
    }),
  );
beforeEach(() => {
  vi.resetAllMocks();
  mocks.cache.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-05T00:00:00Z"));
  PLAN_CONFIG.billingSource = "admin_api";
  mocks.get.mockImplementation(async (key) => mocks.cache.get(key));
  mocks.set.mockImplementation(async (key, value) =>
    mocks.cache.set(key, value),
  );
  mocks.del.mockImplementation(async (key) => mocks.cache.delete(key));
  mocks.find.mockResolvedValue(null);
  mocks.graphql.mockImplementation(async () =>
    subscriptions([{ id: "paid", name: "Pro", status: "ACTIVE", test: false }]),
  );
});
afterEach(() => {
  Object.assign(PLAN_CONFIG, structuredClone(original));
  vi.useRealTimers();
});
describe("Shopify plan verification", () => {
  it("maps confirmed absent subscriptions to free, and exact configured active names to pro", () => {
    expect(mapSubscriptions([]).tier).toBe("free");
    expect(
      mapSubscriptions([{ name: " Pro ", status: "ACTIVE" }]),
    ).toMatchObject({ tier: "pro", unmapped: false });
    expect(mapSubscriptions([{ name: "Pro", status: "CANCELLED" }]).tier).toBe(
      "free",
    );
    expect(mapSubscriptions([{ name: "pro", status: "PENDING" }]).tier).toBe(
      "free",
    );
  });
  it("honors configured free names and preserves unfamiliar active paid plans", () => {
    PLAN_CONFIG.tiers.free.subscriptionNames = ["Starter"];
    expect(mapSubscriptions([{ name: "Starter", status: "ACTIVE" }]).tier).toBe(
      "free",
    );
    expect(
      mapSubscriptions([{ name: "Legacy annual", status: "ACTIVE" }]),
    ).toMatchObject({ tier: "pro", unmapped: true });
  });
  it("does not infer a free plan from empty subscriptions for unconfirmed or modern managed pricing", async () => {
    for (const source of ["unconfirmed", "shopify_app_pricing"]) {
      PLAN_CONFIG.billingSource = source;
      const plan = await getEntitlements(shop, admin);
      expect(plan).toMatchObject({ tier: "unverified", state: "unverified" });
      expect(limitsFor(plan)).toMatchObject({
        monthlyDisplays: null,
        monthlyAiCalls: 0,
      });
    }
    expect(mocks.graphql).not.toHaveBeenCalled();
  });
  it("queries the installed app, caches five minutes, and isolates cache and durable writes by shop", async () => {
    expect((await getEntitlements(shop, admin)).tier).toBe("pro");
    expect((await getEntitlements(shop, admin)).tier).toBe("pro");
    expect(mocks.graphql).toHaveBeenCalledTimes(1);
    expect(mocks.graphql.mock.calls[0][0]).toContain(
      "currentAppInstallation { activeSubscriptions { id name status test } }",
    );
    expect(mocks.set.mock.calls[0][2]).toBe(300);
    expect(mocks.save.mock.calls[0][0]).toMatchObject({
      where: { shop },
      create: { shop, tier: "pro" },
    });
    await getEntitlements("two.myshopify.com", admin);
    expect(mocks.graphql).toHaveBeenCalledTimes(2);
    expect(mocks.cache.has(entitlementCacheKey("two.myshopify.com"))).toBe(
      true,
    );
  });
  it("uses the last verified paid entitlement on API failure without extending its timestamp", async () => {
    const initial = await getEntitlements(shop, admin);
    vi.advanceTimersByTime(301_000);
    mocks.graphql.mockRejectedValue(new Error("Shopify unavailable"));
    expect(await getEntitlements(shop, admin)).toMatchObject({
      tier: "pro",
      state: "grace",
      checkedAt: initial.checkedAt,
    });
    vi.advanceTimersByTime(24 * 60 * 60_000);
    expect(await getEntitlements(shop, admin)).toMatchObject({
      tier: "unverified",
      state: "unverified",
    });
  });
  it("uses PostgreSQL during Redis failure, and retains verified API results when saving fails", async () => {
    await getEntitlements(shop, admin);
    const row = mocks.save.mock.calls[0][0].create;
    mocks.find.mockResolvedValue(row);
    vi.advanceTimersByTime(301_000);
    mocks.get.mockRejectedValue(new Error("Redis unavailable"));
    mocks.graphql.mockRejectedValueOnce(new Error("Shopify unavailable"));
    expect(await getEntitlements(shop, admin)).toMatchObject({
      tier: "pro",
      state: "grace",
    });
    mocks.find.mockRejectedValue(new Error("Postgres unavailable"));
    mocks.save.mockRejectedValue(new Error("Postgres unavailable"));
    mocks.set.mockRejectedValue(new Error("Redis unavailable"));
    expect(await getEntitlements(shop, admin)).toMatchObject({
      tier: "pro",
      state: "verified",
    });
  });
  it.each([
    {},
    { data: { currentAppInstallation: null } },
    {
      errors: [{ message: "denied" }],
      data: { currentAppInstallation: { activeSubscriptions: [] } },
    },
  ])(
    "does not downgrade on malformed/partial GraphQL results: %j",
    async (result) => {
      await getEntitlements(shop, admin);
      vi.advanceTimersByTime(301_000);
      mocks.graphql.mockResolvedValue(new Response(JSON.stringify(result)));
      expect(await getEntitlements(shop, admin)).toMatchObject({
        tier: "pro",
        state: "grace",
      });
    },
  );
  it("coalesces concurrent verification and invalidates without deleting the fallback plan", async () => {
    await Promise.all([
      getEntitlements(shop, admin),
      getEntitlements(shop, admin),
    ]);
    expect(mocks.graphql).toHaveBeenCalledTimes(1);
    await invalidateEntitlements(shop);
    expect(mocks.update).toHaveBeenCalledWith({
      where: { shop },
      data: { refreshRequired: true },
    });
    expect(mocks.cache.has(entitlementCacheKey(shop))).toBe(false);
  });
  it("builds a hosted plan link only from configured handles and a permanent shop domain", () => {
    expect(hostedUpgradeUrl(shop)).toBeNull();
    PLAN_CONFIG.upgradeMode = "shopify_hosted";
    expect(hostedUpgradeUrl(shop)).toBe(
      "https://admin.shopify.com/store/one/charges/ai-agent-21/pricing_plans",
    );
    expect(hostedUpgradeUrl("one.myshopify.com.evil.test")).toBeNull();
  });
});
