import { describe, expect, it } from "vitest";
import { buildHeuristicOfferDecision } from "./decisionEngine.server";
import type { DecisionInput } from "./types";

describe("revenue widget routing", () => {
  it("keeps the assistant available through its own bootstrap trigger", () => {
    expect(
      decision({ trigger: trigger("assistant_bootstrap") }).widgetType,
    ).toBe("chat");
  });

  it("shows catalog-backed recommendations on eligible landing pages", () => {
    expect(
      decision({
        currentPageType: "product",
        currentProductId: "gid://shopify/Product/1",
        trigger: trigger("initial"),
      }).widgetType,
    ).toBe("rec_strip");
  });

  it("prioritizes an upsell drawer after a live cart addition", () => {
    expect(
      decision({
        currentPageType: "product",
        cartProductIds: ["gid://shopify/Product/1"],
        cartItemCount: 1,
        trigger: trigger("cart_item_added", { cartValue: 80 }),
      }).widgetType,
    ).toBe("upsell_drawer");
  });

  it("requires a verified future end time for countdown urgency", () => {
    expect(
      decision({
        trigger: trigger("flash_sale_window", {
          endsAt: "not-a-campaign-date",
        }),
      }).widgetType,
    ).toBeNull();
  });

  it("shows social proof only when store order data supports it", () => {
    const candidate = {
      id: "gid://shopify/Product/2",
      type: "product",
      widgetType: "social_proof",
      productId: "gid://shopify/Product/2",
      title: "Verified Add-on",
      score: 0.8,
      payload: { affinity: { orderCount: 12 } },
    };
    expect(
      decision({
        currentPageType: "product",
        trigger: trigger("social_proof"),
        candidates: [candidate],
      }).widgetType,
    ).toBe("social_proof");
    expect(
      decision({
        currentPageType: "product",
        trigger: trigger("social_proof"),
        candidates: [
          { ...candidate, payload: { affinity: { orderCount: 0 } } },
        ],
      }).widgetType,
    ).toBeNull();
  });
});

function decision(overrides: Partial<DecisionInput> = {}) {
  return buildHeuristicOfferDecision(
    {
      shop: "example.myshopify.com",
      session: {
        id: "session-1",
        anonymousId: "session-1",
        journeyStage: "discovering",
        intentScore: 20,
        hesitationScore: 0,
        viewedProductIds: [],
        cartProductIds: [],
        chatEngaged: false,
        totalPageViews: 1,
        sessionDuration: 10,
        context: {},
      },
      currentPageType: "home",
      cartProductIds: [],
      cartVariantIds: [],
      cartItemCount: 0,
      recentlyDismissedWidgets: [],
      settings: {
        chatEnabled: true,
        chatGreeting: "How can I help?",
        bundlesEnabled: true,
        upsellEnabled: true,
        discountNudgeEnabled: true,
        discountThreshold: 100,
        exitIntentEnabled: true,
        postPurchaseEnabled: true,
      } as any,
      candidates: [
        {
          id: "gid://shopify/Product/2",
          type: "product",
          widgetType: "rec_strip",
          productId: "gid://shopify/Product/2",
          title: "Verified Add-on",
          score: 0.8,
          payload: {},
        },
      ],
      trigger: trigger("initial"),
      ...overrides,
    },
    0,
  );
}

function trigger(type: string, payload: Record<string, unknown> = {}) {
  return { type, payload };
}
