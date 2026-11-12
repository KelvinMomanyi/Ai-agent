import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  execute: vi.fn(),
  offers: vi.fn(),
  eval: vi.fn(),
  del: vi.fn(),
  entitlement: vi.fn(),
  settings: vi.fn(),
}));
vi.mock("../db.server", () => ({
  default: {
    monthlyUsage: { findUnique: mocks.find },
    offer: { findMany: mocks.offers },
    $executeRaw: mocks.execute,
  },
}));
vi.mock("../redis.server", () => ({
  billingRedis: { eval: mocks.eval, del: mocks.del },
}));
vi.mock("./settings.server", () => ({ getAppSettings: mocks.settings }));
vi.mock("./entitlements.server", async (original) => ({
  ...(await original<typeof import("./entitlements.server")>()),
  getEntitlements: mocks.entitlement,
}));
import {
  getUsage,
  getPlanStatus,
  reserveOfferDisplay,
  reserveMonthlyAiCall,
  monthlyAiAvailable,
  recordDisplayedOffers,
  usageMonth,
  usageKeys,
  clearBillingDataCache,
} from "./usage.server";
const shop = "one.myshopify.com";
const free = {
  tier: "free",
  state: "verified",
  checkedAt: 1,
  subscriptionName: null,
  unmapped: false,
} as const;
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-05T12:00:00Z"));
  mocks.find.mockResolvedValue({ displayed: 400, aiCalls: 80 });
  mocks.eval.mockResolvedValue([1, 400, 80, 0, 0]);
  mocks.entitlement.mockResolvedValue(free);
  mocks.settings.mockResolvedValue({ analyticsEnabled: true });
});
afterEach(() => vi.useRealTimers());
describe("monthly shared usage", () => {
  it("does not claim zero usage when the durable seed cannot be read", async () => {
    mocks.find.mockRejectedValue(new Error("database offline"));
    expect(await getUsage(shop)).toMatchObject({
      available: false,
      totalsKnown: false,
    });
    expect(await reserveMonthlyAiCall(shop)).toBe(false);
    expect(mocks.eval).not.toHaveBeenCalled();
  });
  it.each([
    [1, -1, 80, 0, 0],
    [1, null, 80, 0, 0],
    [2, 400, 80, 0, 0],
    [1, 400, 0.5, 0, 0],
  ])("refuses malformed or corrupt shared usage: %j", async (...values) => {
    mocks.eval.mockResolvedValue(values);
    expect(await getUsage(shop)).toMatchObject({ available: false });
    expect(await reserveMonthlyAiCall(shop)).toBe(false);
  });
  it("keeps valid shared totals usable if both rollup and retry-key cleanup fail", async () => {
    mocks.eval.mockResolvedValue([1, 410, 85, 0, 1]);
    mocks.execute.mockRejectedValue(new Error("write unavailable"));
    mocks.del.mockRejectedValue(new Error("cleanup unavailable"));
    expect(await getUsage(shop)).toMatchObject({
      available: true,
      displayed: 410,
      aiCalls: 85,
    });
  });
  it("uses Pro allowances in test mode and retains shared AI usage limits", async () => {
    mocks.entitlement.mockResolvedValue({
      ...free,
      tier: "pro",
      state: "test",
    });
    const status = await getPlanStatus(shop);
    expect(status.notice).toContain("Billing test mode is active");
    expect(status.plan.features.holdoutReporting).toBe(true);
    expect(status.plan.features.advancedPlacements).toBe(true);
    expect(await reserveOfferDisplay(shop, "offer")).toBe(true);
    expect(await monthlyAiAvailable(shop)).toBe(true);
    expect(await reserveMonthlyAiCall(shop)).toBe(true);
    expect(mocks.eval.mock.lastCall?.[2].slice(4, 7)).toEqual([
      "ai",
      "",
      status.plan.monthlyAiCalls,
    ]);
    mocks.eval.mockResolvedValue([0, 400, status.plan.monthlyAiCalls, 0, 0]);
    expect(await monthlyAiAvailable(shop)).toBe(false);
    expect(await reserveMonthlyAiCall(shop)).toBe(false);
    mocks.eval.mockRejectedValue(new Error("Redis unavailable"));
    expect(await reserveMonthlyAiCall(shop)).toBe(false);
  });
  it("seeds atomic counters from tenant-scoped durable totals with UTC calendar boundaries", async () => {
    await getUsage(shop);
    expect(mocks.find).toHaveBeenCalledWith({
      where: { shop_month: { shop, month: new Date("2026-11-01") } },
    });
    const [, keys, args] = mocks.eval.mock.calls[0];
    expect(keys).toEqual(usageKeys(shop));
    expect(args.slice(0, 3)).toEqual([400, 80, 8640000]);
    expect(usageKeys("two.myshopify.com")).not.toEqual(keys);
    expect(usageMonth(new Date("2027-01-01T00:00:00Z"))).toEqual(
      new Date("2027-01-01"),
    );
  });
  it("uses an atomic reservation result so concurrent free deliveries cannot both take the last slot", async () => {
    mocks.eval
      .mockResolvedValueOnce([1, 499, 80, 1, 0])
      .mockResolvedValueOnce([0, 499, 80, 1, 0]);
    expect(
      await Promise.all([
        reserveOfferDisplay(shop, "a", free),
        reserveOfferDisplay(shop, "b", free),
      ]),
    ).toEqual([true, false]);
    for (const [, , args] of mocks.eval.mock.calls)
      expect(args.slice(4, 7)).toEqual(["reserve", expect.any(String), 500]);
  });
  it("does not use a local counter fallback when Redis is unavailable", async () => {
    mocks.eval.mockRejectedValue(new Error("Redis down"));
    expect(await reserveMonthlyAiCall(shop)).toBe(false);
    expect(await reserveOfferDisplay(shop, "offer", free)).toBe(false);
    expect(await getUsage(shop)).toMatchObject({
      displayed: 400,
      aiCalls: 80,
      available: false,
    });
    expect(
      await reserveOfferDisplay(shop, "offer", { ...free, tier: "pro" }),
    ).toBe(true);
  });
  it("denies capped AI while preserving deterministic access, including unverified plans", async () => {
    mocks.eval.mockResolvedValue([0, 400, 100, 0, 0]);
    expect(await reserveMonthlyAiCall(shop)).toBe(false);
    expect(mocks.eval.mock.calls[0][2].slice(4, 7)).toEqual(["ai", "", 100]);
    mocks.entitlement.mockResolvedValue({
      ...free,
      tier: "unverified",
      state: "unverified",
    });
    mocks.eval.mockClear();
    expect(await reserveMonthlyAiCall(shop)).toBe(false);
    expect(mocks.eval).not.toHaveBeenCalled();
    expect(await reserveOfferDisplay(shop, "offer")).toBe(true);
  });
  it("counts only owned visible offers and deduplicates a batch, including delayed month-end events", async () => {
    mocks.offers.mockResolvedValue([
      { id: "owned", createdAt: new Date("2026-10-31") },
    ]);
    await recordDisplayedOffers(shop, "session", [
      "owned",
      "owned",
      "foreign",
      "invalid!",
    ]);
    expect(mocks.offers).toHaveBeenCalledWith({
      where: {
        shop,
        sessionId: "session",
        id: { in: ["owned", "foreign"] },
        createdAt: { gte: new Date("2026-10-05T12:00:00Z") },
        widgetType: { in: ["upsell_drawer", "rec_strip", "bundle", "upsell"] },
      },
      select: { id: true, createdAt: true },
    });
    expect(mocks.eval).toHaveBeenCalledTimes(1);
    expect(mocks.eval.mock.calls[0][1][0]).toContain("2026-10");
    expect(mocks.eval.mock.calls[0][2].slice(4, 6)).toEqual([
      "display",
      "owned",
    ]);
  });
  it("rolls up cumulative totals periodically and retries failed persistence without resetting counts", async () => {
    mocks.eval.mockResolvedValue([1, 410, 85, 1, 1]);
    await getUsage(shop);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute.mock.calls[0][0].values).toEqual([
      shop,
      new Date("2026-11-01"),
      410,
      85,
    ]);
    mocks.execute.mockRejectedValueOnce(new Error("Postgres down"));
    expect(await getUsage(shop)).toMatchObject({
      displayed: 410,
      available: true,
    });
    expect(mocks.del).toHaveBeenCalledWith(usageKeys(shop)[2]);
  });
  it("shows an admin notice at the limit and removes tenant caches during redact", async () => {
    mocks.eval.mockResolvedValue([1, 499, 80, 1, 0]);
    expect((await getPlanStatus(shop)).notice).toMatch(/allowance/);
    await clearBillingDataCache(shop);
    expect(mocks.del).toHaveBeenCalledTimes(19);
    for (const [key] of mocks.del.mock.calls) {
      expect(key).toContain("one.myshopify.com");
      expect(key).not.toContain("two.myshopify.com");
    }
  });
  it("explains that a free shop needs impression analytics rather than silently bypassing its allowance", async () => {
    mocks.settings.mockResolvedValue({ analyticsEnabled: false });
    expect((await getPlanStatus(shop)).notice).toMatch(/Enable analytics/);
  });
});
