import { PGlite } from "@electric-sql/pglite";
import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  recommendationBreakdownQuery,
  summarizeBreakdowns,
  type BreakdownAggregate,
} from "./recommendationBreakdown.server";
let db: PGlite;
let sequence = 0;
const from = new Date("2026-11-01"),
  to = new Date("2026-11-03");
const product = (id = 2) => `gid://shopify/Product/${id}`;
const pair = (origin = "merchant", target = 2) => ({
  targetProductId: product(target),
  origin,
  status:
    origin === "merchant"
      ? "approved"
      : origin === "autopilot"
        ? "auto_approved"
        : "fallback",
  confidence: 0.98,
  modelVersion: "private-model",
  evidence: { title: true },
});
async function query(shop = "one", start = from, end = to) {
  const sql = recommendationBreakdownQuery(shop, start, end);
  return (
    await db.query<BreakdownAggregate>(
      sql.text,
      sql.values.map((v) => (v instanceof Date ? v.toISOString() : v)),
    )
  ).rows;
}
async function offer(
  id = "offer",
  origin = "merchant",
  shop = "one",
  provenance: unknown = [pair(origin)],
  targets = [2],
  created = "2026-11-01T00:00:00Z",
) {
  await db.query('INSERT INTO "Offer" VALUES ($1,$2,$3,$4,$5,$6,$7)', [
    id,
    shop,
    `${shop}-session`,
    "upsell_drawer",
    created,
    { products: targets.map((id) => ({ productId: product(id) })) },
    provenance,
  ]);
}
async function event(
  id: string,
  type: string,
  time: string,
  payload: Record<string, unknown> = {},
  shop = "one",
  session = `${shop}-session`,
) {
  await db.query('INSERT INTO "ShopperEvent" VALUES ($1,$2,$3,$4,$5,$6)', [
    `e${++sequence}`,
    shop,
    session,
    type,
    { offerId: id, ...payload },
    `2026-11-01T${time}Z`,
  ]);
}
async function funnel(
  id = "offer",
  strategy: unknown = "cart_page",
  shop = "one",
  verified: unknown = true,
) {
  await event(
    id,
    "widget_impression",
    "01:00:00",
    { strategy, verified, origin: "forged-client-origin" },
    shop,
  );
  await event(id, "widget_click", "02:00:00", {}, shop);
  await event(
    id,
    "recommendation_added",
    "03:00:00",
    { productId: product() },
    shop,
  );
}
function line(
  offerId = "offer",
  target = 2,
  price: unknown = 10,
  quantity: unknown = 1,
  totalDiscount: unknown = 2,
) {
  return {
    offerId,
    productId: product(target),
    price,
    quantity,
    totalDiscount,
  };
}
async function order(
  id = "order",
  lines: unknown[] = [line()],
  shop = "one",
  currency: unknown = "USD",
  time = "2026-11-01T04:00:00Z",
  links = ["offer"],
) {
  await db.query('INSERT INTO "Event" VALUES ($1,$2,$3,$4,$5,$6)', [
    `order-event-${++sequence}`,
    shop,
    "conversion",
    id,
    time,
    { currency, offerIds: links, line_items: lines },
  ]);
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`CREATE TABLE "Offer" (id TEXT PRIMARY KEY,shop TEXT,"sessionId" TEXT,"widgetType" TEXT,"createdAt" TIMESTAMP,payload JSONB,"pairingProvenance" JSONB);
    CREATE TABLE "ShopperEvent" (id TEXT PRIMARY KEY,shop TEXT,"sessionId" TEXT,type TEXT,payload JSONB,"createdAt" TIMESTAMP);
    CREATE TABLE "Event" (id TEXT PRIMARY KEY,"storeId" TEXT,event TEXT,"orderId" TEXT,timestamp TIMESTAMP,data JSONB);
    CREATE INDEX ON "Offer"(shop,"createdAt");CREATE INDEX ON "ShopperEvent"(shop,type,"createdAt");CREATE INDEX ON "Event"("storeId",event,timestamp);`);
}, 60000);
afterAll(async () => db?.close());
beforeEach(async () => {
  sequence = 0;
  await db.exec('TRUNCATE "Offer","ShopperEvent","Event"');
});
describe("descriptive cart breakdown SQL", () => {
  it.each(["merchant", "autopilot", "affinity", "catalog"])(
    "uses the server's saved %s origin, ignoring browser origin claims",
    async (origin) => {
      await offer("offer", origin);
      await funnel();
      await order();
      const rows = await query();
      expect(rows.find((row) => row.axis === "origin")).toMatchObject({
        bucket: origin,
        displayed: 1,
        clicked: 1,
        added: 1,
        purchased: 1,
        amounts: [{ currency: "USD", revenue: 8 }],
      });
      expect(rows.find((row) => row.axis === "placement")).toMatchObject({
        bucket: "cart_page",
        displayed: 1,
        purchased: 1,
      });
      expect(JSON.stringify(summarizeBreakdowns(rows))).not.toMatch(
        /confidence|evidence|modelVersion|targetProductId|unitCost|inventory|margin/,
      );
    },
  );
  it("puts mixed offers in one bucket without event, product or replayed-order fan-out", async () => {
    await offer(
      "offer",
      "merchant",
      "one",
      [pair("merchant"), pair("autopilot", 3)],
      [2, 3],
    );
    await funnel();
    await funnel();
    await event("offer", "recommendation_added", "03:01:00", {
      productId: product(3),
    });
    const lines = [line(), line("offer", 3), line("offer", 99, 9000)];
    await order("order", lines);
    await order("order", lines); // Replay of the same order ID.
    const rows = await query();
    expect(rows.filter((row) => row.axis === "origin")).toEqual([
      {
        axis: "origin",
        bucket: "mixed",
        displayed: 1,
        clicked: 1,
        added: 1,
        purchased: 1,
        amounts: [{ currency: "USD", revenue: 16 }],
      },
    ]);
    expect(rows.find((row) => row.axis === "placement")?.amounts).toEqual([
      { currency: "USD", revenue: 16 },
    ]);
  });
  it.each([
    null,
    {},
    [],
    [pair("invalid")],
    [pair(), pair()],
    [{ ...pair(), status: "suggested" }],
    [{ ...pair(), targetProductId: product(999) }],
  ])(
    "keeps incomplete or malformed provenance Unknown (%j)",
    async (provenance) => {
      await offer("offer", "merchant", "one", provenance);
      await funnel();
      expect((await query()).find((row) => row.axis === "origin")?.bucket).toBe(
        "unknown",
      );
    },
  );
  it("does not infer a complete origin from only some served cards", async () => {
    await offer("offer", "merchant", "one", [pair()], [2, 3]);
    await funnel();
    expect((await query()).find((row) => row.axis === "origin")?.bucket).toBe(
      "unknown",
    );
  });
  it.each(["native_drawer", "cart_page", "floating_card"])(
    "counts the first verified %s placement once despite recovery impressions",
    async (strategy) => {
      await offer();
      await funnel("offer", strategy);
      await event("offer", "widget_impression", "01:01:00", {
        strategy: strategy === "cart_page" ? "floating_card" : "cart_page",
        verified: true,
      });
      expect(
        (await query()).filter((row) => row.axis === "placement"),
      ).toMatchObject([{ bucket: strategy, displayed: 1 }]);
    },
  );
  it.each([
    ["cart_page", false],
    ["cart_page", "true"],
    ["injected-selector", true],
    [null, null],
  ])(
    "keeps unverified/invalid placement Unknown (%s/%s)",
    async (strategy, verified) => {
      await offer();
      await funnel("offer", strategy, "one", verified);
      expect(
        (await query()).find((row) => row.axis === "placement")?.bucket,
      ).toBe("unknown");
    },
  );
  it("does not rewrite a first legacy impression when a later one reports verification", async () => {
    await offer();
    await event("offer", "impression", "00:59:00");
    await funnel();
    expect(
      (await query()).find((row) => row.axis === "placement")?.bucket,
    ).toBe("unknown");
  });
  it("requires sequential clicks, a served-product confirmed add and a matching signed order line", async () => {
    await offer();
    await event("offer", "widget_click", "00:01:00");
    await event("offer", "recommendation_added", "00:02:00", {
      productId: product(),
    });
    await event("offer", "widget_impression", "01:00:00", {
      strategy: "cart_page",
      verified: true,
    });
    await order();
    expect((await query())[0]).toMatchObject({
      displayed: 1,
      clicked: 0,
      added: 0,
      purchased: 0,
      amounts: [],
    });
    await event("offer", "widget_click", "02:00:00");
    await event("offer", "recommendation_added", "03:00:00", {
      productId: product(99),
    });
    expect((await query())[0]).toMatchObject({
      clicked: 1,
      added: 0,
      purchased: 0,
    });
    await event("offer", "recommendation_added", "03:01:00", {
      productId: product(),
    });
    await db.exec('TRUNCATE "Event"');
    await order("earlier", [line()], "one", "USD", "2026-11-01T02:59:00Z");
    await order("unserved", [line("offer", 99)]);
    await order("unlinked", [line()], "one", "USD", "2026-11-01T04:00:00Z", []);
    expect((await query())[0]).toMatchObject({
      added: 1,
      purchased: 0,
      amounts: [],
    });
  });
  it("separates currencies and preserves legitimate multiple order lines", async () => {
    await offer();
    await funnel();
    await order("USD", [line(), line()]);
    await order("EUR", [line("offer", 2, 20, 1, 0)], "one", "EUR");
    await order("unknown", [line("offer", 2, 5, 1, 0)], "one", null);
    expect((await query())[0]).toMatchObject({
      purchased: 1,
      amounts: [
        { currency: "EUR", revenue: 20 },
        { currency: "USD", revenue: 16 },
        { currency: null, revenue: 5 },
      ],
    });
  });
  it("does not count browser purchases or malformed monetary lines", async () => {
    await offer();
    await funnel();
    await event("offer", "purchase_completed", "04:00:00", { revenue: 999 });
    await order("bad", [
      line("offer", 2, "oops"),
      line("offer", 2, 10, -1),
      line("offer", 2, 10, 0),
      line("offer", 2, 10, 1, "oops"),
    ]);
    expect((await query())[0]).toMatchObject({ purchased: 0, amounts: [] });
  });
  it("isolates shops and sessions even when events claim another owned offer", async () => {
    await offer();
    await offer("other", "autopilot", "two");
    await funnel("other", "floating_card", "two");
    await event(
      "offer",
      "widget_impression",
      "01:00:00",
      { verified: true, strategy: "cart_page" },
      "one",
      "another-session",
    );
    await event(
      "offer",
      "widget_impression",
      "01:00:00",
      { verified: true, strategy: "cart_page" },
      "two",
      "one-session",
    );
    expect(await query()).toEqual([]);
    await funnel();
    await order("foreign-order", [line()], "two");
    expect((await query())[0]).toMatchObject({ displayed: 1, purchased: 0 });
    expect(
      (await query("two")).find((row) => row.axis === "origin")?.bucket,
    ).toBe("autopilot");
  });
  it("excludes generated decisions, out-of-range offers and events before generation", async () => {
    await offer("generated");
    await offer(
      "old",
      "merchant",
      "one",
      [pair()],
      [2],
      "2026-10-31T23:59:59Z",
    );
    await funnel("old");
    await offer(
      "future",
      "merchant",
      "one",
      [pair()],
      [2],
      "2026-11-02T00:00:00Z",
    );
    await funnel("future");
    expect(await query()).toEqual([]);
    await offer();
    await funnel();
    expect(await query("one", new Date("2026-11-02"), to)).toEqual([]);
    expect(
      (await query()).find((row) => row.axis === "origin")?.displayed,
    ).toBe(1);
  });
  it("has no surviving breakdown data after tenant data deletion and preserves another shop", async () => {
    await offer();
    await funnel();
    await offer("other", "autopilot", "two");
    await funnel("other", "cart_page", "two");
    const other = await query("two");
    await db.query('DELETE FROM "Offer" WHERE shop=$1', ["one"]);
    await db.query('DELETE FROM "ShopperEvent" WHERE shop=$1', ["one"]);
    await db.query('DELETE FROM "Event" WHERE "storeId"=$1', ["one"]);
    expect(await query()).toEqual([]);
    expect(await query("two")).toEqual(other);
  });
  it("binds tenant/date values and never reads mutable relationships or theme-report samples", () => {
    const sql: Prisma.Sql = recommendationBreakdownQuery(
      "shop' OR true --",
      from,
      to,
    );
    expect(sql.values).toContain("shop' OR true --");
    expect(sql.text).not.toContain("shop' OR true");
    expect(sql.text).not.toMatch(
      /ProductRelationship|ThemeProfile|ThemeReport/,
    );
  });
});
