import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogCacheProduct } from "./catalogCache.server";
const mocks = vi.hoisted(() => ({
  settings: vi.fn(),
  catalog: vi.fn(),
  fresh: vi.fn(),
  pick: vi.fn(),
  write: vi.fn(),
  relationships: vi.fn(),
  affinities: vi.fn(),
  owned: vi.fn(),
}));
vi.mock("../db.server", () => ({
  default: {
    appSettings: { findUnique: mocks.settings, upsert: mocks.write },
    offer: { create: mocks.write },
    shopperEvent: { create: mocks.write },
    shopperSession: { create: mocks.write },
    recommendationOutcome: { create: mocks.write },
    productRelationship: { findMany: mocks.relationships },
    productAffinity: { findMany: mocks.affinities },
    product: { findFirst: mocks.owned },
  },
}));
vi.mock("./catalogCache.server", () => ({
  getRecommendationCatalog: mocks.catalog,
  getCatalogProductsByIds: mocks.fresh,
  pickCatalogProducts: mocks.pick,
}));
import { getAdminOfferPreview } from "./offerPreview.server";

function product(
  n: number,
  overrides: Partial<CatalogCacheProduct> = {},
): CatalogCacheProduct {
  return {
    id: `gid://shopify/Product/${n}`,
    handle: `product-${n}`,
    title: `Product ${n}`,
    price: "12.00",
    compareAtPrice: null,
    imageUrl: null,
    tags: [],
    collectionIds: [],
    availableForSale: true,
    defaultVariantId: `gid://shopify/ProductVariant/${n + 100}`,
    variants: [
      {
        id: `gid://shopify/ProductVariant/${n + 100}`,
        title: "Default",
        price: "12.00",
        availableForSale: true,
        quantityAvailable: 8,
        sku: "test",
        compareAtPrice: null,
        selectedOptions: [],
      },
    ],
    metafields: {
      "aovboost.availableForSale": { value: "true" },
      "aovboost.defaultVariantId": {
        value: `gid://shopify/ProductVariant/${n + 100}`,
      },
      "aovboost.hasOnlyDefaultVariant": { value: "true" },
    },
    ...overrides,
  } as CatalogCacheProduct;
}
let products: CatalogCacheProduct[];
beforeEach(() => {
  vi.resetAllMocks();
  products = [product(1), product(2), product(3)];
  mocks.relationships.mockResolvedValue([]);
  mocks.affinities.mockResolvedValue([]);
  mocks.owned.mockResolvedValue({ id: products[0].id });
  mocks.settings.mockResolvedValue({
    blockedProductIds: [],
    excludedCollectionIds: [],
    maxProductRecommendations: 3,
  });
  mocks.catalog.mockImplementation(async () => ({
    shop: "one.myshopify.com",
    products,
    byId: Object.fromEntries(products.map((p) => [p.id, p])),
  }));
  mocks.pick.mockImplementation(({ catalog, sourceProductId, limit }) =>
    catalog.products
      .filter((p: CatalogCacheProduct) => p.id !== sourceProductId)
      .slice(0, limit),
  );
  mocks.fresh.mockImplementation(async (_shop, ids) =>
    products.filter((p) => ids.includes(p.id)),
  );
});

describe("read-only catalog preview", () => {
  it("renders verified real products without writes or raw inventory fields", async () => {
    const preview = await getAdminOfferPreview("one.myshopify.com");
    expect(preview.source?.id).toBe(products[0].id);
    expect(preview.products.map(({ id }) => id)).toEqual([
      products[1].id,
      products[2].id,
    ]);
    expect(mocks.catalog).toHaveBeenCalledWith({
      shop: "one.myshopify.com",
      sourceProductId: undefined,
    });
    for (const [shop] of mocks.fresh.mock.calls)
      expect(shop).toBe("one.myshopify.com");
    expect(mocks.settings.mock.calls[0][0].where).toEqual({
      shop: "one.myshopify.com",
    });
    expect(mocks.write).not.toHaveBeenCalled();
    expect(JSON.stringify(preview)).not.toMatch(
      /unitCost|margin|inventory|quantityAvailable|metafields/,
    );
  });
  it("honors blocked products and excluded collections", async () => {
    products.push(
      product(4, { collectionIds: ["gid://shopify/Collection/7"] }),
    );
    mocks.settings.mockResolvedValue({
      blockedProductIds: [products[1].id],
      excludedCollectionIds: ["gid://shopify/Collection/7"],
      maxProductRecommendations: 3,
    });
    const preview = await getAdminOfferPreview("one.myshopify.com");
    expect(preview.products.map(({ id }) => id)).toEqual([products[2].id]);
    expect(preview.sources.map(({ id }) => id)).toEqual([
      products[0].id,
      products[2].id,
    ]);
  });
  it("drops products that became unavailable since the catalog cache was filled", async () => {
    mocks.fresh.mockImplementation(async (_shop, ids) =>
      products
        .filter((p) => ids.includes(p.id))
        .map((p) =>
          p.id === products[1].id ? { ...p, availableForSale: false } : p,
        ),
    );
    expect(
      (await getAdminOfferPreview("one.myshopify.com")).products.map(
        ({ id }) => id,
      ),
    ).toEqual([products[2].id]);
  });
  it("cannot preview an ID absent from the authenticated shop's catalog", async () => {
    const preview = await getAdminOfferPreview(
      "one.myshopify.com",
      "gid://shopify/Product/999",
    );
    expect(preview.source).toBeNull();
    expect(preview.products).toEqual([]);
    expect(mocks.fresh).not.toHaveBeenCalled();
  });
  it("handles empty and single-product catalogs without inventing an offer", async () => {
    products = [];
    expect((await getAdminOfferPreview("one.myshopify.com")).products).toEqual(
      [],
    );
    products = [product(1)];
    expect((await getAdminOfferPreview("one.myshopify.com")).products).toEqual(
      [],
    );
  });
});
