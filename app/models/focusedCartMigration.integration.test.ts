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
import {
  planFocusedCartRecovery,
  REVIEWED_MIGRATION_HASHES,
} from "../../scripts/focused-cart-migration-recovery.mjs";

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
    `CREATE TABLE "_prisma_migrations" (id TEXT,migration_name TEXT,logs TEXT,started_at TIMESTAMP,finished_at TIMESTAMP,rolled_back_at TIMESTAMP,checksum TEXT DEFAULT '${REVIEWED_MIGRATION_HASHES[FOCUSED_CART_MIGRATION]}')`,
  );
  await db.query(
    'INSERT INTO "_prisma_migrations" (id,migration_name,logs,started_at,finished_at,rolled_back_at) VALUES ($1,$2,$3,CURRENT_TIMESTAMP,NULL,NULL)',
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
  await db.waitReady;
}, 60_000);
beforeEach(async () => {
  // This is an in-memory PGlite instance, never a configured PostgreSQL connection.
  await db.exec("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
});
afterAll(async () => db?.close());
describe("immutable focused-cart migration recovery", () => {
  it("requires the unique shop key used by the migration's conflict-safe backfill", async () => {
    await beforeFocused();
    await failedRecord();
    await db.exec('DROP INDEX "AppSettings_shop_key"');
    await expect(planFocusedCartRecovery(adapter)).rejects.toThrow(
      "shop uniqueness",
    );
    expect(
      (await db.query('SELECT rolled_back_at FROM "_prisma_migrations"'))
        .rows[0],
    ).toEqual({ rolled_back_at: null });
  });
  it("plans the fixed rollback once, then allows the normal migration sequence and future builds", async () => {
    await beforeFocused();
    await seed();
    await failedRecord();
    const history = (await db.query('SELECT * FROM "_prisma_migrations"')).rows;
    expect(await planFocusedCartRecovery(adapter)).toMatchObject({
      scriptName: "migrate:rollback:focused-cart",
    });
    expect((await db.query('SELECT * FROM "_prisma_migrations"')).rows).toEqual(
      history,
    );
    // Model only Prisma resolve's metadata effect in this isolated database.
    await db.query(
      'UPDATE "_prisma_migrations" SET rolled_back_at=CURRENT_TIMESTAMP WHERE migration_name=$1 AND finished_at IS NULL',
      [FOCUSED_CART_MIGRATION],
    );
    await db.exec(sql(SESSION_COMPATIBILITY_MIGRATION));
    await db.exec(sql(FOCUSED_CART_MIGRATION));
    for (const name of names.filter((name) => name > FOCUSED_CART_MIGRATION))
      await db.exec(sql(name));
    expect(await planFocusedCartRecovery(adapter)).toBeNull();
    expect(
      (
        await db.query(
          'SELECT "focusedMode" FROM "AppSettings" WHERE shop=$1',
          ["one.myshopify.com"],
        )
      ).rows[0],
    ).toEqual({ focusedMode: false });
  });
  it("does nothing on an empty database, an applied migration or a prior rolled-back failure", async () => {
    expect(await planFocusedCartRecovery(adapter)).toBeNull();
    await beforeFocused();
    await failedRecord();
    await db.exec(
      'UPDATE "_prisma_migrations" SET finished_at=CURRENT_TIMESTAMP',
    );
    expect(await planFocusedCartRecovery(adapter)).toBeNull();
    await db.exec(
      'UPDATE "_prisma_migrations" SET finished_at=NULL,rolled_back_at=CURRENT_TIMESTAMP',
    );
    expect(await planFocusedCartRecovery(adapter)).toBeNull();
  });
  it("requires both exact reviewed SQL files without changing history when missing or altered", async () => {
    await beforeFocused();
    await failedRecord();
    for (const name of [
      SESSION_COMPATIBILITY_MIGRATION,
      FOCUSED_CART_MIGRATION,
    ]) {
      await expect(
        planFocusedCartRecovery(adapter, (requested: string) => {
          if (requested === name) throw new Error("missing");
          return sql(requested);
        }),
      ).rejects.toThrow("missing or unreadable");
      await expect(
        planFocusedCartRecovery(
          adapter,
          (requested: string) =>
            sql(requested) + (requested === name ? "\n-- changed" : ""),
        ),
      ).rejects.toThrow("does not match the reviewed SQL");
    }
    expect(
      (await db.query('SELECT rolled_back_at FROM "_prisma_migrations"'))
        .rows[0],
    ).toEqual({ rolled_back_at: null });
  });
  it("checks the failed record's checksum while allowing Windows line endings", async () => {
    await beforeFocused();
    await failedRecord();
    await db.query('UPDATE "_prisma_migrations" SET checksum=$1', [
      "unexpected-checksum",
    ]);
    await expect(planFocusedCartRecovery(adapter)).rejects.toThrow(
      "checksum is not the reviewed migration",
    );
    await db.query('UPDATE "_prisma_migrations" SET checksum=$1', [
      "f260e36b4059954300568e25ffa0da2fbb39dcbac825835cdbc71065d2addeb1",
    ]);
    expect(
      await planFocusedCartRecovery(adapter, (name: string) =>
        sql(name).replace(/\r\n/g, "\n").replace(/\n/g, "\r\n"),
      ),
    ).toMatchObject({ scriptName: "migrate:rollback:focused-cart" });
  });
  it("refuses to resolve a known failure alongside another unresolved migration", async () => {
    await beforeFocused();
    await failedRecord();
    await db.query(
      'INSERT INTO "_prisma_migrations" (id,migration_name,started_at) VALUES ($1,$2,CURRENT_TIMESTAMP)',
      ["another", "unrelated_migration"],
    );
    await expect(planFocusedCartRecovery(adapter)).rejects.toThrow(
      "exactly its one known unresolved failure",
    );
  });
  it("rejects a failed compatibility migration or applied compatibility with missing schema", async () => {
    await beforeFocused();
    await failedRecord();
    await db.query(
      'INSERT INTO "_prisma_migrations" (id,migration_name,started_at) VALUES ($1,$2,CURRENT_TIMESTAMP)',
      ["compat", SESSION_COMPATIBILITY_MIGRATION],
    );
    await expect(planFocusedCartRecovery(adapter)).rejects.toThrow(
      "unresolved failure",
    );
    await db.query(
      'UPDATE "_prisma_migrations" SET finished_at=CURRENT_TIMESTAMP WHERE id=$1',
      ["compat"],
    );
    await expect(planFocusedCartRecovery(adapter)).rejects.toThrow(
      "drifted state",
    );
    await db.exec(sql(SESSION_COMPATIBILITY_MIGRATION));
    expect(await planFocusedCartRecovery(adapter)).toMatchObject({
      scriptName: "migrate:rollback:focused-cart",
    });
  });
  it("keeps unknown database errors as build failures", async () => {
    await beforeFocused();
    await failedRecord("permission denied");
    await expect(planFocusedCartRecovery(adapter)).rejects.toThrow(
      "needs review",
    );
  });
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
