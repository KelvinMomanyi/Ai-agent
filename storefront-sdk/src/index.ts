import { EventBus } from "./eventBus";
import { OfferPoller } from "./offerPoller";
import { SessionManager } from "./sessionManager";
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
      track: (type: string, payload?: Record<string, unknown>) => void;
      requestOffer: () => Promise<unknown>;
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

    const apiBase = config.apiBase || "/apps/aovboost";
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

    await sessionManager.init();
    eventBus.init();
    offerPoller.init();

    window.AOVBoostSDK = {
      shop,
      sessionId: sessionManager.anonymousId,
      sessionToken: sessionManager.getAuthPayload().sessionToken,
      track: (type, payload = {}) => eventBus.track(type, payload),
      requestOffer: () => offerPoller.requestOffer("global"),
      destroy: () => {
        offerPoller.destroy();
        sessionManager.destroy();
        widgetManager.destroyActive();
      },
    };
  } catch (error) {
    console.log(
      "AOVBoost SDK skipped:",
      error instanceof Error ? error.message : String(error),
    );
  }
}

function hasTrackingConsent(config: AovBoostConfig) {
  const privacy = (window as any).Shopify?.customerPrivacy;
  if (privacy?.analyticsProcessingAllowed instanceof Function) {
    return Boolean(privacy.analyticsProcessingAllowed());
  }
  if (privacy?.userCanBeTracked instanceof Function) {
    return Boolean(privacy.userCanBeTracked());
  }
  return config.settings?.trackingConsentRequired !== true;
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
