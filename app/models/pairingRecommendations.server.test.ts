import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogCacheProduct } from "./catalogCache.server";
import type { OfferCandidate, OfferDecision } from "../ai/types";
const mocks = vi.hoisted(() => ({
  products: [] as any[],
  catalogIds: [] as string[],
  rows: [] as any[],
  orderRows: [] as any[],
  relationships: vi.fn(),
  affinity: vi.fn(),
  owned: vi.fn(),
  catalog: vi.fn(),
  fresh: vi.fn(),
  pick: vi.fn(),
}));
vi.mock("../db.server", () => ({
  default: {
    productRelationship: { findMany: mocks.relationships },
    productAffinity: { findMany: mocks.affinity },
    product: { findFirst: mocks.owned },
  },
}));
vi.mock("./catalogCache.server", () => ({
  getRecommendationCatalog: mocks.catalog,
  getCatalogProductsByIds: mocks.fresh,
  pickCatalogProducts: mocks.pick,
}));
import {
  cachedProductsMatchCandidates,
  enforcePairingDecisionPolicy,
  pairingDeniedTargets,
  selectPairingRecommendations,
} from "./pairingRecommendations.server";
const shop = "one.myshopify.com";
const gid = (id: number) => `gid://shopify/Product/${id}`;
const rules = {
  pairingMode: "autopilot",
  blockedProductIds: [] as string[],
  excludedCollectionIds: [] as string[],
  preferredProductIds: [] as string[],
  upsellPriorityProductIds: [] as string[],
};
function product(id: number, extra: Record<string, unknown> = {}) {
  return {
    shop,
    id: gid(id),
    title: `Product ${id}`,
    handle: `product-${id}`,
    name: `Product ${id}`,
    description: "",
    category: "category",
    vendor: "Brand",
    productType: "",
    tags: [],
    collectionIds: [],
    price: "20.00",
    compareAtPrice: null,
    imageUrl: null,
    availableForSale: true,
    defaultVariantId: `gid://shopify/ProductVariant/${id + 100}`,
    inventory: 17,
    variants: [
      {
        id: `gid://shopify/ProductVariant/${id + 100}`,
        title: "Default",
        price: "20.00",
        availableForSale: true,
        quantityAvailable: 17,
        selectedOptions: [],
        sku: "",
        compareAtPrice: null,
      },
    ],
    metafields: {
      "aovboost.availableForSale": { value: "true" },
      "aovboost.hasOnlyDefaultVariant": { value: "true" },
      "aovboost.defaultVariantId": {
        value: `gid://shopify/ProductVariant/${id + 100}`,
      },
    },
    ...extra,
  } as unknown as CatalogCacheProduct & { shop: string };
}
function pair(
  target: number,
  status = "approved",
  kind = "complement",
  extra: Record<string, unknown> = {},
) {
  return {
    id: `${target}-${kind}`,
    shop,
    sourceProductId: gid(1),
    targetProductId: gid(target),
    kind,
    status,
    position: 0,
    confidence: 0.99,
    origin: "ai",
    reason: "Merchant approved reason",
    createdAt: new Date(0),
    ...extra,
  };
}
function decision(products: unknown[]): OfferDecision {
  return {
    widgetType: "upsell_drawer",
    payload: { products },
    reasoning: "selected",
    confidence: 1,
    aiProvider: "heuristic",
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.products = [1, 2, 3, 4, 5, 6].map((id) => product(id));
  mocks.catalogIds = mocks.products.map(({ id }) => id);
  mocks.rows = [];
  mocks.orderRows = [];
  mocks.owned.mockImplementation(
    async ({ where }) =>
      mocks.products.find((p) => p.shop === where.shop && p.id === where.id) ||
      null,
  );
  mocks.catalog.mockImplementation(async ({ shop }) => {
    const products = mocks.products.filter(
      (p) => p.shop === shop && mocks.catalogIds.includes(p.id),
    );
    return {
      products,
      byId: Object.fromEntries(products.map((p) => [p.id, p])),
      productCount: products.length,
    };
  });
  mocks.pick.mockImplementation(
    ({
      catalog,
      sourceProductId,
      cartProductIds = [],
      excludeProductIds = [],
      limit,
    }) =>
      catalog.products
        .filter(
          (p: any) =>
            p.id !== sourceProductId &&
            !cartProductIds.includes(p.id) &&
            !excludeProductIds.includes(p.id),
        )
        .slice(0, limit),
  );
  mocks.fresh.mockImplementation(async (shop, ids) =>
    mocks.products.filter(
      (p) => p.shop === shop && ids.includes(p.id) && p.availableForSale,
    ),
  );
  mocks.relationships.mockImplementation(async ({ where, take }) =>
    mocks.rows
      .filter((row) => {
        const source =
          typeof where.sourceProductId === "string"
            ? row.sourceProductId === where.sourceProductId
            : where.sourceProductId.in.includes(row.sourceProductId);
        const kind =
          typeof where.kind === "string"
            ? row.kind === where.kind
            : !where.kind || where.kind.in.includes(row.kind);
        return (
          row.shop === where.shop &&
          source &&
          kind &&
          (!where.status ||
            (typeof where.status === "string"
              ? row.status === where.status
              : where.status.in.includes(row.status))) &&
          (!where.OR ||
            where.OR.some(
              (clause: any) =>
                (!clause.kind || clause.kind === row.kind) &&
                (!clause.status || clause.status.in.includes(row.status)),
            )) &&
          (!where.targetProductId?.in ||
            where.targetProductId.in.includes(row.targetProductId))
        );
      })
      .slice(0, take),
  );
  mocks.affinity.mockImplementation(async ({ where, take }) =>
    mocks.orderRows
      .filter(
        (row) =>
          row.shop === where.shop &&
          row.sourceId === where.sourceId &&
          row.orderCount > 0 &&
          row.score > 0,
      )
      .slice(0, take),
  );
});
const select = (extra = {}) =>
  selectPairingRecommendations({
    shop,
    sourceProductId: gid(1),
    settings: rules,
    ...extra,
  });

