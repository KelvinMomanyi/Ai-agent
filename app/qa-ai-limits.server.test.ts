import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-15T12:00:00Z"));
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("AOVBOOST_BILLING_PAUSED", "true");
  vi.stubEnv("AOVBOOST_QA_LOCAL_AI_LIMITS", "true");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("bounded per-instance QA AI budgets", () => {
  it("refuses unscoped calls and calls without both owner flags", async () => {
    const { reserveLocalQaAiAttempt: reserve } =
      await import("./qa-ai-limits.server");
    expect(reserve(undefined, [10, 10, 10, 10])).toBeNull();
    vi.stubEnv("AOVBOOST_QA_LOCAL_AI_LIMITS", "false");
    expect(reserve("a", [10, 10, 10, 10])).toBeNull();
    vi.stubEnv("AOVBOOST_QA_LOCAL_AI_LIMITS", "true");
    vi.stubEnv("AOVBOOST_BILLING_PAUSED", "false");
    expect(reserve("a", [10, 10, 10, 10])).toBeNull();
  });
  it("counts attempts after release, isolates shops, and enforces both daily budgets", async () => {
    const { reserveLocalQaAiAttempt: reserve } =
      await import("./qa-ai-limits.server");
    const limits = [3, 2, 2, 1] as const;
    const a = reserve("a", limits),
      b = reserve("b", limits);
    expect(a).toBeTypeOf("function");
    expect(b).toBeTypeOf("function");
    expect(reserve("a", limits)).toBeNull();
    expect(reserve("c", limits)).toBeNull();
    await a!();
    await b!();
    const next = reserve("a", limits);
    expect(next).toBeTypeOf("function");
    await next!();
    expect(reserve("a", limits)).toBeNull();
    expect(reserve("c", limits)).toBeNull();
    await vi.advanceTimersByTimeAsync(86_400_000);
    expect(reserve("a", limits)).toBeTypeOf("function");
  });
  it("expires abandoned leases and makes late/double releases harmless", async () => {
    const { reserveLocalQaAiAttempt: reserve } =
      await import("./qa-ai-limits.server");
    const limits = [10, 10, 1, 1] as const;
    const old = reserve("a", limits);
    expect(reserve("b", limits)).toBeNull();
    await vi.advanceTimersByTimeAsync(30_001);
    const next = reserve("b", limits);
    expect(next).toBeTypeOf("function");
    await old!();
    await old!();
    expect(reserve("c", limits)).toBeNull();
    await next!();
    expect(reserve("c", limits)).toBeTypeOf("function");
  });
  it("keeps active concurrency leases across the UTC daily reset", async () => {
    const { reserveLocalQaAiAttempt: reserve } =
      await import("./qa-ai-limits.server");
    vi.setSystemTime(new Date("2026-11-15T23:59:50Z"));
    const limits = [1, 1, 1, 1] as const;
    const release = reserve("a", limits);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(reserve("a", limits)).toBeNull();
    await release!();
    expect(reserve("a", limits)).toBeTypeOf("function");
  });
  it("refuses new shops at capacity without evicting a live daily counter", async () => {
    const { reserveLocalQaAiAttempt: reserve } =
      await import("./qa-ai-limits.server");
    const limits = [2000, 1, 1, 1] as const;
    for (let i = 0; i < 1000; i++) {
      const release = reserve(`shop-${i}`, limits);
      expect(release).toBeTypeOf("function");
      await release!();
    }
    expect(reserve("overflow", limits)).toBeNull();
    expect(reserve("shop-0", limits)).toBeNull();
    await vi.advanceTimersByTimeAsync(86_400_000);
    expect(reserve("overflow", limits)).toBeTypeOf("function");
  });
  it("bounds active leases even if configured concurrency is extremely high", async () => {
    const { reserveLocalQaAiAttempt: reserve } =
      await import("./qa-ai-limits.server");
    const limits = [10000, 10000, 10000, 10000] as const;
    for (let i = 0; i < 1000; i++)
      expect(reserve("a", limits)).toBeTypeOf("function");
    expect(reserve("a", limits)).toBeNull();
    await vi.advanceTimersByTimeAsync(30_001);
    expect(reserve("a", limits)).toBeTypeOf("function");
  });
  it.each([0, 1, 2, 3])("honors zero to disable limit %s", async (index) => {
    const { reserveLocalQaAiAttempt: reserve } =
      await import("./qa-ai-limits.server");
    const limits: [number, number, number, number] = [10, 10, 10, 10];
    limits[index] = 0;
    expect(reserve("a", limits)).toBeNull();
  });
});
