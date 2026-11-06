import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  settings: vi.fn(),
  session: vi.fn(),
  enroll: vi.fn(),
  find: vi.fn(),
  order: vi.fn(),
  update: vi.fn(),
}));
vi.mock("../db.server", () => ({
  default: {
    holdoutEnrollment: {
      upsert: mocks.enroll,
      findUnique: mocks.find,
      updateMany: mocks.update,
    },
    holdoutOrder: { upsert: mocks.order },
  },
}));
vi.mock("./settings.server", () => ({ getAppSettings: mocks.settings }));
vi.mock("./session.server", () => ({
  upsertShopperSessionFromEvents: mocks.session,
}));
import {
  enrollHoldout,
  holdoutArm,
  recordHoldoutCartEvents,
  recordHoldoutOrder,
} from "./holdout.server";
import { extractOrderAttribution } from "./attribution.server";
import {
  measurementLink,
  verifyMeasurementLink,
} from "../utils/measurementLink.server";
import {
  issueStorefrontSession,
  authenticateStorefrontRequest,
  renewalSessionId,
} from "../utils/storefrontAuth.server";
const shop = "one.myshopify.com",
  sessionId = "anonymous-one";
const settings = {
  holdoutEnabled: true,
  holdoutPercent: 10,
  holdoutVersion: 2,
  analyticsEnabled: true,
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("SHOPIFY_API_SECRET", "synthetic-secret");
  vi.stubEnv("AOVBOOST_ALLOW_UNSIGNED_PROXY", "true");
  vi.stubEnv("NODE_ENV", "test");
  mocks.settings.mockResolvedValue(settings);
  mocks.session.mockResolvedValue({ id: sessionId, anonymousId: sessionId });
  mocks.enroll.mockImplementation(async ({ create }) => create);
  mocks.find.mockResolvedValue({
    id: "enrollment",
    shop,
    sessionId,
    version: 2,
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
describe("stable holdout identity and signed assignment", () => {
  it("assigns reproducibly by shop and anonymous ID with bounded percentages", () => {
    const ids = Array.from({ length: 1000 }, (_, i) => `session-${i}`);
    expect(ids.map((id) => holdoutArm(shop, id, 10))).toEqual(
      ids.map((id) => holdoutArm(shop, id, 10)),
    );
    expect(
      ids.filter((id) => holdoutArm(shop, id, 0) === "holdout"),
    ).toHaveLength(0);
    expect(
      ids.some(
        (id) =>
          holdoutArm(shop, id, 10) !== holdoutArm("two.myshopify.com", id, 10),
      ),
    ).toBe(true);
    const count = ids.filter(
      (id) => holdoutArm(shop, id, 10) === "holdout",
    ).length;
    expect(count).toBeGreaterThan(50);
    expect(count).toBeLessThan(150);
  });
  it("embeds the assignment in the authenticated signed session and preserves identity on renewal", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-05T00:00:00Z"));
    const session = issueStorefrontSession(shop, {
      sessionId,
      holdout: { arm: "holdout", version: 2, percent: 10 },
    });
    const claims = JSON.parse(
      Buffer.from(session.sessionToken.split(".")[1], "base64url").toString(),
    );
    expect(claims.holdout).toEqual({ arm: "holdout", version: 2, percent: 10 });
    const request = new Request(
      `https://app.example/api/session?shop=${shop}`,
      { headers: { Authorization: `Bearer ${session.sessionToken}` } },
    );
    expect(authenticateStorefrontRequest(request, {}).sessionId).toBe(
      sessionId,
    );
    vi.advanceTimersByTime(13 * 60 * 60 * 1000);
    expect(() => authenticateStorefrontRequest(request, {})).toThrow(/Expired/);
    expect(renewalSessionId(request, shop)).toBe(sessionId);
    expect(renewalSessionId(request, "two.myshopify.com")).toBeUndefined();
    expect(
      issueStorefrontSession(shop, {
        sessionId: renewalSessionId(request, shop),
      }).sessionId,
    ).toBe(sessionId);
    const forged = session.sessionToken.replace(
      /.$/,
      session.sessionToken.endsWith("a") ? "b" : "a",
    );
    expect(
      renewalSessionId(
        new Request(request.url, {
          headers: { Authorization: `Bearer ${forged}` },
        }),
        shop,
      ),
    ).toBeUndefined();
  });
  it("enrolls both groups without a generated offer and snapshots immutable tenant/version data", async () => {
    const result = await enrollHoldout(shop, sessionId);
    expect(result).toMatchObject({ version: 2, percent: 10 });
    expect(mocks.enroll).toHaveBeenCalledWith({
      where: { shop_sessionId_version: { shop, sessionId, version: 2 } },
      update: {},
      create: {
        shop,
        sessionId,
        version: 2,
        percent: 10,
        arm: holdoutArm(shop, sessionId, 10),
      },
    });
    expect(verifyMeasurementLink(shop, result!.link)).toEqual({
      sessionId,
      version: 2,
    });
  });
  it.each([
    { holdoutEnabled: false },
    { holdoutPercent: 0 },
    { analyticsEnabled: false },
  ])(
    "returns all shoppers to exposed/unenrolled when disabled: %j",
    async (change) => {
      mocks.settings.mockResolvedValue({ ...settings, ...change });
      expect(await enrollHoldout(shop, sessionId)).toBeNull();
      expect(mocks.enroll).not.toHaveBeenCalled();
    },
  );
});
describe("holdout cart and order linkage", () => {
  const payload = () => ({
    id: 123,
    created_at: "2026-11-05T10:00:00Z",
    total_price: "100.00",
    currency: "KES",
    total_price_set: { shop_money: { amount: "12.50", currency_code: "USD" } },
    note_attributes: [
      {
        name: "__aovboost_measurement__",
        value: measurementLink(shop, sessionId, 2),
      },
    ],
    line_items: [
      { product_id: 1, variant_id: 101, quantity: 1, price: "12.50" },
    ],
  });
  it("links an order without any offer or recommended line, including holdout", async () => {
    const body = payload(),
      attribution = extractOrderAttribution(body, shop);
    expect(attribution.offerIds).toEqual([]);
    expect(attribution.sessionIds).toEqual([sessionId]);
    await recordHoldoutOrder(shop, body, attribution);
    await recordHoldoutOrder(shop, body, attribution);
    for (const [arg] of mocks.order.mock.calls)
      expect(arg).toMatchObject({
        where: { shop_orderId: { shop, orderId: "123" } },
        update: {},
        create: {
          shop,
          enrollmentId: "enrollment",
          revenue: "12.5",
          currency: "USD",
        },
      });
  });
  it("rejects forged, cross-shop and authentication-purpose links", async () => {
    const link = measurementLink(shop, sessionId, 2);
    expect(verifyMeasurementLink("two.myshopify.com", link)).toBeNull();
    expect(verifyMeasurementLink(shop, link + "bad")).toBeNull();
    expect(
      verifyMeasurementLink(shop, issueStorefrontSession(shop).sessionToken),
    ).toBeNull();
    const body = payload();
    body.note_attributes[0].value = measurementLink(
      "two.myshopify.com",
      sessionId,
      2,
    );
    await recordHoldoutOrder(shop, body, extractOrderAttribution(body, shop));
    expect(mocks.order).not.toHaveBeenCalled();
  });
  it("requires an existing enrollment and valid signed order money/date", async () => {
    const body = payload();
    mocks.find.mockResolvedValueOnce(null);
    await recordHoldoutOrder(shop, body, extractOrderAttribution(body, shop));
    expect(mocks.order).not.toHaveBeenCalled();
    body.created_at = "invalid";
    await recordHoldoutOrder(shop, body, extractOrderAttribution(body, shop));
    expect(mocks.order).not.toHaveBeenCalled();
  });
  it("tracks cart/link receipt identically for each arm, and ignores a forged receipt", async () => {
    await recordHoldoutCartEvents(shop, sessionId, [
      { type: "cart_update", cartItemCount: 1 },
      {
        type: "measurement_cart_linked",
        measurementLink: measurementLink(shop, sessionId, 2),
      },
    ]);
    expect(mocks.update).toHaveBeenCalledWith({
      where: { shop, sessionId, version: 2 },
      data: { cartSeenAt: expect.any(Date), cartLinkedAt: expect.any(Date) },
    });
    mocks.update.mockClear();
    await recordHoldoutCartEvents(shop, sessionId, [
      { type: "measurement_cart_linked", measurementLink: "forged" },
    ]);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
