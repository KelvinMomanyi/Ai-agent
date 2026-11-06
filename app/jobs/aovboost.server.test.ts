import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  jobs: new Map<string, any>(),
  findUnique: vi.fn(),
  upsert: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  productCount: vi.fn(),
  page: vi.fn(),
  prune: vi.fn(),
  affinities: vi.fn(),
  refresh: vi.fn(),
  redisSet: vi.fn(),
  backgroundAdmin: vi.fn(),
  pairingDrain: vi.fn(),
}));
vi.mock("../db.server", () => ({
  default: {
    catalogSyncJob: {
      findUnique: mocks.findUnique,
      upsert: mocks.upsert,
      update: mocks.update,
      updateMany: mocks.updateMany,
    },
    product: { count: mocks.productCount },
  },
}));
vi.mock("./pairingAutopilot.server", () => ({
  schedulePairingDrain: mocks.pairingDrain,
}));
vi.mock("../models/catalogCache.server", () => ({
  refreshCatalogCache: mocks.refresh,
}));
vi.mock("../models/product.server", () => ({
  syncProductsPageFromAdmin: mocks.page,
  pruneDeletedProducts: mocks.prune,
  recomputeInitialAffinityBatch: mocks.affinities,
}));
vi.mock("../redis.server", () => ({
  redis: { set: mocks.redisSet },
  cacheKeys: { syncProgress: (shop: string) => `sync:${shop}` },
}));
vi.mock("../shopify.server", () => ({
  unauthenticated: { admin: mocks.backgroundAdmin },
}));

import {
  ensureInitialCatalogSync,
  getCatalogSyncProgress,
  processCatalogSyncChunk,
  resumeCatalogSyncOnAdminEntry,
  startCatalogSync,
} from "./aovboost.server";

const shop = "setup.myshopify.com";
const admin = { graphql: vi.fn() };
function job(overrides: Record<string, unknown> = {}) {
  return {
    id: "job",
    shop,
    phase: "fetching",
    cursor: null,
    syncedProductIds: [],
    syncedCount: 0,
    affinityOffset: 0,
    affinityTotal: 0,
    error: null,
    leaseToken: null,
    leaseUntil: null,
    startedAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.jobs.clear();
  mocks.findUnique.mockImplementation(async ({ where }) =>
    mocks.jobs.get(where.shop) ? { ...mocks.jobs.get(where.shop) } : null,
  );
  mocks.productCount.mockResolvedValue(0);
  mocks.upsert.mockImplementation(async ({ where, update, create }) => {
    const value = mocks.jobs.has(where.shop)
      ? { ...mocks.jobs.get(where.shop), ...update }
      : job(create);
    mocks.jobs.set(where.shop, value);
    return { ...value };
  });
  mocks.update.mockImplementation(async ({ where, data }) => {
    const value = {
      ...mocks.jobs.get(where.shop),
      ...data,
      updatedAt: new Date(),
    };
    mocks.jobs.set(where.shop, value);
    return { ...value };
  });
  mocks.updateMany.mockImplementation(async ({ where, data }) => {
    const value = mocks.jobs.get(where.shop);
    if (!value || (where.leaseToken && value.leaseToken !== where.leaseToken))
      return { count: 0 };
    if (where.OR && value.leaseUntil && value.leaseUntil >= new Date())
      return { count: 0 };
    Object.assign(value, data);
    return { count: 1 };
  });
  mocks.page.mockResolvedValue({
    productIds: [],
    cursor: null,
    hasNextPage: false,
  });
  mocks.affinities.mockResolvedValue({ done: 0, total: 0, complete: true });
});
afterEach(() => vi.useRealTimers());

