import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  offer: null as any,
  events: [] as any[],
  offers: vi.fn(),
  offerUpdate: vi.fn(),
  eventFind: vi.fn(),
  relationFind: vi.fn(),
  relationUpdate: vi.fn(),
  query: vi.fn(),
  product: vi.fn(),
  settings: vi.fn(),
  affinity: vi.fn(),
  create: vi.fn(),
}));
vi.mock("../db.server", () => ({
  default: {
    offer: {
      findMany: mocks.offers,
      updateMany: mocks.offerUpdate,
      create: mocks.create,
    },
    shopperEvent: { findMany: mocks.eventFind },
    productRelationship: {
      findMany: mocks.relationFind,
      updateMany: mocks.relationUpdate,
    },
    product: { findFirst: mocks.product },
    appSettings: { findUnique: mocks.settings },
    productAffinity: { findMany: mocks.affinity },
    $queryRaw: mocks.query,
  },
}));
vi.mock("./commerceTransaction.server", async () => ({
  withCommerceTransaction: async (
    _namespace: string,
    _key: string,
    run: (tx: unknown) => unknown,
  ) => {
    const { default: db } = await import("../db.server");
    return run(db);
  },
}));
vi.mock("./bundle.server", () => ({ getActiveBundlesForProduct: vi.fn() }));
import {
  evaluatePairingPerformance,
  markPairingEventsPending,
  rollupPairingEvents,
} from "./pairingLearning.server";
import { capturePairingProvenance } from "./pairingProvenance.server";
import { createOfferRecord } from "./offer.server";
const shop = "one.myshopify.com",
  sourceId = "gid://shopify/Product/1",
  targetId = "gid://shopify/Product/2";
