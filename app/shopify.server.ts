import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import prisma from "./db.server";
import { ensureExpiringOfflineToken } from "./services/offline-token-migration.server";
import { UpstashSessionStorage } from "./upstash-session-storage.server";

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
  id: string;
  shop: string;
  state: string;
  isOnline: boolean;
  scope?: string;
  expires?: Date;
  accessToken?: string;
  refreshToken?: string;
  refreshTokenExpires?: Date;
  onlineAccessInfo?: {
    associated_user?: {
      id?: number;
      first_name?: string;
      last_name?: string;
      email?: string;
      account_owner?: boolean;
      locale?: string;
      collaborator?: boolean;
      email_verified?: boolean;
    };
  };
}) {
  try {
    const user = session.onlineAccessInfo?.associated_user;
    await prisma.session.upsert({
      where: { id: session.id },
      update: {
        shop: session.shop,
        accessToken: session.accessToken || "",
        scope: session.scope || null,
        expires: session.expires || null,
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
export const apiVersion = ApiVersion.July26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
const authenticateAdmin = shopify.authenticate.admin;
export const authenticate = {
  ...shopify.authenticate,
  admin: async (request: Request) => {
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
  },
} as typeof shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const sessionStorage = shopify.sessionStorage;
