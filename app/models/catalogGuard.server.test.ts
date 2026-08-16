import { describe, expect, it } from "vitest";
import type { CatalogCacheProduct } from "./catalogCache.server";
import {
  catalogProductToWidgetProduct,
  filterCatalogProducts,
  sanitizeAssistantReplyToCatalog,
} from "./catalogGuard.server";

describe("chat catalog guard", () => {
  it("replaces invented product links with a catalog-backed fallback", () => {
    const catalog = [catalogProduct()];
    const fallback = "Trail Board (KSh499.00) /products/trail-board";

    expect(
      sanitizeAssistantReplyToCatalog({
        reply: "Try the Rocket Board /products/rocket-board",
        userMessage: "Recommend a board",
        messageIntent: "general",
        catalog,
        fallback,
      }),
    ).toBe(fallback);
  });

  it("requires a real product link when the shopper asks for recommendations", () => {
    const fallback = "Trail Board (KSh499.00) /products/trail-board";

    expect(
      sanitizeAssistantReplyToCatalog({
        reply: "A trail board would be a good fit.",
        userMessage: "Show me something for trails",
        messageIntent: "general",
        catalog: [catalogProduct()],
        fallback,
      }),
    ).toBe(fallback);
  });

  it("filters blocked and unavailable products before chat sees them", () => {
    const available = catalogProduct();
    const unavailable = catalogProduct({
      id: "gid://shopify/Product/2",
      handle: "sold-out-board",
      availableForSale: false,
      metafields: {
        "aovboost.availableForSale": { value: "false", type: "boolean" },
      },
    });

    expect(filterCatalogProducts([available, unavailable])).toEqual([
      available,
    ]);
    expect(filterCatalogProducts([available], [available.id])).toEqual([]);
    expect(filterCatalogProducts([available], ["1"])).toEqual([]);
  });

  it("does not force product links into store-policy answers", () => {
    expect(
      sanitizeAssistantReplyToCatalog({
        reply: "Returns are covered by the store's published refund policy.",
        userMessage: "What is your return policy?",
        messageIntent: "returns_policy",
        catalog: [catalogProduct()],
        fallback: "fallback",
      }),
    ).toBe("Returns are covered by the store's published refund policy.");
  });

  it("exposes only canonical variants and selects a real in-stock default", () => {
    const product = catalogProduct({
      defaultVariantId: "gid://shopify/ProductVariant/11",
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
        {
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
        },
      ],
      metafields: {
        "aovboost.availableForSale": { value: "true", type: "boolean" },
        "aovboost.hasOnlyDefaultVariant": {
          value: "false",
          type: "boolean",
        },
        "aovboost.defaultVariantId": {
          value: "gid://shopify/ProductVariant/11",
          type: "single_line_text_field",
        },
      },
    });

    const widgetProduct = catalogProductToWidgetProduct(product);
    expect(widgetProduct.variantId).toBe("gid://shopify/ProductVariant/11");
    expect(widgetProduct.variants.map((variant) => variant.id)).toEqual([
      "gid://shopify/ProductVariant/11",
      "gid://shopify/ProductVariant/12",
    ]);
  });
});

function catalogProduct(
  overrides: Partial<CatalogCacheProduct> = {},
): CatalogCacheProduct {
  return {
    id: "gid://shopify/Product/1",
    handle: "trail-board",
    title: "Trail Board",
    name: "Trail Board",
    description: "A board for trail riding",
    vendor: "AOVBoost",
    productType: "Snowboard",
    category: "Snowboard",
    tags: ["trail"],
    price: "499.00",
    compareAtPrice: null,
    priceRegular: "499.00",
    priceSale: null,
    image: null,
    imageUrl: null,
    imageAlt: "Trail Board",
    inventory: 4,
    availableForSale: true,
    defaultVariantId: "gid://shopify/ProductVariant/11",
    variants: [
      {
        id: "gid://shopify/ProductVariant/11",
        title: "Default",
        sku: "TRAIL-1",
        price: "499.00",
        compareAtPrice: null,
        quantityAvailable: 4,
        availableForSale: true,
        selectedOptions: [],
      },
    ],
    searchText: "trail board snowboard",
    metafields: {
      "aovboost.availableForSale": { value: "true", type: "boolean" },
      "aovboost.hasOnlyDefaultVariant": {
        value: "true",
        type: "boolean",
      },
      "aovboost.defaultVariantId": {
        value: "gid://shopify/ProductVariant/11",
        type: "single_line_text_field",
      },
    },
    ...overrides,
  };
}
