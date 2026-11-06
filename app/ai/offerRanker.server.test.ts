import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OfferCandidate, ShopperSessionSnapshot } from "./types";
const ai = vi.hoisted(() => vi.fn());
vi.mock("./client.server", () => ({
  callAI: ai,
  parseAiJson: (value: string) => {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  },
}));
import { rankOffers } from "./offerRanker.server";
const candidate = (id: string, tier = 0): OfferCandidate => ({
  id,
  type: "product",
  widgetType: "upsell_drawer",
  productId: id,
  title: id,
  score: 1,
  payload: {
    pairingTier: tier,
    affinity: { reason: "Merchant approved" },
    product: { inventory: 99, unitCost: 3 },
  },
});
const session = { cartProductIds: ["source"] } as ShopperSessionSnapshot;
const result = (ids: unknown) => ({
  content: JSON.stringify({ ids }),
  provider: "gemini",
  fallbackUsed: false,
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("AOVBOOST_DISABLE_AI", "false");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
describe("bounded allowlisted cart ranking", () => {
  it("deduplicates, drops invalid IDs, keeps deterministic remainder and approval precedence", async () => {
    ai.mockResolvedValue(result(["fallback", "b", "b", "forged", "a"]));
    const ranked = await rankOffers(
      [
        candidate("a"),
        candidate("b"),
        candidate("fallback", 2),
        candidate("c", 1),
      ],
      session,
      { shop: "one.myshopify.com" },
    );
    expect(ranked.candidates.map(({ id }) => id)).toEqual([
      "b",
      "a",
      "c",
      "fallback",
    ]);
    expect(ranked.provider).toBe("gemini");
    expect(ai).toHaveBeenCalledTimes(1);
    expect(ai.mock.calls[0][0]).toMatchObject({
      shop: "one.myshopify.com",
      triggerName: "cart_offer_ranker",
      timeoutProfile: "urgent",
    });
    expect(ai.mock.calls[0][0].userPrompt).not.toMatch(
      /inventory|unitCost|sessionId|anonymousId/,
    );
  });
  it.each([
    "invalid-json",
    JSON.stringify({ ids: ["forged"] }),
    JSON.stringify({ ids: null }),
  ])("falls back for invalid output %s", async (content) => {
    ai.mockResolvedValue({ content, provider: "gemini", fallbackUsed: false });
    const candidates = [candidate("a"), candidate("b")];
    expect(await rankOffers(candidates, session, { shop: "one" })).toEqual({
      candidates,
      provider: "heuristic",
    });
  });
  it("returns promptly and aborts a late provider even if its promise never settles", async () => {
    vi.useFakeTimers();
    ai.mockImplementation(() => new Promise(() => {}));
    const candidates = [candidate("a"), candidate("b")];
    const pending = rankOffers(candidates, session, {
      shop: "one",
      timeoutMs: 100,
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toEqual({ candidates, provider: "heuristic" });
    expect(ai.mock.calls[0][0].signal.aborted).toBe(true);
  });
  it("uses deterministic order on cap/provider failure", async () => {
    ai.mockResolvedValue({
      content: null,
      provider: "none",
      fallbackUsed: true,
    });
    expect(
      (
        await rankOffers([candidate("a"), candidate("b")], session, {
          shop: "one",
        })
      ).provider,
    ).toBe("heuristic");
  });
  it("skips AI when disabled, cancelled or there is only one candidate", async () => {
    vi.stubEnv("AOVBOOST_DISABLE_AI", "true");
    await rankOffers([candidate("a"), candidate("b")], session, {
      shop: "one",
    });
    vi.stubEnv("AOVBOOST_DISABLE_AI", "false");
    await rankOffers([candidate("a")], session, { shop: "one" });
    await rankOffers([candidate("a"), candidate("b")], session, {
      shop: "one",
      signal: AbortSignal.abort(),
    });
    expect(ai).not.toHaveBeenCalled();
  });
});
