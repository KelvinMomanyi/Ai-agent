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

import {
  SessionPersistenceError,
  UpstashSessionStorage,
} from "./upstash-session-storage.server";

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
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("durable Shopify session storage", () => {
  it("does not acknowledge or cache credentials when PostgreSQL fails", async () => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const value = session();
    mocks.upsert.mockRejectedValue(
      new Error(`database unavailable: ${value.accessToken} ${value.refreshToken}`),
    );
    const result = expect(
      new UpstashSessionStorage().storeSession(value),
    ).rejects.toBeInstanceOf(SessionPersistenceError);
    await vi.runAllTimersAsync();
    await result;
    expect(mocks.upsert).toHaveBeenCalledTimes(3);
    expect(mocks.redis.set).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      "AOVBoost CRITICAL: durable session write failed",
      { shop: value.shop, attempts: 3 },
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain(value.accessToken);
    expect(JSON.stringify(log.mock.calls)).not.toContain(value.refreshToken);
  });

  it("retries the identical credential pair after backoff before caching it", async () => {
    vi.useFakeTimers();
    mocks.upsert
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValueOnce({});
    const result = new UpstashSessionStorage().storeSession(session());
    await vi.advanceTimersByTimeAsync(99);
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.redis.set).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBe(true);
    expect(mocks.upsert).toHaveBeenCalledTimes(2);
    expect(mocks.upsert.mock.calls[1]).toEqual(mocks.upsert.mock.calls[0]);
    expect(mocks.redis.set).toHaveBeenCalledTimes(1);
  });

  it("recovers on the final bounded retry without changing the returned pair", async () => {
    vi.useFakeTimers();
    mocks.upsert
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValueOnce({});
    const result = new UpstashSessionStorage().storeSession(session());
    await vi.advanceTimersByTimeAsync(299);
    expect(mocks.upsert).toHaveBeenCalledTimes(2);
    expect(mocks.redis.set).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBe(true);
    expect(mocks.upsert).toHaveBeenCalledTimes(3);
    expect(mocks.upsert.mock.calls[2]).toEqual(mocks.upsert.mock.calls[0]);
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
