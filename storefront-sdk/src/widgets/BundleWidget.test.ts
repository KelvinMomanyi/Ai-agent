import { describe, expect, it } from "vitest";
import { getBundlePricing } from "./BundleWidget";

describe("getBundlePricing", () => {
  it("shows percentage savings from the live line-price sum", () => {
    expect(
      getBundlePricing(100, {
        id: "bundle-1",
        discountVersion: "version-1",
        discountType: "percentage",
        discountValue: "15",
      }),
    ).toEqual({
      active: true,
      original: 100,
      discounted: 85,
      savings: 15,
    });
  });

  it("shows fixed savings without changing the catalog-derived original", () => {
    expect(
      getBundlePricing(49.99, {
        id: "bundle-1",
        discountVersion: "version-1",
        discountType: "fixed_amount",
        discountValue: "5",
      }),
    ).toEqual({
      active: true,
      original: 49.99,
      discounted: 44.99,
      savings: 5,
    });
  });

  it("does not advertise a discount without native Function configuration", () => {
    expect(
      getBundlePricing(100, {
        id: "bundle-1",
        discountType: "percentage",
        discountValue: "15",
      }).active,
    ).toBe(false);
  });
});
