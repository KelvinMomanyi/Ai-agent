import { Redis } from "@upstash/redis";
import { randomUUID } from "node:crypto";
import { reportDependencyFailure } from "./utils/dependencyFailure.server";
import { redisConnection } from "./redis-configuration.server.mjs";

const connection = redisConnection();
const upstash =
  connection.status === "configured"
    ? new Redis({
        url: connection.url!,
        token: connection.token!,
        retry: { retries: 1, backoff: () => 100 },
        signal: () => AbortSignal.timeout(1500),
      })
    : null;

const memoryStore = new Map<string, { value: unknown; expiresAt?: number }>();
let claimStoreWarningLogged = false;
let redisRetryAt = 0;
let redisWarningAt = 0;
const MAX_MEMORY_ENTRIES = 1000;

/** Billing counters must never silently fall back to per-instance memory. */
export const billingRedis = {
  async get(key: string): Promise<unknown> {
    return withSharedRedis((client) => client.get(key));
  },
  async set(key: string, value: string, seconds: number) {
    await withSharedRedis((client) => client.set(key, value, { ex: seconds }));
  },
  async del(key: string) {
    await withSharedRedis((client) => client.del(key));
  },
  async eval(
    script: string,
    keys: string[],
    args: Array<string | number>,
  ): Promise<unknown> {
    return withSharedRedis((client) => client.eval(script, keys, args));
  },
};

async function withSharedRedis<T>(
  operation: (client: Redis) => Promise<T>,
): Promise<T> {
  if (!upstash || Date.now() < redisRetryAt)
    throw new Error("Shared billing store unavailable");
  try {
    return await operation(upstash);
  } catch (error) {
    redisRetryAt = Date.now() + 30_000;
    reportDependencyFailure("redis_billing", error);
    throw error;
  }
}

/**
 * Upstash's HTTP client works in serverless runtimes. The memory fallback keeps
 * local development usable, but is intentionally treated as a best-effort cache.
 */
export const redis = {
  async del(key: string) {
    await withRedis(
      async (client) => {
        await client.del(key);
      },
      () => {
        memoryStore.delete(key);
      },
    );
  },
  async get(key: string) {
    return withRedis(
      (client) => client.get<string>(key),
      () => getMemoryValue<string>(key),
    );
  },
  async set(key: string, value: string, ...args: any[]) {
    await withRedis(
      async (client) => {
        if (args[0] === "EX" && typeof args[1] === "number") {
          await client.set(key, value, { ex: args[1] });
        } else {
          await client.set(key, value);
        }
      },
      () => setMemoryValue(key, value, args[0] === "EX" ? args[1] : undefined),
    );
  },
  async incr(key: string) {
    return withRedis(
      (client) => client.incr(key),
      () => {
        const next = Number(getMemoryValue(key) || 0) + 1;
        const expiresAt = memoryStore.get(key)?.expiresAt;
        setMemoryValue(key, String(next));
        if (expiresAt) memoryStore.get(key)!.expiresAt = expiresAt;
        return next;
      },
    );
  },
  async expire(key: string, seconds: number) {
    await withRedis(
      async (client) => {
        await client.expire(key, seconds);
      },
      () => {
        const entry = memoryStore.get(key);
        if (entry) entry.expiresAt = Date.now() + seconds * 1000;
      },
    );
  },
  async sadd(key: string, ...members: string[]) {
    if (members.length === 0) return;
    await withRedis(
      async (client) => {
        await (client.sadd as any)(key, ...members);
      },
      () => {
        const current = getMemorySet(key);
        members.forEach((member) => current.add(member));
        setMemoryValue(key, current);
      },
    );
  },
  async srem(key: string, ...members: string[]) {
    if (members.length === 0) return;
    await withRedis(
      async (client) => {
        await (client.srem as any)(key, ...members);
      },
      () => {
        const current = getMemorySet(key);
        members.forEach((member) => current.delete(member));
        setMemoryValue(key, current);
      },
    );
  },
  async smembers(key: string) {
    return withRedis(
      (client) => client.smembers(key),
      () => Array.from(getMemorySet(key)),
    );
  },
};

export async function getJsonCache<T>(
  key: string,
  options: { allowMemoryFallback?: boolean } = {},
): Promise<T | null> {
  const value = await withRedis(
    (client) => client.get<string>(key),
    () =>
      options.allowMemoryFallback === false
        ? null
        : getMemoryValue<string>(key),
  );
  if (!value) return null;

  try {
    return (typeof value === "string" ? JSON.parse(value) : value) as T;
  } catch {
    return null;
  }
}

export async function setJsonCache(
  key: string,
  value: unknown,
  ttlSeconds: number,
) {
  await withRedis(
    async (client) => {
      await client.set(key, JSON.stringify(value), { ex: ttlSeconds });
    },
    () => setMemoryValue(key, JSON.stringify(value), ttlSeconds),
  );
}

