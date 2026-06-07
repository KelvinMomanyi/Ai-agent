import { Redis } from "@upstash/redis";

/**
 * Upstash REST-based Redis client.
 *
 * Uses HTTP per request — no persistent TCP sockets — so it works on
 * Vercel serverless where ioredis/node-redis cause ECONNRESET / ETIMEDOUT.
 */
const upstash = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// ---------------------------------------------------------------------------
// Lightweight job queue over Upstash REST (replaces BullMQ)
//
// On Vercel serverless BullMQ cannot work because:
//   1. ioredis TCP connections die across freeze/thaw cycles
//   2. Workers need a long-running process (no workers on serverless)
//
// Instead we run jobs **inline** within the request that enqueues them.
// The "queue" API is kept so call-sites don't need to change.
// ---------------------------------------------------------------------------

type JobProcessor<T = unknown> = (data: T) => Promise<void>;

const processors = new Map<string, JobProcessor<any>>();

class SimpleQueue<T = unknown> {
  constructor(public readonly name: string) {}

  async add(_jobName: string, data: T): Promise<void> {
    const processor = processors.get(this.name);
    if (processor) {
      try {
        await processor(data);
      } catch (error) {
        console.error(
          `[queue:${this.name}] Job failed:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    } else {
      // No processor registered — log and skip.
      // This is expected on Vercel serverless where workers are not started.
      console.log(`[queue:${this.name}] No processor registered, skipping job`);
    }
  }
}

declare global {
  var aovboostQueues:
    | {
        generateOfferQueue: SimpleQueue;
        syncProductsQueue: SimpleQueue;
        recomputeAffinityQueue: SimpleQueue;
      }
    | undefined;
}

export const queues = global.aovboostQueues ?? {
  generateOfferQueue: new SimpleQueue("generate-offer"),
  syncProductsQueue: new SimpleQueue("sync-products"),
  recomputeAffinityQueue: new SimpleQueue("recompute-affinity"),
};

if (process.env.NODE_ENV !== "production") {
  global.aovboostQueues = queues;
}

/**
 * Register a processor for a named queue.
 * On Vercel serverless, jobs are executed inline when `.add()` is called.
 */
export function createWorker<Data>(
  queueName: string,
  processor: (job: { data: Data }) => Promise<void>,
) {
  processors.set(queueName, async (data: Data) => {
    await processor({ data });
  });
}

// ---------------------------------------------------------------------------
// REST-based cache / rate-limit helpers
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
    if (members.length === 0) return;
    await (upstash.sadd as any)(key, ...members);
  },
  async srem(key: string, ...members: string[]) {
    if (members.length === 0) return;
    await (upstash.srem as any)(key, ...members);
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
