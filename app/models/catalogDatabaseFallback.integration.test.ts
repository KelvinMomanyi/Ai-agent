import { PGlite } from "@electric-sql/pglite";
import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ db: null as PGlite | null }));
vi.mock("../db.server", () => ({
  default: {
    $transaction: async (operations: Array<(db: any) => Promise<unknown>>) =>
      state.db!.transaction(async (db) => {
        const results = [];
        for (const operation of operations) results.push(await operation(db));
        return results;
      }),
    $executeRaw:
      (strings: TemplateStringsArray, ...values: unknown[]) =>
      async (db: any) => {
        const sql = Prisma.sql(strings, ...values);
        return (await db.query(sql.text, sql.values)).affectedRows;
      },
    $queryRaw: (sql: Prisma.Sql) => async (db: any) =>
      (await db.query(sql.text, sql.values)).rows,
  },
}));
import { readCatalogDuringCacheOutage } from "./catalogDatabaseFallback.server";
beforeAll(async () => {
  state.db = new PGlite();
  await state.db.exec(`
    CREATE TABLE "Product" (shop text NOT NULL, id text NOT NULL, title text NOT NULL,
      "updatedAt" timestamptz NOT NULL, PRIMARY KEY (shop,id));
    CREATE TABLE "ProductOrderStat" (shop text NOT NULL, "productId" text NOT NULL,
      "orderCount" integer NOT NULL, PRIMARY KEY (shop,"productId"));
    INSERT INTO "Product" SELECT 'one', 'p' || i, 'Product ' || i, '2026-11-01'::timestamptz + i * interval '1 second'
      FROM generate_series(1,505) i;
    INSERT INTO "Product" VALUES ('other','p1','Private other shop','2026-11-12');
    INSERT INTO "ProductOrderStat" VALUES ('one','p1',20), ('other','p1',999);
  `);
}, 60000);
afterAll(async () => state.db?.close());
describe("PostgreSQL catalog fallback", () => {
  it("returns a bounded, tenant-scoped popular/recent pool and a complete count in a read-only transaction", async () => {
    const result = await readCatalogDuringCacheOutage("one");
    expect(result.productCount).toBe(505);
    expect(result.products).toHaveLength(500);
    expect(result.products[0]).toMatchObject({
      shop: "one",
      id: "p1",
      orderStats: { orderCount: 20 },
    });
    expect(result.products[1].id).toBe("p505");
    expect(result.products.every((row) => row.shop === "one")).toBe(true);
  });
  it("distinguishes a truly empty catalog and isolates a shared product ID by tenant", async () => {
    expect(await readCatalogDuringCacheOutage("empty")).toMatchObject({
      products: [],
      productCount: 0,
    });
    const other = await readCatalogDuringCacheOutage("other");
    expect(other.products).toHaveLength(1);
    expect(other.products[0]).toMatchObject({
      shop: "other",
      orderStats: { orderCount: 999 },
    });
  });
});