export async function incrementRateLimit(
  key: string,
  ttlSeconds: number,
): Promise<number> {
  return withRedis(
    async (client) =>
      Number(
        await client.eval(
          "local n=redis.call('INCR',KEYS[1]); if redis.call('TTL',KEYS[1])<0 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n",
          [key],
          [ttlSeconds],
        ),
      ),
    () => {
      const next = Number(getMemoryValue(key) || 0) + 1;
      const expiresAt = memoryStore.get(key)?.expiresAt;
      setMemoryValue(key, String(next), ttlSeconds);
      if (expiresAt) memoryStore.get(key)!.expiresAt = expiresAt;
      return next;
    },
  );
}

const AI_RESERVATION_SCRIPT = `
local now=tonumber(ARGV[1]); local untilAt=tonumber(ARGV[2]); local id=ARGV[3]
if redis.call('ZSCORE',KEYS[3],id) then return 1 end
redis.call('ZREMRANGEBYSCORE',KEYS[3],'-inf',now); redis.call('ZREMRANGEBYSCORE',KEYS[4],'-inf',now)
if tonumber(redis.call('GET',KEYS[1]) or '0')>=tonumber(ARGV[4]) or tonumber(redis.call('GET',KEYS[2]) or '0')>=tonumber(ARGV[5]) then return 0 end
if redis.call('ZCARD',KEYS[3])>=tonumber(ARGV[6]) or redis.call('ZCARD',KEYS[4])>=tonumber(ARGV[7]) then return 0 end
redis.call('INCR',KEYS[1]); redis.call('EXPIRE',KEYS[1],ARGV[8]); redis.call('INCR',KEYS[2]); redis.call('EXPIRE',KEYS[2],ARGV[8])
redis.call('ZADD',KEYS[3],untilAt,id); redis.call('EXPIRE',KEYS[3],30); redis.call('ZADD',KEYS[4],untilAt,id); redis.call('EXPIRE',KEYS[4],30)
return 1`;
const localAiLeases = new Map<string, { shop: string; expiresAt: number }>();

/** Count every provider attempt. Production AI fails closed when shared limits are unavailable. */
export async function reserveAiAttempt(
  shop?: string,
): Promise<(() => Promise<void>) | null> {
  if (
    process.env.NODE_ENV === "production" &&
    (!shop || !upstash || Date.now() < redisRetryAt)
  )
    return null;
  const scope = encodeURIComponent(shop || "development");
  const now = Date.now(),
    date = new Date(now).toISOString().slice(0, 10);
  const ttl =
    Math.ceil((Date.parse(`${date}T00:00:00Z`) + 86_400_000 - now) / 1000) + 60;
  const keys = [
    `aovboost:{ai}:daily:${date}`,
    `aovboost:{ai}:daily:${date}:${scope}`,
    "aovboost:{ai}:active",
    `aovboost:{ai}:active:${scope}`,
  ];
  const limits = [
    boundedEnv("AOVBOOST_AI_GLOBAL_DAILY_LIMIT", 1000),
    boundedEnv("AOVBOOST_AI_SHOP_DAILY_LIMIT", 200),
    boundedEnv("AOVBOOST_AI_GLOBAL_CONCURRENCY", 8),
    boundedEnv("AOVBOOST_AI_SHOP_CONCURRENCY", 2),
  ];
  const id = randomUUID();
  if (upstash) {
    try {
      if (
        Number(
          await upstash.eval(AI_RESERVATION_SCRIPT, keys, [
            now,
            now + 30_000,
            id,
            ...limits,
            ttl,
          ]),
        ) !== 1
      )
        return null;
      return async () => {
        try {
          await upstash.eval(
            "redis.call('ZREM',KEYS[1],ARGV[1]); redis.call('ZREM',KEYS[2],ARGV[1]); return 1",
            keys.slice(2),
            [id],
          );
        } catch {
          /* Lease expiry releases capacity after an interrupted invocation. */
        }
      };
    } catch (error) {
      warnClaimStoreUnavailable(error);
      return null;
    }
  }
  for (const [key, lease] of localAiLeases)
    if (lease.expiresAt <= now) localAiLeases.delete(key);
  const globalCount = Number(getMemoryValue(keys[0]) || 0),
    shopCount = Number(getMemoryValue(keys[1]) || 0);
  if (
    globalCount >= limits[0] ||
    shopCount >= limits[1] ||
    localAiLeases.size >= limits[2] ||
    [...localAiLeases.values()].filter((lease) => lease.shop === scope)
      .length >= limits[3]
  )
    return null;
  setMemoryValue(keys[0], globalCount + 1, ttl);
  setMemoryValue(keys[1], shopCount + 1, ttl);
  localAiLeases.set(id, { shop: scope, expiresAt: now + 30_000 });
  return async () => {
    localAiLeases.delete(id);
  };
}

