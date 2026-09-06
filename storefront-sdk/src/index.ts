import { EventBus } from "./eventBus";
import { hasTrackingConsent, waitForTrackingConsent } from "./consent";
import { LiveUpdates } from "./liveUpdates";
import { OfferPoller } from "./offerPoller";
import { SessionManager } from "./sessionManager";
import { TriggerRouter } from "./triggerRouter";
import { WidgetManager } from "./widgets/widgetManager";
import "./styles/widgets.css";

type AovBoostConfig = {
  shop?: string;
  currency?: string;
  currencyCode?: string;
  moneyFormat?: string;
  moneyWithCurrencyFormat?: string;
  locale?: string;
  cartToken?: string;
  apiBase?: string;
  settings?: {
    trackingConsentRequired?: boolean;
  };
};

declare global {
  interface Window {
    AOVBoost?: AovBoostConfig;
    AOVBoostSDK?: {
      shop: string;
      sessionId: string;
      sessionToken: string;
      refreshSession: () => Promise<void>;
      getSignedAuthPayload: () => Promise<{
        sessionId: string;
        sessionToken: string;
        shop: string;
      } | null>;
      applySession: (session: unknown) => boolean;
      track: (type: string, payload?: Record<string, unknown>) => void;
      trigger: (type: string, payload?: Record<string, unknown>) => void;
      requestOffer: (
        trigger?: string,
        payload?: Record<string, unknown>,
      ) => Promise<unknown>;
      diagnose: () => unknown;
      destroy: () => void;
    };
  }
}

let started = false;

export function init(): void {
  if (started) return;
  started = true;

  start().catch((error) => {
    console.log(
      "AOVBoost SDK skipped:",
      error instanceof Error ? error.message : String(error),
    );
  });
}

async function start(): Promise<void> {
  try {
    const config = window.AOVBoost || {};
    const shop = config.shop;
    if (!shop) return;
    if (!hasTrackingConsent(config)) {
      await waitForTrackingConsent(config);
    }

    const apiBase = normalizeProxyApiBase(config.apiBase);
    const sessionManager = new SessionManager(shop, apiBase);
    await sessionManager.init();
    const widgetManager = new WidgetManager(sessionManager.getSettings());
    const eventBus = new EventBus({ shop, sessionManager, apiBase });
    const offerPoller = new OfferPoller({
      shop,
      apiBase,
      eventBus,
      sessionManager,
      widgetManager,
    });
    const triggerRouter = new TriggerRouter({
      eventBus,
      offerPoller,
      sessionManager,
    });
    const liveUpdates = new LiveUpdates({ apiBase, sessionManager });

    window.AOVBoostSDK = {
      shop,
      sessionId: sessionManager.anonymousId,
      sessionToken: sessionManager.getAuthPayload().sessionToken,
      refreshSession: async () => {
        await sessionManager.refreshAuth();
        sessionManager.syncGlobalSdkAuth();
      },
      getSignedAuthPayload: () => sessionManager.getSignedAuthPayload(),
      applySession: (session) => sessionManager.applyStorefrontSession(session),
      track: (type, payload = {}) => eventBus.track(type, payload),
      trigger: (type, payload = {}) => triggerRouter.trigger(type, payload),
      requestOffer: (trigger = "global", payload = {}) =>
        offerPoller.requestOffer(trigger, payload),
      diagnose: () => offerPoller.getStatus(),
      destroy: () => {
        liveUpdates.destroy();
        triggerRouter.destroy();
        offerPoller.destroy();
        sessionManager.destroy();
        widgetManager.destroyActive();
      },
    };

    triggerRouter.init();
    eventBus.init();
    offerPoller.init();
    if (sessionManager.getSettings().liveEventsEnabled === true) {
      liveUpdates.init();
    }
  } catch (error) {
    console.log(
      "AOVBoost SDK skipped:",
      error instanceof Error ? error.message : String(error),
    );
  }
}

function normalizeProxyApiBase(value?: string) {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (!candidate || candidate === "/api" || candidate.startsWith("/api/")) {
    return "/apps/aovboost";
  }
  if (candidate.includes("/apps/aovboost")) return candidate;
  if (candidate.startsWith("/apps/")) return candidate;
  return "/apps/aovboost";
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
