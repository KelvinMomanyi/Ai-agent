import { Redis } from "@upstash/redis";
import { Session } from "@shopify/shopify-api";
import type { SessionStorage } from "@shopify/shopify-app-session-storage";

const SESSION_KEY_PREFIX = "shopify:session:";
const SHOP_SESSIONS_KEY = "shopify:shop-sessions";

export class UpstashSessionStorage implements SessionStorage {
  private redis: Redis;

  constructor() {
    this.redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
  }

  async storeSession(session: Session): Promise<boolean> {
    try {
      const data = session.toObject();
      const key = SESSION_KEY_PREFIX + session.id;
      const serialized = JSON.stringify(data, (_, value) => {
        if (value instanceof Date) return value.toISOString();
        return value;
      });
      await this.redis.set(key, serialized);
      await (this.redis.sadd as any)(SHOP_SESSIONS_KEY, session.id);
      return true;
    } catch {
      return false;
    }
  }

  async loadSession(id: string): Promise<Session | undefined> {
    try {
      const key = SESSION_KEY_PREFIX + id;
      const data = await this.redis.get<string>(key);
      if (!data) return undefined;

      const params = JSON.parse(data);
      if (params.expires) {
        params.expires = new Date(params.expires);
      }
      if (params.onlineAccessInfo?.expires_in) {
        params.onlineAccessInfo.expires_in = new Date(
          params.onlineAccessInfo.expires_in,
        );
      }
      return new Session(params);
    } catch {
      return undefined;
    }
  }

  async deleteSession(id: string): Promise<boolean> {
    try {
      const key = SESSION_KEY_PREFIX + id;
      await Promise.all([
        this.redis.del(key),
        (this.redis.srem as any)(SHOP_SESSIONS_KEY, id),
      ]);
      return true;
    } catch {
      return false;
    }
  }

  async deleteSessions(ids: string[]): Promise<boolean> {
    try {
      const pipeline = ids.map((id) => {
        const key = SESSION_KEY_PREFIX + id;
        return this.redis.del(key);
      });
      pipeline.push((this.redis.srem as any)(SHOP_SESSIONS_KEY, ...ids));
      await Promise.all(pipeline);
      return true;
    } catch {
      return false;
    }
  }

  async findSessionsByShop(shop: string): Promise<Session[]> {
    try {
      const ids = await (this.redis.smembers as any)(SHOP_SESSIONS_KEY);
      if (!Array.isArray(ids) || ids.length === 0) return [];

      const sessions = await Promise.all(
        ids.map((id: string) => this.loadSession(id)),
      );
      const filtered = sessions.filter(
        (s): s is Session => s !== undefined && s.shop === shop,
      );
      return filtered;
    } catch {
      return [];
    }
  }
}
