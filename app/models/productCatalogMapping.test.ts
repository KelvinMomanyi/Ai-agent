import { describe, expect, it } from "vitest";
import {
  getSafeDefaultVariantId,
  mapAdminCatalogProductNode,
  mapProductWebhook,
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

  it("keeps multi-option products discoverable without auto-selecting a variant", () => {
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
    expect(getSafeDefaultVariantId(product?.metafields)).toBe("");
  });

  it("rejects products that are hidden or have no sellable variants", () => {
    expect(
      mapAdminCatalogProductNode(adminProduct({ onlineStoreUrl: null })),
    ).toBeNull();
    expect(
      mapAdminCatalogProductNode(
        adminProduct({
          variants: [adminVariant({ sellableOnlineQuantity: 0 })],
        }),
      ),
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
    expect(getSafeDefaultVariantId(product?.metafields)).toBe(
      "gid://shopify/ProductVariant/201",
    );

    expect(mapProductWebhook({ ...base, published_at: null })).toBeNull();
    expect(
      mapProductWebhook({
        ...base,
        variants: [
          {
            ...base.variants[0],
            inventory_quantity: 0,
          },
        ],
      }),
    ).toBeNull();
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
    variants: { edges: variants.map((node) => ({ node })) },
    collections: { edges: [] },
    metafields: { edges: [] },
    ...overrides,
    ...(overrides.variants
      ? {
          variants: {
            edges: (overrides.variants as Array<Record<string, unknown>>).map(
              (node) => ({ node }),
            ),
          },
        }
      : {}),
  };
}

function adminVariant(overrides: Record<string, unknown> = {}) {
  return {
    id: "gid://shopify/ProductVariant/11",
    price: "499.00",
    compareAtPrice: null,
    inventoryPolicy: "DENY",
    sellableOnlineQuantity: 4,
    ...overrides,
  };
}