describe("approved complement precedence", () => {
  it("serves merchant then autopilot then affinity, and suppresses autopilot when switched off", async () => {
    mocks.rows = [
      pair(3, "auto_approved", "complement", { reasonCode: "same_brand" }),
      pair(4),
    ];
    mocks.orderRows = [
      { shop, sourceId: gid(1), targetId: gid(5), score: 1, orderCount: 10 },
    ];
    expect((await select()).map(({ tier }) => tier).slice(0, 3)).toEqual([
      "approved",
      "auto_approved",
      "copurchase",
    ]);
    expect(
      (await select({ settings: { ...rules, pairingMode: "off" } })).map(
        ({ product }) => product.id,
      ),
    ).not.toContain(gid(3));
  });
  it("does not serve a suggested relationship as approved but permits independently verified affinity", async () => {
    mocks.rows = [pair(2, "suggested")];
    mocks.orderRows = [
      { shop, sourceId: gid(1), targetId: gid(2), score: 1, orderCount: 10 },
    ];
    expect((await select())[0]).toMatchObject({
      tier: "copurchase",
      product: { id: gid(2) },
    });
  });
  it("orders approved complements before verified co-purchases and catalog fallback", async () => {
    mocks.catalogIds = [gid(1), gid(2), gid(3)];
    mocks.rows = [pair(5)];
    mocks.orderRows = [
      { shop, sourceId: gid(1), targetId: gid(4), score: 0.9, orderCount: 4 },
    ];
    const rows = await select({ limit: 3 });
    expect(rows.map(({ product }) => product.id)).toEqual([
      gid(5),
      gid(4),
      gid(2),
    ]);
    expect(rows.map(({ tier }) => tier)).toEqual([
      "approved",
      "copurchase",
      "catalog",
    ]);
    expect(rows[0].reason).toBe("Selected by this store to go together.");
    expect(mocks.affinity.mock.calls[0][0].where).toMatchObject({
      shop,
      orderCount: { gt: 0 },
    });
  });
  it("does not treat a catalog-only affinity as verified co-purchase evidence", async () => {
    mocks.orderRows = [
      { shop, sourceId: gid(1), targetId: gid(2), score: 0.99, orderCount: 0 },
    ];
    expect((await select()).every(({ tier }) => tier === "catalog")).toBe(true);
  });
  it.each(["demoted", "rejected"])(
    "does not leak a %s pair through affinity or fallback",
    async (status) => {
      mocks.rows = [pair(2, status)];
      mocks.orderRows = [
        { shop, sourceId: gid(1), targetId: gid(2), score: 1, orderCount: 9 },
      ];
      expect((await select()).map(({ product }) => product.id)).not.toContain(
        gid(2),
      );
    },
  );
  it("lets an exclusion win over an approved complement regardless of exclusion status", async () => {
    mocks.rows = [pair(2), pair(2, "rejected", "exclude")];
    expect((await select()).map(({ product }) => product.id)).not.toContain(
      gid(2),
    );
  });
  it("honors exclusions from another product already in the cart", async () => {
    mocks.rows = [
      pair(2),
      pair(2, "approved", "exclude", { sourceProductId: gid(3) }),
    ];
    expect(
      (await select({ cartProductIds: [gid(1), gid(3)] })).map(
        ({ product }) => product.id,
      ),
    ).not.toContain(gid(2));
  });
  it("never serves an upgrade as a replacement or independent fallback pairing", async () => {
    mocks.rows = [pair(2, "approved", "upgrade")];
    expect((await select()).map(({ product }) => product.id)).not.toContain(
      gid(2),
    );
  });
  it("keeps blocked products, excluded collections, unavailable products and cart items out", async () => {
    mocks.rows = [pair(2)];
    mocks.products[1].availableForSale = false;
    mocks.products[2].collectionIds = ["excluded-collection"];
    const rows = await select({
      cartProductIds: [gid(4)],
      settings: {
        ...rules,
        blockedProductIds: [gid(5)],
        excludedCollectionIds: ["excluded-collection"],
      },
    });
    expect(rows.map(({ product }) => product.id)).toEqual([gid(6)]);
  });
  it("never reads another tenant's relationship or same-ID product", async () => {
    mocks.rows = [
      pair(2, "approved", "complement", { shop: "other.myshopify.com" }),
    ];
    mocks.products.unshift(
      product(2, { shop: "other.myshopify.com", price: "999.00" }),
    );
    const rows = await select();
    expect(rows[0].tier).toBe("catalog");
    expect(rows[0].product.price).toBe("20.00");
    for (const [query] of mocks.relationships.mock.calls)
      expect(query.where.shop).toBe(shop);
    for (const [tenant, ids] of mocks.fresh.mock.calls) {
      expect(tenant).toBe(shop);
      expect(ids.length).toBeLessThanOrEqual(100);
    }
    mocks.owned.mockResolvedValueOnce(null);
    expect(await select()).toEqual([]);
  });
  it("fails closed rather than ignoring exclusions on an oversized cart context", async () => {
    expect(
      await select({
        cartProductIds: Array.from({ length: 101 }, (_, n) => gid(n + 200)),
      }),
    ).toEqual([]);
  });
});

