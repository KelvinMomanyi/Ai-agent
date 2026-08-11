import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  experimentFindMany: vi.fn(),
  offerFindMany: vi.fn(),
}));

vi.mock("../db.server", () => ({
  default: {
    experiment: { findMany: mocks.experimentFindMany },
    offer: { findMany: mocks.offerFindMany },
  },
}));

import {
  getExperimentAnalytics,
  summarizeDashboardMetrics,
  summarizeRevenueAnalytics,
} from "./analytics.server";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getExperimentAnalytics", () => {
  it("keeps consecutive experiments on the same widget type isolated", async () => {
    mocks.experimentFindMany.mockResolvedValue([
      experiment("experiment-2", new Date("2026-08-02")),
      experiment("experiment-1", new Date("2026-08-01")),
    ]);
    mocks.offerFindMany.mockResolvedValue([
      offer("offer-1-control", "experiment-1", "control", false, 0),
      offer("offer-1-treatment", "experiment-1", "treatment", true, 25),
      offer("offer-2-control", "experiment-2", "control", true, 10),
      offer("offer-2-treatment", "experiment-2", "treatment", false, 0),
    ]);

    const results = await getExperimentAnalytics("example.myshopify.com");
    const first = results.find((result) => result.id === "experiment-1");
    const second = results.find((result) => result.id === "experiment-2");

    expect(first?.control.conversions).toBe(0);
    expect(first?.treatment.conversions).toBe(1);
    expect(first?.treatment.revenue).toBe(25);
    expect(second?.control.conversions).toBe(1);
    expect(second?.control.revenue).toBe(10);
    expect(second?.treatment.conversions).toBe(0);
    expect(mocks.offerFindMany).toHaveBeenCalledWith({
      where: {
        shop: "example.myshopify.com",
        abVariant: { not: null },
        experimentId: { not: null },
      },
    });
  });
});

describe("authoritative revenue analytics", () => {
  it("matches the main dashboard and derives panels without legacy funnel events", () => {
    const attributedOffer = offer(
      "offer-attributed",
      "experiment-1",
      "treatment",
      true,
      25,
    );
    attributedOffer.clicked = true;
    attributedOffer.payload = {
      copy: { headline: "Complete the trail kit" },
    };
    attributedOffer.widgetType = "bundle";
    attributedOffer.createdAt = new Date("2026-08-01T10:00:00.000Z");
    const unconvertedOffer = {
      ...offer("offer-unconverted", null, null, false, 0),
      sessionId: "session-2",
      widgetType: "toast",
      shown: true,
      clicked: false,
      payload: { copy: { headline: "A useful reminder" } },
      createdAt: new Date("2026-08-02T10:00:00.000Z"),
    };
    const conversionEvents = [
      conversionEvent("order-attributed", 150, ["offer-attributed"]),
      conversionEvent("order-baseline", 100, []),
    ];
    const sessions = [
      shopperSession("session-1", "deciding", true),
      shopperSession("session-2", "discovering", false),
    ];
    const offers = [attributedOffer, unconvertedOffer] as any;

    const mainDashboard = summarizeDashboardMetrics({
      offers,
      chatEngaged: 1,
      conversionEvents: conversionEvents as any,
    });
    const report = summarizeRevenueAnalytics({
      offers,
      sessions: sessions as any,
      shopperEvents: [
        shopperEvent(
          "widget_impression",
          "offer-attributed",
          "2026-08-02T10:00:00.000Z",
        ),
        shopperEvent(
          "widget_click",
          "offer-attributed",
          "2026-08-03T10:00:00.000Z",
        ),
      ] as any,
      conversionEvents: conversionEvents as any,
      experiments: [{ id: "experiment-1", name: "Bundle copy test" }],
    });

    expect(report.dashboard).toEqual(mainDashboard);
    expect(report.dashboard.attributedRevenue).toBe(25);
    expect(report.dashboard.avgAov).toBe(150);
    expect(report.dashboard.aovLift).toBe(0.5);
    expect(report.dashboard.aovLiftAvailable).toBe(true);
    expect(report.funnel).toEqual({
      generated: 2,
      impressions: 2,
      clicks: 1,
      conversions: 1,
    });
    expect(report.offerRows[0]).toEqual(
      expect.objectContaining({
        name: "Complete the trail kit",
        widgetType: "bundle",
        impressions: 1,
        clicks: 1,
        conversions: 1,
        revenue: 25,
      }),
    );
    expect(report.experimentRows).toEqual([
      expect.objectContaining({
        experiment: "Bundle copy test",
        variant: "treatment",
        revenue: 25,
      }),
    ]);
    expect(report.journeyRows).toContainEqual({
      journeyStage: "deciding",
      sessions: 1,
      convertedSessions: 1,
      revenue: 25,
    });
    expect(report.timeSeries).toContainEqual(
      expect.objectContaining({
        date: "2026-08-03",
        clicks: 1,
      }),
    );
    expect(report.timeSeries).toContainEqual(
      expect.objectContaining({
        date: "2026-08-04",
        conversions: 1,
        revenue: 25,
      }),
    );
  });

  it("marks AOV lift unavailable when either comparison cohort is missing", () => {
    const metrics = summarizeDashboardMetrics({
      offers: [] as any,
      chatEngaged: 0,
      conversionEvents: [
        conversionEvent("order-attributed", 150, ["offer-attributed"]),
      ] as any,
    });

    expect(metrics.aovLiftAvailable).toBe(false);
  });
});

function experiment(id: string, startedAt: Date) {
  return {
    id,
    shop: "example.myshopify.com",
    name: id,
    widgetType: "toast",
    trafficSplit: 0.5,
    isActive: false,
    controlConfig: {},
    treatmentConfig: {},
    startedAt,
    endedAt: new Date("2026-08-03"),
  };
}

function offer(
  id: string,
  experimentId: string | null,
  abVariant: "control" | "treatment" | null,
  converted: boolean,
  revenueImpact: number,
) {
  return {
    id,
    sessionId: "session-1",
    shop: "example.myshopify.com",
    widgetType: "toast",
    payload: {},
    triggerContext: {},
    aiProvider: "heuristic",
    shown: true,
    clicked: converted,
    converted,
    revenueImpact,
    abVariant,
    experimentId,
    createdAt: new Date("2026-08-02"),
  };
}

function conversionEvent(orderId: string, total: number, offerIds: string[]) {
  return {
    id: orderId,
    event: "conversion",
    orderId,
    storeId: "example.myshopify.com",
    timestamp: new Date("2026-08-04T10:00:00.000Z"),
    data: { total_price: total, offerIds },
    createdAt: new Date("2026-08-04T10:00:00.000Z"),
    updatedAt: new Date("2026-08-04T10:00:00.000Z"),
  };
}

function shopperEvent(type: string, offerId: string, createdAt: string) {
  return {
    id: `${type}-${offerId}`,
    sessionId: "session-1",
    shop: "example.myshopify.com",
    type,
    payload: { offerId },
    createdAt: new Date(createdAt),
  };
}

function shopperSession(id: string, journeyStage: string, chatEngaged: boolean) {
  return {
    id,
    shop: "example.myshopify.com",
    anonymousId: id,
    journeyStage,
    intentScore: 50,
    hesitationScore: 10,
    viewedProductIds: [],
    cartProductIds: [],
    chatEngaged,
    totalPageViews: 1,
    sessionDuration: 60,
    context: {},
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-04T00:00:00.000Z"),
  };
}
