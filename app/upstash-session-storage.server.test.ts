import { Session } from "@shopify/shopify-api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(),
  findUnique: vi.fn(),
  findMany: vi.fn(),
  redis: { set: vi.fn(), get: vi.fn(), sadd: vi.fn(), smembers: vi.fn() },
}));
vi.mock("./db.server", () => ({
  default: {
    session: {
      upsert: mocks.upsert,
      findUnique: mocks.findUnique,
      findMany: mocks.findMany,
    },
  },
}));
vi.mock("@upstash/redis", () => ({
  Redis: vi.fn(function () {
    return mocks.redis;
  }),
}));

import { UpstashSessionStorage } from "./upstash-session-storage.server";

function session() {
  return new Session({
    id: "offline_store.myshopify.com",
    shop: "store.myshopify.com",
    state: "state",
    isOnline: false,
    accessToken: "rotated",
    expires: new Date(Date.now() + 3_600_000),
    refreshToken: "rotated-refresh",
    refreshTokenExpires: new Date(Date.now() + 86_400_000),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://cache.example.com");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "test-cache-credential");
});
afterEach(() => vi.unstubAllEnvs());

describe("durable Shopify session storage", () => {
  it("does not acknowledge or cache credentials when PostgreSQL fails", async () => {
    mocks.upsert.mockRejectedValue(new Error("database unavailable"));
    expect(await new UpstashSessionStorage().storeSession(session())).toBe(
      false,
    );
    expect(mocks.redis.set).not.toHaveBeenCalled();
  });

  it("accepts durable credentials even when Redis fails", async () => {
    mocks.upsert.mockResolvedValue({});
    mocks.redis.set.mockRejectedValue(new Error("cache unavailable"));
    const value = session();
    expect(await new UpstashSessionStorage().storeSession(value)).toBe(true);
    expect(mocks.upsert.mock.calls[0][0].update).toMatchObject({
      accessToken: value.accessToken,
      refreshToken: value.refreshToken,
      expires: value.expires,
      refreshTokenExpires: value.refreshTokenExpires,
    });
  });

  it("reads current offline credentials from PostgreSQL instead of stale Redis", async () => {
    const value = session();
    mocks.findUnique.mockResolvedValue(value.toObject());
    mocks.redis.get.mockResolvedValue(
      JSON.stringify({ ...value.toObject(), accessToken: "stale" }),
    );
    const loaded = await new UpstashSessionStorage().loadSession(value.id);
    expect(loaded?.accessToken).toBe("rotated");
    expect(loaded?.refreshToken).toBe("rotated-refresh");
    expect(mocks.redis.get).not.toHaveBeenCalled();
  });

  it("does not resurrect deleted offline credentials from Redis", async () => {
    mocks.findUnique.mockResolvedValue(null);
    mocks.redis.get.mockResolvedValue(JSON.stringify(session().toObject()));
    expect(
      await new UpstashSessionStorage().loadSession(session().id),
    ).toBeUndefined();
  });

  it("finds durable sessions after cache indexes are lost", async () => {
    mocks.redis.smembers.mockResolvedValue([]);
    mocks.findMany.mockResolvedValue([session().toObject()]);
    const found = await new UpstashSessionStorage().findSessionsByShop(
      session().shop,
    );
    expect(found).toHaveLength(1);
    expect(found[0].refreshToken).toBe("rotated-refresh");
  });
});
