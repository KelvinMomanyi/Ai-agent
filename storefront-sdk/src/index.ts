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
  };
};

declare global {
  interface Window {
    AOVBoost?: AovBoostConfig;
    AOVBoostSDK?: {
      shop: string;
      sessionId: string;
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

  try {
    const config = window.AOVBoost || {};
    const shop = config.shop;
    if (!shop) return;

    const apiBase = config.apiBase || "/api";
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

    sessionManager.init();
    eventBus.init();
    offerPoller.init();

    window.AOVBoostSDK = {
      shop,
      sessionId: sessionManager.anonymousId,
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

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
