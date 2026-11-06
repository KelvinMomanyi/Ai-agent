import { PGlite } from "@electric-sql/pglite";
import { Prisma } from "@prisma/client";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  FOCUSED_CART_MIGRATION,
  SESSION_COMPATIBILITY_MIGRATION,
  inspectFocusedCartMigration,
  focusedCartRecoveryMessage,
} from "../../scripts/focused-cart-migration-check.mjs";

const root = new URL("../../prisma/migrations/", import.meta.url);
const names = readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const sql = (name: string) =>
  readFileSync(new URL(`${name}/migration.sql`, root), "utf8");
let db: PGlite;
const adapter = {
  $queryRaw: async (
    input: Prisma.Sql | TemplateStringsArray,
    ...values: unknown[]
  ) => {
    const query = Array.isArray(input)
      ? Prisma.sql(input as TemplateStringsArray, ...values)
      : (input as Prisma.Sql);
    return (await db.query(query.text, query.values)).rows;
  },
};
async function beforeFocused() {
  for (const name of names.filter(
    (name) =>
      name < FOCUSED_CART_MIGRATION && name !== SESSION_COMPATIBILITY_MIGRATION,
  ))
    await db.exec(sql(name));
}
async function failedRecord(
  logs = 'Database error code: 42P01\nERROR: relation "Session" does not exist\nprivate diagnostic text must not be returned',
) {
  await db.exec(
    `CREATE TABLE "_prisma_migrations" (id TEXT,migration_name TEXT,logs TEXT,started_at TIMESTAMP,finished_at TIMESTAMP,rolled_back_at TIMESTAMP)`,
  );
  await db.query(
    'INSERT INTO "_prisma_migrations" VALUES ($1,$2,$3,CURRENT_TIMESTAMP,NULL,NULL)',
    ["failure", FOCUSED_CART_MIGRATION, logs],
  );
}
async function seed() {
  await db.exec(`INSERT INTO session (id,shop,state,"accessToken") VALUES
    ('offline-one','one.myshopify.com','test-state','synthetic-token'),
    ('online-one','one.myshopify.com','test-state','synthetic-token'),
    ('offline-two','two.myshopify.com','test-state','synthetic-token');
    INSERT INTO "Shop" ("shopDomain","accessToken") VALUES ('legacy.myshopify.com','synthetic-token');
    INSERT INTO "AppSettings" (id,shop,"chatEnabled","maxProductRecommendations","updatedAt") VALUES ('custom','custom.myshopify.com',false,4,CURRENT_TIMESTAMP);`);
}
beforeAll(async () => {
  db = new PGlite();
}, 60_000);
beforeEach(async () => {
  // This is an in-memory PGlite instance, never a configured PostgreSQL connection.
  await db.exec("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
});
afterAll(async () => db?.close());
describe("immutable focused-cart migration recovery", () => {
  it("reproduces the real Session/session error with historical migrations", async () => {
    await beforeFocused();
    expect(
      (
        await db.query(
          `SELECT to_regclass('public."Session"') upper,to_regclass('public.session') lower`,
        )
      ).rows[0],
    ).toEqual({ upper: null, lower: "session" });
    await expect(db.exec(sql(FOCUSED_CART_MIGRATION))).rejects.toMatchObject({
      code: "42P01",
    });
  });
  it("replays the full migration history without editing historical SQL", async () => {
    expect(names.indexOf(SESSION_COMPATIBILITY_MIGRATION)).toBeLessThan(
      names.indexOf(FOCUSED_CART_MIGRATION),
    );
    for (const name of names) await db.exec(sql(name));
    expect(
      (
        await db.query(
          `SELECT column_default FROM information_schema.columns WHERE table_name='AppSettings' AND column_name='focusedMode'`,
        )
      ).rows[0],
    ).toEqual({ column_default: "true" });
    expect(
      (await db.query(`SELECT to_regclass('public."ThemeProfile"') present`))
        .rows[0],
    ).toEqual({ present: '"ThemeProfile"' });
  });
  it("can retry after the exact failure and preserves existing merchants and new-install defaults", async () => {
    await beforeFocused();
    await seed();
    await expect(db.exec(sql(FOCUSED_CART_MIGRATION))).rejects.toMatchObject({
      code: "42P01",
    });
    await db.exec(sql(SESSION_COMPATIBILITY_MIGRATION));
    await db.exec(sql(SESSION_COMPATIBILITY_MIGRATION));
    await db.exec(sql(FOCUSED_CART_MIGRATION));
    await db.exec(sql(FOCUSED_CART_MIGRATION));
    const rows = (
      await db.query(
        'SELECT shop,"focusedMode","chatEnabled","maxProductRecommendations" FROM "AppSettings" ORDER BY shop',
      )
    ).rows;
    expect(rows).toEqual([
      {
        shop: "custom.myshopify.com",
        focusedMode: false,
        chatEnabled: false,
        maxProductRecommendations: 4,
      },
      {
        shop: "legacy.myshopify.com",
        focusedMode: false,
        chatEnabled: true,
        maxProductRecommendations: 3,
      },
      {
        shop: "one.myshopify.com",
        focusedMode: false,
        chatEnabled: true,
        maxProductRecommendations: 3,
      },
      {
        shop: "two.myshopify.com",
        focusedMode: false,
        chatEnabled: true,
        maxProductRecommendations: 3,
      },
    ]);
    expect(
      (
        await db.query(
          'INSERT INTO "AppSettings" (id,shop,"updatedAt") VALUES ($1,$2,CURRENT_TIMESTAMP) RETURNING "focusedMode","chatEnabled","maxProductRecommendations"',
          ["fresh", "fresh.myshopify.com"],
        )
      ).rows[0],
    ).toEqual({
      focusedMode: true,
      chatEnabled: false,
      maxProductRecommendations: 2,
    });
  });
  it("exposes only distinct shop names, is not updatable, and retains no tenant data", async () => {
    await beforeFocused();
    await seed();
    await db.exec(sql(SESSION_COMPATIBILITY_MIGRATION));
    expect(
      (await db.query('SELECT * FROM "Session" ORDER BY shop')).rows,
    ).toEqual([{ shop: "one.myshopify.com" }, { shop: "two.myshopify.com" }]);
    expect(
      (
        await db.query(
          `SELECT is_updatable FROM information_schema.views WHERE table_schema='public' AND table_name='Session'`,
        )
      ).rows[0],
    ).toEqual({ is_updatable: "NO" });
    await expect(
      db.query('SELECT "accessToken" FROM "Session"'),
    ).rejects.toMatchObject({ code: "42703" });
    await expect(db.query('DELETE FROM "Session"')).rejects.toMatchObject({
      code: "55000",
    });
    await db.query("DELETE FROM session WHERE shop=$1", ["one.myshopify.com"]);
    expect((await db.query('SELECT * FROM "Session"')).rows).toEqual([
      { shop: "two.myshopify.com" },
    ]);
    expect(
      (
        await db.query("SELECT count(*)::int n FROM session WHERE shop=$1", [
          "two.myshopify.com",
        ])
      ).rows[0],
    ).toEqual({ n: 1 });
  });
  it("refuses to replace an unrelated uppercase table", async () => {
    await beforeFocused();
    await db.exec('CREATE TABLE "Session" (shop TEXT)');
    await expect(db.exec(sql(SESSION_COMPATIBILITY_MIGRATION))).rejects.toThrow(
      "unrelated public.Session",
    );
    expect(
      (
        await db.query(
          `SELECT relkind FROM pg_class WHERE oid='public."Session"'::regclass`,
        )
      ).rows[0],
    ).toEqual({ relkind: "r" });
  });
  it("refuses to reuse a modified compatibility view even if its comment remains", async () => {
    await beforeFocused();
    await db.exec(sql(SESSION_COMPATIBILITY_MIGRATION));
    await db.exec(
      'CREATE OR REPLACE VIEW "Session" AS SELECT DISTINCT shop FROM session WHERE false',
    );
    await expect(db.exec(sql(SESSION_COMPATIBILITY_MIGRATION))).rejects.toThrow(
      "compatibility view was changed",
    );
  });
  it("classifies a known failure without changing history or returning private logs", async () => {
    await beforeFocused();
    await failedRecord();
    const before = (await db.query('SELECT * FROM "_prisma_migrations"')).rows;
    const result = await inspectFocusedCartMigration(adapter);
    expect(result.status).toBe("retryable");
    const message = focusedCartRecoveryMessage(result);
    expect(message).toContain(
      `migrate resolve --rolled-back ${FOCUSED_CART_MIGRATION}`,
    );
    expect(message).toContain(SESSION_COMPATIBILITY_MIGRATION);
    expect(message).not.toContain("private diagnostic text");
    expect((await db.query('SELECT * FROM "_prisma_migrations"')).rows).toEqual(
      before,
    );
    await db.exec(sql(SESSION_COMPATIBILITY_MIGRATION));
    expect((await inspectFocusedCartMigration(adapter)).status).toBe(
      "retryable",
    );
    await db.query(
      'UPDATE "_prisma_migrations" SET rolled_back_at=CURRENT_TIMESTAMP',
    );
    expect((await inspectFocusedCartMigration(adapter)).status).toBe(
      "not_failed",
    );
  });
  it("refuses unrelated failures instead of prescribing a history change", async () => {
    await beforeFocused();
    await failedRecord(
      "Database error code: 42501 permission denied; private text",
    );
    const result = await inspectFocusedCartMigration(adapter);
    expect(result.status).toBe("needs_review");
    expect(focusedCartRecoveryMessage(result)).not.toMatch(
      /--rolled-back|--applied|private text/,
    );
  });
  it("refuses unexpected partial columns or conflicting relations", async () => {
    await beforeFocused();
    await failedRecord();
    await db.exec('ALTER TABLE "AppSettings" ADD COLUMN "focusedMode" TEXT');
    expect((await inspectFocusedCartMigration(adapter)).status).toBe(
      "needs_review",
    );
    await db.exec('ALTER TABLE "AppSettings" DROP COLUMN "focusedMode"');
    await db.exec('CREATE TABLE "Session" (shop TEXT)');
    expect((await inspectFocusedCartMigration(adapter)).status).toBe(
      "needs_review",
    );
  });
  it("allows a compatible partially applied focusedMode column and a fresh database", async () => {
    expect((await inspectFocusedCartMigration(adapter)).status).toBe(
      "not_failed",
    );
    await beforeFocused();
    await failedRecord();
    await db.exec(
      'ALTER TABLE "AppSettings" ADD COLUMN "focusedMode" BOOLEAN NOT NULL DEFAULT false',
    );
    expect((await inspectFocusedCartMigration(adapter)).status).toBe(
      "retryable",
    );
  });
});
