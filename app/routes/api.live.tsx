import { data as json, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import {
  getPendingStorefrontLiveEvents,
  LIVE_POLL_INTERVAL_MS,
} from "../models/liveEvents.server";
import { isLiveEventsEnabled } from "../models/settings.server";
import { cacheKeys, incrementRateLimit } from "../redis.server";
import { optionsResponse, withCors } from "../utils/cors.server";
import {
  authenticateStorefrontRequest,
  isStorefrontAuthError,
  logStorefrontAuthError,
} from "../utils/storefrontAuth.server";
import { getStorefrontSessionRecovery } from "../utils/storefrontSessionRecovery.server";

const LIVE_REQUESTS_PER_MINUTE = 12;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") return optionsResponse();

  const url = new URL(request.url);
  return handleLiveRequest(request, {
    shop: url.searchParams.get("shop"),
    sessionId: url.searchParams.get("sessionId"),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") return optionsResponse();
  if (request.method !== "POST") {
    return json(
      { error: "Method not allowed" },
      { status: 405, headers: liveHeaders() },
    );
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 4096) {
    return json(
      { error: "Request payload too large" },
      { status: 413, headers: liveHeaders() },
    );
  }

  try {
    const body = (await request.json()) as LiveAuthInput;
    return handleLiveRequest(request, body);
  } catch {
    return json(
      { error: "Invalid JSON" },
      { status: 400, headers: liveHeaders() },
    );
  }
};

type LiveAuthInput = {
  shop?: unknown;
  sessionId?: unknown;
  sessionToken?: unknown;
};

async function handleLiveRequest(request: Request, credentials: LiveAuthInput) {
  try {
    const auth = authenticateStorefrontRequest(request, credentials);

    if (!isLiveEventsEnabled()) {
      return liveJson({ enabled: false, events: [] });
    }

    const requestCount = await incrementRateLimit(
      cacheKeys.liveRateLimit(auth.sessionId),
      60,
    );
    if (requestCount > LIVE_REQUESTS_PER_MINUTE) {
      return json(
        {
          enabled: true,
          events: [],
          pollAfterMs: LIVE_POLL_INTERVAL_MS,
          error: "Rate limited",
        },
        {
          status: 429,
          headers: liveHeaders({ "Retry-After": "60" }),
        },
      );
    }

    const events = await getPendingStorefrontLiveEvents({
      shop: auth.shop,
      sessionId: auth.sessionId,
    });
    return liveJson({ enabled: true, events });
  } catch (error) {
    if (isStorefrontAuthError(error)) {
      const storefrontSession = await getStorefrontSessionRecovery(request);
      logStorefrontAuthError(request, "api.live", error);
      return json(
        {
          enabled: false,
          events: [],
          error: "Unauthorized",
          reauth: Boolean(storefrontSession),
          storefrontSession,
        },
        {
          status: error.status,
          headers: liveHeaders(
            storefrontSession ? { "X-AOVBoost-Reauth": "true" } : undefined,
          ),
        },
      );
    }

    console.error(
      "AOVBoost live event polling failed:",
      error instanceof Error ? error.message : String(error),
    );
    return json(
      {
        enabled: true,
        events: [],
        pollAfterMs: LIVE_POLL_INTERVAL_MS,
        error: "Live updates unavailable",
      },
      { status: 500, headers: liveHeaders() },
    );
  }
}

function liveJson(value: {
  enabled: boolean;
  events: unknown[];
}) {
  return json(
    { ...value, pollAfterMs: LIVE_POLL_INTERVAL_MS },
    { headers: liveHeaders() },
  );
}

function liveHeaders(headers?: HeadersInit) {
  return withCors({
    "Cache-Control": "no-store, no-cache, must-revalidate, no-transform",
    ...(headers || {}),
  });
}
