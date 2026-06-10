import { EventBus } from "./eventBus";
import { OfferPoller } from "./offerPoller";
import { SessionManager } from "./sessionManager";
import { TriggerRouter } from "./triggerRouter";
import { WidgetManager } from "./widgets/widgetManager";
import "./styles/widgets.css";

type AovBoostConfig = {
  shop?: string;
  currency?: string;
  cartToken?: string;
  apiBase?: string;
  settings?: {
    chatEnabled?: boolean;
    tone?: string;
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
      track: (type: string, payload?: Record<string, unknown>) => void;
      trigger: (type: string, payload?: Record<string, unknown>) => void;
      requestOffer: (
        trigger?: string,
        payload?: Record<string, unknown>,
      ) => Promise<unknown>;
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
    const eventBus = new EventBus({ shop, sessionManager, apiBase });
    const widgetManager = new WidgetManager();
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

    await sessionManager.init();
    window.AOVBoostSDK = {
      shop,
      sessionId: sessionManager.anonymousId,
      sessionToken: sessionManager.getAuthPayload().sessionToken,
      refreshSession: async () => {
        await sessionManager.refreshAuth();
        if (window.AOVBoostSDK) {
          window.AOVBoostSDK.sessionId = sessionManager.anonymousId;
          window.AOVBoostSDK.sessionToken = sessionManager.getAuthPayload().sessionToken;
        }
      },
      track: (type, payload = {}) => eventBus.track(type, payload),
      trigger: (type, payload = {}) => triggerRouter.trigger(type, payload),
      requestOffer: (trigger = "global", payload = {}) =>
        offerPoller.requestOffer(trigger, payload),
      destroy: () => {
        triggerRouter.destroy();
        offerPoller.destroy();
        sessionManager.destroy();
        widgetManager.destroyActive();
      },
    };

    triggerRouter.init();
    eventBus.init();
    offerPoller.init();
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

function hasTrackingConsent(config: AovBoostConfig) {
  if (config.settings?.trackingConsentRequired !== true) return true;

  const privacy = (window as any).Shopify?.customerPrivacy;
  if (typeof privacy?.analyticsProcessingAllowed === "function") {
    return Boolean(privacy.analyticsProcessingAllowed());
  }
  if (typeof privacy?.userCanBeTracked === "function") {
    return Boolean(privacy.userCanBeTracked());
  }

  // Do not deadlock the assistant on stores that have not installed a consent API.
  return true;
}

function waitForTrackingConsent(config: AovBoostConfig) {
  return new Promise<void>((resolve) => {
    const complete = () => {
      if (!hasTrackingConsent({ ...config, settings: { ...config.settings, trackingConsentRequired: false } })) return;
      cleanup();
      resolve();
    };
    const cleanup = () => {
      [
        "visitorConsentCollected",
        "shopify:customer_privacy:consent_collected",
        "aovboost:consent-granted",
      ].forEach((eventName) => window.removeEventListener(eventName, complete));
    };

    [
      "visitorConsentCollected",
      "shopify:customer_privacy:consent_collected",
      "aovboost:consent-granted",
    ].forEach((eventName) => window.addEventListener(eventName, complete));
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
