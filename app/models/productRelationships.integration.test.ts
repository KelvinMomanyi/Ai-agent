import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import type { ActionFunctionArgs } from "react-router";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => {
  const tables = [
    "productPairingState",
    "themeReport",
    "themeProfile",
    "monthlyUsage",
    "entitlementSnapshot",
    "holdoutOrder",
    "holdoutEnrollment",
    "offer",
    "shopperEvent",
    "chatMessage",
    "recommendationOutcome",
    "shopperSession",
    "bundleItem",
    "bundle",
    "productAffinity",
    "productVariantOrderStat",
    "productOrderStat",
    "product",
    "experiment",
    "appSettings",
    "catalogSyncJob",
    "shopConfig",
    "shop",
    "event",
    "visitorSession",
    "session",
  ];
  return {
    db: null as PGlite | null,
    deletes: Object.fromEntries(tables.map((name) => [name, vi.fn()])),
    deleteRelationships: vi.fn(),
    findSessions: vi.fn(),
    topic: "SHOP_REDACT",
    baselineSettings: null as unknown,
  };
});
vi.mock("../db.server", () => ({
  default: {
    ...Object.fromEntries(
      Object.entries(mocks.deletes).map(([name, deleteMany]) => [
        name,
        { deleteMany },
      ]),
    ),
    productRelationship: { deleteMany: mocks.deleteRelationships },
    $transaction: (operations: Promise<unknown>[]) => Promise.all(operations),
  },
}));
vi.mock("../shopify.server", () => ({
  authenticate: { webhook: vi.fn() },
  sessionStorage: {
    findSessionsByShop: mocks.findSessions,
    deleteSessions: vi.fn(),
  },
}));
vi.mock("../services/data-webhook.server", () => ({
  authenticateDataWebhook: async () => ({
    shop: "one.myshopify.com",
    topic: mocks.topic,
    payload: {},
  }),
}));
vi.mock("../redis.server", () => ({
  redis: { del: vi.fn() },
  billingRedis: { del: vi.fn() },
}));
vi.mock("../models/catalogCache.server", () => ({
  invalidateCatalogCache: vi.fn(),
}));
vi.mock("../models/offer.server", () => ({ markOfferConversion: vi.fn() }));
vi.mock("../models/recommendationOutcome.server", () => ({
  markPurchasedRecommendationOutcomes: vi.fn(),
}));
vi.mock("../models/product.server", () => ({
  deleteProduct: vi.fn(),
  upsertProduct: vi.fn(),
  incrementOrderAffinities: vi.fn(),
}));
import { action } from "../routes/api.webhooks";
import { pairingBaselineQuery } from "./pairingLearning.server";
import { wilsonInterval } from "./pairingLearning";
import {
  pairingTrafficQuery,
  reviewPairingIdsQuery,
} from "./productRelationships.server";

const one = "one.myshopify.com",
  two = "two.myshopify.com";
const insert = (id: string, shop: string, source: string, target: string) =>
  mocks.db!.query(
    'INSERT INTO "ProductRelationship" (id,shop,"sourceProductId","targetProductId","updatedAt") VALUES ($1,$2,$3,$4,CURRENT_TIMESTAMP)',
    [id, shop, source, target],
  );
