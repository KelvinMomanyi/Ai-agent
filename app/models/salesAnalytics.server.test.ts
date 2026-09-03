import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sessionFindMany: vi.fn(),
  eventFindMany: vi.fn(),
  outcomeFindMany: vi.fn(),
  orderFindMany: vi.fn(),
}));

vi.mock("../db.server", () => ({
  default: {
    shopperSession: { findMany: mocks.sessionFindMany },
    shopperEvent: { findMany: mocks.eventFindMany },
    recommendationOutcome: { findMany: mocks.outcomeFindMany },
    event: { findMany: mocks.orderFindMany },
  },
}));

import { getSalesAnalytics } from "./salesAnalytics.server";

describe("AI sales attribution analytics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sessionFindMany.mockResolvedValue([
      {
        id: "engaged-purchased",
        chatEngaged: true,
        checkoutStarted: true,
        purchaseCompleted: true,
        orderValue: 100,
        aiAttributedRevenue: 60,
        shopperProfile: { knownObjections: ["PRICE"] },
        context: { proactivePromptCount: 1 },
      },
      {
        id: "engaged-browsing",
        chatEngaged: true,
        checkoutStarted: false,
        purchaseCompleted: false,
        orderValue: null,
        aiAttributedRevenue: 0,
        shopperProfile: {},
        context: {},
      },
      {
        id: "not-engaged",
        chatEngaged: false,
        checkoutStarted: false,
        purchaseCompleted: false,
        orderValue: null,
        aiAttributedRevenue: 0,
        shopperProfile: {},
        context: {},
      },
    ]);
    mocks.eventFindMany.mockResolvedValue([
      event("engaged-purchased", "widget_impression", {
        widgetType: "chat",
      }),
      event("engaged-purchased", "chat_opened"),
      event("engaged-purchased", "customer_message_sent"),
      event("engaged-purchased", "recommendation_shown"),
      event("engaged-purchased", "recommendation_clicked"),
      event("engaged-purchased", "recommendation_added"),
      event("engaged-purchased", "upsell_shown"),
      event("engaged-purchased", "upsell_added"),
      event("engaged-purchased", "checkout_started"),
    ]);
    mocks.outcomeFindMany.mockResolvedValue([
      {
        recommendationType: "primary",
        clickedAt: new Date(),
        addedAt: new Date(),
        purchasedAt: new Date(),
        revenue: 60,
      },
      {
        recommendationType: "upsell",
        clickedAt: null,
        addedAt: new Date(),
        purchasedAt: new Date(),
        revenue: 15,
      },
    ]);
    mocks.orderFindMany.mockResolvedValue([
      {
        data: {
          total_price: 100,
          aiAssisted: true,
          aiAttributedRevenue: 60,
        },
      },
      { data: { total_price: 80, aiAssisted: false } },
    ]);
  });

  it("credits only materially assisted orders and reports both AOV cohorts", async () => {
    const report = await getSalesAnalytics("example.myshopify.com");

    expect(report.chatImpressions).toBe(1);
    expect(report.recommendationClickRate).toBe(1);
    expect(report.recommendationAddToCartRate).toBe(1);
    expect(report.upsellAcceptanceRate).toBe(1);
    expect(report.aiAssistedOrders).toBe(1);
    expect(report.aiAttributedRevenue).toBe(60);
    expect(report.aiAssistedAov).toBe(100);
    expect(report.nonAiAov).toBe(80);
    expect(report.aiEngagedConversionRate).toBe(0.5);
    expect(report.objectionToPurchaseRate).toBe(1);
    expect(report.proactiveMessageConversionRate).toBe(1);
  });
});

function event(
  sessionId: string,
  type: string,
  payload: Record<string, unknown> = {},
) {
  return { sessionId, type, payload };
}
