import { PGlite } from "@electric-sql/pglite";
import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ db: null as PGlite | null }));
vi.mock("../db.server", () => ({
  default: {
    $queryRaw: async (sql: Prisma.Sql) =>
      (await state.db!.query(sql.text, sql.values)).rows,
    product: {
      findMany: async () => [],
      count: async ({ where }: any) =>
        Number(
          (
            await state.db!.query<{ count: number }>(
              'SELECT count(*)::int count FROM "Product" WHERE shop = $1',
              [where.shop],
            )
          ).rows[0].count,
        ),
    },
  },
}));
vi.mock("../redis.server", () => ({
  getJsonCache: async () => null,
  setJsonCache: async () => {},
  redis: null,
  claimExpiringKeyStatus: async () => "unavailable",
}));
import { getChatCatalog } from "./catalogCache.server";
import { classifyMessageIntent, getCatalogProductCards } from "./chatResponse";
import { rankProductRecommendations } from "../sales/recommendationEngine";
import { normalizeShopperProfile } from "../sales/shopperProfile";
import { toMerchantSalesSettings } from "../sales/settings";

beforeAll(async () => {
  state.db = new PGlite();
  await state.db.exec(`
    CREATE TABLE "Product" (shop text, id text, title text, handle text, "productType" text,
      tags text[], "collectionIds" text[], price numeric, "compareAtPrice" numeric, vendor text,
      "imageUrl" text, metafields jsonb, "updatedAt" timestamptz);
    CREATE TABLE "ProductOrderStat" (shop text, "productId" text, "orderCount" integer);
  `);
  for (const [shop, n] of [
    ["one", 1],
    ["one", 18],
    ["one", 20],
    ["other", 99],
  ] as const) {
    await state.db.query(
      `INSERT INTO "Product" VALUES ($1,$2,$3,$4,'', '{}','{}',249.29,null,'',null,$5,now())`,
      [
        shop,
        `gid://shopify/Product/${n}`,
        `Amazing Aluminum Bag Collection${n}`,
        `amazing-aluminum-bag-collection${n}`,
        JSON.stringify({
          "aovboost.availableForSale": { value: "true" },
          "aovboost.hasOnlyDefaultVariant": { value: "true" },
          "aovboost.defaultVariantId": {
            value: `gid://shopify/ProductVariant/${n + 100}`,
          },
        }),
      ],
    );
  }
}, 60_000);
afterAll(async () => state.db?.close());

describe("shopper message through PostgreSQL retrieval, ranking and chat cards", () => {
  it.each([
    "Show me three bags from this store with prices.",
    "Show me Amazing Aluminum Bag Collection20.",
  ])("returns available, tenant-scoped cards for %s", async (query) => {
    expect(classifyMessageIntent(query)).toBe("product_search");
    const catalog = await getChatCatalog({ shop: "one", query });
    expect(catalog.products.length).toBeGreaterThan(0);
    expect(catalog.products.some((p) => p.id.endsWith("/99"))).toBe(false);
    const ranked = rankProductRecommendations({
      products: catalog.products,
      query,
      profile: normalizeShopperProfile({}),
      currencyCode: "KES",
      settings: toMerchantSalesSettings({ chatEnabled: true } as any),
    });
    const cards = getCatalogProductCards(
      ranked.map((p) => p.product),
      { code: "KES", locale: "en-KE" },
    );
    expect(cards.length).toBeGreaterThan(0);
    if (query.includes("Collection20"))
      expect(cards[0].title).toContain("Collection20");
    else expect(cards).toHaveLength(3);
    expect(
      cards.every((p) => p.variants.length > 0 && p.price.includes("249.29")),
    ).toBe(true);
    // A shopper's hard budget must still be respected after plural retrieval.
    expect(
      rankProductRecommendations({
        products: catalog.products,
        query,
        profile: normalizeShopperProfile({ budgetMax: 100 }),
        settings: toMerchantSalesSettings({ chatEnabled: true } as any),
      }),
    ).toEqual([]);
  });
});