const settings = {
  pairingMode: "autopilot",
  pairingStrictness: "balanced",
  pairingSensitiveKeywords: [],
  blockedProductIds: [],
  excludedCollectionIds: [],
  verticalPreset: "generic",
};
const product = {
  id: sourceId,
  title: "Shampoo",
  vendor: "Brand",
  productType: "Shampoo",
  tags: [],
  collectionIds: [],
  price: "20",
  metafields: { "aovboost.availableForSale": { value: "true" } },
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.offer = {
    id: "offer",
    shop,
    sessionId: "signed-session",
    createdAt: new Date("2026-11-05T00:00:00Z"),
    pairingShownAt: null,
    pairingAcceptedIds: [],
    pairingRollupPending: true,
    pairingProvenance: [
      {
        relationshipId: "pair",
        sourceProductId: sourceId,
        targetProductId: targetId,
        origin: "autopilot",
        status: "auto_approved",
        confidence: 0.95,
        reasonCode: "same_brand",
        modelVersion: "synthetic",
      },
    ],
  };
  mocks.events = [
    {
      id: "visible",
      type: "widget_impression",
      createdAt: new Date("2026-11-05T00:00:01Z"),
      payload: { offerId: "offer" },
    },
    {
      id: "added",
      type: "recommendation_added",
      createdAt: new Date("2026-11-05T00:00:02Z"),
      payload: {
        offerId: "offer",
        productId: targetId,
        origin: "merchant",
        confidence: 1,
      },
    },
  ];
  mocks.offers.mockImplementation(async () =>
    mocks.offer.pairingRollupPending ? [mocks.offer] : [],
  );
  mocks.offerUpdate.mockImplementation(async ({ data }) => {
    Object.assign(mocks.offer, data);
    return { count: 1 };
  });
  mocks.eventFind.mockImplementation(async () => mocks.events);
  mocks.relationUpdate.mockResolvedValue({ count: 1 });
  mocks.relationFind.mockResolvedValue([]);
  mocks.query.mockImplementation(async (sql) =>
    sql.text.includes("percentile_cont")
      ? [{ peers: 6, medianLower: 0.2189 }]
      : [{ count: 20 }],
  );
  mocks.product.mockResolvedValue(product);
  mocks.settings.mockResolvedValue(settings);
  mocks.affinity.mockResolvedValue([]);
  mocks.create.mockImplementation(async ({ data }) => ({
    id: "stored",
    ...data,
  }));
});
describe("immutable served-pair provenance and learning", () => {
  it("uses the actual selected source and canonical IDs, and discards an old cached offer identity", async () => {
    await createOfferRecord({
      shop,
      sessionId: "signed-session",
      decision: {
        widgetType: "rec_strip",
        payload: {
          offerId: "previous-shopper",
          products: [{ productId: "2" }],
        },
        reasoning: "verified",
        confidence: 1,
        aiProvider: "heuristic",
      },
      triggerContext: {
        sourceProductId: "1",
        currentProductId: "gid://shopify/Product/999",
      },
    });
    expect(mocks.relationFind).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          shop,
          sourceProductId: sourceId,
          targetProductId: { in: [targetId] },
        },
      }),
    );
    const stored = mocks.create.mock.calls[0][0].data;
    expect(stored.pairingProvenance[0]).toMatchObject({
      sourceProductId: sourceId,
      targetProductId: targetId,
      origin: "catalog",
    });
    expect(stored.payload).not.toHaveProperty("offerId");
  });
  it("counts a displayed pair and a confirmed product add once across replayed event batches", async () => {
    await rollupPairingEvents(shop);
    expect(mocks.relationUpdate).toHaveBeenCalledWith({
      where: {
        shop,
        id: "pair",
        sourceProductId: sourceId,
        targetProductId: targetId,
      },
      data: { shownCount: { increment: 1 }, acceptedCount: { increment: 1 } },
    });
    mocks.offer.pairingRollupPending = true;
    await rollupPairingEvents(shop);
    expect(mocks.relationUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.offer.pairingAcceptedIds).toEqual(["pair"]);
    for (const [arg] of mocks.offerUpdate.mock.calls)
      expect(arg.where.shop).toBe(shop);
    expect(mocks.eventFind.mock.calls[0][0].where.sessionId).toBe(
      "signed-session",
    );
  });
  it("never counts a generated offer or an unshown/foreign-product add as acceptance", async () => {
    mocks.events = [];
    await rollupPairingEvents(shop);
    expect(mocks.relationUpdate).not.toHaveBeenCalled();
    mocks.offer.pairingRollupPending = true;
    mocks.events = [
      {
        type: "widget_impression",
        createdAt: new Date("2026-11-05T00:00:01Z"),
        payload: {},
      },
      {
        type: "recommendation_added",
        createdAt: new Date("2026-11-05T00:00:02Z"),
        payload: { productId: "gid://shopify/Product/999", origin: "merchant" },
      },
    ];
    await rollupPairingEvents(shop);
    expect(mocks.relationUpdate.mock.calls[0][0].data).toEqual({
      shownCount: { increment: 1 },
    });
  });
  it("marks only owned offers pending and ignores client provenance fields", async () => {
    await markPairingEventsPending(shop, "signed-session", [
      {
        type: "widget_impression",
        offerId: "offer",
        origin: "merchant",
        confidence: 1,
      },
    ]);
    expect(mocks.offerUpdate).toHaveBeenCalledWith({
      where: {
        shop,
        sessionId: "signed-session",
        id: { in: ["offer"] },
        widgetType: { in: ["upsell_drawer", "rec_strip", "upsell"] },
      },
      data: { pairingRollupPending: true },
    });
  });
  it("captures server approval/provenance when writing an offer rather than accepting model/client claims", async () => {
    mocks.relationFind.mockResolvedValue([
      {
        id: "pair",
        sourceProductId: sourceId,
        targetProductId: targetId,
        kind: "complement",
        status: "auto_approved",
        origin: "ai",
        confidence: 0.91,
        reasonCode: "same_brand",
        modelVersion: "trusted-version",
      },
    ]);
    const decision = {
      widgetType: "upsell_drawer",
      payload: {
        products: [{ productId: targetId }],
        pairingProvenance: [{ origin: "merchant", confidence: 1 }],
      },
      reasoning: "verified",
      confidence: 1,
      aiProvider: "heuristic" as const,
    };
    await createOfferRecord({
      shop,
      sessionId: "signed-session",
      decision,
      triggerContext: { currentProductId: sourceId },
    });
    expect(mocks.create.mock.calls[0][0].data.pairingProvenance).toEqual([
      {
        relationshipId: "pair",
        sourceProductId: sourceId,
        targetProductId: targetId,
        origin: "autopilot",
        status: "auto_approved",
        confidence: 0.91,
        reasonCode: "same_brand",
        modelVersion: "trusted-version",
      },
    ]);
  });
  it("fails closed on a rejection or disabled autopilot at the final offer-write boundary", async () => {
    mocks.relationFind.mockResolvedValue([
      { kind: "complement", status: "rejected", targetProductId: targetId },
    ]);
    expect(
      await capturePairingProvenance(shop, sourceId, [targetId]),
    ).toBeNull();
    mocks.relationFind.mockResolvedValue([
      {
        kind: "complement",
        status: "auto_approved",
        targetProductId: targetId,
      },
    ]);
    mocks.settings.mockResolvedValue({ pairingMode: "review_first" });
    expect(
      await capturePairingProvenance(shop, sourceId, [targetId]),
    ).toBeNull();
  });
  it("records explicit fallback origin when no approved relationship exists", async () => {
    mocks.affinity.mockResolvedValue([{ targetId }]);
    expect(
      (await capturePairingProvenance(shop, sourceId, [targetId]))![0],
    ).toMatchObject({
      relationshipId: null,
      origin: "affinity",
      status: "fallback",
      confidence: null,
    });
  });
  it("demotes only a qualified autopilot pair and promotes a freshly validated alternative", async () => {
    const low = {
      id: "low",
      sourceProductId: sourceId,
      shownCount: 100,
      acceptedCount: 0,
      status: "auto_approved",
    };
    const peers = Array.from({ length: 5 }, (_, i) => ({
      id: `peer-${i}`,
      shownCount: 100,
      acceptedCount: 30,
      status: "auto_approved",
    }));
    const alternate = {
      id: "next",
      status: "suggested",
      confidence: 0.99,
      origin: "ai",
      reasonCode: "same_brand",
      target: {
        ...product,
        id: targetId,
        title: "Conditioner",
        productType: "Conditioner",
      },
    };
    mocks.relationFind.mockImplementation(async ({ where }) =>
      where.shownCount
        ? [low, ...peers]
        : where.status === "suggested"
          ? [alternate]
          : [],
    );
    await evaluatePairingPerformance(shop, settings as any);
    expect(mocks.relationUpdate).toHaveBeenCalledWith({
      where: { shop, id: "low", status: "auto_approved" },
      data: { performanceFlag: true, status: "demoted" },
    });
    expect(mocks.relationUpdate).toHaveBeenCalledWith({
      where: { shop, id: "next", status: "suggested" },
      data: { status: "auto_approved" },
    });
  });
  it("only flags merchant approvals and requires a distinct-session minimum before acting", async () => {
    const low = {
      id: "low",
      shownCount: 100,
      acceptedCount: 0,
      status: "approved",
    };
    mocks.relationFind.mockResolvedValue([
      low,
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `peer-${i}`,
        shownCount: 100,
        acceptedCount: 30,
        status: "approved",
      })),
    ]);
    mocks.query
      .mockImplementationOnce(async () => [{ peers: 6, medianLower: 0.2189 }])
      .mockResolvedValueOnce([{ count: 1 }]);
    await evaluatePairingPerformance(shop, settings as any);
    expect(
      mocks.relationUpdate.mock.calls.every(
        ([arg]) => !arg.data.performanceFlag,
      ),
    ).toBe(true);
    await evaluatePairingPerformance(shop, settings as any);
    expect(mocks.relationUpdate).toHaveBeenCalledWith({
      where: { shop, id: "low", status: "approved" },
      data: { performanceFlag: true },
    });
  });
});