describe("last-mile pairing and cache guards", () => {
  it("withholds autopilot when its current evidence or stricter threshold no longer supports approval", async () => {
    mocks.rows = [
      pair(2, "auto_approved", "complement", {
        reasonCode: "same_collection_set",
      }),
    ];
    const request = {
      shop,
      sourceProductId: gid(1),
      settings: rules,
      decision: decision([{ productId: gid(2) }]),
    };
    expect((await enforcePairingDecisionPolicy(request)).widgetType).toBeNull();
    mocks.rows = [
      pair(2, "auto_approved", "complement", {
        reasonCode: "same_brand",
        confidence: 0.91,
      }),
    ];
    expect(
      (
        await enforcePairingDecisionPolicy({
          ...request,
          settings: { ...rules, pairingStrictness: "cautious" },
        })
      ).widgetType,
    ).toBeNull();
  });
  it("revalidates cached autopilot against current sensitive text and only permits explicit merchant overrides", async () => {
    mocks.rows = [
      pair(2, "auto_approved", "complement", { reasonCode: "same_brand" }),
    ];
    mocks.products[1].metafields["aovboost.description"] = {
      value: "A scalp treatment",
    };
    const input = {
      shop,
      sourceProductId: gid(1),
      settings: rules,
      decision: decision([{ productId: gid(2), reason: "Cures dry scalp" }]),
    };
    expect((await enforcePairingDecisionPolicy(input)).widgetType).toBeNull();
    mocks.rows = [pair(2)];
    const safe = await enforcePairingDecisionPolicy(input);
    expect(safe.widgetType).toBe("upsell_drawer");
    expect(JSON.stringify(safe)).not.toMatch(
      /Cures|Merchant approved reason|confidence.*origin/,
    );
    expect(safe.payload.copy).toMatchObject({
      headline: "Selected by this store to go together.",
    });
  });
  it("drops cached or model-selected rejected targets and rehydrates verified prices", async () => {
    mocks.rows = [pair(2, "rejected")];
    const result = await enforcePairingDecisionPolicy({
      shop,
      sourceProductId: gid(1),
      settings: rules,
      decision: decision([
        { productId: gid(2), price: "0.01" },
        { productId: gid(3), product: { id: gid(3), price: "0.01" } },
        { productId: gid(999) },
      ]),
    });
    const products = result.payload.products as any[];
    expect(products.map((p) => p.productId)).toEqual([gid(3)]);
    expect(products[0].product.price).toBe("20.00");
    expect(JSON.stringify(result)).not.toMatch(
      /quantityAvailable|inventory|unitCost|margin/,
    );
  });
  it("suppresses a bundle with an excluded item instead of changing its discount contents", async () => {
    mocks.rows = [pair(2, "approved", "exclude")];
    const result = await enforcePairingDecisionPolicy({
      shop,
      sourceProductId: gid(1),
      settings: rules,
      decision: {
        ...decision([]),
        widgetType: "bundle",
        payload: {
          bundle: {
            id: "bundle",
            items: [{ productId: gid(1) }, { productId: gid(2) }],
          },
          products: [{ productId: gid(1) }, { productId: gid(2) }],
        },
      },
    });
    expect(result.widgetType).toBeNull();
    expect(result.payload).toEqual({});
  });
  it("invalidates cached products when approval order or merchant reasons change", () => {
    const candidate = {
      id: gid(2),
      productId: gid(2),
      type: "product",
      widgetType: "upsell_drawer",
      title: "Target",
      score: 1,
      payload: { affinity: { reason: "New approved reason" } },
    } as OfferCandidate;
    expect(
      cachedProductsMatchCandidates(
        decision([{ productId: gid(2), reason: "Old reason" }]),
        [candidate],
      ),
    ).toBe(false);
    expect(
      cachedProductsMatchCandidates(
        decision([{ productId: gid(3), reason: "New approved reason" }]),
        [candidate],
      ),
    ).toBe(false);
    expect(
      cachedProductsMatchCandidates(
        decision([{ productId: gid(2), reason: "New approved reason" }]),
        [candidate],
      ),
    ).toBe(true);
  });
  it("keeps legacy upgrades and exclusions denied even beside an approved complement", () => {
    expect(
      pairingDeniedTargets([pair(2, "suggested", "upgrade"), pair(2)], []).size,
    ).toBe(1);
    expect(
      pairingDeniedTargets([pair(2)], [pair(2, "approved", "exclude")]).has(
        gid(2),
      ),
    ).toBe(true);
  });
});
