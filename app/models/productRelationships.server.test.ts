import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  rows: [] as any[],
  products: [] as any[],
  findFirst: vi.fn(),
  findMany: vi.fn(),
  productFind: vi.fn(),
  stats: vi.fn(),
  update: vi.fn(),
  upsert: vi.fn(),
  remove: vi.fn(),
  transaction: vi.fn(),
  settings: vi.fn(),
  fresh: vi.fn(),
}));
vi.mock("../db.server", () => ({
  default: {
    productRelationship: {
      findFirst: mocks.findFirst,
      findMany: mocks.findMany,
      updateMany: mocks.update,
      upsert: mocks.upsert,
      deleteMany: mocks.remove,
    },
    product: { findMany: mocks.productFind },
    productOrderStat: { findMany: mocks.stats },
    appSettings: { findUnique: mocks.settings },
    $transaction: mocks.transaction,
  },
}));
vi.mock("./catalogCache.server", () => ({
  getCatalogProductsByIds: mocks.fresh,
}));
import {
  bulkApprovePairings,
  changeRelationshipStatus,
  removePairingExclusion,
  saveMerchantPair,
  topPairingProducts,
  undoPairingRejection,
} from "./productRelationships.server";
const shop = "one.myshopify.com";
const gid = (n: number) => `gid://shopify/Product/${n}`;
function matches(row: any, where: any) {
  return (
    row.shop === where.shop &&
    (!where.id ||
      (typeof where.id === "string"
        ? row.id === where.id
        : where.id.in.includes(row.id))) &&
    (!where.sourceProductId ||
      (typeof where.sourceProductId === "string"
        ? row.sourceProductId === where.sourceProductId
        : where.sourceProductId.in.includes(row.sourceProductId))) &&
    (!where.targetProductId ||
      (typeof where.targetProductId === "string"
        ? row.targetProductId === where.targetProductId
        : where.targetProductId.in.includes(row.targetProductId))) &&
    (!where.kind ||
      (typeof where.kind === "string"
        ? row.kind === where.kind
        : where.kind.in
          ? where.kind.in.includes(row.kind)
          : row.kind !== where.kind.not)) &&
    (!where.status || row.status === where.status) &&
    (!where.confidence || row.confidence >= where.confidence.gte)
  );
}
function row(id: string, target: number, extra = {}) {
  return {
    id,
    shop,
    sourceProductId: gid(1),
    targetProductId: gid(target),
    kind: "complement",
    status: "suggested",
    confidence: 0.9,
    ...extra,
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.rows = [];
  mocks.products = [1, 2, 3].map((n) => ({
    id: gid(n),
    shop,
    title: `Product ${n}`,
    imageUrl: null,
    collectionIds: [],
    availableForSale: true,
    metafields: { "aovboost.availableForSale": { value: "true" } },
  }));
  mocks.productFind.mockImplementation(async ({ where, take }) =>
    mocks.products
      .filter(
        (p) =>
          p.shop === where.shop &&
          (!where.id?.in || where.id.in.includes(p.id)) &&
          (!where.id?.notIn || !where.id.notIn.includes(p.id)),
      )
      .slice(0, take),
  );
  mocks.stats.mockResolvedValue([
    { productId: gid(1), product: mocks.products[0], orderCount: 12 },
  ]);
  mocks.findFirst.mockImplementation(
    async ({ where }) => mocks.rows.find((r) => matches(r, where)) || null,
  );
  mocks.findMany.mockImplementation(async ({ where, take }) =>
    mocks.rows.filter((r) => matches(r, where)).slice(0, take),
  );
  mocks.update.mockImplementation(async ({ where, data }) => {
    let count = 0;
    for (const row of mocks.rows)
      if (matches(row, where)) {
        Object.assign(row, data);
        count++;
      }
    return { count };
  });
  mocks.upsert.mockImplementation(async ({ where, create, update }) => {
    const key = where.shop_sourceProductId_targetProductId_kind;
    const existing = mocks.rows.find(
      (r) =>
        r.shop === key.shop &&
        r.sourceProductId === key.sourceProductId &&
        r.targetProductId === key.targetProductId &&
        r.kind === key.kind,
    );
    if (existing) {
      Object.assign(existing, update);
      return existing;
    }
    const value = { id: "new-pair", ...create };
    mocks.rows.push(value);
    return value;
  });
  mocks.remove.mockImplementation(async ({ where }) => {
    const length = mocks.rows.length;
    mocks.rows = mocks.rows.filter((r) => !matches(r, where));
    return { count: length - mocks.rows.length };
  });
  mocks.transaction.mockImplementation((fn) =>
    fn({
      productRelationship: {
        findFirst: mocks.findFirst,
        updateMany: mocks.update,
        upsert: mocks.upsert,
      },
    }),
  );
  mocks.settings.mockResolvedValue({
    blockedProductIds: [],
    excludedCollectionIds: [],
  });
  mocks.fresh.mockImplementation(async (tenant, ids) =>
    mocks.products.filter((p) => p.shop === tenant && ids.includes(p.id)),
  );
});
describe("undo merchant rejection", () => {
  it("restores only the recorded prior status and keeps exclusions authoritative", async () => {
    mocks.rows = [row("auto", 2, { status: "auto_approved", origin: "ai" })];
    await changeRelationshipStatus(shop, "auto", "rejected");
    expect(mocks.rows[0]).toMatchObject({
      status: "rejected",
      previousStatus: "auto_approved",
    });
    await undoPairingRejection(shop, "auto");
    expect(mocks.rows[0]).toMatchObject({
      status: "auto_approved",
      previousStatus: null,
    });
    await changeRelationshipStatus(shop, "auto", "rejected");
    mocks.rows.push(row("excluded", 2, { kind: "exclude" }));
    await expect(undoPairingRejection(shop, "auto")).rejects.toThrow(
      /exclusion/i,
    );
    await expect(
      undoPairingRejection("other.myshopify.com", "auto"),
    ).rejects.toThrow(/not found/i);
  });
});

