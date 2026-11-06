import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { Prisma, type Offer } from "@prisma/client";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const state = vi.hoisted(() => ({
  db: null as PGlite | null,
  failUpdate: false,
  reads: [] as unknown[],
}));

vi.mock("../redis.server", () => ({
  getJsonCache: async () => null,
  setJsonCache: async () => {},
  cacheKeys: { affinity: (shop: string, id: string) => `${shop}:${id}` },
  redis: { del: async () => {}, get: async () => null, set: async () => {} },
}));

vi.mock("../db.server", () => {
  const query = async (sql: Prisma.Sql) => {
    if (state.failUpdate && sql.text.includes('UPDATE "ProductAffinity"')) {
      state.failUpdate = false;
      throw new Error("interrupted");
    }
    return state.db!.query(
      sql.text,
      sql.values.map((v) => (v instanceof Date ? v.toISOString() : v)),
    );
  };
  const tx = {
    $executeRaw: async (sql: Prisma.Sql) => (await query(sql)).affectedRows,
    product: {
      findMany: async ({
        where,
      }: {
        where: {
          shop: string;
          id?: { in: string[] };
          OR?: Array<{ id?: { in: string[] }; handle?: { in: string[] } }>;
        };
      }) => {
        if (!where.id) {
          return (
            await state.db!.query(
              'SELECT p.*, jsonb_build_object(\'orderCount\',0) "orderStats" FROM "Product" p WHERE shop=$1 AND (id=ANY($2::text[]) OR handle=ANY($3::text[])) LIMIT 100',
              [
                where.shop,
                where.OR?.[0]?.id?.in || [],
                where.OR?.[1]?.handle?.in || [],
              ],
            )
          ).rows;
        }
        state.reads.push(where);
        return (
          await state.db!.query(
            'SELECT id FROM "Product" WHERE shop=$1 AND id=ANY($2::text[])',
            [where.shop, where.id.in],
          )
        ).rows;
      },
      count: async ({ where }: { where: { shop: string } }) =>
        Number(
          (
            await state.db!.query<{ n: number }>(
              'SELECT COUNT(*)::int n FROM "Product" WHERE shop=$1',
              [where.shop],
            )
          ).rows[0].n,
        ),
    },
    event: {
      findUnique: async ({
        where,
      }: {
        where: {
          event_orderId_storeId: {
            event: string;
            orderId: string;
            storeId: string;
          };
        };
      }) => {
        const k = where.event_orderId_storeId;
        return (
          (
            await state.db!.query(
              'SELECT id FROM "Event" WHERE event=$1 AND "orderId"=$2 AND "storeId"=$3',
              [k.event, k.orderId, k.storeId],
            )
          ).rows[0] || null
        );
      },
      create: async ({
        data,
      }: {
        data: {
          event: string;
          orderId: string;
          storeId: string;
          timestamp: Date;
          data: unknown;
        };
      }) => {
        await state.db!.query(
          'INSERT INTO "Event" (id,event,"orderId","storeId",timestamp,data,"updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$5)',
          [
            `${data.storeId}:${data.orderId}`,
            data.event,
            data.orderId,
            data.storeId,
            data.timestamp.toISOString(),
            JSON.stringify(data.data),
          ],
        );
      },
    },
    productOrderStat: {
      createMany: async ({
        data,
      }: {
        data: Array<{ shop: string; productId: string }>;
      }) => {
        for (const r of data)
          await state.db!.query(
            'INSERT INTO "ProductOrderStat" (id,shop,"productId","orderCount") VALUES ($1,$2,$3,0) ON CONFLICT DO NOTHING',
            [`${r.shop}:${r.productId}`, r.shop, r.productId],
          );
      },
      updateMany: async ({
        where,
      }: {
        where: { shop: string; productId: { in: string[] } };
      }) => {
        await state.db!.query(
          'UPDATE "ProductOrderStat" SET "orderCount"="orderCount"+1 WHERE shop=$1 AND "productId"=ANY($2::text[])',
          [where.shop, where.productId.in],
        );
      },
    },
    productVariantOrderStat: {
      createMany: async () => {},
      updateMany: async () => {},
    },
  };
  return {
    default: {
      ...tx,
      $queryRaw: async (sql: Prisma.Sql) => (await query(sql)).rows,
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        await state.db!.exec("BEGIN");
        try {
          const value = await fn(tx);
          await state.db!.exec("COMMIT");
          return value;
        } catch (error) {
          await state.db!.exec("ROLLBACK");
          throw error;
        }
      },
    },
  };
});

