import { describe, expect, it } from "vitest";
import { parseResourceIds, pickerSelectionValue } from "./resourcePicker";

describe("resource picker value compatibility", () => {
  it("round-trips existing CSV product and collection lists", () => {
    for (const type of ["product", "collection"] as const) {
      const resource = type === "product" ? "Product" : "Collection";
      const existing = `gid://shopify/${resource}/1, gid://shopify/${resource}/2`;
      const selectionIds = parseResourceIds(existing).map((id) => ({ id }));
      expect(pickerSelectionValue(selectionIds, type)).toBe(existing);
      expect(
        parseResourceIds(pickerSelectionValue(selectionIds, type)!),
      ).toEqual(selectionIds.map(({ id }) => id));
    }
  });
  it("distinguishes cancellation from clearing the selection", () => {
    expect(pickerSelectionValue(undefined, "product")).toBeUndefined();
    expect(pickerSelectionValue([], "product")).toBe("");
  });
  it("drops invalid IDs, variants and wrong resource kinds, and deduplicates", () => {
    expect(
      pickerSelectionValue(
        [
          { id: "gid://shopify/Product/1" },
          { id: "gid://shopify/Product/1" },
          { id: "gid://shopify/ProductVariant/2" },
          { id: "gid://shopify/Collection/3" },
          { id: "invalid" },
        ],
        "product",
      ),
    ).toBe("gid://shopify/Product/1");
  });
  it("bounds a native selection to the existing settings list limit", () => {
    const selection = Array.from({ length: 550 }, (_, n) => ({
      id: `gid://shopify/Product/${n}`,
    }));
    expect(
      parseResourceIds(pickerSelectionValue(selection, "product")!),
    ).toHaveLength(500);
  });
});
