import { describe, it, expect } from "vitest";
import { validThemeTestUrl } from "./ThemeTestButton";
describe("merchant theme preview navigation", () => {
  it("allows only Shopify product-page preview links", () => {
    expect(
      validThemeTestUrl(
        "https://one.myshopify.com/products/shampoo?aovboost_preview=signed",
      ),
    ).toBe(true);
    for (const value of [
      "javascript:alert(1)",
      "https://evil.example/products/shampoo?aovboost_preview=x",
      "https://one.myshopify.com/admin?aovboost_preview=x",
      "https://one.myshopify.com/products/shampoo",
    ])
      expect(validThemeTestUrl(value)).toBe(false);
  });
});
