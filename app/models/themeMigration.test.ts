import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
vi.mock("../db.server", () => ({ default: {} }));
vi.mock("../redis.server", () => ({ incrementRateLimit: vi.fn() }));
import { latestThemePreviewQuery } from "./themeCompatibility.server";
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `CREATE TABLE "AppSettings" (shop TEXT PRIMARY KEY);INSERT INTO "AppSettings" VALUES ('one');`,
  );
  const sql = readFileSync(
    new URL(
      "../../prisma/migrations/20261106120000_theme_compatibility/migration.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await db.exec(sql);
  await db.exec(sql);
}, 60000);
afterAll(() => db.close());
describe("additive theme migration", () => {
  it("prevents a late background write from recreating a profile after tenant settings are purged", async () => {
    await db.exec(
      `INSERT INTO "AppSettings" (shop) VALUES ('purged');INSERT INTO "ThemeProfile" (shop,"themeId","themeName","updatedAt") VALUES ('purged','123','Dawn',CURRENT_TIMESTAMP);DELETE FROM "AppSettings" WHERE shop='purged';`,
    );
    expect(
      (
        await db.query(
          "SELECT count(*)::int n FROM \"ThemeProfile\" WHERE shop='purged'",
        )
      ).rows,
    ).toEqual([{ n: 0 }]);
    await expect(
      db.exec(
        `INSERT INTO "ThemeProfile" (shop,"themeId","themeName","updatedAt") VALUES ('purged','123','Dawn',CURRENT_TIMESTAMP)`,
      ),
    ).rejects.toThrow(/foreign key/i);
  });
  it("orders preview results by protected test time rather than public traffic updates", async () => {
    await db.exec(
      `INSERT INTO "AppSettings" (shop) VALUES ('preview-shop'),('foreign');`,
    );
    await db.exec(
      `INSERT INTO "ThemeProfile" (shop,"themeId","themeName","updatedAt","lastPreviewResult") VALUES ('preview-shop','old','Old','2026-11-30','{"at":"2026-11-01T00:00:00.000Z"}'),('preview-shop','new','New','2026-11-06','{"at":"2026-11-06T00:00:00.000Z"}'),('foreign','new','Foreign','2026-11-07','{"at":"2026-11-07T00:00:00.000Z"}');`,
    );
    const query = latestThemePreviewQuery("preview-shop");
    expect((await db.query(query.text, query.values)).rows).toEqual([
      {
        themeName: "New",
        lastPreviewResult: { at: "2026-11-06T00:00:00.000Z" },
      },
    ]);
  });
  it("applies twice, preserves merchants and gives new profiles learning defaults", async () => {
    expect(
      (await db.query("SELECT * FROM \"AppSettings\" WHERE shop='one'")).rows,
    ).toEqual([
      {
        shop: "one",
        placementPreference: "auto",
        recommendationAccentColor: null,
        recommendationRadius: null,
        recommendationFont: "inherit",
      },
    ]);
    await db.exec(
      `INSERT INTO "AppSettings" (shop) VALUES ('two');INSERT INTO "ThemeProfile" (shop,"themeId","themeName","updatedAt") VALUES ('one','123','Dawn',CURRENT_TIMESTAMP),('two','123','Other',CURRENT_TIMESTAMP);`,
    );
    expect(
      (
        await db.query(
          "SELECT status,attempts FROM \"ThemeProfile\" WHERE shop='one'",
        )
      ).rows,
    ).toEqual([{ status: "learning", attempts: 0 }]);
  });
  it("scopes duplicate reports and foreign keys by shop and cascades only the owning profile", async () => {
    await db.exec(
      `INSERT INTO "ThemeReport" (id,shop,"themeId","sessionHash","attemptId",strategy,"cartUi",verified,reason) VALUES ('r1','one','123','session','attempt','floating_card','unknown',true,'display_verified'),('r2','two','123','session','attempt','floating_card','unknown',true,'display_verified');`,
    );
    await expect(
      db.exec(
        `INSERT INTO "ThemeReport" (id,shop,"themeId","sessionHash","attemptId",strategy,"cartUi",verified,reason) VALUES ('bad','foreign','123','session','attempt','none','unknown',false,'failed')`,
      ),
    ).rejects.toThrow(/foreign key/i);
    await expect(
      db.exec(
        `INSERT INTO "ThemeReport" (id,shop,"themeId","sessionHash","attemptId",strategy,"cartUi",verified,reason) VALUES ('dup','one','123','session','attempt','none','unknown',false,'failed')`,
      ),
    ).rejects.toThrow(/unique/i);
    await db.exec(`DELETE FROM "ThemeProfile" WHERE shop='one'`);
    expect((await db.query('SELECT shop FROM "ThemeReport"')).rows).toEqual([
      { shop: "two" },
    ]);
  });
});
