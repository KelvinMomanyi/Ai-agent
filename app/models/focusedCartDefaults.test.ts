import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ upsert: vi.fn() }));
vi.mock("../db.server", () => ({
  default: { appSettings: { upsert: mocks.upsert } },
}));
vi.mock("../redis.server", () => ({
  getJsonCache: vi.fn(),
  setJsonCache: vi.fn(),
}));
import { getAppSettings, toPublicAppSettings } from "./settings.server";
import { computeSessionState } from "./session.server";
import {
  CART_DISMISS_TTL_MS,
  isRecentCartDismissal,
  recommendationLimit,
} from "../../shared/cartRecommendations";
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`CREATE TABLE "AppSettings" (id TEXT PRIMARY KEY, shop TEXT UNIQUE, "chatEnabled" BOOLEAN DEFAULT true, "bundlesEnabled" BOOLEAN DEFAULT true, "upsellEnabled" BOOLEAN DEFAULT true, "discountNudgeEnabled" BOOLEAN DEFAULT true, "exitIntentEnabled" BOOLEAN DEFAULT true, "postPurchaseEnabled" BOOLEAN DEFAULT true, "proactiveMessagesEnabled" BOOLEAN DEFAULT true, "maxProductRecommendations" INTEGER DEFAULT 3, "hesitationDetectionEnabled" BOOLEAN DEFAULT true, "bundleSupportEnabled" BOOLEAN DEFAULT true, "updatedAt" TIMESTAMP NOT NULL);
    CREATE TABLE "session" (shop TEXT); CREATE TABLE "Shop" ("shopDomain" TEXT);
    INSERT INTO "AppSettings" (id,shop,"chatEnabled","updatedAt") VALUES ('custom','custom.myshopify.com',false,CURRENT_TIMESTAMP);
    INSERT INTO "session" (shop) VALUES ('session-only.myshopify.com'),('session-only.myshopify.com');
    INSERT INTO "Shop" ("shopDomain") VALUES ('legacy-shop.myshopify.com');`);
  await db.exec(
    readFileSync(
      new URL(
        "../../prisma/migrations/20261105135000_session_migration_compatibility/migration.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const sql = readFileSync(
    new URL(
      "../../prisma/migrations/20261105140000_focused_cart_defaults/migration.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await db.exec(sql);
  await db.exec(sql);
}, 60_000);
afterAll(async () => {
  vi.unstubAllEnvs();
  await db?.close();
});
describe("new-install focused defaults and existing-shop preservation", () => {
  it("opts only newly created settings into autopilot and preserves existing preferences", async () => {
    await getAppSettings("new.myshopify.com");
    expect(mocks.upsert).toHaveBeenCalledWith({
      where: { shop: "new.myshopify.com" },
      create: { shop: "new.myshopify.com", pairingMode: "autopilot" },
      update: {},
    });
  });
  it("preserves custom existing settings and leaves them opted out", async () => {
    const row = (
      await db.query('SELECT * FROM "AppSettings" WHERE shop=$1', [
        "custom.myshopify.com",
      ])
    ).rows[0];
    expect(row).toMatchObject({
      focusedMode: false,
      chatEnabled: false,
      bundlesEnabled: true,
      upsellEnabled: true,
      maxProductRecommendations: 3,
    });
  });
  it("preserves legacy defaults for installed shops that had no settings, idempotently", async () => {
    const rows = (
      await db.query(
        'SELECT shop,"focusedMode","chatEnabled","maxProductRecommendations" FROM "AppSettings" WHERE shop<>$1 ORDER BY shop',
        ["custom.myshopify.com"],
      )
    ).rows;
    expect(rows).toEqual([
      {
        shop: "legacy-shop.myshopify.com",
        focusedMode: false,
        chatEnabled: true,
        maxProductRecommendations: 3,
      },
      {
        shop: "session-only.myshopify.com",
        focusedMode: false,
        chatEnabled: true,
        maxProductRecommendations: 3,
      },
    ]);
  });
  it("uses focused defaults only for new settings rows", async () => {
    const [row] = (
      await db.query(
        'INSERT INTO "AppSettings" (id,shop,"updatedAt") VALUES ($1,$2,CURRENT_TIMESTAMP) RETURNING *',
        ["new", "new.myshopify.com"],
      )
    ).rows;
    expect(row).toMatchObject({
      focusedMode: true,
      chatEnabled: false,
      bundlesEnabled: false,
      upsellEnabled: true,
      discountNudgeEnabled: false,
      exitIntentEnabled: false,
      postPurchaseEnabled: false,
      proactiveMessagesEnabled: false,
      maxProductRecommendations: 2,
      hesitationDetectionEnabled: false,
      bundleSupportEnabled: false,
    });
  });
  it("keeps live alerts off for focused shops even with the global switch on", () => {
    vi.stubEnv("AOVBOOST_ENABLE_LIVE_EVENTS", "true");
    expect(
      toPublicAppSettings({ focusedMode: true } as any).liveEventsEnabled,
    ).toBe(false);
    expect(
      toPublicAppSettings({ focusedMode: false } as any).liveEventsEnabled,
    ).toBe(true);
  });
  it("uses the same dismissal expiry across the client and server", () => {
    const now = Date.now();
    expect(isRecentCartDismissal(now - CART_DISMISS_TTL_MS + 1, now)).toBe(
      true,
    );
    expect(isRecentCartDismissal(now - CART_DISMISS_TTL_MS, now)).toBe(false);
    expect(isRecentCartDismissal(now + 1, now)).toBe(false);
    const state = computeSessionState(null, [
      { type: "widget_dismiss", widgetType: "upsell_drawer", ts: now },
    ]);
    expect(
      isRecentCartDismissal(
        state.context.lastCartRecommendationDismissedAt,
        now,
      ),
    ).toBe(true);
    expect(recommendationLimit(4)).toBe(4);
    expect(recommendationLimit(999)).toBe(4);
  });
});
