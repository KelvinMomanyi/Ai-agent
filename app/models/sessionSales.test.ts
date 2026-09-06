import { describe, expect, it } from "vitest";
import { computeSessionState } from "./session.server";
import type { ShopperSession } from "@prisma/client";

describe("shopper sales journeys", () => {
  it("preserves proactive state and reconciles an empty cart snapshot", () => {
    const existing = {
      viewedProductIds: ["p1"],
      cartProductIds: ["p1"],
      context: {
        proactivePromptCount: 2,
        lastProactivePromptAt: "2026-09-06T12:00:00Z",
        cartValue: 90,
        cartItemCount: 1,
      },
    } as unknown as ShopperSession;
    const result = computeSessionState(existing, [
      { type: "product_revisited", productId: "p1" },
      {
        type: "session_sync",
        cartProductIds: [],
        cartVariantIds: [],
        cartItemCount: 0,
        cartValue: 0,
      },
    ]);
    expect(result.context).toMatchObject({
      proactivePromptCount: 2,
      cartValue: 0,
      cartItemCount: 0,
      productViewCounts: { p1: 2 },
    });
    expect(result.cartProductIds).toEqual([]);
    expect(
      computeSessionState(null, [{ type: "checkout_clicked" }]).checkoutStarted,
    ).toBe(true);
  });
  it("moves a qualified shopper from discovery through recommendation to closing", () => {
    const result = computeSessionState(null, [
      { type: "page_view", url: "/collections/running" },
      { type: "collection_viewed", collectionId: "running" },
      { type: "product_viewed", productId: "gid://shopify/Product/shoe" },
      {
        type: "customer_message_sent",
        message:
          "I need comfortable black running shoes under KSh 5,000 in size 43.",
      },
      {
        type: "recommendation_shown",
        productId: "gid://shopify/Product/shoe",
      },
      {
        type: "add_to_cart",
        productId: "gid://shopify/Product/shoe",
        cartItemCount: 1,
        cartValue: 4800,
      },
      {
        type: "recommendation_added",
        productId: "gid://shopify/Product/shoe",
      },
      { type: "session_sync", sessionDuration: 180 },
    ]);

    expect(result.salesState).toBe("CLOSING");
    expect(result.intentScore).toBeGreaterThan(70);
    expect(result.shopperProfile.budgetMax).toBe(5000);
    expect(result.cartProductIds).toEqual(["gid://shopify/Product/shoe"]);
  });

  it("recognizes a price objection before recommending a cheaper fit", () => {
    const result = computeSessionState(null, [
      { type: "product_viewed", productId: "gid://shopify/Product/premium" },
      {
        type: "customer_message_sent",
        message: "This is too expensive. Is there a cheaper option?",
      },
    ]);

    expect(result.salesState).toBe("OBJECTION");
    expect(result.shopperProfile.currentObjection).toBe("PRICE");
    expect(result.shopperProfile.knownObjections).toContain("PRICE");
  });

  it("detects cart hesitation after comparison, cart close, and a shipping concern", () => {
    const productId = "gid://shopify/Product/shoe";
    const result = computeSessionState(null, [
      { type: "product_viewed", productId },
      { type: "product_revisited", productId },
      { type: "comparison_page_visit" },
      { type: "variant_selected", productId },
      { type: "add_to_cart", productId, cartItemCount: 1, cartValue: 90 },
      { type: "cart_opened" },
      { type: "cart_closed" },
      {
        type: "customer_message_sent",
        message: "I'm unsure whether delivery will arrive in time.",
      },
      { type: "session_sync", sessionDuration: 200 },
    ]);

    expect(result.hesitationScore).toBeGreaterThanOrEqual(55);
    expect(result.salesState).toBe("HESITATING");
    expect(result.shopperProfile.currentObjection).toBe("SHIPPING");
  });

  it("moves checkout to purchased and prevents further sales states", () => {
    const result = computeSessionState(null, [
      { type: "checkout_started" },
      { type: "purchase_completed" },
    ]);

    expect(result.checkoutStarted).toBe(true);
    expect(result.purchaseCompleted).toBe(true);
    expect(result.salesState).toBe("PURCHASED");
  });
});
