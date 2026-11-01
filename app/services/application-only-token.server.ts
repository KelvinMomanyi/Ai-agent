import { createPrivateKey, randomUUID } from "node:crypto";
// jsonwebtoken is CommonJS; Node exposes module.exports as the default.
// eslint-disable-next-line import/default
import jwt from "jsonwebtoken";
import { HttpResponseError, Session } from "@shopify/shopify-api";
import type { UnauthenticatedAdminContext } from "@shopify/shopify-app-react-router/server";
import { getTokenApi } from "./offline-token-migration.server";

// eslint-disable-next-line import/no-named-as-default-member
const { sign } = jwt;

type ApplicationToken = {
  accessToken: string;
  scope: string;
  expires: Date;
  renewAt: number;
};

const cachedTokens = new Map<string, ApplicationToken>();
const pendingTokens = new Map<string, Promise<ApplicationToken>>();

export function hasApplicationOnlyCredentials() {
  return Boolean(process.env.SHOPIFY_KEY_ID && process.env.SHOPIFY_PRIVATE_KEY);
}

export function assertPermanentShopDomain(shop: string) {
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) {
    throw new Error("Use the store's permanent lowercase myshopify.com domain");
  }
}

export function createClientAssertion(shop: string) {
  assertPermanentShopDomain(shop);
  const clientId = process.env.SHOPIFY_API_KEY;
  const keyId = process.env.SHOPIFY_KEY_ID;
  const pem = process.env.SHOPIFY_PRIVATE_KEY;
  if (!clientId || !keyId || !pem) {
    throw new Error(
      "SHOPIFY_API_KEY, SHOPIFY_KEY_ID and SHOPIFY_PRIVATE_KEY are required for application-only access",
    );
  }

  const key = createPrivateKey(pem.replace(/\\n/g, "\n"));
  const algorithm =
    key.asymmetricKeyType === "rsa"
      ? "RS256"
      : key.asymmetricKeyType === "ec" &&
          key.asymmetricKeyDetails?.namedCurve === "prime256v1"
        ? "ES256"
        : undefined;
  if (!algorithm) throw new Error("Use an RSA or P-256 EC signing key");

  return sign({}, key, {
    algorithm,
    keyid: keyId,
    issuer: clientId,
    subject: clientId,
    audience: `https://${shop}/admin/oauth/access_token`,
    expiresIn: 60,
    jwtid: randomUUID(),
  });
}

export async function getApplicationOnlyToken(shop: string) {
  assertPermanentShopDomain(shop);
  const cacheKey = `${process.env.SHOPIFY_API_KEY}:${process.env.SHOPIFY_KEY_ID}:${shop}`;
  const cached = cachedTokens.get(cacheKey);
  if (cached && Date.now() < cached.renewAt) return cached;
  const pending = pendingTokens.get(cacheKey);
  if (pending) return pending;

  const request = requestToken(shop)
    .then((token) => {
      cachedTokens.set(cacheKey, token);
      return token;
    })
    .finally(() => pendingTokens.delete(cacheKey));
  pendingTokens.set(cacheKey, request);
  return request;
}

export function invalidateApplicationOnlyToken(shop: string) {
  cachedTokens.delete(
    `${process.env.SHOPIFY_API_KEY}:${process.env.SHOPIFY_KEY_ID}:${shop}`,
  );
}

async function requestToken(shop: string): Promise<ApplicationToken> {
  for (let attempt = 1; ; attempt += 1) {
    // Shopify accepts a jti only once, including after a failed request.
    const assertion = createClientAssertion(shop);
    const requestedAt = Date.now();
    let response: Response;
    try {
      response = await fetch(`https://${shop}/admin/oauth/access_token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: process.env.SHOPIFY_API_KEY!,
          client_assertion_type:
            "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
          client_assertion: assertion,
        }),
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      if (attempt >= 3) {
        throw new Error(
          "Shopify application-only token request failed after 3 attempts",
        );
      }
      await retryDelay(attempt);
      continue;
    }

    if (response.status >= 500 && attempt < 3) {
      await retryDelay(attempt);
      continue;
    }
    if (!response.ok) {
      // Never include raw OAuth responses, assertions or credentials in errors.
      throw new Error(
        `Shopify application-only token request returned HTTP ${response.status}`,
      );
    }

    const data = await response.json();
    if (
      typeof data?.access_token !== "string" ||
      !data.access_token ||
      typeof data.scope !== "string" ||
      !Number.isInteger(data.expires_in) ||
      data.expires_in <= 0
    ) {
      throw new Error(
        "Shopify returned incomplete application-only token data",
      );
    }
    const renewBeforeSeconds = 180 + Math.random() * 300;
    return {
      accessToken: data.access_token,
      scope: data.scope,
      expires: new Date(requestedAt + data.expires_in * 1000),
      renewAt:
        requestedAt +
        Math.max(data.expires_in / 2, data.expires_in - renewBeforeSeconds) *
          1000,
    };
  }
}

function retryDelay(attempt: number) {
  return new Promise((resolve) =>
    setTimeout(
      resolve,
      2 ** (attempt - 1) * 1000 + Math.floor(Math.random() * 250),
    ),
  );
}

function tokenSession(shop: string, token: ApplicationToken) {
  return new Session({
    id: `application_only_${shop}`,
    shop,
    state: "",
    isOnline: false,
    accessToken: token.accessToken,
    scope: token.scope,
    expires: token.expires,
  });
}

export async function getApplicationOnlyAdminContext(
  shop: string,
): Promise<UnauthenticatedAdminContext> {
  const token = await getApplicationOnlyToken(shop);
  return {
    // This context is never written over the offline access/refresh pair.
    session: tokenSession(shop, token),
    admin: {
      graphql: async (operation, options) => {
        for (let attempt = 0; ; attempt += 1) {
          const current = await getApplicationOnlyToken(shop);
          const client = new (getTokenApi().clients.Graphql)({
            session: tokenSession(shop, current),
            apiVersion: options?.apiVersion,
          });
          try {
            const result = await client.request(operation, {
              variables: options?.variables,
              retries: options?.tries ? options.tries - 1 : 0,
              headers: options?.headers,
              signal: options?.signal,
            });
            return new Response(JSON.stringify(result));
          } catch (error) {
            if (
              error instanceof HttpResponseError &&
              error.response.code === 401
            ) {
              invalidateApplicationOnlyToken(shop);
              if (attempt === 0) continue;
            }
            throw error;
          }
        }
      },
    },
  };
}
