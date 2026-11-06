import "@shopify/shopify-app-react-router/adapters/node";
import { createHmac } from "node:crypto";
import { Session } from "@shopify/shopify-api";
import { setAbstractFetchFunc } from "@shopify/shopify-api/runtime";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import type { ActionFunctionArgs } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SessionPersistenceError,
  UpstashSessionStorage,
} from "../upstash-session-storage.server";

const mocks = vi.hoisted(() => {
  const tables = [
    "productPairingState",
    "monthlyUsage",
    "entitlementSnapshot",
    "holdoutOrder",
    "holdoutEnrollment",
    "offer",
    "shopperEvent",
    "chatMessage",
    "recommendationOutcome",
    "shopperSession",
    "bundleItem",
    "bundle",
    "productRelationship",
    "productAffinity",
    "productVariantOrderStat",
    "productOrderStat",
    "product",
    "experiment",
    "appSettings",
    "catalogSyncJob",
    "shopConfig",
    "shop",
    "event",
    "visitorSession",
    "session",
  ];
  return {
    deletes: Object.fromEntries(tables.map((table) => [table, vi.fn()])),
    transaction: vi.fn(),
    sessionUpdate: vi.fn(),
    sessionUpsert: vi.fn(),
    shopUpdate: vi.fn(),
    findSessions: vi.fn(),
    deleteSessions: vi.fn(),
    loadSession: vi.fn(),
    storeSession: vi.fn(),
    webhook: vi.fn(),
    fetch: vi.fn(),
    redisDel: vi.fn(),
    entitlementUpdate: vi.fn(),
    invalidateCatalog: vi.fn(),
  };
});
vi.mock("../db.server", () => ({
  default: {
    ...Object.fromEntries(
      Object.entries(mocks.deletes).map(([table, deleteMany]) => [
        table,
        { deleteMany },
      ]),
    ),
    session: {
      deleteMany: mocks.deletes.session,
      updateMany: mocks.sessionUpdate,
      upsert: mocks.sessionUpsert,
    },
    shop: { deleteMany: mocks.deletes.shop, updateMany: mocks.shopUpdate },
    entitlementSnapshot: {
      deleteMany: mocks.deletes.entitlementSnapshot,
      updateMany: mocks.entitlementUpdate,
    },
    $transaction: mocks.transaction,
  },
}));
vi.mock("../shopify.server", () => ({
  authenticate: { webhook: mocks.webhook },
  sessionStorage: {
    findSessionsByShop: mocks.findSessions,
    deleteSessions: mocks.deleteSessions,
  },
}));
vi.mock("../redis.server", () => ({
  redis: { del: mocks.redisDel },
  billingRedis: { del: mocks.redisDel },
}));
vi.mock("../models/catalogCache.server", () => ({
  invalidateCatalogCache: mocks.invalidateCatalog,
}));
vi.mock("../models/offer.server", () => ({ markOfferConversion: vi.fn() }));
vi.mock("../models/recommendationOutcome.server", () => ({
  markPurchasedRecommendationOutcomes: vi.fn(),
}));
vi.mock("../models/product.server", () => ({
  deleteProduct: vi.fn(),
  incrementOrderAffinities: vi.fn(),
  upsertProduct: vi.fn(),
}));
vi.mock("../jobs/pairingAutopilot.server", () => ({ schedulePairingDrain: vi.fn(), markPairingDirty: vi.fn(), markPairingDeletionDirty: vi.fn() }));

import { action } from "../routes/api.webhooks";

const shop = "webhook-test.myshopify.com";
const secret = "fake-webhook-signing-secret";

function request(topic = "app/uninstalled", body = "{}") {
  return new Request("https://app.example.com/api/webhooks", {
    method: "POST",
    body,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Hmac-Sha256": createHmac("sha256", secret)
        .update(body)
        .digest("base64"),
      "X-Shopify-Topic": topic,
      "X-Shopify-Shop-Domain": shop,
      "X-Shopify-Api-Version": "2026-07",
      "X-Shopify-Webhook-Id": "test-delivery",
    },
  });
}

function handle(webhook: Request) {
  return action({ request: webhook } as ActionFunctionArgs);
}

