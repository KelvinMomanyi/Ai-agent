import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  products: [] as any[],
  rows: [] as any[],
  preset: "beauty_haircare",
  mode: "review_first",
  update: vi.fn(),
  state: vi.fn(),
  findProducts: vi.fn(),
  settings: vi.fn(),
  affinities: vi.fn(),
  remove: vi.fn(),
  create: vi.fn(),
  ai: vi.fn(),
  reserve: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock("../db.server", () => ({
  default: {
    appSettings: { findUnique: mocks.settings },
    product: { findMany: mocks.findProducts },
    productAffinity: { findMany: mocks.affinities },
    $transaction: mocks.transaction,
  },
}));
vi.mock("../ai/client.server", () => ({
  callAI: mocks.ai,
  parseAiJson: (value: string | null) => {
    try {
      return JSON.parse(value || "null");
    } catch {
      return null;
    }
  },
}));
vi.mock("../redis.server", () => ({ reserveAiAttempt: mocks.reserve }));
vi.mock("../models/usage.server", () => ({
  monthlyAiAvailable: async () => true,
  reserveMonthlyAiCall: async () => true,
}));
import { generatePairingSuggestions } from "./pairingSuggestions.server";
const shop = "one.myshopify.com";
function product(
  n: number,
  title: string,
  extra: Record<string, unknown> = {},
) {
  return {
    id: `gid://shopify/Product/${n}`,
    shop,
    title,
    vendor: "Brand",
    productType: title,
    price: "20.00",
    tags: [],
    collectionIds: [],
    metafields: { "aovboost.availableForSale": { value: "true" } },
    ...extra,
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("AOVBOOST_DISABLE_AI", "");
  mocks.preset = "beauty_haircare";
  mocks.mode = "review_first";
  mocks.products = [
    product(1, "Shampoo"),
    product(2, "Conditioner"),
    product(3, "Hair serum"),
    product(4, "Comb"),
  ];
  mocks.rows = [];
  mocks.settings.mockImplementation(async () => ({
    verticalPreset: mocks.preset,
    pairingMode: mocks.mode,
    pairingStrictness: "balanced",
    pairingSensitiveKeywords: [],
    blockedProductIds: [],
    excludedCollectionIds: [],
  }));
  mocks.findProducts.mockImplementation(async ({ where, take }) =>
    mocks.products
      .filter(
        (p) =>
          p.shop === where.shop &&
          (!where.id?.in || where.id.in.includes(p.id)) &&
          (!where.id?.not || where.id.not !== p.id),
      )
      .slice(0, take),
  );
  mocks.affinities.mockResolvedValue([]);
  mocks.ai.mockResolvedValue({
    provider: "none",
    fallbackUsed: true,
    content: '{"pairings":[]}',
  });
  mocks.remove.mockImplementation(async ({ where }) => {
    mocks.rows = mocks.rows.filter(
      (row) =>
        !(
          row.shop === where.shop &&
          where.sourceProductId.in.includes(row.sourceProductId) &&
          row.kind === where.kind &&
          row.status === where.status
        ),
    );
  });
  mocks.create.mockImplementation(async ({ data }) => {
    let count = 0;
    for (const row of data)
      if (
        !mocks.rows.some(
          (old) =>
            old.shop === row.shop &&
            old.sourceProductId === row.sourceProductId &&
            old.targetProductId === row.targetProductId &&
            old.kind === row.kind,
        )
      ) {
        mocks.rows.push(row);
        count++;
      }
    return { count };
  });
  mocks.transaction.mockImplementation((fn) =>
    fn({
      appSettings: { findUnique: mocks.settings },
      product: { findMany: mocks.findProducts },
      productPairingState: {
        findUnique: mocks.state,
        updateMany: mocks.update,
      },
      productRelationship: {
        findMany: async ({ where }: any) =>
          mocks.rows.filter(
            (row) =>
              row.shop === where.shop &&
              where.sourceProductId.in.includes(row.sourceProductId),
          ),
        updateMany: mocks.update,
        deleteMany: mocks.remove,
        createMany: mocks.create,
      },
    }),
  );
  mocks.update.mockImplementation(async ({ where, data }) => {
    let count = 0;
    for (const row of mocks.rows)
      if (
        row.shop === where.shop &&
        row.sourceProductId === where.sourceProductId &&
        row.kind === where.kind &&
        (typeof where.status === "string"
          ? row.status === where.status
          : where.status?.in?.includes(row.status)) &&
        (typeof where.targetProductId === "string"
          ? row.targetProductId === where.targetProductId
          : !where.targetProductId?.notIn?.includes(row.targetProductId))
      ) {
        Object.assign(row, data);
        count++;
      }
    return { count };
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("bounded setup-only pairing generation", () => {
  it("publishes a grounded high-confidence non-sensitive AI pair in autopilot", async () => {
    mocks.mode = "autopilot";
    mocks.ai.mockResolvedValue({
      provider: "gemini",
      modelVersion: "synthetic-pro",
      fallbackUsed: false,
      content: JSON.stringify({
        pairings: [
          {
            sourceProductId: mocks.products[0].id,
            targetId: mocks.products[1].id,
            confidence: 0.95,
            reasonCode: "completes_routine",
            supportingFields: ["source.productType", "target.productType"],
          },
        ],
      }),
    });
    const result = await generatePairingSuggestions(shop, [
      mocks.products[0].id,
    ]);
    expect(result.autoApproved).toBe(1);
    expect(
      mocks.rows.find((row) => row.targetProductId === mocks.products[1].id),
    ).toMatchObject({
      status: "auto_approved",
      origin: "ai",
      reasonCode: "completes_routine",
      modelVersion: "gemini:synthetic-pro",
    });
  });
  it("keeps sensitive wording for review despite maximal model confidence", async () => {
    mocks.mode = "autopilot";
    mocks.products[1].title = "Chemical conditioner treatment";
    mocks.ai.mockResolvedValue({
      provider: "gemini",
      fallbackUsed: false,
      content: JSON.stringify({
        pairings: [
          {
            sourceProductId: mocks.products[0].id,
            targetId: mocks.products[1].id,
            confidence: 1,
            reasonCode: "completes_routine",
            supportingFields: ["source.productType"],
          },
        ],
      }),
    });
    await generatePairingSuggestions(shop, [mocks.products[0].id]);
    expect(
      mocks.rows.find((row) => row.targetProductId === mocks.products[1].id),
    ).toMatchObject({ status: "suggested", evidence: { sensitive: true } });
  });
  it("uses the stricter deterministic threshold when AI is capped and does nothing in off mode", async () => {
    mocks.mode = "autopilot";
    mocks.products.forEach((product) => (product.collectionIds = ["routine"]));
    await generatePairingSuggestions(shop, [mocks.products[0].id]);
    expect(
      mocks.rows.some(
        (row) =>
          row.status === "auto_approved" &&
          row.modelVersion === "deterministic-v2" &&
          row.confidence >= 0.96,
      ),
    ).toBe(true);
    mocks.mode = "off";
    mocks.create.mockClear();
    mocks.ai.mockClear();
    expect(
      await generatePairingSuggestions(shop, [mocks.products[0].id]),
    ).toEqual({ processed: 0, suggested: 0, autoApproved: 0 });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.ai).not.toHaveBeenCalled();
  });
  it("drops stale revisions before writing a background result", async () => {
    mocks.state.mockResolvedValue({
      revision: 2,
      leaseToken: "new-token",
      leaseUntil: new Date(Date.now() + 60000),
    });
    await expect(
      generatePairingSuggestions(shop, [mocks.products[0].id], undefined, [
        {
          productId: mocks.products[0].id,
          revision: 1,
          leaseToken: "old-token",
        },
      ]),
    ).rejects.toThrow("Pairing lease changed");
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("regenerates preset-specific suggestions without approving them", async () => {
    const sourceId = mocks.products[0].id;
    mocks.preset = "generic";
    await generatePairingSuggestions(shop, [sourceId]);
    expect(mocks.rows[0].reasonCode).toBe("same_brand");
    mocks.preset = "beauty_haircare";
    await generatePairingSuggestions(shop, [sourceId]);
    expect(mocks.rows[0].reasonCode).toBe("completes_routine");
    expect(mocks.rows.every((row) => row.status === "suggested")).toBe(true);
  });
  it("uses one gateway request for at most three owned sources and writes suggested pairs only", async () => {
    const result = await generatePairingSuggestions(
      shop,
      mocks.products.map(({ id }) => id),
    );
    expect(result.processed).toBe(3);
    expect(mocks.ai).toHaveBeenCalledTimes(1);
    expect(mocks.rows.length).toBeGreaterThan(0);
    expect(
      mocks.rows.every(
        (row) =>
          row.status === "suggested" &&
          row.shop === shop &&
          row.kind === "complement",
      ),
    ).toBe(true);
    expect(mocks.ai.mock.calls[0][0]).toMatchObject({
      shop,
      triggerName: "pairing_setup",
      schemaType: "json",
      timeoutProfile: "reasoning",
      jobClass: "pairing_reasoning",
    });
    expect(JSON.stringify(mocks.ai.mock.calls)).not.toMatch(
      /quantityAvailable|unitCost|inventoryQuantity|marginBand/,
    );
    for (const [query] of mocks.findProducts.mock.calls) {
      expect(query.where.shop).toBe(shop);
      expect(query.take).toBeLessThanOrEqual(40);
    }
  });
  it("preserves approved/rejected choices when suggestions are refreshed", async () => {
    const source = mocks.products[0].id;
    mocks.rows = [
      {
        shop,
        sourceProductId: source,
        targetProductId: mocks.products[1].id,
        kind: "complement",
        status: "approved",
        reason: "Merchant reason",
      },
      {
        shop,
        sourceProductId: source,
        targetProductId: mocks.products[2].id,
        kind: "complement",
        status: "rejected",
      },
      {
        shop: "other.myshopify.com",
        sourceProductId: source,
        targetProductId: mocks.products[3].id,
        kind: "complement",
        status: "suggested",
      },
    ];
    await generatePairingSuggestions(shop, [source]);
    expect(
      mocks.rows.filter((row) => row.status === "approved")[0].reason,
    ).toBe("Merchant reason");
    expect(mocks.rows.some((row) => row.status === "rejected")).toBe(true);
    expect(mocks.rows.some((row) => row.shop === "other.myshopify.com")).toBe(
      true,
    );
  });
  it("never persists invalid model IDs or invented reasons", async () => {
    mocks.ai.mockResolvedValue({
      provider: "gemini",
      fallbackUsed: false,
      content: JSON.stringify({
        pairings: [
          {
            sourceProductId: mocks.products[0].id,
            targetProductId: "gid://shopify/Product/999",
            reason: "invented",
          },
          {
            sourceProductId: mocks.products[0].id,
            targetProductId: mocks.products[1].id,
            reason: "Clinically proven cure",
          },
        ],
      }),
    });
    await generatePairingSuggestions(shop, [mocks.products[0].id]);
    expect(JSON.stringify(mocks.rows)).not.toMatch(/999|Clinically|cure/);
    expect(mocks.rows[0].targetProductId).toBe(mocks.products[1].id);
  });
  it("uses deterministic suggestions when the real shared budget rejects an AI attempt", async () => {
    vi.stubEnv("GOOGLE_API_KEY", "fake-key");
    for (const key of ["MISTRAL_API_KEY", "GROQ_API_KEY", "DEEPSEEK_API_KEY"])
      vi.stubEnv(key, "");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.reserve.mockResolvedValue(null);
    const actual = await vi.importActual<typeof import("../ai/client.server")>(
      "../ai/client.server",
    );
    mocks.ai.mockImplementation(actual.callAI);
    await generatePairingSuggestions(shop, [mocks.products[0].id]);
    expect(mocks.reserve).toHaveBeenCalledWith(shop);
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.rows.length).toBeGreaterThan(0);
    expect(mocks.rows.every((row) => row.origin === "affinity")).toBe(true);
  });
  it("does not call AI when explicitly disabled", async () => {
    vi.stubEnv("AOVBOOST_DISABLE_AI", "true");
    await generatePairingSuggestions(shop, [mocks.products[0].id]);
    expect(mocks.ai).not.toHaveBeenCalled();
    expect(mocks.rows.length).toBeGreaterThan(0);
  });
  it("cannot generate for another tenant's IDs", async () => {
    mocks.products.push(
      product(99, "Conditioner", { shop: "other.myshopify.com" }),
    );
    expect(
      await generatePairingSuggestions(shop, ["gid://shopify/Product/99"]),
    ).toEqual({ processed: 0, suggested: 0, autoApproved: 0 });
    expect(mocks.ai).not.toHaveBeenCalled();
    expect(mocks.rows).toEqual([]);
  });
  it("rejects an old preset result if the merchant switches presets during generation", async () => {
    mocks.ai.mockImplementation(async () => {
      mocks.preset = "generic";
      return { provider: "none", fallbackUsed: true, content: null };
    });
    await expect(
      generatePairingSuggestions(shop, [mocks.products[0].id]),
    ).rejects.toThrow("Pairing settings changed");
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
