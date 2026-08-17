import { describe, expect, it } from "vitest";
import {
  getSafeDefaultVariantId,
  getSyncedProductVariants,
  mapAdminCatalogProductNode,
  mapProductWebhook,
  selectDefaultVariant,
  summarizeCatalogReadiness,
} from "./productCatalogMapping";

describe("Shopify catalog safety mapping", () => {
  it("keeps a published, sellable single-variant product addable", () => {
    const product = mapAdminCatalogProductNode(
      adminProduct({
        hasOnlyDefaultVariant: true,
        variants: [adminVariant({ sellableOnlineQuantity: 8 })],
      }),
    );

    expect(product).not.toBeNull();
    expect(getSafeDefaultVariantId(product?.metafields)).toBe(
      "gid://shopify/ProductVariant/11",
    );
    expect(product?.metafields).toMatchObject({
      "aovboost.availableForSale": { value: "true" },
      "aovboost.hasOnlyDefaultVariant": { value: "true" },
      "aovboost.sellableOnlineQuantity": { value: "8" },
    });
  });

  it("stores every fetched variant and defaults to the first in-stock variant", () => {
    const product = mapAdminCatalogProductNode(
      adminProduct({
        hasOnlyDefaultVariant: false,
        variants: [
          adminVariant({ id: "gid://shopify/ProductVariant/11" }),
          adminVariant({ id: "gid://shopify/ProductVariant/12" }),
        ],
      }),
    );

    expect(product).not.toBeNull();
    expect(getSafeDefaultVariantId(product?.metafields)).toBe(
      "gid://shopify/ProductVariant/11",
    );
    expect(getSyncedProductVariants(product?.metafields)).toHaveLength(2);
  });

  it("prefers the most ordered in-stock variant as the direct-add default", () => {
    const product = mapAdminCatalogProductNode(
      adminProduct({
        hasOnlyDefaultVariant: false,
        variants: [
          adminVariant({ id: "gid://shopify/ProductVariant/11" }),
          adminVariant({
            id: "gid://shopify/ProductVariant/12",
            title: "Large / Blue",
            price: "549.00",
            selectedOptions: [
              { name: "Size", value: "Large" },
              { name: "Color", value: "Blue" },
            ],
          }),
        ],
      }),
      {
        variantOrderCounts: new Map([
          ["gid://shopify/ProductVariant/11", 2],
          ["gid://shopify/ProductVariant/12", 9],
        ]),
      },
    );

    expect(getSafeDefaultVariantId(product?.metafields)).toBe(
      "gid://shopify/ProductVariant/12",
    );
    expect(product?.price).toBe("549.00");
    expect(getSyncedProductVariants(product?.metafields)[1]).toMatchObject({
      title: "Large / Blue",
      selectedOptions: [
        { name: "Size", value: "Large" },
        { name: "Color", value: "Blue" },
      ],
    });
  });

  it("never chooses a sold-out popular variant over an in-stock variant", () => {
    const variants = [
      {
        id: "gid://shopify/ProductVariant/11",
        title: "Small",
        sku: "SMALL",
        price: "10.00",
        compareAtPrice: null,
        quantityAvailable: 2,
        availableForSale: true,
        selectedOptions: [{ name: "Size", value: "Small" }],
      },
      {
        id: "gid://shopify/ProductVariant/12",
        title: "Large",
        sku: "LARGE",
        price: "10.00",
        compareAtPrice: null,
        quantityAvailable: 0,
        availableForSale: false,
        selectedOptions: [{ name: "Size", value: "Large" }],
      },
    ];

    expect(
      selectDefaultVariant(
        variants,
        new Map([["gid://shopify/ProductVariant/12", 100]]),
      )?.id,
    ).toBe("gid://shopify/ProductVariant/11");
  });

  it("rejects products that are not published to the Online Store", () => {
    expect(
      mapAdminCatalogProductNode(adminProduct({ onlineStoreUrl: null })),
    ).toBeNull();
  });

  it("stores a plain-text product description and featured image for grounding", () => {
    const product = mapAdminCatalogProductNode(
      adminProduct({
        description: "A waterproof trail board with a bamboo core.",
        featuredMedia: {
          preview: { image: { url: "https://cdn.example.test/trail.jpg" } },
        },
      }),
    );

    expect(product?.imageUrl).toBe("https://cdn.example.test/trail.jpg");
    expect(product?.metafields).toMatchObject({
      "aovboost.description": {
        value: "A waterproof trail board with a bamboo core.",
      },
    });
  });

  it("caps stored variant JSON at 100 and records truncation", () => {
    const variants = Array.from({ length: 101 }, (_, index) =>
      adminVariant({ id: `gid://shopify/ProductVariant/${index + 1}` }),
    );
    const node = adminProduct({ variants });
    node.variants.pageInfo.hasNextPage = true;
    const product = mapAdminCatalogProductNode(node);

    expect(getSyncedProductVariants(product?.metafields)).toHaveLength(100);
    expect(product?.metafields).toMatchObject({
      "aovboost.variantsTruncated": { value: "true" },
    });
  });

  it("keeps zero-sellable products but marks them unavailable", () => {
    const product = mapAdminCatalogProductNode(
      adminProduct({
        variants: [adminVariant({ sellableOnlineQuantity: 0 })],
      }),
    );
    expect(product).not.toBeNull();
    expect(product?.metafields).toMatchObject({
      "aovboost.availableForSale": { value: "false" },
    });
  });

  it("rejects products with no variants at all", () => {
    expect(
      mapAdminCatalogProductNode(adminProduct({ variants: [] })),
    ).toBeNull();
  });

  it("honors continue-selling inventory policy", () => {
    const product = mapAdminCatalogProductNode(
      adminProduct({
        variants: [
          adminVariant({
            inventoryPolicy: "CONTINUE",
            sellableOnlineQuantity: 0,
          }),
        ],
      }),
    );

    expect(product).not.toBeNull();
  });

  it("applies the same rules to Shopify product webhooks", () => {
    const base = {
      id: 101,
      title: "Trail Board",
      handle: "trail-board",
      status: "active",
      published_at: "2026-08-04T00:00:00Z",
      body_html: "<p>Built for <strong>rocky trails</strong>.</p>",
      variants: [
        {
          id: 201,
          price: "499.00",
          inventory_management: "shopify",
          inventory_policy: "deny",
          inventory_quantity: 3,
        },
      ],
    };

    const product = mapProductWebhook(base);
    expect(product?.id).toBe("gid://shopify/Product/101");
    expect(product?.metafields).toMatchObject({
      "aovboost.description": { value: "Built for rocky trails." },
    });
    expect(getSafeDefaultVariantId(product?.metafields)).toBe(
      "gid://shopify/ProductVariant/201",
    );

    expect(mapProductWebhook({ ...base, published_at: null })).toBeNull();
    const unavailable = mapProductWebhook({
      ...base,
      variants: [
        {
          ...base.variants[0],
          inventory_quantity: 0,
        },
      ],
    });
    expect(unavailable?.metafields).toMatchObject({
      "aovboost.availableForSale": { value: "false" },
    });
  });

  it("flags legacy catalog rows without variant data for repair", () => {
    const legacyProduct = {
      metafields: {
        "aovboost.availableForSale": { value: "true", type: "boolean" },
      },
    };
    const currentProduct = mapAdminCatalogProductNode(adminProduct());

    expect(
      summarizeCatalogReadiness([
        legacyProduct,
        { metafields: currentProduct?.metafields || {} },
      ]),
    ).toMatchObject({
      storedProductCount: 2,
      availableProductCount: 2,
      actionableProductCount: 1,
      missingVariantDataCount: 1,
      resyncRequired: true,
    });
  });

  it("marks a fully variant-backed catalog ready for storefront actions", () => {
    const product = mapAdminCatalogProductNode(adminProduct());
    expect(
      summarizeCatalogReadiness([
        { metafields: product?.metafields || {} },
      ]),
    ).toMatchObject({
      storedProductCount: 1,
      actionableProductCount: 1,
      missingVariantDataCount: 0,
      resyncRequired: false,
    });
  });
});

