import { describe, expect, it } from "vitest";
import {
  pickCatalogProducts,
  type CatalogCacheProduct,
  type CatalogSnapshot,
} from "./catalogCache.server";

describe("chat catalog retrieval", () => {
  it("prioritizes exact product facts over incidental description matches", () => {
    const exact = product({
      id: "gid://shopify/Product/1",
      title: "Trail Board",
      handle: "trail-board",
    });
    const incidental = product({
      id: "gid://shopify/Product/2",
      title: "Repair Kit",
      handle: "repair-kit",
      description: "A repair kit for every trail board.",
    });

    expect(
      pickCatalogProducts({
        catalog: snapshot([incidental, exact]),
        query: "Do you have the Trail Board?",
        limit: 2,
      }).map((item) => item.id),
    ).toEqual([exact.id, incidental.id]);
  });

  it("keeps current and cart products in chat context when requested", () => {
    const current = product({ id: "current", title: "Current Item" });
    const cart = product({ id: "cart", title: "Cart Item" });
    const match = product({ id: "match", title: "Rain Jacket" });

    expect(
      pickCatalogProducts({
        catalog: snapshot([match, current, cart]),
        sourceProductId: current.id,
        cartProductIds: [cart.id],
        includeContextProducts: true,
        query: "rain jacket",
        limit: 3,
      }).map((item) => item.id),
    ).toEqual([current.id, cart.id, match.id]);
  });

  it("keeps retrieval bounded for a large catalog", () => {
    const products = Array.from({ length: 500 }, (_, index) =>
      product({
        id: `gid://shopify/Product/${index + 1}`,
        handle: `item-${index + 1}`,
        title: index === 347 ? "Blue Hiking Hoodie" : `Store Item ${index + 1}`,
        tags: index === 347 ? ["blue", "hiking", "hoodie"] : [],
      }),
    );

    const matches = pickCatalogProducts({
      catalog: snapshot(products),
      query: "Show me a blue hiking hoodie",
      limit: 12,
    });

    expect(matches).toHaveLength(12);
    expect(matches[0].title).toBe("Blue Hiking Hoodie");
  });
});

function snapshot(products: CatalogCacheProduct[]): CatalogSnapshot {
  return {
    shop: "example.myshopify.com",
    refreshedAt: "2026-08-16T00:00:00.000Z",
    productCount: products.length,
    products,
    byId: Object.fromEntries(products.map((item) => [item.id, item])),
    byCategory: {},
    byTag: {},
  };
}

function product(
  overrides: Partial<CatalogCacheProduct> = {},
): CatalogCacheProduct {
  return {
    id: "product",
    handle: "product",
    title: "Product",
    name: "Product",
    description: "",
    vendor: "",
    productType: "",
    category: "uncategorized",
    tags: [],
    price: "100",
    compareAtPrice: null,
    priceRegular: "100",
    priceSale: null,
    image: null,
    imageUrl: null,
    imageAlt: "Product",
    inventory: null,
    availableForSale: true,
    defaultVariantId: "",
    variants: [],
    searchText: "product",
    metafields: {},
    ...overrides,
  };
}
