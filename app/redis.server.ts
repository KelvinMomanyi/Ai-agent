import { Redis } from "@upstash/redis";

const upstash =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

const memoryStore = new Map<string, { value: unknown; expiresAt?: number }>();

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
        setMemoryValue(key, String(next));
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
        memoryStore.set(key, { value: current });
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
        memoryStore.set(key, { value: current });
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

export async function getJsonCache<T>(key: string): Promise<T | null> {
  const value = await withRedis(
    (client) => client.get<string>(key),
    () => getMemoryValue<string>(key),
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
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, ttlSeconds);
  return count;
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
};

async function withRedis<T>(
  operation: (client: Redis) => Promise<T>,
  fallback: () => T | Promise<T>,
): Promise<T> {
  if (!upstash) return fallback();
  try {
    return await operation(upstash);
  } catch (error) {
    console.warn(
      "AOVBoost Redis fallback active:",
      error instanceof Error ? error.message : String(error),
    );
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
  memoryStore.set(key, {
    value,
    expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined,
  });
}

function getMemorySet(key: string) {
  const value = getMemoryValue<Set<string>>(key);
  return value instanceof Set ? value : new Set<string>();
}
