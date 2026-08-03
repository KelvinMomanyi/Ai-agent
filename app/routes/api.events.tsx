import { data as json, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { ingestStorefrontEvents } from "../models/event.server";
import type { StorefrontEvent } from "../models/session.server";
import { cacheKeys, incrementRateLimit } from "../redis.server";
import { optionsResponse, withCors } from "../utils/cors.server";
import {
  authenticateStorefrontRequest,
  isStorefrontAuthError,
  logStorefrontAuthError,
} from "../utils/storefrontAuth.server";
import { getStorefrontSessionRecovery } from "../utils/storefrontSessionRecovery.server";

type EventsBody = {
  sessionId?: string;
  sessionToken?: string;
  shop?: string;
  events?: StorefrontEvent[];
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") return optionsResponse();
  return json({ ok: true }, { headers: withCors() });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") return optionsResponse();

  try {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 128_000) {
      return json(
        { ok: false, error: "Event payload too large" },
        { status: 413, headers: withCors() },
      );
    }
    const body = (await request.json()) as EventsBody;
    const auth = authenticateStorefrontRequest(request, body);
    const { shop, sessionId } = auth;

    if (!shop || !(await isInstalledShop(shop))) {
      return json({ ok: false, error: "Invalid shop" }, { status: 401, headers: withCors() });
    }

    if (!Array.isArray(body.events) || body.events.length > 100) {
      return json(
        { ok: false, error: "Events must contain at most 100 items" },
        { status: 400, headers: withCors() },
      );
    }
    if (JSON.stringify(body.events).length > 128_000) {
      return json(
        { ok: false, error: "Event payload too large" },
        { status: 413, headers: withCors() },
      );
    }

    const eventRequestCount = await incrementRateLimit(
      cacheKeys.eventsRateLimit(sessionId),
      60,
    );
    if (eventRequestCount > 30) {
      return json(
        { ok: false, error: "Rate limited" },
        {
          status: 429,
          headers: withCors({ "Retry-After": "60" }),
        },
      );
    }

    const events = body.events
      .map(sanitizeEvent)
      .filter((event): event is StorefrontEvent => Boolean(event));

    await ingestStorefrontEvents({
      shop,
      sessionId,
      events: events.map((event) => ({ ...event, shop, sessionId })),
    });

    return json({ ok: true }, { headers: withCors() });
  } catch (error) {
    if (isStorefrontAuthError(error)) {
      const storefrontSession = await getStorefrontSessionRecovery(request);
      logStorefrontAuthError(request, "api.events", error);
      return json(
        {
          ok: false,
          error: "Unauthorized",
          reauth: Boolean(storefrontSession),
          storefrontSession,
        },
        {
          status: error.status,
          headers: withCors(
            storefrontSession ? { "X-AOVBoost-Reauth": "true" } : undefined,
          ),
        },
      );
    }

    console.error("AOVBoost event ingestion failed:", getErrorMessage(error));
    return json({ ok: false }, { status: 500, headers: withCors() });
  }
};

async function isInstalledShop(shop: string) {
  const [session, legacyShop] = await Promise.all([
    prisma.session.findFirst({ where: { shop }, select: { id: true } }),
    prisma.shop.findUnique({ where: { shopDomain: shop }, select: { shopDomain: true } }),
  ]);

  return Boolean(session || legacyShop);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function sanitizeEvent(value: unknown): StorefrontEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  const type = String(event.type || "").trim().slice(0, 64);
  if (!/^[a-z][a-z0-9_:-]*$/i.test(type)) return null;

  const timestamp = Number(event.ts);
  return {
    ...event,
    type,
    ...(Number.isFinite(timestamp) ? { ts: timestamp } : { ts: Date.now() }),
  };
}
