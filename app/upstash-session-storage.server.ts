import { Redis } from "@upstash/redis";
import { Session } from "@shopify/shopify-api";
import type { SessionStorage } from "@shopify/shopify-app-session-storage";
import prisma from "./db.server";

const SESSION_KEY_PREFIX = "shopify:session:";
const SHOP_SESSIONS_KEY = "shopify:shop-sessions";

export class UpstashSessionStorage implements SessionStorage {
  private redis: Redis | null;

  constructor() {
    this.redis =
      process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
        ? new Redis({
            url: process.env.UPSTASH_REDIS_REST_URL,
            token: process.env.UPSTASH_REDIS_REST_TOKEN,
          })
        : null;
  }

  async storeSession(session: Session): Promise<boolean> {
    try {
      if (!this.redis) return this.storeSessionInPrisma(session);

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
      return this.storeSessionInPrisma(session);
    }
  }

  async loadSession(id: string): Promise<Session | undefined> {
    try {
      if (!this.redis) return this.loadSessionFromPrisma(id);

      const key = SESSION_KEY_PREFIX + id;
      const data = await this.redis.get<string>(key);
      if (!data) return this.loadSessionFromPrisma(id);

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
      return this.loadSessionFromPrisma(id);
    }
  }

  async deleteSession(id: string): Promise<boolean> {
    try {
      if (this.redis) {
        const key = SESSION_KEY_PREFIX + id;
        await Promise.all([
          this.redis.del(key),
          (this.redis.srem as any)(SHOP_SESSIONS_KEY, id),
        ]);
      }
      await prisma.session.deleteMany({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  async deleteSessions(ids: string[]): Promise<boolean> {
    try {
      if (this.redis) {
        const pipeline = ids.map((id) => {
          const key = SESSION_KEY_PREFIX + id;
          return this.redis!.del(key);
        });
        pipeline.push((this.redis.srem as any)(SHOP_SESSIONS_KEY, ...ids));
        await Promise.all(pipeline);
      }
      await prisma.session.deleteMany({ where: { id: { in: ids } } });
      return true;
    } catch {
      return false;
    }
  }

  async findSessionsByShop(shop: string): Promise<Session[]> {
    try {
      if (!this.redis) return this.findSessionsByShopFromPrisma(shop);

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
      return this.findSessionsByShopFromPrisma(shop);
    }
  }

  private async storeSessionInPrisma(session: Session) {
    try {
      await prisma.session.upsert({
        where: { id: session.id },
        update: {
          shop: session.shop,
          state: session.state,
          isOnline: session.isOnline,
          scope: session.scope || null,
          expires: session.expires || null,
          accessToken: session.accessToken || "",
        },
        create: {
          id: session.id,
          shop: session.shop,
          state: session.state,
          isOnline: session.isOnline,
          scope: session.scope || null,
          expires: session.expires || null,
          accessToken: session.accessToken || "",
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  private async loadSessionFromPrisma(id: string) {
    const record = await prisma.session.findUnique({ where: { id } });
    if (!record) return undefined;

    return new Session({
      id: record.id,
      shop: record.shop,
      state: record.state,
      isOnline: record.isOnline,
      scope: record.scope || undefined,
      expires: record.expires || undefined,
      accessToken: record.accessToken,
    });
  }

  private async findSessionsByShopFromPrisma(shop: string) {
    const records = await prisma.session.findMany({ where: { shop } });
    return records.map(
      (record) =>
        new Session({
          id: record.id,
          shop: record.shop,
          state: record.state,
          isOnline: record.isOnline,
          scope: record.scope || undefined,
          expires: record.expires || undefined,
          accessToken: record.accessToken,
        }),
    );
  }
}