function adminProduct(overrides: Record<string, unknown> = {}) {
  const variants = (overrides.variants as
    Array<Record<string, unknown>> | undefined) || [adminVariant()];
  return {
    id: "gid://shopify/Product/1",
    title: "Trail Board",
    handle: "trail-board",
    onlineStoreUrl: "https://example.test/products/trail-board",
    hasOnlyDefaultVariant: true,
    tags: ["trail"],
    variants: {
      edges: variants.map((node) => ({ node })),
      pageInfo: { hasNextPage: false },
    },
    collections: { edges: [] },
    metafields: { edges: [] },
    ...overrides,
    ...(overrides.variants
      ? {
          variants: {
            edges: (overrides.variants as Array<Record<string, unknown>>).map(
              (node) => ({ node }),
            ),
            pageInfo: { hasNextPage: false },
          },
        }
      : {}),
  };
}

function adminVariant(overrides: Record<string, unknown> = {}) {
  return {
    id: "gid://shopify/ProductVariant/11",
    title: "Medium / Black",
    sku: "TRAIL-M-BLK",
    price: "499.00",
    compareAtPrice: null,
    inventoryPolicy: "DENY",
    sellableOnlineQuantity: 4,
    selectedOptions: [
      { name: "Size", value: "Medium" },
      { name: "Color", value: "Black" },
    ],
    ...overrides,
  };
}