function sdkWithStorage(
  storeSession: (session: Session) => Promise<boolean> = mocks.storeSession,
) {
  return shopifyApp({
    apiKey: "fake-webhook-key",
    apiSecretKey: secret,
    appUrl: "https://app.example.com",
    apiVersion: ApiVersion.July26,
    distribution: AppDistribution.AppStore,
    future: { expiringOfflineAccessTokens: true },
    logger: { log: () => {} },
    sessionStorage: {
      storeSession,
      loadSession: mocks.loadSession,
      findSessionsByShop: mocks.findSessions,
      deleteSessions: mocks.deleteSessions,
      deleteSession: vi.fn(),
    },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("SHOPIFY_API_KEY", "fake-webhook-key");
  vi.stubEnv("SHOPIFY_API_SECRET", secret);
  vi.stubEnv("SHOPIFY_APP_URL", "https://app.example.com");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
  // Auth uses the SDK's runtime fetch adapter, not its Admin API custom fetch.
  setAbstractFetchFunc(mocks.fetch);
  const expired = new Session({
    id: `offline_${shop}`,
    shop,
    state: "",
    isOnline: false,
    accessToken: "fake-expired-access",
    expires: new Date(Date.now() - 1000),
    refreshToken: "fake-revoked-refresh",
    refreshTokenExpires: new Date(Date.now() + 86_400_000),
  });
  mocks.loadSession.mockResolvedValue(expired);
  mocks.findSessions.mockResolvedValue([expired]);
  mocks.fetch.mockResolvedValue(
    new Response(JSON.stringify({ error: "invalid_request" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    }),
  );
  const sdk = sdkWithStorage();
  mocks.webhook.mockImplementation(sdk.authenticate.webhook);
  mocks.transaction.mockImplementation((operations) => Promise.all(operations));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  setAbstractFetchFunc(globalThis.fetch);
});

function refreshSucceeds() {
  mocks.fetch.mockResolvedValue(
    new Response(
      JSON.stringify({
        access_token: "fake-rotated-access",
        refresh_token: "fake-rotated-refresh",
        expires_in: 3600,
        refresh_token_expires_in: 86400,
        scope: "read_products",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  );
}

describe("installed SDK refresh persistence boundary", () => {
  it("reproduces the SDK accepting a false storage result", async () => {
    refreshSucceeds();
    mocks.storeSession.mockResolvedValue(false);
    const context = await mocks.webhook(request());
    expect(context.session.accessToken).toBe("fake-rotated-access");
    expect(mocks.storeSession).toHaveBeenCalledTimes(1);
  });

  it("retries saving the same refresh result without repeating the exchange", async () => {
    refreshSucceeds();
    mocks.sessionUpsert
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValueOnce({});
    const storage = new UpstashSessionStorage();
    const sdk = sdkWithStorage(storage.storeSession.bind(storage));
    const context = await sdk.authenticate.webhook(request());
    expect(context.session?.accessToken).toBe("fake-rotated-access");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.sessionUpsert).toHaveBeenCalledTimes(2);
    expect(mocks.sessionUpsert.mock.calls[1]).toEqual(
      mocks.sessionUpsert.mock.calls[0],
    );
  });

  it("does not return refreshed credentials when durable persistence permanently fails", async () => {
    refreshSucceeds();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.sessionUpsert.mockRejectedValue(new Error("database unavailable"));
    const storage = new UpstashSessionStorage();
    const sdk = sdkWithStorage(storage.storeSession.bind(storage));
    await expect(sdk.authenticate.webhook(request())).rejects.toBeInstanceOf(
      SessionPersistenceError,
    );
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.sessionUpsert).toHaveBeenCalledTimes(3);
    expect(log).toHaveBeenCalledTimes(1);
  });
});

describe("signature-verified data webhooks with unusable offline credentials", () => {
  it("purges durable tenant rows even if cache cleanup needs a retry", async () => {
    mocks.redisDel.mockRejectedValueOnce(new Error("Redis unavailable"));
    expect((await handle(request())).status).toBe(500);
    for (const deletion of Object.values(mocks.deletes))
      expect(deletion).toHaveBeenCalled();
    expect(mocks.webhook).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("invalidates a signed subscription update without an offline refresh or trusting payload tier claims", async () => {
    const body = JSON.stringify({
      app_subscription: { name: "Pro", status: "ACTIVE" },
      shop: "other.myshopify.com",
    });
    expect(
      (await handle(request("app_subscriptions/update", body))).status,
    ).toBe(200);
    expect(mocks.entitlementUpdate).toHaveBeenCalledWith({
      where: { shop },
      data: { refreshRequired: true },
    });
    expect(mocks.redisDel).toHaveBeenCalledWith(`entitlement:${shop}`);
    expect(mocks.webhook).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("rejects an unsigned subscription update before invalidation", async () => {
    const webhook = request("app_subscriptions/update");
    webhook.headers.delete("X-Shopify-Hmac-Sha256");
    await expect(handle(webhook)).rejects.toBeInstanceOf(Response);
    expect(mocks.entitlementUpdate).not.toHaveBeenCalled();
    expect(mocks.redisDel).not.toHaveBeenCalled();
  });
  it("reproduces the installed SDK's 500 on an invalid refresh token", async () => {
    await expect(mocks.webhook(request())).rejects.toMatchObject({
      status: 500,
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.loadSession).toHaveBeenCalledWith(`offline_${shop}`);
  });

  it.each(["app/uninstalled", "shop/redact"])(
    "%s returns 200 and purges only the signed shop without refreshing",
    async (topic) => {
      expect((await handle(request(topic))).status).toBe(200);
      expect(mocks.webhook).not.toHaveBeenCalled();
      expect(mocks.loadSession).not.toHaveBeenCalled();
      expect(mocks.fetch).not.toHaveBeenCalled();
      expect(mocks.findSessions).toHaveBeenCalledWith(shop);
      expect(mocks.deleteSessions).toHaveBeenCalledWith([`offline_${shop}`]);
      expect(mocks.transaction).toHaveBeenCalledTimes(1);
      for (const [table, deleteMany] of Object.entries(mocks.deletes)) {
        const where =
          table === "bundleItem"
            ? { bundle: { shop } }
            : ["shop", "shopConfig"].includes(table)
              ? { shopDomain: shop }
              : ["event", "visitorSession"].includes(table)
                ? { storeId: shop }
                : { shop };
        expect(deleteMany, table).toHaveBeenCalledWith({ where });
      }
      expect(mocks.invalidateCatalog).toHaveBeenCalledWith(shop);
    },
  );

  it.each(["customers/data_request", "customers/redact"])(
    "%s is processed without an offline token refresh",
    async (topic) => {
      expect((await handle(request(topic))).status).toBe(200);
      expect(mocks.webhook).not.toHaveBeenCalled();
      expect(mocks.fetch).not.toHaveBeenCalled();
    },
  );

  it("updates only the signed shop's scopes without refreshing", async () => {
    const body = JSON.stringify({ current: ["read_products", "read_orders"] });
    expect((await handle(request("app/scopes_update", body))).status).toBe(200);
    expect(mocks.sessionUpdate).toHaveBeenCalledWith({
      where: { shop },
      data: { scope: "read_products,read_orders" },
    });
    expect(mocks.shopUpdate).toHaveBeenCalledWith({
      where: { shopDomain: shop },
      data: { scope: "read_products,read_orders" },
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("does not require a stored session for a valid uninstall", async () => {
    mocks.findSessions.mockResolvedValue([]);
    mocks.loadSession.mockResolvedValue(undefined);
    expect((await handle(request())).status).toBe(200);
    expect(mocks.deletes.session).toHaveBeenCalledWith({ where: { shop } });
    expect(mocks.deleteSessions).not.toHaveBeenCalled();
  });

  it("preserves SDK authentication for other topics", async () => {
    await expect(handle(request("products/update"))).rejects.toMatchObject({
      status: 500,
    });
    expect(mocks.webhook).toHaveBeenCalledTimes(1);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["forged", "missing", "tampered"])(
    "rejects %s signatures before any deletion or refresh",
    async (kind) => {
      let webhook = request();
      if (kind === "forged") {
        webhook.headers.set("X-Shopify-Hmac-Sha256", "forged-signature");
      } else if (kind === "missing") {
        webhook.headers.delete("X-Shopify-Hmac-Sha256");
      } else {
        webhook = new Request(webhook.url, {
          method: "POST",
          headers: webhook.headers,
          body: '{"tampered":true}',
        });
      }
      await expect(handle(webhook)).rejects.toMatchObject({
        status: kind === "missing" ? 400 : 401,
      });
      expect(mocks.transaction).not.toHaveBeenCalled();
      expect(mocks.findSessions).not.toHaveBeenCalled();
      expect(mocks.fetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    "X-Shopify-Shop-Domain",
    "X-Shopify-Api-Version",
    "X-Shopify-Webhook-Id",
  ])("requires the %s header", async (header) => {
    const webhook = request();
    webhook.headers.delete(header);
    await expect(handle(webhook)).rejects.toMatchObject({ status: 400 });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects non-POST requests", async () => {
    await expect(handle(new Request(request().url))).rejects.toMatchObject({
      status: 405,
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects signed malformed JSON without deleting data", async () => {
    await expect(handle(request("shop/redact", "{"))).rejects.toMatchObject({
      status: 400,
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
