import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
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
      "holdoutOrder",
      "holdoutEnrollment",
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
    ].map((name) => [name, { deleteMany: vi.fn() }]),
  ),
}));
vi.mock("../db.server", () => ({
  default: {
    ...mocks.legacy,
    monthlyUsage: {
      deleteMany: ({ where }: any) =>
        mocks.db!.query('DELETE FROM "MonthlyUsage" WHERE shop=$1', [
          where.shop,
        ]),
    },
    entitlementSnapshot: {
      deleteMany: ({ where }: any) =>
        mocks.db!.query('DELETE FROM "EntitlementSnapshot" WHERE shop=$1', [
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
}));
vi.mock("./catalogCache.server", () => ({ invalidateCatalogCache: vi.fn() }));
vi.mock("./offer.server", () => ({ markOfferConversion: vi.fn() }));
vi.mock("./recommendationOutcome.server", () => ({
  markPurchasedRecommendationOutcomes: vi.fn(),
}));
vi.mock("./product.server", () => ({
  upsertProduct: vi.fn(),
  deleteProduct: vi.fn(),
  incrementOrderAffinities: vi.fn(),
}));
import { usageRollupQuery } from "./usage.server";
import { action } from "../routes/api.webhooks";
async function rollup(
  shop: string,
  month: string,
  displays: number,
  calls: number,
) {
  const sql = usageRollupQuery(shop, new Date(month), displays, calls);
  return mocks.db!.query(
    sql.text,
    sql.values.map((value) =>
      value instanceof Date ? value.toISOString() : value,
    ),
  );
}
beforeAll(async () => {
  mocks.db = new PGlite();
  const migration = readFileSync(
    new URL(
      "../../prisma/migrations/20261105160000_plan_entitlements/migration.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await mocks.db.exec(migration);
  await mocks.db.exec(migration);
}, 60000);
afterAll(async () => mocks.db?.close());
beforeEach(async () => {
  await mocks.db!.exec('TRUNCATE "MonthlyUsage", "EntitlementSnapshot"');
  for (const shop of ["one", "two"]) {
    await rollup(shop, "2026-11-01", 10, 2);
    await mocks.db!.query(
      'INSERT INTO "EntitlementSnapshot" (shop,tier,source,"verifiedAt") VALUES ($1,$2,$3,$4)',
      [shop, "pro", "test", "2026-11-05"],
    );
  }
});
describe("durable billing state", () => {
  it("applies the additive migration twice with composite monthly uniqueness and nonnegative counters", async () => {
    await expect(
      mocks.db!.query(
        'INSERT INTO "MonthlyUsage" (shop,month) VALUES ($1,$2)',
        ["one", "2026-11-01"],
      ),
    ).rejects.toThrow(/unique/i);
    await expect(rollup("one", "2026-10-01", -1, 0)).rejects.toThrow(/check/i);
  });
  it("rolls up cumulative snapshots idempotently and never replaces newer totals with older ones", async () => {
    await rollup("one", "2026-11-01", 25, 5);
    await rollup("one", "2026-11-01", 25, 5);
    await rollup("one", "2026-11-01", 12, 3);
    expect(
      (
        await mocks.db!.query(
          'SELECT displayed,"aiCalls" FROM "MonthlyUsage" WHERE shop=$1',
          ["one"],
        )
      ).rows,
    ).toEqual([{ displayed: 25, aiCalls: 5 }]);
    expect(
      (
        await mocks.db!.query(
          'SELECT displayed FROM "MonthlyUsage" WHERE shop=$1',
          ["two"],
        )
      ).rows,
    ).toEqual([{ displayed: 10 }]);
  });
  it("keeps calendar months separate", async () => {
    await rollup("one", "2026-12-01", 3, 1);
    expect(
      (
        await mocks.db!.query(
          'SELECT displayed FROM "MonthlyUsage" WHERE shop=$1 ORDER BY month',
          ["one"],
        )
      ).rows,
    ).toEqual([{ displayed: 10 }, { displayed: 3 }]);
  });
  it.each(["APP_UNINSTALLED", "SHOP_REDACT"])(
    "%s explicitly removes both tenant tables and preserves the other shop",
    async (topic) => {
      mocks.topic = topic;
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
      for (const table of ["MonthlyUsage", "EntitlementSnapshot"])
        expect(
          (await mocks.db!.query(`SELECT shop FROM "${table}"`)).rows,
        ).toEqual([{ shop: "two" }]);
    },
  );
});
