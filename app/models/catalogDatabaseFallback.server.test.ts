import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  execute: vi.fn(),
  products: vi.fn(),
}));
vi.mock("../db.server", () => ({
  default: {
    $transaction: mocks.transaction,
    $executeRaw:
      (...args: unknown[]) =>
      () =>
        mocks.execute(...args),
    $queryRaw:
      (...args: unknown[]) =>
      () =>
        mocks.products(...args),
  },
}));
import {
  readCatalogDuringCacheOutage,
  catalogFallbackQuery,
} from "./catalogDatabaseFallback.server";
import { CatalogUnavailableError } from "../utils/catalogAvailability.server";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.products.mockResolvedValue([
    { id: "one", catalogCount: 1, acquired: true },
  ]);
  mocks.transaction.mockImplementation(async (operations) => {
    const results = [];
    for (const operation of operations) results.push(await operation());
    return results;
  });
});
describe("durable catalog retrieval when Redis is unavailable", () => {
  it("uses a read-only bounded transaction and a cross-instance transaction lock", async () => {
    const result = await readCatalogDuringCacheOutage("one.myshopify.com");
    expect(result.products).toMatchObject([{ id: "one" }]);
    expect(result.productCount).toBe(1);
    expect(mocks.transaction.mock.calls[0][0]).toHaveLength(3);
    expect(mocks.execute.mock.calls[0][0]).toEqual([
      "SET TRANSACTION READ ONLY",
    ]);
    expect(mocks.execute.mock.calls[1][0]).toEqual([
      "SET LOCAL statement_timeout = '2500ms'",
    ]);
    const query = catalogFallbackQuery("one.myshopify.com");
    expect(query.text).toContain("LIMIT 500");
    expect(query.text).toContain("s.shop = p.shop");
    expect(query.values).toEqual(["one.myshopify.com", "one.myshopify.com"]);
    expect(mocks.products).toHaveBeenCalledTimes(1);
    expect(query.text).toContain("pg_try_advisory_xact_lock");
    expect(query.text).toContain("AND guard.acquired");
  });
  it("rejects a conflicting fill claim from another instance", async () => {
    mocks.products.mockResolvedValue([{ id: null, acquired: false }]);
    await expect(
      readCatalogDuringCacheOutage("one.myshopify.com"),
    ).rejects.toBeInstanceOf(CatalogUnavailableError);
    expect(mocks.products).toHaveBeenCalledTimes(1);
  });
  it("turns transaction and query failures into safe unavailable errors", async () => {
    mocks.products.mockRejectedValue(new Error("private connection error"));
    await expect(
      readCatalogDuringCacheOutage("one.myshopify.com"),
    ).rejects.toThrow("temporarily unavailable");
  });
});