describe("durable onboarding catalog sync", () => {
  it("starts the first empty shop idempotently under concurrent admin loads", async () => {
    await Promise.all([
      ensureInitialCatalogSync(shop),
      ensureInitialCatalogSync(shop),
    ]);
    expect(mocks.jobs.size).toBe(1);
    for (const [input] of mocks.upsert.mock.calls)
      expect(input).toMatchObject({
        where: { shop },
        update: {},
        create: { shop },
      });
    const current = mocks.jobs.get(shop);
    Object.assign(current, {
      cursor: "saved-cursor",
      syncedCount: 20,
      leaseToken: "other-worker",
    });
    await ensureInitialCatalogSync(shop);
    expect(mocks.jobs.get(shop)).toMatchObject({
      cursor: "saved-cursor",
      syncedCount: 20,
      leaseToken: "other-worker",
    });
    expect(mocks.productCount).toHaveBeenCalledWith({ where: { shop } });
  });

  it("does not start an unsolicited sync for an existing catalog without a job", async () => {
    mocks.productCount.mockResolvedValue(10);
    expect(await resumeCatalogSyncOnAdminEntry(shop, admin)).toBeNull();
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.page).not.toHaveBeenCalled();
  });

  it("recovers a concurrent unique-shop insert without resetting the winner's progress", async () => {
    mocks.upsert.mockImplementationOnce(async () => {
      mocks.jobs.set(
        shop,
        job({
          cursor: "winning-cursor",
          syncedCount: 25,
          leaseToken: "winning-lease",
        }),
      );
      throw Object.assign(new Error("concurrent insert"), { code: "P2002" });
    });
    expect(await ensureInitialCatalogSync(shop)).toMatchObject({
      status: "fetching",
      done: 25,
    });
    expect(mocks.jobs.get(shop)).toMatchObject({
      cursor: "winning-cursor",
      leaseToken: "winning-lease",
    });
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
  });

  it("processes only one page on entry and retains the cursor for browser continuation", async () => {
    mocks.page.mockResolvedValue({
      productIds: ["p1"],
      cursor: "next-page",
      hasNextPage: true,
    });
    await resumeCatalogSyncOnAdminEntry(shop, admin);
    expect(mocks.page).toHaveBeenCalledTimes(1);
    expect(mocks.page).toHaveBeenCalledWith(shop, admin, null);
    expect(mocks.jobs.get(shop)).toMatchObject({
      phase: "fetching",
      cursor: "next-page",
      syncedCount: 1,
      leaseToken: null,
    });
    expect(mocks.backgroundAdmin).not.toHaveBeenCalled();
  });

  it("resumes the saved cursor after two hours without cached Redis progress", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-05T10:00:00Z"));
    mocks.jobs.set(
      shop,
      job({
        cursor: "page-2",
        syncedProductIds: ["p1"],
        syncedCount: 1,
        updatedAt: new Date("2026-11-05T08:00:00Z"),
      }),
    );
    expect(await getCatalogSyncProgress(shop)).toMatchObject({
      status: "fetching",
      done: 1,
    });
    mocks.page.mockResolvedValue({
      productIds: ["p2"],
      cursor: "page-3",
      hasNextPage: true,
    });
    await resumeCatalogSyncOnAdminEntry(shop, admin);
    expect(mocks.page).toHaveBeenCalledWith(shop, admin, "page-2");
    expect(mocks.jobs.get(shop)).toMatchObject({
      cursor: "page-3",
      syncedCount: 2,
    });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("records a successful empty fetch durably and never auto-restarts an empty completed catalog", async () => {
    await resumeCatalogSyncOnAdminEntry(shop, admin);
    expect(mocks.jobs.get(shop)).toMatchObject({
      phase: "pruning_deleted",
      syncedCount: 0,
    });
    await processCatalogSyncChunk(shop, admin);
    await processCatalogSyncChunk(shop, admin);
    await processCatalogSyncChunk(shop, admin);
    expect(await getCatalogSyncProgress(shop)).toMatchObject({
      complete: true,
      emptyCatalog: true,
    });
    await resumeCatalogSyncOnAdminEntry(shop, admin);
    await resumeCatalogSyncOnAdminEntry(shop, admin);
    expect(mocks.page).toHaveBeenCalledTimes(1);
    expect(mocks.jobs.get(shop).phase).toBe("complete");
    expect(mocks.pairingDrain).toHaveBeenCalledWith(shop, { seed: true });
  });

  it("honors an active lease instead of fetching the same page concurrently", async () => {
    let release!: () => void;
    let entered!: () => void;
    const pageEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mocks.page.mockImplementationOnce(async () => {
      entered();
      await gate;
      return { productIds: ["p1"], cursor: "next-page", hasNextPage: true };
    });
    const first = resumeCatalogSyncOnAdminEntry(shop, admin);
    await pageEntered;
    expect(await resumeCatalogSyncOnAdminEntry(shop, admin)).toMatchObject({
      busy: true,
    });
    release();
    await first;
    expect(mocks.page).toHaveBeenCalledTimes(1);
  });

  it("leaves failed jobs visible until a merchant explicitly retries", async () => {
    mocks.jobs.set(shop, job({ phase: "failed", error: "interrupted" }));
    expect(await resumeCatalogSyncOnAdminEntry(shop, admin)).toMatchObject({
      failed: true,
    });
    expect(mocks.page).not.toHaveBeenCalled();
    await startCatalogSync(shop);
    expect(mocks.jobs.get(shop)).toMatchObject({
      phase: "fetching",
      cursor: null,
      error: null,
    });
  });

  it("never resumes or updates another shop's job", async () => {
    const other = "other.myshopify.com";
    mocks.jobs.set(other, job({ shop: other, cursor: "other-cursor" }));
    await resumeCatalogSyncOnAdminEntry(shop, admin);
    expect(mocks.jobs.get(other).cursor).toBe("other-cursor");
    for (const [input] of [
      ...mocks.findUnique.mock.calls,
      ...mocks.update.mock.calls,
      ...mocks.updateMany.mock.calls,
    ])
      expect(input.where.shop).toBe(shop);
  });
});
