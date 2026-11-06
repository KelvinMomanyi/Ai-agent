import {
  data as json,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { getPublicAppSettings } from "../models/settings.server";
import { enrollHoldout } from "../models/holdout.server";
import {
  getThemeConfig,
  scheduleThemeSession,
} from "../models/themeCompatibility.server";
import { optionsResponse, withCors } from "../utils/cors.server";
import {
  authenticateStorefrontRequest,
  isStorefrontAuthError,
  logStorefrontAuthError,
} from "../utils/storefrontAuth.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") return optionsResponse();
  return json(
    { error: "Method not allowed" },
    { status: 405, headers: withCors() },
  );
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") return optionsResponse();

  try {
    const body = (await request.json()) as {
      shop?: string;
      sessionId?: string;
      sessionToken?: string;
      theme?: unknown;
    };
    const { shop, sessionId } = authenticateStorefrontRequest(request, body);
    let theme;
    if (body.theme) {
      try {
        theme = await getThemeConfig(shop, body.theme);
        scheduleThemeSession(shop, sessionId, body.theme);
      } catch {
        /* Keep ordinary config available during advisory-report failure. */
      }
    }
    return json(
      {
        settings: await getPublicAppSettings(shop),
        measurement: await enrollHoldout(shop, sessionId),
        ...(theme ? { theme } : {}),
      },
      { headers: withCors({ "Cache-Control": "no-store" }) },
    );
  } catch (error) {
    if (isStorefrontAuthError(error)) {
      logStorefrontAuthError(request, "api.config", error);
      return json(
        { error: "Unauthorized" },
        { status: error.status, headers: withCors() },
      );
    }
    console.error("AOVBoost storefront config failed:", error);
    return json(
      { error: "Configuration unavailable" },
      { status: 500, headers: withCors() },
    );
  }
};
