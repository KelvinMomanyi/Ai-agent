// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  getProducts,
  renderVariantPicker,
  resolveProductVariant,
} from "./BaseWidget";

describe("canonical widget variant selection", () => {
  it("keeps a single variant on the existing one-click path", () => {
    const product = getProducts({ products: [productPayload().product] })[0];

    expect(product.variantId).toBe("gid://shopify/ProductVariant/11");
    expect(renderVariantPicker(product, "product-0")).toBe("");
  });

  it("renders only synced combinations and marks unavailable variants", () => {
    const payload = productPayload();
    payload.product.variants.push({
      id: "gid://shopify/ProductVariant/12",
      title: "Large / Blue",
      sku: "TRAIL-L-BLUE",
      price: "529.00",
      compareAtPrice: null,
      quantityAvailable: 0,
      availableForSale: false,
      selectedOptions: [
        { name: "Size", value: "Large" },
        { name: "Color", value: "Blue" },
      ],
    });
    const product = getProducts({ products: [payload.product] })[0];
    const root = document.createElement("div");
    root.innerHTML = renderVariantPicker(product, "product-0");

    const options = Array.from(root.querySelectorAll("option"));
    expect(options.map((option) => option.value)).toEqual([
      "gid://shopify/ProductVariant/11",
      "gid://shopify/ProductVariant/12",
    ]);
    expect(options[1].disabled).toBe(true);
    expect(options[1].textContent).toContain("Sold out");
    expect(resolveProductVariant(root, product, "product-0")?.id).toBe(
      "gid://shopify/ProductVariant/11",
    );
  });

  it("rejects a picker value that is not in the synced variant list", () => {
    const product = getProducts({ products: [productPayload().product] })[0];
    const root = document.createElement("div");
    root.innerHTML = `<select data-variant-picker="product-0"><option value="gid://shopify/ProductVariant/invented" selected>Fake</option></select>`;

    expect(resolveProductVariant(root, product, "product-0")?.id).toBe(
      "gid://shopify/ProductVariant/11",
    );
  });
});

function productPayload() {
  return {
    product: {
      id: "gid://shopify/Product/1",
      title: "Trail Board",
      handle: "trail-board",
      imageUrl: "",
      price: "499.00",
      variantId: "gid://shopify/ProductVariant/11",
      variants: [
        {
          id: "gid://shopify/ProductVariant/11",
          title: "Small / Blue",
          sku: "TRAIL-S-BLUE",
          price: "499.00",
          compareAtPrice: null,
          quantityAvailable: 4,
          availableForSale: true,
          selectedOptions: [
            { name: "Size", value: "Small" },
            { name: "Color", value: "Blue" },
          ],
        },
      ],
    },
  };
}
