import crypto from "node:crypto";

const TOKEN_TTL_SECONDS = 12 * 60 * 60;
const MAX_PROXY_AGE_SECONDS = 5 * 60;

type StorefrontTokenPayload = {
  v: 1;
  shop: string;
  sid: string;
  iat: number;
  exp: number;
};

export type StorefrontAuth = {
  shop: string;
  sessionId: string;
  customerId: string | null;
};

export class StorefrontAuthError extends Error {
  constructor(
    message: string,
    readonly status = 401,
  ) {
    super(message);
  }
}

export function verifyAppProxyRequest(request: Request) {
  const url = new URL(request.url);
  const signature = url.searchParams.get("signature");
  const shop = url.searchParams.get("shop")?.trim() || "";
  const timestamp = Number(url.searchParams.get("timestamp") || 0);
  const customerId = url.searchParams.get("logged_in_customer_id") || null;

  if (process.env.AOVBOOST_ALLOW_UNSIGNED_PROXY === "true") {
    return { shop, customerId };
  }

  if (!signature || !shop || !timestamp) {
    throw new StorefrontAuthError("Missing app proxy signature");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestamp) > MAX_PROXY_AGE_SECONDS) {
    throw new StorefrontAuthError("Expired app proxy signature");
  }

  const expected = hmacHex(getSharedSecret(), getAppProxySignaturePayload(url));
  if (!safeCompareHex(signature, expected)) {
    throw new StorefrontAuthError("Invalid app proxy signature");
  }

  return { shop, customerId };
}

export function issueStorefrontSession(shop: string) {
  const sessionId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + TOKEN_TTL_SECONDS;
  const payload: StorefrontTokenPayload = {
    v: 1,
    shop,
    sid: sessionId,
    iat: now,
    exp: expiresAt,
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = base64UrlEncode(
    crypto.createHmac("sha256", getTokenSecret()).update(encodedPayload).digest(),
  );

  return {
    shop,
    sessionId,
    sessionToken: `v1.${encodedPayload}.${signature}`,
    expiresAt,
  };
}

export function authenticateStorefrontRequest(
  request: Request,
  body: { shop?: unknown; sessionId?: unknown; sessionToken?: unknown },
): StorefrontAuth {
  const proxy = verifyAppProxyRequest(request);
  const bodyShop = typeof body.shop === "string" ? body.shop.trim() : "";
  const bodySessionId =
    typeof body.sessionId === "string" ? body.sessionId.trim() : "";

  if (!proxy.shop) {
    throw new StorefrontAuthError("Missing shop");
  }
  if (bodyShop && bodyShop !== proxy.shop) {
    throw new StorefrontAuthError("Shop mismatch");
  }

  const token =
    typeof body.sessionToken === "string" && body.sessionToken.trim()
      ? body.sessionToken.trim()
      : getBearerToken(request);
  const payload = verifyStorefrontSessionToken(token, proxy.shop);

  if (bodySessionId && bodySessionId !== payload.sid) {
    throw new StorefrontAuthError("Session mismatch");
  }

  return {
    shop: proxy.shop,
    sessionId: payload.sid,
    customerId: proxy.customerId,
  };
}

export function isStorefrontAuthError(error: unknown): error is StorefrontAuthError {
  return error instanceof StorefrontAuthError;
}

export function logStorefrontAuthError(
  request: Request,
  route: string,
  error: StorefrontAuthError,
) {
  const url = new URL(request.url);
  console.warn("AOVBoost storefront auth rejected:", {
    route,
    reason: error.message,
    status: error.status,
    path: url.pathname,
    hasSignature: url.searchParams.has("signature"),
    hasShop: url.searchParams.has("shop"),
    hasTimestamp: url.searchParams.has("timestamp"),
  });
}

function verifyStorefrontSessionToken(token: string, shop: string) {
  const [version, encodedPayload, signature] = token.split(".");
  if (!token) {
    throw new StorefrontAuthError("Missing storefront session token");
  }
  if (version !== "v1" || !encodedPayload || !signature) {
    throw new StorefrontAuthError("Malformed storefront session token");
  }

  const expected = base64UrlEncode(
    crypto.createHmac("sha256", getTokenSecret()).update(encodedPayload).digest(),
  );
  if (!safeCompare(signature, expected)) {
    throw new StorefrontAuthError("Invalid storefront session token signature");
  }

  let payload: StorefrontTokenPayload;
  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload)) as StorefrontTokenPayload;
  } catch {
    throw new StorefrontAuthError("Unreadable storefront session token");
  }

  if (payload.v !== 1 || !payload.sid) {
    throw new StorefrontAuthError("Invalid storefront session token payload");
  }
  if (payload.shop !== shop) {
    throw new StorefrontAuthError("Storefront session token shop mismatch");
  }
  if (payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new StorefrontAuthError("Expired storefront session token");
  }

  return payload;
}

function getAppProxySignaturePayload(url: URL) {
  const values = new Map<string, string[]>();

  url.searchParams.forEach((value, rawKey) => {
    if (rawKey === "signature") return;
    const key = rawKey.endsWith("[]") ? rawKey.slice(0, -2) : rawKey;
    const existing = values.get(key) || [];
    existing.push(value);
    values.set(key, existing);
  });

  return Array.from(values.entries())
    .map(([key, itemValues]) => `${key}=${itemValues.join(",")}`)
    .sort()
    .join("");
}

function getBearerToken(request: Request) {
  const authorization = request.headers.get("Authorization") || "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
}

function hmacHex(secret: string, value: string) {
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

function safeCompareHex(left: string, right: string) {
  if (!/^[a-f0-9]+$/i.test(left) || left.length !== right.length) return false;
  return safeCompare(left.toLowerCase(), right.toLowerCase());
}

function safeCompare(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function base64UrlEncode(value: string | Buffer) {
  const buffer = typeof value === "string" ? Buffer.from(value) : value;
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(value: string) {
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
    "utf8",
  );
}

function getSharedSecret() {
  const secret = process.env.SHOPIFY_API_SECRET || "";
  if (!secret) throw new StorefrontAuthError("Missing Shopify app secret", 500);
  return secret;
}

function getTokenSecret() {
  const secret =
    process.env.AOVBOOST_STOREFRONT_SESSION_SECRET ||
    process.env.SHOPIFY_API_SECRET ||
    "";
  if (!secret) throw new StorefrontAuthError("Missing storefront token secret", 500);
  return secret;
}
