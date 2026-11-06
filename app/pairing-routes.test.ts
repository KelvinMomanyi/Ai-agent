import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  data: vi.fn(),
  generate: vi.fn(),
  change: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  bulk: vi.fn(),
  policy: vi.fn(),
  dirty: vi.fn(),
  undo: vi.fn(),
}));
vi.mock("./db.server", () => ({
  default: { appSettings: { upsert: mocks.policy } },
}));
vi.mock("./redis.server", () => ({ redis: { del: vi.fn() } }));
vi.mock("./jobs/pairingAutopilot.server", () => ({
  markPairingPolicyDirty: mocks.dirty,
}));
vi.mock("./shopify.server", () => ({ authenticate: { admin: mocks.auth } }));
vi.mock("./jobs/pairingSuggestions.server", () => ({
  generatePairingSuggestions: mocks.generate,
}));
vi.mock("./models/productRelationships.server", async (original) => ({
  ...(await original<typeof import("./models/productRelationships.server")>()),
  pairingAdminData: mocks.data,
  changeRelationshipStatus: mocks.change,
  saveMerchantPair: mocks.save,
  removePairingExclusion: mocks.remove,
  bulkApprovePairings: mocks.bulk,
  undoPairingRejection: mocks.undo,
}));
import { action, loader } from "./routes/app.pairings";
const shop = "one.myshopify.com";
function post(values: Record<string, string>) {
  return {
    request: new Request("https://app.example.com/app/pairings", {
      method: "POST",
      body: new URLSearchParams(values),
    }),
  } as ActionFunctionArgs;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ session: { shop } });
  mocks.generate.mockResolvedValue({ processed: 3, suggested: 5 });
  mocks.bulk.mockResolvedValue(2);
});
afterEach(() => vi.restoreAllMocks());
describe("pairing admin routes", () => {
  it("persists bounded preferences only for the authenticated shop and schedules refresh", async () => {
    const result = await action(
      post({
        intent: "policy",
        shop: "forged.myshopify.com",
        pairingMode: "autopilot",
        pairingStrictness: "cautious",
        verticalPreset: "beauty_haircare",
        sensitiveKeywords: "fragrance, fragrance, allergy",
      }),
    );
    expect(result.data).toMatchObject({ ok: true });
    expect(mocks.policy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { shop },
        update: {
          pairingMode: "autopilot",
          pairingStrictness: "cautious",
          verticalPreset: "beauty_haircare",
          pairingSensitiveKeywords: ["fragrance", "allergy"],
        },
      }),
    );
    expect(mocks.dirty).toHaveBeenCalledWith(shop);
    await action(
      post({
        intent: "undoReject",
        relationshipId: "row",
        status: "approved",
        shop: "forged",
      }),
    );
    expect(mocks.undo).toHaveBeenCalledWith(shop, "row");
  });
  it("rejects invalid policy and unbounded keyword input before writes", async () => {
    const invalid: Array<Record<string, string>> = [
      { pairingMode: "bad" },
      { sensitiveKeywords: "x".repeat(81) },
      {
        sensitiveKeywords: Array.from(
          { length: 31 },
          (_, i) => `word${i}`,
        ).join(","),
      },
    ];
    for (const extra of invalid) {
      const result = await action(
        post({
          intent: "policy",
          pairingMode: "autopilot",
          pairingStrictness: "balanced",
          verticalPreset: "generic",
          ...extra,
        }),
      );
      expect(result.init?.status).toBe(400);
    }
    expect(mocks.policy).not.toHaveBeenCalled();
  });
  it("authenticates before reading source/search data", async () => {
    mocks.data.mockResolvedValue({ products: [] });
    await loader({
      request: new Request(
        "https://app.example.com/app/pairings?source=gid%3A%2F%2Fshopify%2FProduct%2F1&q=shampoo",
      ),
    } as LoaderFunctionArgs);
    expect(mocks.data).toHaveBeenCalledWith(
      shop,
      "gid://shopify/Product/1",
      "shampoo",
    );
    const redirect = new Response(null, { status: 302 });
    mocks.auth.mockRejectedValueOnce(redirect);
    await expect(
      loader({
        request: new Request("https://app.example.com/app/pairings"),
      } as LoaderFunctionArgs),
    ).rejects.toBe(redirect);
    expect(mocks.data).toHaveBeenCalledTimes(1);
  });
  it("runs only one three-product batch while returning browser continuation", async () => {
    const ids = Array.from(
      { length: 50 },
      (_, n) => `gid://shopify/Product/${n + 1}`,
    );
    const result = await action(
      post({
        intent: "generate",
        sourceProductIds: JSON.stringify(ids),
        shop: "other.myshopify.com",
      }),
    );
    expect(mocks.generate).toHaveBeenCalledWith(
      shop,
      ids.slice(0, 3),
      expect.any(AbortSignal),
    );
    expect(result.data).toMatchObject({
      ok: true,
      remainingSourceIds: ids.slice(3),
      done: 3,
      total: 50,
    });
  });
  it.each([
    "not-json",
    '["bad-id"]',
    JSON.stringify(
      Array.from({ length: 51 }, (_, n) => `gid://shopify/Product/${n}`),
    ),
  ])(
    "rejects invalid or unbounded batches before gateway work",
    async (value) => {
      const result = await action(
        post({ intent: "generate", sourceProductIds: value }),
      );
      expect(result.init?.status).toBe(400);
      expect(mocks.generate).not.toHaveBeenCalled();
    },
  );
  it("uses authenticated shop boundaries for approval, replacement and bulk actions", async () => {
    await action(
      post({
        intent: "approve",
        relationshipId: "row",
        shop: "other.myshopify.com",
      }),
    );
    expect(mocks.change).toHaveBeenCalledWith(shop, "row", "approved");
    await action(
      post({
        intent: "replace",
        relationshipId: "row",
        sourceProductId: "source",
        targetProductId: "target",
      }),
    );
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        shop,
        sourceProductId: "source",
        targetProductId: "target",
        replaceId: "row",
      }),
    );
    await action(post({ intent: "bulkApprove" }));
    expect(mocks.bulk).toHaveBeenCalledWith(shop);
  });
});
