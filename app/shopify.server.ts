import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  DeliveryMethod,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { restResources } from "@shopify/shopify-api/rest/admin/2023-10";
import prisma from "./db.server";
import { UpstashSessionStorage } from "./upstash-session-storage.server";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.January25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new UpstashSessionStorage(),
  distribution: AppDistribution.AppStore,
  restResources,
  webhooks: {
    APP_UNINSTALLED: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/api/webhooks",
    },
    PRODUCTS_CREATE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/api/webhooks",
    },
    PRODUCTS_UPDATE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/api/webhooks",
    },
    PRODUCTS_DELETE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/api/webhooks",
    },
    ORDERS_CREATE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/api/webhooks",
    },
  },
  hooks: {
    afterAuth: async ({ session }) => {
      shopify.registerWebhooks({ session });
      await persistShopToPrisma(session);
    },
  },
  future: {
    unstable_newEmbeddedAuthStrategy: true,
    removeRest: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

async function persistShopToPrisma(session: { id: string; shop: string; state: string; isOnline: boolean; scope?: string; expires?: Date; accessToken?: string; onlineAccessInfo?: { associated_user?: { id?: number; first_name?: string; last_name?: string; email?: string; account_owner?: boolean; locale?: string; collaborator?: boolean; email_verified?: boolean } } }) {
  try {
    const user = session.onlineAccessInfo?.associated_user;
    await prisma.session.upsert({
      where: { id: session.id },
      update: {
        shop: session.shop,
        accessToken: session.accessToken || "",
        scope: session.scope || null,
        expires: session.expires || null,
      },
      create: {
        id: session.id,
        shop: session.shop,
        state: session.state,
        isOnline: session.isOnline,
        scope: session.scope || null,
        expires: session.expires || null,
        accessToken: session.accessToken || "",
        userId: user?.id ? BigInt(user.id) : null,
        firstName: user?.first_name || null,
        lastName: user?.last_name || null,
        email: user?.email || null,
        accountOwner: user?.account_owner ?? false,
        locale: user?.locale || null,
        collaborator: user?.collaborator ?? null,
        emailVerified: user?.email_verified ?? null,
      },
    });
    await prisma.shop.upsert({
      where: { shopDomain: session.shop },
      update: { accessToken: session.accessToken || "" },
      create: {
        shopDomain: session.shop,
        accessToken: session.accessToken || "",
        scope: session.scope || null,
      },
    });
  } catch (error) {
    console.error("Failed to persist shop to Prisma:", error);
  }
}

export default shopify;
export const apiVersion = ApiVersion.January25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