function boundedEnv(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value >= 0
    ? Math.min(Math.floor(value), 1_000_000)
    : fallback;
}

/**
 * Atomically reserves a key for a bounded window. In production this fails
 * closed when Upstash is unavailable because an instance-local fallback
 * cannot enforce an at-most-once guarantee across Vercel function instances.
 */
export async function claimExpiringKey(
  key: string,
  ttlSeconds: number,
): Promise<boolean> {
  return (await claimExpiringKeyStatus(key, ttlSeconds)) === "acquired";
}

/** Distinguish normal contention from a failed distributed dependency. */
export async function claimExpiringKeyStatus(
  key: string,
  ttlSeconds: number,
): Promise<"acquired" | "busy" | "unavailable"> {
  if (upstash) {
    if (Date.now() < redisRetryAt) return "unavailable";
    try {
      const result = await upstash.set(key, "1", {
        ex: ttlSeconds,
        nx: true,
      });
      return result === "OK" ? "acquired" : "busy";
    } catch (error) {
      redisRetryAt = Date.now() + 30_000;
      warnClaimStoreUnavailable(error);
      reportDependencyFailure("redis_claim", error);
      return "unavailable";
    }
  }

  if (process.env.NODE_ENV === "production") {
    warnClaimStoreUnavailable("Shared Redis credentials are not configured");
    return "unavailable";
  }

  if (getMemoryValue(key) !== null) return "busy";
  setMemoryValue(key, "1", ttlSeconds);
  return "acquired";
}

export const cacheKeys = {
  offer: (sessionId: string, productId = "none") =>
    `offer:${sessionId}:${productId}`,
  session: (shop: string, anonymousId: string) =>
    `session:${shop}:${anonymousId}`,
  syncProgress: (shop: string) => `sync:progress:${shop}`,
  affinity: (shop: string, productId: string) =>
    `affinity:${shop}:${productId}`,
  offerRateLimit: (sessionId: string) => `rate:offer:${sessionId}`,
  chatRateLimit: (sessionId: string) => `rate:chat:${sessionId}`,
  eventsRateLimit: (sessionId: string) => `rate:events:${sessionId}`,
  liveRateLimit: (sessionId: string) => `rate:live:${sessionId}`,
  liveDelivery: (
    shop: string,
    sessionId: string,
    eventType: string,
    productId: string,
  ) =>
    `live:delivery:${[shop, sessionId, eventType, productId]
      .map(encodeURIComponent)
      .join(":")}`,
  experiment: (shop: string, widgetType: string) =>
    `experiment:${shop}:${widgetType}`,
};

function warnClaimStoreUnavailable(error: unknown) {
  if (claimStoreWarningLogged) return;
  claimStoreWarningLogged = true;
  console.warn(
    "AOVBoost distributed store unavailable; guarded operations are fail-closed",
  );
  reportDependencyFailure("redis_guarded_operations", error);
}

async function withRedis<T>(
  operation: (client: Redis) => Promise<T>,
  fallback: () => T | Promise<T>,
): Promise<T> {
  if (!upstash || Date.now() < redisRetryAt) return fallback();
  try {
    return await operation(upstash);
  } catch (error) {
    redisRetryAt = Date.now() + 30_000;
    if (Date.now() - redisWarningAt > 60_000) {
      redisWarningAt = Date.now();
      reportDependencyFailure("redis_cache_fallback", error);
    }
    return fallback();
  }
}

function getMemoryValue<T = unknown>(key: string): T | null {
  const entry = memoryStore.get(key);
  if (!entry) return null;
  if (entry.expiresAt && entry.expiresAt <= Date.now()) {
    memoryStore.delete(key);
    return null;
  }
  return entry.value as T;
}

function setMemoryValue(key: string, value: unknown, ttlSeconds?: number) {
  if (typeof value === "string" && value.length > 300_000) return;
  if (!memoryStore.has(key) && memoryStore.size >= MAX_MEMORY_ENTRIES) {
    for (const [entryKey, entry] of memoryStore) {
      if (entry.expiresAt && entry.expiresAt <= Date.now())
        memoryStore.delete(entryKey);
    }
    if (memoryStore.size >= MAX_MEMORY_ENTRIES)
      memoryStore.delete(memoryStore.keys().next().value!);
  }
  memoryStore.set(key, {
    value,
    expiresAt: Date.now() + (ttlSeconds ?? 300) * 1000,
  });
}

function getMemorySet(key: string) {
  const value = getMemoryValue<Set<string>>(key);
  return value instanceof Set ? value : new Set<string>();
}
