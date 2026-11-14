import { EventBus } from "./eventBus";
import { hasTrackingConsent, waitForTrackingConsent } from "./consent";
import { LiveUpdates } from "./liveUpdates";
import { OfferPoller } from "./offerPoller";
import { SessionManager } from "./sessionManager";
import { TriggerRouter } from "./triggerRouter";
import { WidgetManager } from "./widgets/widgetManager";
import { MeasurementCartLink } from "./measurementCartLink";
import { themePreviewToken, readThemeIdentity } from "./theme/identity";
import { defaultThemeConfig } from "../../shared/themeCompatibility";
import { loadThemeEngine } from "./theme/loader";
import "./styles/widgets.css";
import { agentCoreEnabled } from "./agent/flag";
import { loadAgentCore } from "./agent/loader";

type AovBoostConfig = {
  agent_holdout_percent?: number;
  agentFacts?: import("./agent/OfferFacts").AgentFactsConfig;
  campaign?: unknown;
  agent_core_enabled?: boolean;
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
    agent_core_enabled?: boolean;
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
    const previewToken = themePreviewToken();
    if (previewToken) {
      await (
        await loadThemeEngine()
      ).runThemePreview({
        shop,
        apiBase: normalizeProxyApiBase(config.apiBase),
        token: previewToken,
      });
      return;
    }
    if (!hasTrackingConsent(config)) {
      await waitForTrackingConsent(config);
    }

    const apiBase = normalizeProxyApiBase(config.apiBase);
    const sessionManager = new SessionManager(shop, apiBase);
    await sessionManager.init();
    const settings = sessionManager.getSettings();
    const widgetManager = new WidgetManager({
      ...settings,
      themeCompatibility:
        settings.themeCompatibility ||
        defaultThemeConfig(readThemeIdentity().themeId),
    });
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
    const measurementLink = new MeasurementCartLink(sessionManager, eventBus);
    measurementLink.init();
    const coreEnabled = agentCoreEnabled(settings);
    const agent = coreEnabled
      ? await loadAgentCore()
          .then((module) =>
            module.createAgentCore({
              shop,
              apiBase,
              settings,
              visitorId: sessionManager.anonymousId,
              measurement: () => sessionManager.getMeasurement(),
              serverHoldout: () =>
                sessionManager.getSettings().holdout === true,
              analyticsEnabled: () =>
                sessionManager.getSettings().analyticsEnabled !== false,
              bridge: widgetManager,
              enabled: (type) => widgetManager.isProviderEnabled(type),
              track: (type, data) => eventBus.track(type, data),
              trigger: (type, data) => triggerRouter.trigger(type, data),
            }),
          )
          .catch(() => null)
      : undefined;
    if (coreEnabled) {
      if (agent) eventBus.setAgentTelemetry(agent.telemetryEvent);
      // Also expose a session-supplied flag to the cart helpers. No setting
      // schema or merchant-facing label is changed.
      window.AOVBoost = { ...config, agent_core_enabled: true };
      widgetManager.setAgentCore(
        agent || {
          offer: () => ({
            status: "suppressed",
            reason: "agent_core_unavailable",
          }),
          navigation: () => {},
          setHoldout: () => {},
        },
      );
      agent?.init();
      if (agent?.recommendations)
        offerPoller.setRecommendationService(agent.recommendations);
    }

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
        agent?.destroy();
        measurementLink.destroy();
        eventBus.destroy();
        liveUpdates.destroy();
        triggerRouter.destroy();
        offerPoller.destroy();
        sessionManager.destroy();
        widgetManager.destroy();
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
