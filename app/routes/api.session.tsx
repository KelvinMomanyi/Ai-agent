import { isInstalledShop } from "../models/installedShop.server";
import { data as json, type LoaderFunctionArgs } from "react-router";
import { getPublicAppSettings } from "../models/settings.server";
import { recordAuthenticatedStorefrontSession } from "../models/onboarding.server";
import { enrollHoldout } from "../models/holdout.server";
import { schedulePairingDrain } from "../jobs/pairingAutopilot.server";
import {
  getThemeConfig,
  scheduleThemeSession,
} from "../models/themeCompatibility.server";
import {
  isStorefrontAuthError,
  issueStorefrontSession,
  renewalSessionId,
  logStorefrontAuthError,
  verifyAppProxyRequest,
} from "../utils/storefrontAuth.server";
import { optionsResponse, withCors } from "../utils/cors.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") return optionsResponse();

  try {
    const { shop } = verifyAppProxyRequest(request);
    if (!shop || !(await isInstalledShop(shop))) {
      return json(
        { error: "Invalid shop" },
        { status: 401, headers: withCors() },
      );
    }

    const identity = renewalSessionId(request, shop);
    const initial = identity
      ? issueStorefrontSession(shop, { sessionId: identity })
      : issueStorefrontSession(shop);
    const [measurement, settings] = await Promise.all([
      enrollHoldout(shop, initial.sessionId),
      getPublicAppSettings(shop),
    ]);
    const storefrontSession = measurement
      ? issueStorefrontSession(shop, {
          sessionId: initial.sessionId,
          holdout: {
            arm: measurement.arm,
            version: measurement.version,
            percent: measurement.percent,
          },
        })
      : initial;
    try {
      await recordAuthenticatedStorefrontSession(shop);
    } catch {
      // Onboarding telemetry must not break a successfully authenticated session.
      console.warn(
        "AOVBoost storefront connection receipt could not be saved",
        { shop },
      );
    }
    schedulePairingDrain(shop);
    const rawTheme = new URL(request.url).searchParams.get("theme");
    let theme;
    if (rawTheme && rawTheme.length <= 512) {
      try {
        const identity = JSON.parse(rawTheme);
        theme = await getThemeConfig(shop, identity);
        scheduleThemeSession(shop, initial.sessionId, identity);
      } catch {
        /* Advisory theme detection never breaks a signed session. */
      }
    }
    return json(
      {
        ...storefrontSession,
        settings,
        measurement,
        ...(theme ? { theme } : {}),
      },
      {
        headers: withCors({ "Cache-Control": "no-store" }),
      },
    );
  } catch (error) {
    const status = isStorefrontAuthError(error) ? error.status : 500;
    if (isStorefrontAuthError(error)) {
      logStorefrontAuthError(request, "api.session", error);
    }
    return json({ error: "Unauthorized" }, { status, headers: withCors() });
  }
};