beforeAll(async () => {
  mocks.db = new PGlite();
  await mocks.db.exec(
    `CREATE TABLE "Product" (shop TEXT NOT NULL,id TEXT NOT NULL,PRIMARY KEY(shop,id));
    CREATE TABLE "AppSettings" (id TEXT NOT NULL DEFAULT 'test',shop TEXT PRIMARY KEY,"updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,"chatEnabled" BOOLEAN NOT NULL DEFAULT false);
    INSERT INTO "AppSettings" (shop) VALUES ('one.myshopify.com');
    CREATE TABLE session(shop TEXT); INSERT INTO session VALUES ('old-missing-settings.myshopify.com');
    CREATE TABLE "Shop" ("shopDomain" TEXT); INSERT INTO "Shop" VALUES ('legacy-shop.myshopify.com');
    CREATE TABLE "Offer" (id TEXT,shop TEXT,"sessionId" TEXT,"createdAt" TIMESTAMP);
    CREATE TABLE "ShopperEvent" (shop TEXT,type TEXT,payload JSONB,"createdAt" TIMESTAMP);`,
  );
  const sql = readFileSync(
    new URL(
      "../../prisma/migrations/20261105130000_product_relationships/migration.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await mocks.db.exec(sql);
  await mocks.db.exec(sql);
  mocks.baselineSettings = (
    await mocks.db.query(
      'SELECT shop,"chatEnabled","verticalPreset" FROM "AppSettings"',
    )
  ).rows[0];
  const revision = readFileSync(
    new URL(
      "../../prisma/migrations/20261105200000_pairing_autopilot/migration.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await mocks.db.exec(revision);
  await mocks.db.exec(revision);
  const themeSql = readFileSync(
    new URL(
      "../../prisma/migrations/20261106120000_theme_compatibility/migration.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await mocks.db.exec(themeSql);
}, 60_000);
afterAll(async () => mocks.db?.close());
beforeEach(async () => {
  vi.clearAllMocks();
  await mocks.db!.exec('TRUNCATE "Product" CASCADE;');
  for (const shop of [one, two])
    for (const id of ["1", "2", "3"])
      await mocks.db!.query('INSERT INTO "Product" (shop,id) VALUES ($1,$2)', [
        shop,
        id,
      ]);
  await mocks.db!.query('INSERT INTO "Product" (shop,id) VALUES ($1,$2)', [
    two,
    "99",
  ]);
  await insert("one-pair", one, "1", "2");
  await insert("two-pair", two, "1", "2");
  await mocks.db!.exec('TRUNCATE "ShopperEvent";');
  await mocks.db!.exec('TRUNCATE "ThemeProfile" CASCADE;');
  for (const shop of [one, two]) {
    await mocks.db!.query(
      'INSERT INTO "AppSettings" (shop) VALUES ($1) ON CONFLICT (shop) DO NOTHING',
      [shop],
    );
    await mocks.db!.query(
      'INSERT INTO "ThemeProfile" (shop,"themeId","themeName","updatedAt") VALUES ($1,\'123\',\'Dawn\',CURRENT_TIMESTAMP)',
      [shop],
    );
    await mocks.db!.query(
      "INSERT INTO \"ThemeReport\" (id,shop,\"themeId\",\"sessionHash\",\"attemptId\",strategy,\"cartUi\",verified,reason) VALUES ($1,$2,'123','session','attempt','floating_card','unknown',true,'display_verified')",
      [`theme-${shop}`, shop],
    );
  }
  for (const [delegate, table] of [
    ["themeReport", "ThemeReport"],
    ["themeProfile", "ThemeProfile"],
  ])
    mocks.deletes[delegate].mockImplementation(async ({ where }) => ({
      count: (
        await mocks.db!.query(`DELETE FROM "${table}" WHERE shop=$1`, [
          where.shop,
        ])
      ).affectedRows,
    }));
  for (const shop of [one, two])
    await mocks.db!.query(
      'INSERT INTO "ProductPairingState" (shop,"productId") VALUES ($1,$2)',
      [shop, "1"],
    );
  mocks.deletes.productPairingState.mockImplementation(async ({ where }) => ({
    count: (
      await mocks.db!.query('DELETE FROM "ProductPairingState" WHERE shop=$1', [
        where.shop,
      ])
    ).affectedRows,
  }));
  mocks.findSessions.mockResolvedValue([]);
  mocks.deleteRelationships.mockImplementation(async ({ where }) => {
    if (!where.shop) throw new Error("Missing tenant scope");
    return {
      count: (
        await mocks.db!.query(
          'DELETE FROM "ProductRelationship" WHERE shop=$1',
          [where.shop],
        )
      ).affectedRows,
    };
  });
});

describe("relationship migration and tenant lifecycle", () => {
  it("applies twice and preserves existing settings with a generic preset", async () => {
    expect(mocks.baselineSettings).toEqual({
      shop: one,
      chatEnabled: false,
      verticalPreset: "generic",
    });
    const rows = (
      await mocks.db!.query(
        'SELECT kind,status,origin,confidence FROM "ProductRelationship" WHERE shop=$1',
        [one],
      )
    ).rows;
    expect(rows).toEqual([
      {
        kind: "complement",
        status: "suggested",
        origin: "merchant",
        confidence: 0,
      },
    ]);
    const indexes = await mocks.db!.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE tablename='ProductRelationship'",
    );
    expect(indexes.rows.map(({ indexname }) => indexname)).toContain(
      "ProductRelationship_shop_sourceProductId_status_idx",
    );
    expect(indexes.rows.map(({ indexname }) => indexname)).toContain(
      "ProductRelationship_shop_targetProductId_idx",
    );
  });
  it.each(["1", "2"])(
    "cascades when source or target product %s is deleted without touching another tenant",
    async (id) => {
      await mocks.db!.query('DELETE FROM "Product" WHERE shop=$1 AND id=$2', [
        one,
        id,
      ]);
      expect(
        (
          await mocks.db!.query(
            'SELECT id FROM "ProductRelationship" ORDER BY id',
          )
        ).rows,
      ).toEqual([{ id: "two-pair" }]);
    },
  );
  it("rejects cross-tenant product references even when the ID exists in another shop", async () => {
    await expect(insert("bad-tenant", one, "1", "99")).rejects.toThrow(
      /foreign key/i,
    );
  });
  it("enforces unique directed kinds and explicit status enums", async () => {
    await expect(insert("duplicate", one, "1", "2")).rejects.toThrow(/unique/i);
    await expect(
      mocks.db!.query(
        "UPDATE \"ProductRelationship\" SET status='unknown' WHERE shop=$1",
        [one],
      ),
    ).rejects.toThrow(/enum/i);
    await expect(
      mocks.db!.query(
        'UPDATE "ProductRelationship" SET confidence=1.5 WHERE shop=$1',
        [one],
      ),
    ).rejects.toThrow(/check constraint/i);
  });
  it.each(["APP_UNINSTALLED", "SHOP_REDACT"])(
    "%s explicitly purges the new tenant table, independent of product cascades",
    async (topic) => {
      mocks.topic = topic;
      const response = await action({
        request: new Request("https://app.example.com/api/webhooks", {
          method: "POST",
          body: "{}",
        }),
      } as ActionFunctionArgs);
      expect(response.status).toBe(200);
      for (const model of ["themeReport", "themeProfile"])
        expect(mocks.deletes[model]).toHaveBeenCalledWith({
          where: { shop: one },
        });
      expect(
        (await mocks.db!.query('SELECT shop FROM "ThemeProfile"')).rows,
      ).toEqual([{ shop: two }]);
      expect(
        (await mocks.db!.query('SELECT shop FROM "ThemeReport"')).rows,
      ).toEqual([{ shop: two }]);
      expect(mocks.deleteRelationships).toHaveBeenCalledWith({
        where: { shop: one },
      });
      expect(mocks.deletes.productPairingState).toHaveBeenCalledWith({
        where: { shop: one },
      });
      expect(
        (await mocks.db!.query('SELECT shop FROM "ProductPairingState"')).rows,
      ).toEqual([{ shop: two }]);
      expect(
        (
          await mocks.db!.query(
            'SELECT id,shop FROM "ProductRelationship" ORDER BY id',
          )
        ).rows,
      ).toEqual([{ id: "two-pair", shop: two }]);
      // Product deletes are intentionally inert here: removal must use deleteShopData's new entry.
      expect(
        (
          await mocks.db!.query(
            'SELECT count(*)::int AS count FROM "Product" WHERE shop=$1',
            [one],
          )
        ).rows,
      ).toEqual([{ count: 3 }]);
    },
  );
});
describe("autopilot additive migration and SQL", () => {
  it("orders the bounded review queue by traffic before confidence, without foreign rows", async () => {
    await mocks.db!.query(
      'UPDATE "ProductRelationship" SET confidence=.99 WHERE shop=$1',
      [one],
    );
    await insert("low-traffic", one, "2", "3");
    await insert("same-traffic-low-confidence", one, "1", "3");
    const sql = reviewPairingIdsQuery(one, [
      { productId: "1", views: 100 },
      { productId: "2", views: 1 },
    ]);
    expect((await mocks.db!.query(sql.text, sql.values)).rows).toEqual([
      { id: "same-traffic-low-confidence" },
      { id: "one-pair" },
      { id: "low-traffic" },
    ]);
  });
  it("keeps existing installs in review-first, including installs missing settings", async () => {
    expect(
      (
        await mocks.db!.query(
          'SELECT shop,"pairingMode" FROM "AppSettings" WHERE shop<>$1 ORDER BY shop',
          [two],
        )
      ).rows,
    ).toEqual([
      { shop: "legacy-shop.myshopify.com", pairingMode: "review_first" },
      {
        shop: "old-missing-settings.myshopify.com",
        pairingMode: "review_first",
      },
      { shop: one, pairingMode: "review_first" },
    ]);
    await mocks.db!.query(
      "UPDATE \"ProductRelationship\" SET status='auto_approved' WHERE shop=$1",
      [one],
    );
    expect(
      (
        await mocks.db!.query(
          'SELECT "shownCount","acceptedCount",evidence FROM "ProductRelationship" WHERE shop=$1',
          [one],
        )
      ).rows,
    ).toEqual([{ shownCount: 0, acceptedCount: 0, evidence: null }]);
  });
  it("cascades owned dirty state and rejects foreign-tenant references", async () => {
    await expect(
      mocks.db!.query(
        'INSERT INTO "ProductPairingState" (shop,"productId") VALUES ($1,$2)',
        [one, "99"],
      ),
    ).rejects.toThrow(/foreign key/i);
    await mocks.db!.query('DELETE FROM "Product" WHERE shop=$1 AND id=$2', [
      one,
      "1",
    ]);
    expect(
      (await mocks.db!.query('SELECT shop FROM "ProductPairingState"')).rows,
    ).toEqual([{ shop: two }]);
  });
  it("computes the full shop median with Wilson parity and ignores small samples/other tenants", async () => {
    for (const [shop, n, yes] of [
      [one, 100, 30],
      [two, 100, 99],
    ] as const)
      await mocks.db!.query(
        'UPDATE "ProductRelationship" SET status=\'auto_approved\',"shownCount"=$2,"acceptedCount"=$3 WHERE shop=$1',
        [shop, n, yes],
      );
    const sql = pairingBaselineQuery(one);
    const [row] = (
      await mocks.db!.query<{ peers: number; medianLower: number }>(
        sql.text,
        sql.values,
      )
    ).rows;
    expect(row.peers).toBe(1);
    expect(row.medianLower).toBeCloseTo(wilsonInterval(30, 100).lower, 12);
    await mocks.db!.query(
      'UPDATE "ProductRelationship" SET "shownCount"=99 WHERE shop=$1',
      [one],
    );
    expect((await mocks.db!.query(sql.text, sql.values)).rows).toEqual([
      { peers: 0, medianLower: null },
    ]);
  });
  it("counts recent product traffic by tenant and canonical product ID only", async () => {
    await mocks.db!.query('INSERT INTO "Product" VALUES ($1,$2)', [
      one,
      "gid://shopify/Product/1",
    ]);
    for (const [shop, id, age] of [
      [one, "1", 0],
      [one, "gid://shopify/Product/1", 0],
      [two, "1", 0],
      [one, "2", 20],
      [one, "999", 0],
    ] as const)
      await mocks.db!.query(
        "INSERT INTO \"ShopperEvent\" VALUES ($1,'product_view',$2,$3)",
        [
          shop,
          JSON.stringify({ productId: id }),
          new Date(Date.now() - age * 86400000),
        ],
      );
    const sql = pairingTrafficQuery(one);
    expect((await mocks.db!.query(sql.text, sql.values)).rows).toEqual([
      { productId: "gid://shopify/Product/1", views: 2 },
    ]);
  });
});
