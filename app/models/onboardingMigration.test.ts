import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("adds nullable preview progress idempotently without changing existing settings", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      'CREATE TABLE "AppSettings" (shop TEXT PRIMARY KEY, "chatEnabled" BOOLEAN NOT NULL); INSERT INTO "AppSettings" VALUES (\'one.myshopify.com\', false);',
    );
    const migration = readFileSync(
      new URL(
        "../../prisma/migrations/20261105120000_onboarding_preview/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await db.exec(migration);
    await db.exec(migration);
    expect((await db.query('SELECT * FROM "AppSettings"')).rows).toEqual([
      {
        shop: "one.myshopify.com",
        chatEnabled: false,
        onboardingPreviewedAt: null,
      },
    ]);
  } finally {
    await db.close();
  }
}, 30_000);
