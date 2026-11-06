import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  settings: vi.fn(),
  stateFind: vi.fn(),
  stateFirst: vi.fn(),
  stateUnique: vi.fn(),
  stateUpdate: vi.fn(),
  stateUpsert: vi.fn(),
  create: vi.fn(),
  products: vi.fn(),
  product: vi.fn(),
  stats: vi.fn(),
  generate: vi.fn(),
  rollup: vi.fn(),
  evaluate: vi.fn(),
  retain: vi.fn(),
  claim: vi.fn(),
  tasks: [] as Promise<unknown>[],
}));
vi.mock("@vercel/functions", () => ({ waitUntil: mocks.retain }));
vi.mock("../db.server", () => ({
  default: {
    productPairingState: {
      findMany: mocks.stateFind,
      findFirst: mocks.stateFirst,
      findUnique: mocks.stateUnique,
      updateMany: mocks.stateUpdate,
      upsert: mocks.stateUpsert,
      createMany: mocks.create,
    },
    product: { findMany: mocks.products, findFirst: mocks.product },
    productOrderStat: { findMany: mocks.stats },
  },
}));
vi.mock("../models/settings.server", () => ({
  getAppSettings: mocks.settings,
}));
vi.mock("../redis.server", () => ({ claimExpiringKey: mocks.claim }));
vi.mock("../models/pairingLearning.server", () => ({
  rollupPairingEvents: mocks.rollup,
  evaluatePairingPerformance: mocks.evaluate,
}));
vi.mock("./pairingSuggestions.server", () => ({
  pairingProductSelect: { id: true },
  generatePairingSuggestions: mocks.generate,
}));
import {
  drainPairings,
  markPairingDirty,
  schedulePairingDrain,
  seedPairingStates,
} from "./pairingAutopilot.server";
import { catalogHash } from "../models/pairingAutopilot";
const shop = "one.myshopify.com";
const product = {
  id: "gid://shopify/Product/1",
  title: "Shampoo",
  productType: "Shampoo",
  vendor: "Brand",
  tags: [],
  collectionIds: [],
  price: "20",
  metafields: {},
};
const settings = {
  pairingMode: "autopilot",
  pairingStrictness: "balanced",
  verticalPreset: "generic",
  blockedProductIds: [],
  excludedCollectionIds: [],
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.tasks = [];
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("VERCEL", "");
  mocks.settings.mockResolvedValue(settings);
  mocks.claim.mockResolvedValue(true);
  mocks.stateFirst.mockResolvedValue({ productId: product.id });
  mocks.stateFind.mockResolvedValue([
    { productId: product.id, revision: 4, catalogHash: "", status: "dirty" },
  ]);
  mocks.product.mockResolvedValue(product);
  mocks.products.mockResolvedValue([product]);
  mocks.stats.mockResolvedValue([]);
  mocks.stateUpdate.mockResolvedValue({ count: 1 });
  mocks.generate.mockResolvedValue({ processed: 1 });
  mocks.retain.mockImplementation((promise) => mocks.tasks.push(promise));
});
afterEach(async () => {
  await Promise.allSettled(mocks.tasks);
  vi.unstubAllEnvs();
});
describe("durable bounded pairing work", () => {
  it("does not dirty an unchanged catalog hash and scopes real changes by shop/product", async () => {
    mocks.stateUnique.mockResolvedValue({
      status: "done",
      catalogHash: catalogHash(product, settings),
    });
    await markPairingDirty(shop, [product.id]);
    expect(mocks.stateUpsert).not.toHaveBeenCalled();
    mocks.stateUnique.mockResolvedValue({ status: "done", catalogHash: "old" });
    await markPairingDirty(shop, [product.id]);
    expect(mocks.stateUpsert).toHaveBeenCalledWith({
      where: { shop_productId: { shop, productId: product.id } },
      create: { shop, productId: product.id },
      update: { status: "dirty", revision: { increment: 1 } },
    });
  });
  it("claims only the bounded dirty batch and forwards the same revision/token into the commit guard", async () => {
    await drainPairings(shop);
    expect(mocks.stateFind.mock.calls[0][0]).toMatchObject({
      where: { shop, status: "dirty" },
      take: 3,
    });
    expect(mocks.generate.mock.calls[0]).toEqual([
      shop,
      [product.id],
      undefined,
      [{ productId: product.id, revision: 4, leaseToken: expect.any(String) }],
    ]);
    const token = mocks.generate.mock.calls[0][3][0].leaseToken;
    expect(mocks.stateUpdate).toHaveBeenLastCalledWith({
      where: { shop, leaseToken: token },
      data: { leaseToken: null, leaseUntil: null },
    });
  });
  it("does not generate after another worker wins the lease and releases a failed generation for retry", async () => {
    mocks.stateUpdate.mockResolvedValueOnce({ count: 0 });
    await drainPairings(shop);
    expect(mocks.generate).not.toHaveBeenCalled();
    mocks.generate.mockRejectedValueOnce(new Error("interrupted"));
    await expect(drainPairings(shop)).rejects.toThrow("interrupted");
    expect(mocks.stateUpdate.mock.calls.at(-1)![0].data).toEqual({
      leaseToken: null,
      leaseUntil: null,
    });
  });
  it("skips unchanged policy work and never generates with mode off", async () => {
    mocks.stateFind.mockResolvedValue([
      {
        productId: product.id,
        revision: 4,
        catalogHash: catalogHash(product, settings),
      },
    ]);
    await drainPairings(shop);
    expect(mocks.generate).not.toHaveBeenCalled();
    mocks.settings.mockResolvedValue({ ...settings, pairingMode: "off" });
    expect(await drainPairings(shop)).toEqual({ processed: 0 });
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("seeds a bounded set idempotently with traffic-independent order-count priority", async () => {
    await seedPairingStates(shop);
    expect(mocks.stats.mock.calls[0][0]).toMatchObject({
      where: { shop },
      take: 50,
    });
    expect(mocks.create).toHaveBeenCalledWith({
      data: [{ shop, productId: product.id, priority: 50 }],
      skipDuplicates: true,
    });
  });
  it("retains work through Vercel without making the session caller await it", async () => {
    let release!: (value: typeof settings) => void;
    mocks.settings.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    expect(schedulePairingDrain(shop)).toBe(true);
    expect(mocks.retain).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.generate).not.toHaveBeenCalled();
    release({ ...settings, pairingMode: "off" });
    await mocks.tasks[0];
    expect(mocks.settings).toHaveBeenCalledWith(shop);
  });
  it("does not start detached production work without Vercel lifecycle support", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(schedulePairingDrain(shop)).toBe(false);
    expect(mocks.retain).not.toHaveBeenCalled();
    expect(mocks.settings).not.toHaveBeenCalled();
  });
});