import {
  getRevenueAnalytics,
  summarizeRevenueAnalytics,
} from "./analytics.server";
import {
  getSalesAnalytics,
  summarizeSalesAnalytics,
} from "./salesAnalytics.server";
import { getCatalogReadiness, getChatCatalog } from "./catalogCache.server";
import { summarizeCatalogReadiness } from "./productCatalogMapping";
import { findProductIdsByVariants } from "./productLookup.server";
import { incrementOrderAffinities } from "./product.server";
import { enforceCatalogBackedDecision } from "./catalogGuard.server";

const shop = "one.myshopify.com",
  other = "two.myshopify.com";
const from = new Date("2026-08-01T00:00:00Z");

beforeAll(async () => {
  state.db = new PGlite();
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const ddl = execFileSync(
    process.execPath,
    [
      "node_modules/prisma/build/index.js",
      "migrate",
      "diff",
      "--from-empty",
      "--to-schema-datamodel",
      "prisma/schema.prisma",
      "--script",
    ],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 30_000,
      env: {
        ...process.env,
        DATABASE_URL: "postgresql://test:test@localhost:1/test",
        DATABASE_DIRECT_URL: "postgresql://test:test@localhost:1/test",
      },
    },
  );
  await state.db.exec(
    ddl.replace(
      'CREATE SCHEMA "public";',
      'CREATE SCHEMA IF NOT EXISTS "public";',
    ),
  );
  await state.db.exec(
    readFileSync(
      new URL(
        "../../prisma/migrations/20261102150000_performance_indexes/migration.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
}, 60_000);

afterAll(async () => {
  await state.db?.close();
});
beforeEach(async () => {
  state.reads = [];
  state.failUpdate = false;
  await state.db!.exec(
    'TRUNCATE "Product", "ShopperSession", "Event", "Experiment" CASCADE',
  );
});

async function insert(table: string, row: Record<string, unknown>) {
  const fields = Object.keys(row);
  await state.db!.query(
    `INSERT INTO "${table}" (${fields.map((f) => `"${f}"`).join(",")}) VALUES (${fields.map((_, i) => `$${i + 1}`).join(",")})`,
    Object.values(row).map((v) =>
      v instanceof Date
        ? v.toISOString()
        : v instanceof Prisma.Decimal
          ? v.toString()
          : v && typeof v === "object" && !Array.isArray(v)
            ? JSON.stringify(v)
            : v,
    ),
  );
}

describe("database-side performance work", () => {
  it("matches the existing revenue and sales attribution calculations, including action dates and tenant isolation", async () => {
    const sessions = [
      {
        id: "s1",
        shop,
        anonymousId: "s1",
        journeyStage: "buying",
        chatEngaged: true,
        checkoutStarted: true,
        purchaseCompleted: true,
        shopperProfile: { knownObjections: ["PRICE"] },
        context: { proactivePromptCount: 1 },
        updatedAt: from,
      },
      {
        id: "s2",
        shop,
        anonymousId: "s2",
        journeyStage: "discovering",
        chatEngaged: false,
        checkoutStarted: false,
        purchaseCompleted: false,
        shopperProfile: {},
        context: {},
        updatedAt: from,
      },
    ];
    for (const s of sessions) await insert("ShopperSession", s);
    await insert("ShopperSession", {
      id: "other-session",
      shop: other,
      anonymousId: "other",
      updatedAt: from,
    });
    await insert("Experiment", {
      id: "exp",
      shop,
      name: "Bundle test",
      widgetType: "bundle",
    });
    const offer = (
      id: string,
      converted: boolean,
      revenue: number,
      date: string,
    ) => ({
      id,
      shop,
      sessionId: "s1",
      widgetType: "bundle",
      payload: { copy: { headline: "Complete the kit" } },
      triggerContext: {},
      shown: true,
      clicked: converted,
      converted,
      aiProvider: null,
      revenueImpact: new Prisma.Decimal(revenue),
      abVariant: "treatment",
      experimentId: "exp",
      createdAt: new Date(date),
    });
    const offers = [
      offer("o1", true, 25, "2026-08-01T10:00:00Z"),
      offer("o2", false, 0, "2026-08-02T10:00:00Z"),
      offer("o3", true, 10, "2026-08-06T10:00:00Z"),
    ];
    for (const o of offers) await insert("Offer", o);
    await insert("Offer", {
      ...offer("foreign", true, 999, "2026-08-01T10:00:00Z"),
      shop: other,
      sessionId: "other-session",
      experimentId: null,
    });
    const orders = [
      {
        data: {
          total_price: "150.00",
          offerIds: ["o1"],
          aiAssisted: true,
          aiAttributedRevenue: 25,
        },
        timestamp: new Date("2026-08-04T00:00:00Z"),
      },
      {
        data: { total_price: "100.00", offerIds: [] },
        timestamp: new Date("2026-08-05T00:00:00Z"),
      },
    ];
    for (let i = 0; i < orders.length; i++)
      await insert("Event", {
        id: `order-${i}`,
        storeId: shop,
        event: "conversion",
        orderId: `order-${i}`,
        updatedAt: from,
        ...orders[i],
      });
    const events = [
      {
        type: "widget_impression",
        payload: { offerId: "o1", widgetType: "chat" },
        createdAt: new Date("2026-08-02T00:00:00Z"),
        sessionId: "s1",
      },
      {
        type: "widget_click",
        payload: { offerId: "o1" },
        createdAt: new Date("2026-08-03T00:00:00Z"),
        sessionId: "s1",
      },
      {
        type: "recommendation_added",
        payload: {},
        createdAt: from,
        sessionId: "s1",
      },
    ];
    for (let i = 0; i < events.length; i++)
      await insert("ShopperEvent", { id: `event-${i}`, shop, ...events[i] });
    const outcomes = [
      { recommendationType: "primary", clickedAt: from, addedAt: from },
    ];
    await insert("RecommendationOutcome", {
      id: "rec",
      shop,
      sessionId: "s1",
      productId: "product",
      reason: "match",
      rank: 1,
      salesState: "BUYING",
      shownAt: from,
      ...outcomes[0],
    });
    expect(await getRevenueAnalytics(shop, from)).toEqual(
      summarizeRevenueAnalytics({
        offers: offers.map((offer) => ({
          ...offer,
          pairingProvenance: [],
          pairingShownAt: null,
          pairingAcceptedIds: [],
          pairingRollupPending: false,
        })) as Offer[],
        sessions,
        shopperEvents: events,
        conversionEvents: orders,
        experiments: [{ id: "exp", name: "Bundle test" }],
      }),
    );
    expect(await getSalesAnalytics(shop, from)).toEqual(
      summarizeSalesAnalytics({ sessions, events, outcomes, orders }),
    );
  });

  it("returns zero-valued reports without raw history or invalid divisions", async () => {
    expect(await getRevenueAnalytics(shop, from)).toEqual(
      summarizeRevenueAnalytics({
        offers: [],
        sessions: [],
        shopperEvents: [],
        conversionEvents: [],
        experiments: [],
      }),
    );
    expect(await getSalesAnalytics(shop, from)).toEqual(
      summarizeSalesAnalytics({
        sessions: [],
        events: [],
        outcomes: [],
        orders: [],
      }),
    );
  });

  it("aggregates readiness and resolves variant IDs without transferring a whole catalog", async () => {
    const variants = [
      {
        id: "gid://shopify/ProductVariant/1",
        price: "10.00",
        availableForSale: true,
      },
    ];
    const products = [
      {
        id: "p1",
        metafields: {
          "aovboost.variants": variants,
          "aovboost.availableForSale": { value: "true" },
        },
      },
      {
        id: "p2",
        metafields: {
          "aovboost.variants": [
            {
              ...variants[0],
              id: "gid://shopify/ProductVariant/2",
              availableForSale: false,
            },
          ],
        },
      },
      { id: "p3", metafields: {} },
    ];
    for (const p of products)
      await insert("Product", {
        ...p,
        shop,
        title: p.id,
        handle: p.id,
        price: "10",
        updatedAt: from,
      });
    await insert("Product", {
      ...products[0],
      shop: other,
      title: "foreign",
      handle: "foreign",
      price: "10",
      updatedAt: from,
    });
    expect(await getCatalogReadiness(shop)).toEqual(
      summarizeCatalogReadiness(products),
    );
    expect(await findProductIdsByVariants(shop, ["1"])).toEqual(["p1"]);
    expect(await findProductIdsByVariants(shop, [])).toEqual([]);
  });

  it("ranks a rare older search match before limiting chat retrieval", async () => {
    await state.db!.query(
      `INSERT INTO "Product" (id,shop,title,handle,price,"updatedAt") SELECT 'p'||i,$1,'Hiking item '||i,'item-'||i,10,$2 FROM generate_series(1,1000) i`,
      [shop, from.toISOString()],
    );
    await insert("Product", {
      id: "rare",
      shop,
      title: "Blue Hiking Hoodie",
      handle: "blue-hiking-hoodie",
      price: "10",
      updatedAt: new Date("2020-01-01"),
    });
    const catalog = await getChatCatalog({
      shop,
      query: "Show me a blue hiking hoodie",
    });
    expect(catalog.products).toHaveLength(60);
    expect(catalog.byId.rare.title).toBe("Blue Hiking Hoodie");
    expect(catalog.productCount).toBe(1001);
  });

  it("updates only purchased pairs, retries atomically, and ignores duplicate deliveries", async () => {
    await state.db!.query(
      `INSERT INTO "Product" (id,shop,title,handle,price,"updatedAt") SELECT 'p'||i,$1,'Item '||i,'item-'||i,10,$2 FROM generate_series(1,5000) i`,
      [shop, from.toISOString()],
    );
    state.failUpdate = true;
    await expect(
      incrementOrderAffinities(shop, ["p1", "p2"], "order-1"),
    ).rejects.toThrow("interrupted");
    expect(
      (await state.db!.query('SELECT * FROM "ProductOrderStat"')).rows,
    ).toHaveLength(0);
    await incrementOrderAffinities(shop, ["p1", "p2"], "order-1");
    await incrementOrderAffinities(shop, ["p1", "p2"], "order-1");
    const rows = (
      await state.db!.query<{ orderCount: number; score: number }>(
        'SELECT "orderCount",score FROM "ProductAffinity"',
      )
    ).rows;
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.orderCount === 1 && r.score === 0.5)).toBe(true);
    expect(state.reads).toEqual(
      Array.from({ length: 2 }, () => ({ shop, id: { in: ["p1", "p2"] } })),
    );
  });

  it("revalidates cached recommendations against fresh prices and availability", async () => {
    const id = "gid://shopify/Product/1";
    await insert("Product", {
      id,
      shop,
      title: "Item",
      handle: "item",
      price: "10",
      updatedAt: from,
      metafields: {
        "aovboost.variants": [
          {
            id: "gid://shopify/ProductVariant/1",
            price: "10",
            availableForSale: true,
          },
        ],
      },
    });
    const decision = {
      widgetType: "rec_strip",
      payload: { products: [{ productId: id, price: "999" }] },
      reasoning: "cached",
      confidence: 1,
      aiProvider: "heuristic" as const,
    };
    const fresh = await enforceCatalogBackedDecision({ shop, decision });
    expect(JSON.stringify(fresh.payload)).not.toContain('"999"');
    expect(fresh.widgetType).toBe("rec_strip");
    await state.db!.query(
      'UPDATE "Product" SET metafields=$1 WHERE shop=$2 AND id=$3',
      [
        JSON.stringify({ "aovboost.availableForSale": { value: "false" } }),
        shop,
        id,
      ],
    );
    expect(
      (await enforceCatalogBackedDecision({ shop, decision })).widgetType,
    ).toBeNull();
  });
});
