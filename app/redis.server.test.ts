import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("bounded Redis fallbacks and AI budgets", () => {
  it("preserves the original counter expiry across repeated increments", async () => {
    const { redis, incrementRateLimit } = await import("./redis.server");
    expect(await incrementRateLimit("rate:test", 60)).toBe(1);
    expect(await redis.incr("legacy:test")).toBe(1);
    await redis.expire("legacy:test", 60);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await incrementRateLimit("rate:test", 60)).toBe(2);
    expect(await redis.incr("legacy:test")).toBe(2);
    await vi.advanceTimersByTimeAsync(31_000);
    expect(await incrementRateLimit("rate:test", 60)).toBe(1);
    expect(await redis.incr("legacy:test")).toBe(1);
  });

  it("bounds fallback memory and refuses oversized catalog entries", async () => {
    const { redis } = await import("./redis.server");
    for (let i = 0; i < 1001; i++)
      await redis.set(`key:${i}`, "value", "EX", 60);
    expect(await redis.get("key:0")).toBeNull();
    expect(await redis.get("key:1000")).toBe("value");
    await redis.set("oversized", "x".repeat(300_001), "EX", 60);
    expect(await redis.get("oversized")).toBeNull();
  });

  it("applies shared and per-shop daily budgets, releases concurrency, and resets next day", async () => {
    vi.stubEnv("AOVBOOST_AI_GLOBAL_DAILY_LIMIT", "3");
    vi.stubEnv("AOVBOOST_AI_SHOP_DAILY_LIMIT", "2");
    vi.stubEnv("AOVBOOST_AI_GLOBAL_CONCURRENCY", "2");
    vi.stubEnv("AOVBOOST_AI_SHOP_CONCURRENCY", "1");
    const { reserveAiAttempt } = await import("./redis.server");
    const a = await reserveAiAttempt("a"),
      b = await reserveAiAttempt("b");
    expect(a).toBeTypeOf("function");
    expect(b).toBeTypeOf("function");
    expect(await reserveAiAttempt("a")).toBeNull();
    await a!();
    await b!();
    const second = await reserveAiAttempt("a");
    expect(second).toBeTypeOf("function");
    await second!();
    expect(await reserveAiAttempt("a")).toBeNull();
    expect(await reserveAiAttempt("c")).toBeNull();
    await vi.advanceTimersByTimeAsync(86_400_000);
    const nextDay = await reserveAiAttempt("a");
    expect(nextDay).toBeTypeOf("function");
    await nextDay!();
  });

  it("fails closed for production AI when the distributed store is missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { reserveAiAttempt } = await import("./redis.server");
    expect(await reserveAiAttempt("shop")).toBeNull();
    expect(await reserveAiAttempt()).toBeNull();
  });
});
