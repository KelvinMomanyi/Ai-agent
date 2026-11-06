import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { Prisma } from "@prisma/client";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
const mocks = vi.hoisted(() => ({
  db: null as PGlite | null,
  topic: "SHOP_REDACT",
  legacy: Object.fromEntries(
    [
      "productPairingState",
      "themeReport",
      "themeProfile",
      "monthlyUsage",
      "entitlementSnapshot",
      "offer",
      "shopperEvent",
      "chatMessage",
      "recommendationOutcome",
      "shopperSession",
      "bundleItem",
      "bundle",
      "productRelationship",
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
    ].map((table) => [table, { deleteMany: vi.fn() }]),
  ),
}));
vi.mock("../db.server", () => ({
  default: {
    ...mocks.legacy,
    holdoutOrder: {
      deleteMany: async ({ where }: any) =>
        mocks.db!.query('DELETE FROM "HoldoutOrder" WHERE shop=$1', [
          where.shop,
        ]),
    },
    holdoutEnrollment: {
      deleteMany: async ({ where }: any) =>
        mocks.db!.query('DELETE FROM "HoldoutEnrollment" WHERE shop=$1', [
          where.shop,
        ]),
    },
    $transaction: (operations: any[]) => Promise.all(operations),
  },
}));
vi.mock("../shopify.server", () => ({
  authenticate: { webhook: vi.fn() },
  sessionStorage: {
    findSessionsByShop: async () => [],
    deleteSessions: vi.fn(),
  },
}));
vi.mock("../services/data-webhook.server", () => ({
  authenticateDataWebhook: async () => ({
    shop: "one",
    topic: mocks.topic,
    payload: {},
  }),
}));
vi.mock("../redis.server", () => ({
  redis: { del: vi.fn() },
  billingRedis: { del: vi.fn() },
  getJsonCache: vi.fn(),
  setJsonCache: vi.fn(),
}));
vi.mock("./catalogCache.server", () => ({ invalidateCatalogCache: vi.fn() }));
vi.mock("./offer.server", () => ({ markOfferConversion: vi.fn() }));
vi.mock("./recommendationOutcome.server", () => ({
  markPurchasedRecommendationOutcomes: vi.fn(),
}));
vi.mock("./product.server", () => ({
  deleteProduct: vi.fn(),
  upsertProduct: vi.fn(),
  incrementOrderAffinities: vi.fn(),
}));
import {
  holdoutArmsQuery,
  measuredFunnelQuery,
  monthlyValueQuery,
} from "./holdoutAnalytics.server";
import { action } from "../routes/api.webhooks";
async function query<T = any>(sql: Prisma.Sql) {
  return (
    await mocks.db!.query<T>(
      sql.text,
      sql.values.map((value) =>
        value instanceof Date ? value.toISOString() : value,
      ),
    )
  ).rows;
}
beforeAll(async () => {
  mocks.db = new PGlite();
  await mocks.db
    .exec(`CREATE TABLE "AppSettings" (shop TEXT PRIMARY KEY,"chatEnabled" BOOLEAN DEFAULT true);CREATE TABLE "ShopperSession" (id TEXT PRIMARY KEY,shop TEXT NOT NULL);
    CREATE TABLE "Offer" (id TEXT PRIMARY KEY,shop TEXT,"sessionId" TEXT,"widgetType" TEXT,"createdAt" TIMESTAMP,shown BOOLEAN DEFAULT false,converted BOOLEAN DEFAULT false);
    CREATE TABLE "ShopperEvent" (id TEXT PRIMARY KEY,shop TEXT,"sessionId" TEXT,type TEXT,payload JSONB,"createdAt" TIMESTAMP);
    CREATE TABLE "Event" (id TEXT PRIMARY KEY,"storeId" TEXT,event TEXT,"orderId" TEXT,timestamp TIMESTAMP,data JSONB);
    INSERT INTO "AppSettings" (shop) VALUES ('one');`);
  const sql = readFileSync(
    new URL(
      "../../prisma/migrations/20261105150000_holdout_measurement/migration.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await mocks.db.exec(sql);
  await mocks.db.exec(sql);
}, 60000);
afterAll(async () => mocks.db?.close());
beforeEach(async () => {
  await mocks.db!.exec(
    'TRUNCATE "ShopperSession" CASCADE;TRUNCATE "Offer","ShopperEvent","Event";',
  );
  for (const shop of ["one", "two"])
    for (const arm of ["exposed", "holdout"]) {
      const id = `${shop}-${arm}`;
      await mocks.db!.query('INSERT INTO "ShopperSession" VALUES ($1,$2)', [
        id,
        shop,
      ]);
      await mocks.db!.query(
        'INSERT INTO "HoldoutEnrollment" (id,shop,"sessionId",version,arm,percent,"startedAt","cartSeenAt","cartLinkedAt") VALUES ($1,$2,$1,1,$3,10,$4,$4,$4)',
        [id, shop, arm, "2026-10-15T00:00:00Z"],
      );
    }
});
const from = new Date("2026-10-01"),
  to = new Date("2026-11-05");
async function order(
  shop: string,
  id: string,
  enrollment: string,
  revenue: number,
  created = "2026-10-16T00:00:00Z",
) {
  await mocks.db!.query(
    'INSERT INTO "HoldoutOrder" (id,shop,"orderId","enrollmentId",revenue,currency,"createdAt") VALUES ($1,$2,$1,$3,$4,$5,$6)',
    [id, shop, enrollment, revenue, "USD", created],
  );
}
describe("holdout SQL and lifecycle", () => {
  it("applies idempotently with disabled/default settings and tenant indexes", async () => {
    expect((await mocks.db!.query('SELECT * FROM "AppSettings"')).rows).toEqual(
      [
        {
          shop: "one",
          chatEnabled: true,
          holdoutEnabled: false,
          holdoutPercent: 10,
          holdoutVersion: 1,
        },
      ],
    );
    await expect(
      mocks.db!.query(
        'UPDATE "AppSettings" SET "holdoutPercent"=31 WHERE shop=$1',
        ["one"],
      ),
    ).rejects.toThrow(/check constraint/i);
    const indexes = (
      await mocks.db!.query<{ indexname: string }>(
        "SELECT indexname FROM pg_indexes WHERE tablename='HoldoutEnrollment' OR tablename='HoldoutOrder'",
      )
    ).rows.map((row) => row.indexname);
    expect(indexes).toContain("HoldoutEnrollment_shop_version_startedAt_idx");
    expect(indexes).toContain("HoldoutOrder_shop_orderId_key");
  });
  it("uses distinct converting sessions, preserves multiple orders and isolates shops", async () => {
    await order("one", "one-order-a", "one-exposed", 30);
    await order("one", "one-order-b", "one-exposed", 20);
    await order("one", "one-order-c", "one-holdout", 10);
    await order("two", "other-order", "two-exposed", 9999);
    const rows = await query(holdoutArmsQuery("one", 1, from, to));
    expect(rows.find((row) => row.arm === "exposed")).toMatchObject({
      sessions: 1,
      convertedSessions: 1,
      orders: 2,
      revenue: 50,
      currencies: ["USD"],
    });
    expect(rows.find((row) => row.arm === "holdout")).toMatchObject({
      sessions: 1,
      convertedSessions: 1,
      orders: 1,
      revenue: 10,
    });
  });
  it("excludes immature sessions, other versions and orders outside follow-up", async () => {
    await mocks.db!.query(
      'UPDATE "HoldoutEnrollment" SET "startedAt"=$1 WHERE shop=$2 AND arm=$3',
      ["2026-11-03", "one", "holdout"],
    );
    await order("one", "late", "one-exposed", 100, "2026-10-30");
    expect(await query(holdoutArmsQuery("one", 1, from, to))).toEqual([
      expect.objectContaining({
        arm: "exposed",
        sessions: 1,
        orders: 0,
        revenue: 0,
      }),
    ]);
    expect(await query(holdoutArmsQuery("one", 2, from, to))).toEqual([]);
  });
  it("enforces duplicate-order and cross-tenant foreign-key boundaries", async () => {
    await order("one", "same", "one-exposed", 10);
    await expect(order("one", "same", "one-exposed", 10)).rejects.toThrow(
      /unique/i,
    );
    await expect(order("one", "foreign", "two-exposed", 10)).rejects.toThrow(
      /foreign key/i,
    );
    await mocks.db!.query('DELETE FROM "ShopperSession" WHERE shop=$1', [
      "one",
    ]);
    expect(
      (await mocks.db!.query('SELECT shop FROM "HoldoutEnrollment"')).rows,
    ).toEqual([{ shop: "two" }, { shop: "two" }]);
    expect(
      (await mocks.db!.query('SELECT * FROM "HoldoutOrder"')).rows,
    ).toEqual([]);
  });
  it.each(["APP_UNINSTALLED", "SHOP_REDACT"])(
    "%s explicitly purges both tables while preserving another tenant",
    async (topic) => {
      mocks.topic = topic;
      await order("one", "one-order", "one-holdout", 10);
      await order("two", "two-order", "two-exposed", 20);
      expect(
        (
          await action({
            request: new Request("https://app.test/webhooks", {
              method: "POST",
              body: "{}",
            }),
          } as any)
        ).status,
      ).toBe(200);
      expect(
        (await mocks.db!.query('SELECT DISTINCT shop FROM "HoldoutEnrollment"'))
          .rows,
      ).toEqual([{ shop: "two" }]);
      expect(
        (await mocks.db!.query('SELECT shop FROM "HoldoutOrder"')).rows,
      ).toEqual([{ shop: "two" }]);
      expect(
        (
          await mocks.db!.query(
            'SELECT count(*)::int n FROM "ShopperSession" WHERE shop=$1',
            ["one"],
          )
        ).rows[0],
      ).toEqual({ n: 2 });
    },
  );
  it("counts only a sequential displayed/clicked/confirmed-add/signed-purchase funnel", async () => {
    await mocks.db!.exec(
      `INSERT INTO "Offer" VALUES ('valid','one','one-exposed','upsell_drawer','2026-10-20',true,true),('generated','one','one-holdout','upsell_drawer','2026-10-20',true,true),('other','two','two-exposed','upsell_drawer','2026-10-20',true,true);`,
    );
    for (const [i, type] of [
      "widget_impression",
      "widget_click",
      "recommendation_added",
    ].entries())
      await mocks.db!.query(
        'INSERT INTO "ShopperEvent" VALUES ($1,$2,$3,$4,$5,$6)',
        [
          `e${i}`,
          "one",
          "one-exposed",
          type,
          { offerId: "valid" },
          `2026-10-20T00:00:0${i + 1}Z`,
        ],
      );
    await mocks.db!.query(
      'INSERT INTO "ShopperEvent" VALUES ($1,$2,$3,$4,$5,$6)',
      [
        "forged",
        "two",
        "one-holdout",
        "widget_impression",
        { offerId: "generated" },
        "2026-10-20T00:00:01Z",
      ],
    );
    await mocks.db!.query('INSERT INTO "Event" VALUES ($1,$2,$3,$4,$5,$6)', [
      "order-event",
      "one",
      "conversion",
      "order",
      "2026-10-20T00:00:04Z",
      {
        offerIds: ["valid"],
        currency: "USD",
        line_items: [
          { offerId: "valid", price: 12, quantity: 2, totalDiscount: 4 },
        ],
      },
    ]);
    expect(await query(measuredFunnelQuery("one", from, to))).toEqual([
      { displayed: 1, clicked: 1, added: 1, purchased: 1 },
    ]);
    expect(await query(monthlyValueQuery("one", from, to))).toEqual([
      { currency: "USD", orders: 1, revenue: 20 },
    ]);
  });
});
