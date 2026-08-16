import { describe, expect, it } from "vitest";
import type { ShopperSession } from "@prisma/client";
import type { CatalogCacheProduct } from "./catalogCache.server";
import {
  buildVisitorBehaviorContext,
  formatConversationHistoryForPrompt,
  formatVisitorSignalsForPrompt,
} from "./chatContext.server";

describe("chat context assembly", () => {
  it("builds current-page, referral, returning-visitor, and abandoned-cart context from existing events", () => {
    const now = new Date("2026-08-16T12:05:00.000Z");
    const behavior = buildVisitorBehaviorContext({
      now,
      session: session(),
      pageContext: {
        pageType: "product",
        path: "/products/trail-board",
        productId: "gid://shopify/Product/1",
      },
      recentEvents: [
        event("scroll_depth", "2026-08-16T12:03:30.000Z", { depth: 75 }),
        event("page_view", "2026-08-16T12:02:00.000Z", {
          url: "https://example.test/products/trail-board?campaign=private",
          referrer: "https://www.google.com/search?q=boards",
        }),
        event("cart_abandoned", "2026-08-15T10:00:00.000Z", {
          cartItems: [{ productId: "gid://shopify/Product/2" }],
        }),
      ],
      pageViewEvents: [
        { createdAt: new Date("2026-08-16T12:02:00.000Z") },
        { createdAt: new Date("2026-08-15T10:00:00.000Z") },
      ],
    });

    expect(behavior).toMatchObject({
      currentPage: {
        path: "/products/trail-board",
        timeOnPageSeconds: 180,
        scrollDepthPercent: 75,
      },
      referralSource: "www.google.com",
      visitorType: "returning",
      pastSessionCount: 1,
      abandonedCartProductIds: ["gid://shopify/Product/2"],
    });
  });

  it("only names behavior products that are verified in the store catalog", () => {
    const behavior = buildVisitorBehaviorContext({
      session: session({
        viewedProductIds: [
          "gid://shopify/Product/1",
          "gid://shopify/Product/999",
        ],
      }),
      recentEvents: [],
      pageViewEvents: [],
    });
    const prompt = formatVisitorSignalsForPrompt(behavior, [product()]);

    expect(prompt).toContain("Trail Board (gid://shopify/Product/1)");
    expect(prompt).not.toContain("Product/999");
  });

  it("bounds server conversation memory and labels the speakers", () => {
    const history = Array.from({ length: 14 }, (_, index) => ({
      role: index % 2 ? ("user" as const) : ("assistant" as const),
      content: `turn-${index}`,
    }));
    const prompt = formatConversationHistoryForPrompt(history);

    expect(prompt).not.toContain("turn-3");
    expect(prompt).toContain("Assistant: turn-4");
    expect(prompt).toContain("Shopper: turn-13");
  });
});

function session(overrides: Partial<ShopperSession> = {}): ShopperSession {
  return {
    id: "session-1",
    shop: "example.myshopify.com",
    anonymousId: "visitor-1",
    journeyStage: "comparing",
    intentScore: 65,
    hesitationScore: 20,
    viewedProductIds: ["gid://shopify/Product/1"],
    cartProductIds: [],
    chatEngaged: true,
    totalPageViews: 4,
    sessionDuration: 300,
    context: { maxScrollDepth: 50, lastEventType: "product_view" },
    createdAt: new Date("2026-08-15T10:00:00.000Z"),
    updatedAt: new Date("2026-08-16T12:05:00.000Z"),
    ...overrides,
  };
}

function event(type: string, createdAt: string, payload: unknown) {
  return { type, createdAt: new Date(createdAt), payload };
}

function product(): CatalogCacheProduct {
  return {
    id: "gid://shopify/Product/1",
    handle: "trail-board",
    title: "Trail Board",
    name: "Trail Board",
    description: "A trail board",
    vendor: "AOVBoost",
    productType: "Board",
    category: "Board",
    tags: ["trail"],
    price: "499",
    compareAtPrice: null,
    priceRegular: "499",
    priceSale: null,
    image: null,
    imageUrl: null,
    imageAlt: "Trail Board",
    inventory: 4,
    availableForSale: true,
    defaultVariantId: "gid://shopify/ProductVariant/11",
    variants: [],
    searchText: "trail board",
    metafields: {},
  };
}
