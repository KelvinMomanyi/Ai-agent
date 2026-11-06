import type { LoaderFunctionArgs } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  admin: vi.fn(),
  graphql: vi.fn(),
  cache: vi.fn(),
  upsert: vi.fn(),
  resume: vi.fn(),
}));
vi.mock("./shopify.server", () => ({ authenticate: { admin: mocks.admin } }));
vi.mock("./redis.server", () => ({
  getJsonCache: mocks.cache,
  setJsonCache: vi.fn(),
}));
vi.mock("./db.server", () => ({ default: { shop: { upsert: mocks.upsert } } }));
vi.mock("./jobs/aovboost.server", () => ({
  resumeCatalogSyncOnAdminEntry: mocks.resume,
}));

import { loader } from "./routes/app";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("SHOPIFY_API_KEY", "public-test-key");
  mocks.admin.mockResolvedValue({
    session: { shop: "test.myshopify.com", accessToken: "fake-access" },
    admin: { graphql: mocks.graphql },
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("parent admin loader", () => {
  it.each([true, null])(
    "authenticates without a legacy catalog fetch when shop:init is %s",
    async (cached) => {
      mocks.cache.mockResolvedValue(cached);
      const request = new Request("https://app.example.com/app");
      expect(await loader({ request } as LoaderFunctionArgs)).toEqual({
        apiKey: "public-test-key",
      });
      expect(mocks.admin).toHaveBeenCalledWith(request);
      expect(mocks.graphql).not.toHaveBeenCalled();
      expect(mocks.upsert).not.toHaveBeenCalled();
      expect(mocks.cache).not.toHaveBeenCalled();
      expect(mocks.resume).toHaveBeenCalledWith("test.myshopify.com", {
        graphql: mocks.graphql,
      });
    },
  );

  it("keeps the admin accessible when a bounded sync chunk fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.resume.mockRejectedValueOnce(new Error("sync unavailable"));
    expect(
      await loader({
        request: new Request("https://app.example.com/app"),
      } as LoaderFunctionArgs),
    ).toEqual({ apiKey: "public-test-key" });
    expect(log).toHaveBeenCalledWith(
      "AOVBoost admin-entry catalog sync failed",
      { shop: "test.myshopify.com" },
    );
    log.mockRestore();
  });
});
