import { describe, expect, it } from "vitest";
import { extractOrderAttribution } from "./attribution.server";

describe("extractOrderAttribution", () => {
  it("attributes net line revenue to private offer properties", () => {
    const result = extractOrderAttribution({
      line_items: [
        {
          product_id: 123,
          variant_id: 456,
          quantity: 2,
          price: "25.00",
          total_discount: "5.00",
          properties: [{ name: "_aovboost_offer_id", value: "offer_abc" }],
        },
        {
          product_id: 789,
          variant_id: 1011,
          quantity: 1,
          price: "10.00",
          properties: { _aovboost_offer_id: "offer_abc" },
        },
      ],
    });

    expect(result.productIds).toEqual([
      "gid://shopify/Product/123",
      "gid://shopify/Product/789",
    ]);
    expect(result.attributedOffers).toEqual([
      { offerId: "offer_abc", revenue: 55 },
    ]);
    expect(result.lineItems[0]).toMatchObject({
      variantId: "gid://shopify/ProductVariant/456",
      offerId: "offer_abc",
      totalDiscount: 5,
    });
  });

  it("ignores malformed offer identifiers and handles discount allocations", () => {
    const result = extractOrderAttribution({
      line_items: [
        {
          product_id: 1,
          quantity: 1,
          price: "20",
          discount_allocations: [{ amount: "2.50" }, { amount: "1.25" }],
          properties: [{ name: "_aovboost_offer_id", value: "bad id!" }],
        },
      ],
    });

    expect(result.offerIds).toEqual([]);
    expect(result.lineItems[0].totalDiscount).toBe(3.75);
  });
});
