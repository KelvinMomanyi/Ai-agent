import { Queue, Worker, type JobsOptions, type Processor } from "bullmq";
import IORedis from "ioredis";

// Use Upstash native Redis endpoint (works with BullMQ)
const redisUrl = process.env.UPSTASH_REDIS_URL || "redis://localhost:6379";

declare global {
  var aovboostRedis: IORedis | undefined;
  var aovboostQueues:
    | {
        generateOfferQueue: Queue;
        syncProductsQueue: Queue;
        recomputeAffinityQueue: Queue;
      }
    | undefined;
}

export const redis =
  global.aovboostRedis ??
  new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

if (!global.aovboostRedis) {
  redis.on("error", (err: any) => {
    if (err.code === "ECONNRESET") return;
    if (err.code === "ECONNREFUSED") return;
    console.error("Redis Error:", err.message);
  });
}

if (process.env.NODE_ENV !== "production") {
  global.aovboostRedis = redis;
}

const defaultJobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 1000 },
  removeOnComplete: 1000,
  removeOnFail: 1000,
};

function createQueue(name: string) {
  return new Queue(name, {
    connection: redis,
    defaultJobOptions,
  });
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
  return new Worker<Data>(queueName, processor, { connection: redis });
}

export async function getJsonCache<T>(key: string): Promise<T | null> {
  const value = await redis.get(key);
  if (!value) return null;

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export async function setJsonCache(
  key: string,
  value: unknown,
  ttlSeconds: number,
) {
  await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
}

export async function incrementRateLimit(
  key: string,
  ttlSeconds: number,
): Promise<number> {
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, ttlSeconds);
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
