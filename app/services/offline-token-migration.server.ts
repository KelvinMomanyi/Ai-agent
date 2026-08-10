import "@shopify/shopify-api/adapters/node";
import { ApiVersion, Session, shopifyApi } from "@shopify/shopify-api";
import type { SessionStorage } from "@shopify/shopify-app-session-storage";

type TokenMigrationResult = { session: Session };
type TokenMigrator = (input: {
  shop: string;
  nonExpiringOfflineAccessToken: string;
}) => Promise<TokenMigrationResult>;

const migrationsInFlight = new Map<string, Promise<Session>>();
let tokenApi: ReturnType<typeof shopifyApi> | undefined;

export class OfflineTokenMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OfflineTokenMigrationError";
  }
}

export function hasExpiringOfflineToken(session: Session) {
  return Boolean(
    !session.isOnline &&
    session.accessToken &&
    session.expires &&
    session.refreshToken &&
    session.refreshTokenExpires,
  );
}

export async function ensureExpiringOfflineToken(
  session: Session,
  storage: SessionStorage,
  migrateToken: TokenMigrator = migrateWithShopify,
): Promise<Session> {
  if (session.isOnline || hasExpiringOfflineToken(session)) return session;

  const existing = migrationsInFlight.get(session.shop);
  if (existing) return existing;

  const migration = migrateAndPersist(session, storage, migrateToken).finally(
    () => {
      migrationsInFlight.delete(session.shop);
    },
  );
  migrationsInFlight.set(session.shop, migration);
  return migration;
}

async function migrateAndPersist(
  suppliedSession: Session,
  storage: SessionStorage,
  migrateToken: TokenMigrator,
) {
  const storedSession = await storage.loadSession(suppliedSession.id);
  const session = storedSession || suppliedSession;
  if (hasExpiringOfflineToken(session)) return session;

  if (session.isOnline) {
    throw new OfflineTokenMigrationError(
      `Cannot migrate online session ${session.id} as an offline token`,
    );
  }
  if (!session.accessToken) {
    throw new OfflineTokenMigrationError(
      `Offline session ${session.id} has no access token`,
    );
  }
  if (session.expires || session.refreshToken || session.refreshTokenExpires) {
    throw new OfflineTokenMigrationError(
      `Offline session ${session.id} has incomplete expiry metadata and must be reauthorized`,
    );
  }

  let result: TokenMigrationResult;
  try {
    result = await migrateToken({
      shop: session.shop,
      nonExpiringOfflineAccessToken: session.accessToken,
    });
  } catch (error) {
    // Another server instance might have completed the irreversible exchange.
    // Reloading avoids failing this request when the rotated session is available.
    const latest = await storage.loadSession(session.id);
    if (latest && hasExpiringOfflineToken(latest)) return latest;
    throw error;
  }

  const migratedSession = result.session;
  if (
    migratedSession.id !== session.id ||
    migratedSession.shop !== session.shop ||
    !hasExpiringOfflineToken(migratedSession)
  ) {
    throw new OfflineTokenMigrationError(
      `Shopify returned incomplete expiring token data for ${session.shop}`,
    );
  }

  migratedSession.state = session.state;
  await persistRotatedSession(storage, migratedSession);
  return migratedSession;
}

async function persistRotatedSession(
  storage: SessionStorage,
  session: Session,
) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (await storage.storeSession(session)) return;
  }

  throw new OfflineTokenMigrationError(
    `Shopify migrated ${session.shop}, but the rotated credentials could not be persisted`,
  );
}

async function migrateWithShopify(input: {
  shop: string;
  nonExpiringOfflineAccessToken: string;
}) {
  return getTokenApi().auth.migrateToExpiringToken(input);
}

function getTokenApi() {
  if (tokenApi) return tokenApi;

  const apiKey = process.env.SHOPIFY_API_KEY;
  const apiSecretKey = process.env.SHOPIFY_API_SECRET;
  if (!apiKey || !apiSecretKey) {
    throw new OfflineTokenMigrationError(
      "SHOPIFY_API_KEY and SHOPIFY_API_SECRET are required for token migration",
    );
  }

  const appUrl = new URL(
    process.env.SHOPIFY_APP_URL || "http://localhost:3000",
  );
  tokenApi = shopifyApi({
    apiKey,
    apiSecretKey,
    apiVersion: ApiVersion.July26,
    scopes: process.env.SCOPES?.split(","),
    hostName: appUrl.host,
    hostScheme: appUrl.protocol === "http:" ? "http" : "https",
    isEmbeddedApp: true,
  });
  return tokenApi;
}
