import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import prisma from "./db.server";
import { ensureExpiringOfflineToken } from "./services/offline-token-migration.server";
import {
  assertPermanentShopDomain,
  getApplicationOnlyAdminContext,
  hasApplicationOnlyCredentials,
} from "./services/application-only-token.server";
import {
  SessionPersistenceError,
  UpstashSessionStorage,
} from "./upstash-session-storage.server";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.July26,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new UpstashSessionStorage(),
  distribution: AppDistribution.AppStore,
  future: {
    expiringOfflineAccessTokens: true,
  },
  hooks: {
    afterAuth: async ({ session }) => {
      await persistShopToPrisma(session);
    },
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

async function persistShopToPrisma(session: {
  shop: string;
  scope?: string;
}) {
  try {
    // Session storage has already saved credentials before afterAuth runs.
    await prisma.shop.upsert({
      where: { shopDomain: session.shop },
      update: { scope: session.scope || null },
      create: {
        shopDomain: session.shop,
        // Required legacy column; no runtime consumer reads this credential.
        accessToken: "",
        scope: session.scope || null,
      },
    });
  } catch {
    console.error("Failed to persist shop metadata to Prisma", {
      shop: session.shop,
    });
  }
}

export default shopify;
export const apiVersion = ApiVersion.July26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
const authenticateAdmin = shopify.authenticate.admin;
export const authenticate = {
  ...shopify.authenticate,
  admin: async (request: Request) => {
    try {
      const context = await authenticateAdmin(request);
      const session = await ensureExpiringOfflineToken(
        context.session,
        shopify.sessionStorage,
      );
      if (session === context.session) return context;

      const refreshed = await shopify.unauthenticated.admin(session.shop);
      return {
        ...context,
        session: refreshed.session,
        admin: refreshed.admin,
      };
    } catch (error) {
      if (error instanceof SessionPersistenceError) {
        throw new Response("Shopify credentials could not be saved. Please retry.", {
          status: 503,
          headers: { "Retry-After": "1" },
        });
      }
      throw error;
    }
  },
} as typeof shopify.authenticate;
export const unauthenticated: typeof shopify.unauthenticated = {
  ...shopify.unauthenticated,
  admin: async (shop) => {
    assertPermanentShopDomain(shop);
    if (hasApplicationOnlyCredentials()) {
      return getApplicationOnlyAdminContext(shop);
    }

    const stored = await shopify.sessionStorage.loadSession(`offline_${shop}`);
    if (stored) {
      await ensureExpiringOfflineToken(stored, shopify.sessionStorage);
    }
    return shopify.unauthenticated.admin(shop);
  },
};
export const login = shopify.login;
export const sessionStorage = shopify.sessionStorage;
