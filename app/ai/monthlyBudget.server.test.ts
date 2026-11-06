import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  monthly: vi.fn(),
  available: vi.fn(),
  release: vi.fn(),
  daily: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("../redis.server", () => ({ reserveAiAttempt: mocks.daily }));
vi.mock("../models/usage.server", () => ({
  monthlyAiAvailable: mocks.available,
  reserveMonthlyAiCall: mocks.monthly,
}));
beforeEach(() => {
  vi.resetAllMocks();
  vi.resetModules();
  for (const name of [
    "GOOGLE_API_KEY",
    "MISTRAL_API_KEY",
    "GROQ_API_KEY",
    "DEEPSEEK_API_KEY",
  ])
    vi.stubEnv(name, "");
  vi.stubEnv("GOOGLE_API_KEY", "synthetic-google");
  vi.stubEnv("MISTRAL_API_KEY", "synthetic-mistral");
  vi.stubEnv("AOVBOOST_DISABLE_AI", "false");
  mocks.daily.mockResolvedValue(mocks.release);
  mocks.available.mockResolvedValue(true);
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("monthly AI cost boundary", () => {
  it("does not let a fully exhausted shop consume the global daily allowance", async () => {
    mocks.available.mockResolvedValue(false);
    const { callAI } = await import("./client.server");
    expect(
      (
        await callAI({
          shop: "one.myshopify.com",
          triggerName: "chat",
          systemPrompt: "rules",
          userPrompt: "hello",
          fallback: "fallback",
        })
      ).content,
    ).toBe("fallback");
    expect(mocks.daily).not.toHaveBeenCalled();
    expect(mocks.monthly).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("keeps the deterministic ranked list when monthly allowance is exhausted, without contacting a provider", async () => {
    mocks.monthly.mockResolvedValue(false);
    const { rankOffers } = await import("./offerRanker.server");
    const candidates = [
      { id: "one", title: "One", payload: {} },
      { id: "two", title: "Two", payload: {} },
    ] as any;
    expect(
      await rankOffers(candidates, { cartProductIds: [] } as any, {
        shop: "one.myshopify.com",
      }),
    ).toEqual({ candidates, provider: "heuristic" });
    expect(mocks.monthly).toHaveBeenCalledWith("one.myshopify.com");
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });
  it("checks and charges each provider fallback attempt in addition to existing daily limits", async () => {
    mocks.monthly.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    mocks.fetch.mockResolvedValue(new Response("unavailable", { status: 503 }));
    const { callAI } = await import("./client.server");
    const result = await callAI({
      shop: "one.myshopify.com",
      triggerName: "cart_offer_ranker",
      systemPrompt: "rules",
      userPrompt: "allowed ids",
      fallback: "deterministic",
    });
    expect(result.content).toBe("deterministic");
    expect(result.fallbackUsed).toBe(true);
    expect(mocks.monthly).toHaveBeenCalledTimes(2);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.daily).toHaveBeenCalledTimes(2);
    expect(mocks.release).toHaveBeenCalledTimes(2);
  });
});
