import { describe, expect, it, vi } from "vitest";
const reportMocks = vi.hoisted(() => ({
  query: vi.fn(),
  count: vi.fn(),
  settings: vi.fn(),
  entitlement: vi.fn(),
}));
vi.mock("../db.server", () => ({
  default: {
    $queryRaw: reportMocks.query,
    holdoutEnrollment: { count: reportMocks.count },
  },
}));
vi.mock("./settings.server", () => ({ getAppSettings: reportMocks.settings }));
vi.mock("./entitlements.server", async (original) => ({
  ...(await original<typeof import("./entitlements.server")>()),
  getEntitlements: reportMocks.entitlement,
}));
vi.mock("./reportCache.server", () => ({
  cachedReport: async (
    _shop: string,
    _key: string,
    _date: Date,
    load: () => Promise<unknown>,
  ) => load(),
}));
vi.mock("../redis.server", () => ({
  getJsonCache: vi.fn(),
  setJsonCache: vi.fn(),
}));
import {
  summarizeHoldout,
  measurementDateRange,
  MIN_ARM_SESSIONS,
  getHoldoutReport,
} from "./holdoutAnalytics.server";
import { calculateTwoProportionZTest } from "./analytics.server";
const arm = (name: string, convertedSessions: number, sessions = 200) => ({
  arm: name,
  sessions,
  convertedSessions,
  orders: convertedSessions + 2,
  revenue: 1000,
  currencies: ["USD"],
  cartSessions: 100,
  linkedCarts: 100,
});
describe("honest measurement gates", () => {
  it("withholds the paid report server-side for free shops while retaining the attributed funnel and value summary", async () => {
    reportMocks.settings.mockResolvedValue({
      holdoutEnabled: true,
      holdoutPercent: 10,
      holdoutVersion: 2,
      analyticsEnabled: true,
      upsellEnabled: true,
      updatedAt: new Date(),
    });
    reportMocks.entitlement.mockResolvedValue({
      tier: "free",
      state: "verified",
    });
    reportMocks.query.mockResolvedValue([]);
    const report = await getHoldoutReport("one.myshopify.com");
    expect(report).toMatchObject({
      reportingAvailable: false,
      enabled: false,
      lift: null,
      pendingSessions: 0,
    });
    expect(reportMocks.query).toHaveBeenCalledTimes(2);
    expect(reportMocks.count).not.toHaveBeenCalled();
    for (const [sql] of reportMocks.query.mock.calls) {
      expect(sql.values).toContain("one.myshopify.com");
      expect(sql.text).not.toContain('FROM "HoldoutEnrollment"');
    }
  });
  it("never displays lift below the named sample threshold even when rates differ", () => {
    const result = summarizeHoldout([
      arm("exposed", 60, MIN_ARM_SESSIONS - 1),
      arm("holdout", 20),
    ]);
    expect(result.lift).toBeNull();
    expect(result.status).toBe("Not enough data yet");
    expect(result.guardrail).toBe(false);
  });
  it("requires sufficient converting and non-converting sessions", () => {
    for (const n of [0, 19, 190])
      expect(
        summarizeHoldout([arm("exposed", n), arm("holdout", 40)]).lift,
      ).toBeNull();
  });
  it.each([
    [60, 20],
    [20, 60],
    [30, 30],
    [40, 35],
  ])("reuses the unchanged two-proportion test for %s vs %s", (a, b) => {
    const result = summarizeHoldout([arm("exposed", a), arm("holdout", b)]);
    expect(result.significant).toBe(
      calculateTwoProportionZTest(
        { impressions: 200, conversions: a },
        { impressions: 200, conversions: b },
      ),
    );
  });
  it("shows a material significant negative conversion guardrail and no revenue lift", () => {
    const result = summarizeHoldout([arm("exposed", 20), arm("holdout", 60)]);
    expect(result.guardrail).toBe(true);
    expect(result.lift).toBeCloseTo(-2 / 3);
    expect(result).not.toHaveProperty("incrementalRevenue");
  });
  it("blocks lift when cart-link coverage is insufficient", () => {
    const result = summarizeHoldout([
      arm("exposed", 60),
      { ...arm("holdout", 20), linkedCarts: 94 },
    ]);
    expect(result.ready).toBe(false);
    expect(result.lift).toBeNull();
    expect(result.status).toBe("Cart linkage needs attention");
  });
  it("requires balanced linkage between the arms as well as high coverage", () => {
    const result = summarizeHoldout([
      arm("exposed", 60),
      { ...arm("holdout", 20), linkedCarts: 96 },
    ]);
    expect(result.lift).toBeNull();
    expect(result.linkageReady).toBe(false);
  });
  it("does not add different currencies together for AOV or revenue per session", () => {
    const result = summarizeHoldout([
      arm("exposed", 60),
      { ...arm("holdout", 20), currencies: ["KES"] },
    ]);
    expect(result.exposed.aov).toBeNull();
    expect(result.holdout.revenuePerSession).toBeNull();
    expect(result.currency).toBeNull();
  });
  it("uses converting sessions for conversion and orders for AOV", () => {
    const result = summarizeHoldout([arm("exposed", 60), arm("holdout", 20)]);
    expect(result.exposed.conversionRate).toBe(0.3);
    expect(result.exposed.aov).toBeCloseTo(1000 / 62);
    expect(result.exposed.revenuePerSession).toBe(5);
  });
  it("validates bounded inclusive calendar ranges", () => {
    const now = new Date("2026-11-05T12:00:00Z");
    expect(
      measurementDateRange(
        new URL("https://app.test/?from=2026-10-01&to=2026-10-31"),
        now,
      ),
    ).toEqual({ from: new Date("2026-10-01"), to: new Date("2026-11-01") });
    for (const query of [
      "from=2026-02-30",
      "from=2025-01-01",
      "from=2026-11-06",
      "from=bad",
    ])
      expect(() =>
        measurementDateRange(new URL(`https://app.test/?${query}`), now),
      ).toThrow();
  });
});
