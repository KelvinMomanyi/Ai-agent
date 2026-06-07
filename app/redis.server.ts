import { Redis } from "@upstash/redis";

/**
 * Upstash REST-based Redis client for caching, rate-limiting, and key/value ops.
 *
 * Uses HTTP per request — no persistent TCP sockets — so it works perfectly
 * on Vercel serverless where ioredis/node-redis cause ECONNRESET errors.
 */
const upstash = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// ---------------------------------------------------------------------------
// BullMQ (requires ioredis — TCP connections)
// Only initialized when workers are explicitly enabled via env var.
// On Vercel serverless, workers should NOT be enabled; use a separate
// long-running worker process (Railway, Render, Fly.io, etc.).
// ---------------------------------------------------------------------------
import { Queue, Worker, type JobsOptions, type Processor } from "bullmq";
import IORedis from "ioredis";

let _ioredis: IORedis | null = null;

function getIORedis(): IORedis {
  if (_ioredis) return _ioredis;

  const redisUrl = process.env.UPSTASH_REDIS_URL || "redis://localhost:6379";
  _ioredis = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
    tls: redisUrl.startsWith("rediss://") ? {} : undefined,
  });

  _ioredis.on("error", (err: any) => {
    if (err.code === "ECONNRESET") return;
    if (err.code === "ECONNREFUSED") return;
    console.error("Redis (ioredis) Error:", err.message);
  });

  return _ioredis;
}

const defaultJobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 1000 },
  removeOnComplete: 1000,
  removeOnFail: 1000,
};

function createQueue(name: string) {
  return new Queue(name, {
    connection: getIORedis(),
    defaultJobOptions,
  });
}

declare global {
  var aovboostQueues:
    | {
        generateOfferQueue: Queue;
        syncProductsQueue: Queue;
        recomputeAffinityQueue: Queue;
      }
    | undefined;
}

export const queues =
  global.aovboostQueues ??
  {
    generateOfferQueue: createQueue("generate-offer"),
    syncProductsQueue: createQueue("sync-products"),
    recomputeAffinityQueue: createQueue("recompute-affinity"),
  };

if (process.env.NODE_ENV !== "production") {
  global.aovboostQueues = queues;
}

export function createWorker<Data>(
  queueName: string,
  processor: Processor<Data>,
) {
  return new Worker<Data>(queueName, processor, { connection: getIORedis() });
}

// ---------------------------------------------------------------------------
// REST-based cache / rate-limit helpers (used from route handlers)
// These replaced the old ioredis-based versions to eliminate ECONNRESET.
// ---------------------------------------------------------------------------

/**
 * Thin wrapper that exposes `.del()`, `.get()`, `.set()`, `.incr()`, `.expire()`
 * matching the old ioredis API surface used throughout the app.
 */
export const redis = {
  async del(key: string) {
    await upstash.del(key);
  },
  async get(key: string) {
    return upstash.get<string>(key);
  },
  async set(key: string, value: string, ...args: any[]) {
    // Support: redis.set(key, value, "EX", ttl)
    if (args[0] === "EX" && typeof args[1] === "number") {
      await upstash.set(key, value, { ex: args[1] });
    } else {
      await upstash.set(key, value);
    }
  },
  async incr(key: string) {
    return upstash.incr(key);
  },
  async expire(key: string, seconds: number) {
    await upstash.expire(key, seconds);
  },
  async sadd(key: string, ...members: string[]) {
    await upstash.sadd(key, ...members);
  },
  async srem(key: string, ...members: string[]) {
    await upstash.srem(key, ...members);
  },
  async smembers(key: string) {
    return upstash.smembers(key);
  },
};

export async function getJsonCache<T>(key: string): Promise<T | null> {
  const value = await upstash.get<string>(key);
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
  await upstash.set(key, JSON.stringify(value), { ex: ttlSeconds });
}

export async function incrementRateLimit(
  key: string,
  ttlSeconds: number,
): Promise<number> {
  const count = await upstash.incr(key);
  if (count === 1) {
    await upstash.expire(key, ttlSeconds);
  }
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
};
