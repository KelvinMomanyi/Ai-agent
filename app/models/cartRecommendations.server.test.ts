import type { AppSettings } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  candidates: vi.fn(),
  history: vi.fn(),
  aggregate: vi.fn(),
  fresh: vi.fn(),
  relationships: vi.fn(),
  ai: vi.fn(),
  cache: new Map<string, any>(),
}));
vi.mock("../db.server", () => ({
  default: {
    recommendationOutcome: { findMany: mocks.history },
    product: {
      aggregate: mocks.aggregate,
      findFirst: async ({ where }: any) => ({ ...product(1), id: where.id }),
    },
    productAffinity: { findMany: async () => [] },
    productRelationship: { findMany: mocks.relationships },
  },
}));
vi.mock("./offer.server", () => ({ buildOfferCandidates: mocks.candidates }));
vi.mock("./catalogCache.server", () => ({
  getCatalogProductsByIds: mocks.fresh,
}));
vi.mock("../ai/client.server", () => ({
  callAI: mocks.ai,
  parseAiJson: (value: string) => JSON.parse(value),
}));
vi.mock("../redis.server", () => ({
  redis: { get: mocks.aggregate },
  getJsonCache: async (key: string) => mocks.cache.get(key) || null,
  setJsonCache: async (key: string, value: unknown) => {
    mocks.cache.set(key, value);
  },
}));
import { buildCartRecommendation } from "./cartRecommendations.server";
const id = (n: number) => `gid://shopify/Product/${n}`;
const settings = {
  upsellEnabled: true,
  chatEnabled: false,
  maxProductRecommendations: 4,
  blockedProductIds: [],
  excludedCollectionIds: [],
  preferredProductIds: [],
  upsellPriorityProductIds: [],
  updatedAt: new Date("2026-11-05"),
} as unknown as AppSettings;
function input() {
  return {
    shop: "one.myshopify.com",
    session: {
      id: "session-one",
      anonymousId: "session-one",
      cartProductIds: [id(1)],
      viewedProductIds: [],
      context: {},
    } as any,
    settings,
    sourceProductId: id(1),
    sourceVariantId: "gid://shopify/ProductVariant/101",
    cartProductIds: [id(1)],
    cartVariantIds: ["gid://shopify/ProductVariant/101"],
    cartItems: [
      {
        key: "line-one",
        productId: id(1),
        variantId: "gid://shopify/ProductVariant/101",
        quantity: 1,
      },
    ],
    cartItemCount: 1,
    mutationId: "mutation-one",
    confirmed: true,
    currency: "USD",
    market: "US",
    dismissedWidgets: [],
  };
}
function product(n: number) {
  return {
    id: id(n),
    handle: `product-${n}`,
    title: `Product ${n}`,
    price: "12.00",
    tags: [],
    collectionIds: [],
    availableForSale: true,
    inventory: 17,
    variants: [
      {
        id: `gid://shopify/ProductVariant/${n + 100}`,
        title: "Default",
        price: "12.00",
        availableForSale: true,
        quantityAvailable: 17,
        selectedOptions: [],
      },
    ],
    metafields: {
      "aovboost.availableForSale": { value: "true" },
      "aovboost.hasOnlyDefaultVariant": { value: "true" },
      "aovboost.defaultVariantId": {
        value: `gid://shopify/ProductVariant/${n + 100}`,
      },
    },
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.cache.clear();
  vi.stubEnv("AOVBOOST_DISABLE_AI", "false");
  mocks.history.mockResolvedValue([]);
  mocks.aggregate.mockResolvedValue("catalog-version-one");
  mocks.candidates.mockResolvedValue(
    [2, 3, 4, 5].map((n) => ({
      id: id(n),
      productId: id(n),
      type: "product",
      widgetType: "upsell_drawer",
      title: `Product ${n}`,
      score: 1,
      payload: {
        pairingTier: 0,
        affinity: { reason: `Approved ${n}` },
        product: product(n),
      },
    })),
  );
  mocks.fresh.mockImplementation(async (_shop, ids) =>
    [2, 3, 4, 5].filter((n) => ids.includes(id(n))).map(product),
  );
  mocks.relationships.mockResolvedValue([]);
  mocks.ai.mockResolvedValue({
    content: JSON.stringify({ ids: [id(5), id(3), id(2), id(4)] }),
    provider: "gemini",
    fallbackUsed: false,
  });
});
afterEach(() => vi.unstubAllEnvs());
describe("authoritative cart recommendations", () => {
  it("renders ranked IDs in order, rehydrates prices, uses the configured count and strips private signals", async () => {
    const result = await buildCartRecommendation(input());
    expect(result.widgetType).toBe("upsell_drawer");
    expect((result.payload.products as any[]).map((p) => p.productId)).toEqual([
      id(5),
      id(3),
      id(2),
      id(4),
    ]);
    expect((result.payload.products as any[])[0]).toMatchObject({
      reason: "Selected from this store's catalog.",
      product: { price: "12.00" },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /inventory|quantityAvailable|unitCost|margin/,
    );
    expect(result.payload).toMatchObject({
      mutationId: "mutation-one",
      maxProductRecommendations: 4,
      copy: { headline: "Selected from this store's catalog." },
    });
    expect(mocks.ai).toHaveBeenCalledTimes(1);
  });
  it("reuses ranking across shoppers without caching their offer/session/mutation identity", async () => {
    await buildCartRecommendation(input());
    const next = input();
    next.session.id = "session-two";
    next.session.anonymousId = "anon-two";
    next.mutationId = "mutation-two";
    const result = await buildCartRecommendation(next);
    expect(mocks.ai).toHaveBeenCalledTimes(1);
    expect(result.payload.mutationId).toBe("mutation-two");
    expect(JSON.stringify([...mocks.cache])).not.toMatch(
      /session-one|session-two|mutation-one|mutation-two|offerId/,
    );
  });
  it.each([
    "shop",
    "currency",
    "market",
    "variant",
    "quantity",
    "settings",
    "catalog",
    "candidates",
  ])("invalidates cache for %s changes", async (field) => {
    await buildCartRecommendation(input());
    const next = input();
    if (field === "shop") next.shop = "two.myshopify.com";
    if (field === "currency") next.currency = "KES";
    if (field === "market") next.market = "KE";
    if (field === "variant")
      next.sourceVariantId = "gid://shopify/ProductVariant/999";
    if (field === "quantity") next.cartItems[0].quantity = 2;
    if (field === "settings")
      next.settings = { ...settings, updatedAt: new Date("2026-11-06") };
    if (field === "catalog")
      mocks.aggregate.mockResolvedValue("catalog-version-two");
    if (field === "candidates") {
      const rows = await mocks.candidates();
      rows[0].payload.affinity.reason = "New approval reason";
    }
    await buildCartRecommendation(next);
    expect(mocks.ai).toHaveBeenCalledTimes(2);
  });
  it("rechecks availability even on a ranking cache hit", async () => {
    await buildCartRecommendation(input());
    mocks.fresh.mockResolvedValue([product(2)]);
    const result = await buildCartRecommendation(input());
    expect((result.payload.products as any[]).map((p) => p.productId)).toEqual([
      id(2),
    ]);
    expect(mocks.ai).toHaveBeenCalledTimes(1);
  });
  it("passes only this shopper's recent rejected products into eligibility", async () => {
    mocks.history.mockResolvedValue([{ productId: id(5) }]);
    await buildCartRecommendation(input());
    expect(mocks.history.mock.calls[0][0]).toMatchObject({
      where: {
        shop: "one.myshopify.com",
        sessionId: "session-one",
        rejectedAt: { gte: expect.any(Date) },
      },
      take: 30,
    });
    expect(mocks.candidates.mock.calls[0][0]).toMatchObject({
      cartOnly: true,
      excludeProductIds: [id(5)],
    });
  });
  it.each([
    "disabled",
    "unconfirmed",
    "empty",
    "dismissed",
    "serverDismissed",
    "cancelled",
  ])("shows nothing for %s", async (mode) => {
    const next = input();
    if (mode === "disabled")
      next.settings = { ...settings, upsellEnabled: false };
    if (mode === "unconfirmed") next.confirmed = false;
    if (mode === "empty") {
      next.cartItemCount = 0;
      next.cartProductIds = [];
    }
    if (mode === "dismissed")
      next.dismissedWidgets = ["upsell_drawer"] as never[];
    if (mode === "serverDismissed")
      next.session.context.lastCartRecommendationDismissedAt = Date.now();
    const result = await buildCartRecommendation({
      ...next,
      ...(mode === "cancelled" ? { signal: AbortSignal.abort() } : {}),
    });
    expect(result.widgetType).toBeNull();
    expect(mocks.ai).not.toHaveBeenCalled();
    expect(mocks.candidates).not.toHaveBeenCalled();
  });
  it("uses deterministic candidates with AI disabled and chat disabled", async () => {
    vi.stubEnv("AOVBOOST_DISABLE_AI", "true");
    const result = await buildCartRecommendation(input());
    expect((result.payload.products as any[]).map((p) => p.productId)).toEqual([
      id(2),
      id(3),
      id(4),
      id(5),
    ]);
    expect(result.aiProvider).toBe("heuristic");
    expect(mocks.ai).not.toHaveBeenCalled();
  });
  it("does not reuse an AI ranking after the provider is disabled", async () => {
    await buildCartRecommendation(input());
    vi.stubEnv("AOVBOOST_DISABLE_AI", "true");
    const result = await buildCartRecommendation(input());
    expect((result.payload.products as any[]).map((p) => p.productId)).toEqual([
      id(2),
      id(3),
      id(4),
      id(5),
    ]);
    expect(result.aiProvider).toBe("heuristic");
  });
});
