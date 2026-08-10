import { Redis } from "@upstash/redis";
import { Session } from "@shopify/shopify-api";
import type { SessionStorage } from "@shopify/shopify-app-session-storage";
import prisma from "./db.server";

const SESSION_KEY_PREFIX = "shopify:session:";
const LEGACY_SHOP_SESSIONS_KEY = "shopify:shop-sessions";
const shopSessionsKey = (shop: string) => `shopify:shop-sessions:${shop}`;

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
    const storedInPrisma = await this.storeSessionInPrisma(session);
    if (!this.redis) return storedInPrisma;

    try {
      const data = session.toObject();
      const key = SESSION_KEY_PREFIX + session.id;
      const serialized = JSON.stringify(data, (_, value) => {
        if (value instanceof Date) return value.toISOString();
        return value;
      });
      await this.redis.set(key, serialized);
      await (this.redis.sadd as any)(shopSessionsKey(session.shop), session.id);
      return true;
    } catch {
      return storedInPrisma;
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
      if (params.refreshTokenExpires) {
        params.refreshTokenExpires = new Date(params.refreshTokenExpires);
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
        const session = await this.loadSession(id);
        const key = SESSION_KEY_PREFIX + id;
        await this.redis.del(key);
        if (session?.shop) {
          await (this.redis.srem as any)(shopSessionsKey(session.shop), id);
        }
        await (this.redis.srem as any)(LEGACY_SHOP_SESSIONS_KEY, id);
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
        const sessions = await Promise.all(
          ids.map((id) => this.loadSession(id)),
        );
        const pipeline = ids.map((id) => {
          const key = SESSION_KEY_PREFIX + id;
          return this.redis!.del(key);
        });
        const idsByShop = new Map<string, string[]>();
        sessions.forEach((session, index) => {
          if (!session?.shop) return;
          const shopIds = idsByShop.get(session.shop) || [];
          shopIds.push(ids[index]);
          idsByShop.set(session.shop, shopIds);
        });
        idsByShop.forEach((shopIds, shop) => {
          pipeline.push(
            (this.redis!.srem as any)(shopSessionsKey(shop), ...shopIds),
          );
        });
        pipeline.push(
          (this.redis.srem as any)(LEGACY_SHOP_SESSIONS_KEY, ...ids),
        );
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

      let ids = await (this.redis.smembers as any)(shopSessionsKey(shop));
      if (!Array.isArray(ids) || ids.length === 0) {
        ids = await (this.redis.smembers as any)(LEGACY_SHOP_SESSIONS_KEY);
      }
      if (!Array.isArray(ids) || ids.length === 0) return [];

      const sessions = await Promise.all(
        ids.map((id: string) => this.loadSession(id)),
      );
      const filtered = sessions.filter(
        (s): s is Session => s !== undefined && s.shop === shop,
      );
      if (filtered.length > 0) {
        await (this.redis.sadd as any)(
          shopSessionsKey(shop),
          ...filtered.map(({ id }) => id),
        );
      }
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
          refreshToken: session.refreshToken || null,
          refreshTokenExpires: session.refreshTokenExpires || null,
        },
        create: {
          id: session.id,
          shop: session.shop,
          state: session.state,
          isOnline: session.isOnline,
          scope: session.scope || null,
          expires: session.expires || null,
          accessToken: session.accessToken || "",
          refreshToken: session.refreshToken || null,
          refreshTokenExpires: session.refreshTokenExpires || null,
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
      refreshToken: record.refreshToken || undefined,
      refreshTokenExpires: record.refreshTokenExpires || undefined,
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
          refreshToken: record.refreshToken || undefined,
          refreshTokenExpires: record.refreshTokenExpires || undefined,
        }),
    );
  }
}
