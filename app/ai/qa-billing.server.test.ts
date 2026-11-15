import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  eval: vi.fn(),
  get: vi.fn(),
  usage: vi.fn(),
  rollup: vi.fn(),
  snapshot: vi.fn(),
}));
vi.mock("@upstash/redis", () => ({
  Redis: class {
    eval = mocks.eval;
    get = mocks.get;
  },
}));
vi.mock("../db.server", () => ({
  default: {
    monthlyUsage: { findUnique: mocks.usage },
    $executeRaw: mocks.rollup,
    entitlementSnapshot: { findUnique: mocks.snapshot },
  },
}));
vi.mock("../models/settings.server", () => ({ getAppSettings: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("AOVBOOST_BILLING_PAUSED", "true");
  vi.stubEnv("AOVBOOST_QA_LOCAL_AI_LIMITS", "true");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://synthetic.upstash.io");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "synthetic");
  vi.stubEnv("AOVBOOST_BILLING_SOURCE", "unconfirmed");
  vi.stubEnv("GOOGLE_API_KEY", "synthetic");
  vi.stubEnv("GOOGLE_AI_MODEL", "qa-model");
  vi.stubEnv("MISTRAL_API_KEY", "");
  vi.stubEnv("GROQ_API_KEY", "");
  vi.stubEnv("DEEPSEEK_API_KEY", "");
  vi.stubEnv("AOVBOOST_DISABLE_AI", "false");
  vi.stubEnv("AOVBOOST_AI_GLOBAL_DAILY_LIMIT", "3");
  vi.stubEnv("AOVBOOST_AI_SHOP_DAILY_LIMIT", "2");
  vi.stubEnv("AOVBOOST_AI_GLOBAL_CONCURRENCY", "2");
  vi.stubEnv("AOVBOOST_AI_SHOP_CONCURRENCY", "1");
  mocks.get.mockRejectedValue(new Error("Redis unavailable"));
  mocks.eval.mockRejectedValue(new Error("Redis unavailable"));
  mocks.usage.mockRejectedValue(
    new Error("Monthly counters must not be touched"),
  );
  mocks.snapshot.mockResolvedValue(null);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const request = {
  shop: "one.myshopify.com",
  triggerName: "chat:qa",
  systemPrompt: "test rules",
  userPrompt: "test message",
  fallback: "fallback",
};

describe("production QA through the real billing and AI gates", () => {
  it("reaches the provider during Redis outage, enforces daily caps, and restores production denial", async () => {
    const fetchMock = vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "Provider reply" }] } }],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { callAI } = await import("./client.server");
    for (let i = 0; i < 2; i++)
      expect(await callAI(request)).toMatchObject({
        content: "Provider reply",
        provider: "gemini",
        fallbackUsed: false,
      });
    expect(await callAI(request)).toMatchObject({ fallbackUsed: true });
    expect(
      await callAI({ ...request, shop: "two.myshopify.com" }),
    ).toMatchObject({ fallbackUsed: false });
    expect(
      await callAI({ ...request, shop: "three.myshopify.com" }),
    ).toMatchObject({ fallbackUsed: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "qa-model:generateContent",
    );
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.eval).not.toHaveBeenCalled();
    expect(mocks.usage).not.toHaveBeenCalled();
    expect(mocks.rollup).not.toHaveBeenCalled();
    expect(mocks.snapshot).not.toHaveBeenCalled();

    vi.stubEnv("AOVBOOST_BILLING_PAUSED", "false");
    expect(await callAI(request)).toMatchObject({
      provider: "none",
      fallbackUsed: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(mocks.get).toHaveBeenCalled();
  });

  it("keeps production fail-closed without the separate Redis-independent opt-in", async () => {
    vi.stubEnv("AOVBOOST_QA_LOCAL_AI_LIMITS", "false");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { callAI } = await import("./client.server");
    const result = await callAI(request);
    expect(result.fallbackUsed).toBe(true);
    expect(result.errors[0].message).toContain("budget or concurrency");
    expect(mocks.eval).toHaveBeenCalledTimes(1);
    expect(mocks.usage).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not authorize unscoped provider calls in production QA", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { callAI } = await import("./client.server");
    expect(await callAI({ ...request, shop: undefined })).toMatchObject({
      fallbackUsed: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
