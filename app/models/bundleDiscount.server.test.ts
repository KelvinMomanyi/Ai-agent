import { describe, expect, it } from "vitest";
import {
  assertBundleDiscountWithinCatalogTotal,
  BundleValidationError,
  getBundleDiscountVersion,
  normalizeBundleDiscount,
} from "./bundleDiscount.server";

describe("bundle discount validation", () => {
  it("accepts inclusive percentage boundaries", () => {
    expect(
      normalizeBundleDiscount({
        discountType: "percentage" as const,
        discountValue: 1,
        items: [],
      }).discountValue,
    ).toBe(1);
    expect(
      normalizeBundleDiscount({
        discountType: "percentage" as const,
        discountValue: 50,
        items: [],
      }).discountValue,
    ).toBe(50);
  });

  it("rejects percentage values outside 1-50", () => {
    expect(() =>
      normalizeBundleDiscount({
        discountType: "percentage" as const,
        discountValue: 75,
        items: [],
      }),
    ).toThrow(BundleValidationError);
  });

  it("rejects a fixed discount equal to or above the live line sum", () => {
    expect(() =>
      assertBundleDiscountWithinCatalogTotal(
        { discountType: "fixed_amount", discountValue: 100 },
        100,
      ),
    ).toThrow(/less than the live bundle total/);
  });

  it("versions the exact discount and membership configuration", () => {
    const base = {
      id: "bundle-1",
      isActive: true,
      discountType: "percentage" as const,
      discountValue: 15,
      items: [{ productId: "gid://shopify/Product/1", quantity: 1 }],
    };

    expect(getBundleDiscountVersion(base)).not.toBe(
      getBundleDiscountVersion({
        ...base,
        items: [{ productId: "gid://shopify/Product/1", quantity: 2 }],
      }),
    );
  });
});
