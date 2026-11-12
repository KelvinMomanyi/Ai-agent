import { describe, expect, it } from "vitest";
import { redisConnection } from "./redis-configuration.server.mjs";

describe("shared Redis connection configuration", () => {
  const direct = {
    UPSTASH_REDIS_REST_URL: "https://direct.example.com",
    UPSTASH_REDIS_REST_TOKEN: "direct-test",
  };
  const marketplace = {
    KV_REST_API_URL: "https://marketplace.example.com",
    KV_REST_API_TOKEN: "marketplace-test",
  };
  it("accepts Vercel Marketplace's paired credentials for all shared Redis consumers", () => {
    expect(redisConnection(marketplace)).toMatchObject({
      status: "configured",
      source: "vercel_kv",
      token: "marketplace-test",
    });
    expect(redisConnection(direct)).toMatchObject({
      status: "configured",
      source: "upstash",
    });
  });
  it("lets an explicit source replace a stale direct endpoint without changing its old credentials", () => {
    expect(
      redisConnection({
        ...direct,
        ...marketplace,
        AOVBOOST_REDIS_SOURCE: "vercel_kv",
      }),
    ).toMatchObject({
      source: "vercel_kv",
      url: marketplace.KV_REST_API_URL,
      token: "marketplace-test",
    });
    expect(redisConnection({ ...direct, ...marketplace })).toMatchObject({
      source: "upstash",
      url: direct.UPSTASH_REDIS_REST_URL,
    });
  });
  it("never mixes credential pairs or uses a read-only token for billing and claims", () => {
    expect(
      redisConnection({
        UPSTASH_REDIS_REST_URL: direct.UPSTASH_REDIS_REST_URL,
        KV_REST_API_TOKEN: "other-test",
      }).status,
    ).toBe("incomplete_credentials");
    expect(
      redisConnection({
        KV_REST_API_URL: marketplace.KV_REST_API_URL,
        KV_REST_API_READ_ONLY_TOKEN: "readonly-test",
      }).status,
    ).toBe("incomplete_credentials");
    expect(
      redisConnection({ ...direct, AOVBOOST_REDIS_SOURCE: "vercel_kv" }).status,
    ).toBe("not_configured");
  });
  it("refuses unknown sources and malformed or insecure endpoints without exposing secrets", () => {
    expect(
      redisConnection({ ...direct, AOVBOOST_REDIS_SOURCE: "vercel" }),
    ).toEqual({ status: "invalid_source" });
    for (const url of [
      "http://external.example.com",
      "invalid",
      "https://user:password@example.com",
      "https://example.com/?token=test",
    ]) {
      expect(
        redisConnection({
          UPSTASH_REDIS_REST_URL: url,
          UPSTASH_REDIS_REST_TOKEN: "secret-test",
        }),
      ).toEqual({ status: "invalid_url", source: "upstash" });
    }
  });
});
