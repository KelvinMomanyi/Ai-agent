import { Session } from "@shopify/shopify-api";
import { SessionStorage } from "@shopify/shopify-app-session-storage";
import { Redis } from "@upstash/redis";

/**
 * Custom Shopify session storage backed by Upstash Redis REST API.
 *
 * Why this exists:
 * - @shopify/shopify-app-session-storage-redis uses ioredis (TCP sockets)
 * - Vercel serverless functions freeze/thaw unpredictably, killing TCP sockets
 * - This causes endless ECONNRESET / EPIPE errors
 * - Upstash's REST client (@upstash/redis) uses HTTP per request — no sockets
 */

const PREFIX = "shopify_session:";
const SHOP_INDEX_PREFIX = "shopify_sessions_shop:";

export class UpstashSessionStorage implements SessionStorage {
  private redis: Redis;

  constructor() {
    this.redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
  }

  async storeSession(session: Session): Promise<boolean> {
    const key = `${PREFIX}${session.id}`;
    const payload = session.toObject();

    // Store the session
    await this.redis.set(key, JSON.stringify(payload));

    // Maintain a per-shop index so findSessionsByShop works
    if (session.shop) {
      const shopKey = `${SHOP_INDEX_PREFIX}${session.shop}`;
      await this.redis.sadd(shopKey, session.id);
    }

    return true;
  }

  async loadSession(id: string): Promise<Session | undefined> {
    const key = `${PREFIX}${id}`;
    const data = await this.redis.get<string>(key);
    if (!data) return undefined;

    const parsed = typeof data === "string" ? JSON.parse(data) : data;
    return Session.fromPropertyArray(
      Object.entries(parsed) as [string, string | number | boolean][],
      true,
    );
  }

  async deleteSession(id: string): Promise<boolean> {
    const key = `${PREFIX}${id}`;

    // Load session first to remove from shop index
    const session = await this.loadSession(id);
    if (session?.shop) {
      const shopKey = `${SHOP_INDEX_PREFIX}${session.shop}`;
      await this.redis.srem(shopKey, id);
    }

    await this.redis.del(key);
    return true;
  }

  async deleteSessions(ids: string[]): Promise<boolean> {
    if (ids.length === 0) return true;

    // Remove from shop indexes first
    for (const id of ids) {
      const session = await this.loadSession(id);
      if (session?.shop) {
        const shopKey = `${SHOP_INDEX_PREFIX}${session.shop}`;
        await this.redis.srem(shopKey, id);
      }
    }

    const keys = ids.map((id) => `${PREFIX}${id}`);
    await this.redis.del(...keys);
    return true;
  }

  async findSessionsByShop(shop: string): Promise<Session[]> {
    const shopKey = `${SHOP_INDEX_PREFIX}${shop}`;
    const sessionIds = await this.redis.smembers(shopKey);

    if (!sessionIds || sessionIds.length === 0) return [];

    const sessions: Session[] = [];
    for (const id of sessionIds) {
      const session = await this.loadSession(id as string);
      if (session) {
        sessions.push(session);
      } else {
        // Clean up stale index entry
        await this.redis.srem(shopKey, id);
      }
    }

    return sessions;
  }
}