describe("merchant pairing decisions", () => {
  it("creates an explicitly approved manual complement for two owned products", async () => {
    await saveMerchantPair({
      shop,
      sourceProductId: gid(1),
      targetProductId: gid(2),
    });
    expect(mocks.rows[0]).toMatchObject({
      shop,
      kind: "complement",
      status: "approved",
      origin: "merchant",
    });
    expect(mocks.productFind.mock.calls[0][0].where.shop).toBe(shop);
  });
  it("rejects self-pairs and products outside the authenticated shop", async () => {
    await expect(
      saveMerchantPair({
        shop,
        sourceProductId: gid(1),
        targetProductId: gid(1),
      }),
    ).rejects.toThrow("different target");
    await expect(
      saveMerchantPair({
        shop,
        sourceProductId: gid(1),
        targetProductId: gid(99),
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("approves/rejects only the tenant's own rows", async () => {
    mocks.rows = [
      row("ours", 2),
      row("theirs", 3, { shop: "other.myshopify.com" }),
    ];
    await changeRelationshipStatus(shop, "ours", "approved");
    expect(mocks.rows[0].status).toBe("approved");
    await changeRelationshipStatus(shop, "ours", "rejected");
    expect(mocks.rows[0].status).toBe("rejected");
    await expect(
      changeRelationshipStatus(shop, "theirs", "approved"),
    ).rejects.toMatchObject({ status: 404 });
    expect(mocks.rows[1].status).toBe("suggested");
  });
  it("excludes a target and rejects existing positive relationships atomically", async () => {
    mocks.rows = [row("old", 2, { status: "approved" })];
    await saveMerchantPair({
      shop,
      sourceProductId: gid(1),
      targetProductId: gid(2),
      exclude: true,
    });
    expect(mocks.rows[0].status).toBe("rejected");
    expect(mocks.rows.find((r) => r.kind === "exclude")).toMatchObject({
      status: "approved",
      origin: "merchant",
    });
    await expect(
      changeRelationshipStatus(shop, "old", "approved"),
    ).rejects.toMatchObject({ status: 409 });
    await removePairingExclusion(shop, "new-pair");
    expect(mocks.rows.some((r) => r.kind === "exclude")).toBe(false);
    expect(mocks.rows[0].status).toBe("rejected");
  });
  it("replaces a source pairing while preserving its rejection history", async () => {
    mocks.rows = [row("old", 2, { status: "approved" })];
    await saveMerchantPair({
      shop,
      sourceProductId: gid(1),
      targetProductId: gid(3),
      replaceId: "old",
    });
    expect(mocks.rows[0].status).toBe("rejected");
    expect(mocks.rows[1]).toMatchObject({
      targetProductId: gid(3),
      status: "approved",
    });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });
  it("requires an existing pairing to belong to that source before replacement", async () => {
    mocks.rows = [row("other-source", 2, { sourceProductId: gid(3) })];
    await expect(
      saveMerchantPair({
        shop,
        sourceProductId: gid(1),
        targetProductId: gid(2),
        replaceId: "other-source",
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("bulk approves strong suggestions only, respecting exclusions, stock and prior rejection", async () => {
    mocks.rows = [
      row("strong", 2),
      row("weak", 3, { confidence: 0.6 }),
      row("rejected", 3, { status: "rejected" }),
    ];
    expect(await bulkApprovePairings(shop)).toBe(1);
    expect(mocks.rows.map((r) => r.status)).toEqual([
      "approved",
      "suggested",
      "rejected",
    ]);
    mocks.rows = [
      row("denied", 2),
      row("exclude", 2, { kind: "exclude", status: "approved" }),
    ];
    expect(await bulkApprovePairings(shop)).toBe(0);
    mocks.rows = [row("unavailable", 2)];
    mocks.products[1].availableForSale = false;
    expect(await bulkApprovePairings(shop)).toBe(0);
  });
  it("puts recorded order leaders ahead of products with no orders and scopes search", async () => {
    const rows = await topPairingProducts(shop, "Conditioner");
    expect(rows[0].orderCount).toBe(12);
    expect(mocks.stats.mock.calls[0][0]).toMatchObject({
      where: { shop, product: { shop } },
      take: 50,
    });
    expect(mocks.productFind.mock.calls[0][0].where).toMatchObject({
      shop,
      OR: [
        { title: { contains: "Conditioner", mode: "insensitive" } },
        { vendor: { contains: "Conditioner", mode: "insensitive" } },
      ],
    });
  });
});
