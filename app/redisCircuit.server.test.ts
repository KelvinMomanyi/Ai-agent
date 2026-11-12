import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  eval: vi.fn(),
  del: vi.fn(),
}));
vi.mock("@upstash/redis", () => ({
  Redis: class {
    get = mocks.get;
    set = mocks.set;
    eval = mocks.eval;
    del = mocks.del;
  },
}));
beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-12T04:00:00Z"));
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://synthetic.upstash.io");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "synthetic");
  vi.stubEnv("NODE_ENV", "production");
  mocks.get.mockRejectedValue(
    new Error("fetch failed", { cause: { code: "ENOTFOUND" } }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
describe("shared Redis outage circuit", () => {
  it("stops repeated claims and billing calls after a cache outage and retries after the bounded window", async () => {
    const { getJsonCache, setJsonCache, claimExpiringKeyStatus, billingRedis } =
      await import("./redis.server");
    expect(await getJsonCache("catalog:test")).toBeNull();
    expect(await claimExpiringKeyStatus("delivery:test", 5)).toBe(
      "unavailable",
    );
    await expect(billingRedis.get("plan:test")).rejects.toThrow(/unavailable/);
    await expect(billingRedis.eval("return 1", [], [])).rejects.toThrow(
      /unavailable/,
    );
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.set).not.toHaveBeenCalled();
    expect(mocks.eval).not.toHaveBeenCalled();
    await setJsonCache("settings:test", { upsellEnabled: true }, 3600);
    expect(await getJsonCache("settings:test")).toEqual({
      upsellEnabled: true,
    });
    expect(
      await getJsonCache("settings:test", { allowMemoryFallback: false }),
    ).toBeNull();
    await vi.advanceTimersByTimeAsync(30_001);
    mocks.set.mockResolvedValue("OK");
    expect(await claimExpiringKeyStatus("delivery:test", 5)).toBe("acquired");
  });
  it("opens the same circuit for a billing failure without using local quota counters", async () => {
    const { billingRedis, claimExpiringKeyStatus } =
      await import("./redis.server");
    mocks.eval.mockRejectedValue(new Error("quota exceeded"));
    await expect(billingRedis.eval("return 1", [], [])).rejects.toThrow(
      /quota/,
    );
    await expect(billingRedis.eval("return 1", [], [])).rejects.toThrow(
      /unavailable/,
    );
    expect(await claimExpiringKeyStatus("catalog:test", 5)).toBe("unavailable");
    expect(mocks.eval).toHaveBeenCalledTimes(1);
    expect(mocks.set).not.toHaveBeenCalled();
  });
});
