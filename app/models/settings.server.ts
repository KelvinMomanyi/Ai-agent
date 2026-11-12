import type { AppSettings } from "@prisma/client";
import prisma from "../db.server";
import { getJsonCache, setJsonCache } from "../redis.server";

export type PublicAppSettings = {
  holdoutEnabled: boolean;
  focusedMode: boolean;
  chatEnabled: boolean;
  bundlesEnabled: boolean;
  upsellEnabled: boolean;
  discountNudgeEnabled: boolean;
  discountThreshold: number;
  exitIntentEnabled: boolean;
  postPurchaseEnabled: boolean;
  liveEventsEnabled: boolean;
  proactiveMessagesEnabled: boolean;
  proactiveDelaySeconds: number;
  maxProactivePrompts: number;
  maxProductRecommendations: number;
  minimumProactiveConfidence: number;
  minimumUpsellIntentScore: number;
  hesitationDetectionEnabled: boolean;
  bundleSupportEnabled: boolean;
  analyticsEnabled: boolean;
};

export async function getAppSettings(shop: string) {
  return prisma.appSettings.upsert({
    where: { shop },
    update: {},
    create: { shop, pairingMode: "autopilot" },
  });
}

export async function getPublicAppSettings(shop: string) {
  const key = `public-settings:${shop}`;
  const cached = await getJsonCache<PublicAppSettings>(key, {
    allowMemoryFallback: false,
  });
  if (cached)
    return {
      ...cached,
      liveEventsEnabled: !cached.focusedMode && isLiveEventsEnabled(),
    };
  const settings = toPublicAppSettings(await getAppSettings(shop));
  await setJsonCache(key, settings, 60);
  return settings;
}

export function toPublicAppSettings(settings: AppSettings): PublicAppSettings {
  return {
    holdoutEnabled: settings.holdoutEnabled && settings.holdoutPercent > 0,
    focusedMode: settings.focusedMode,
    chatEnabled: settings.chatEnabled,
    bundlesEnabled: settings.bundlesEnabled,
    upsellEnabled: settings.upsellEnabled,
    discountNudgeEnabled: settings.discountNudgeEnabled,
    discountThreshold: Number(settings.discountThreshold),
    exitIntentEnabled: settings.exitIntentEnabled,
    postPurchaseEnabled: settings.postPurchaseEnabled,
    proactiveMessagesEnabled: settings.proactiveMessagesEnabled,
    proactiveDelaySeconds: settings.proactiveDelaySeconds,
    maxProactivePrompts: settings.maxProactivePrompts,
    maxProductRecommendations: settings.maxProductRecommendations,
    minimumProactiveConfidence: settings.minimumProactiveConfidence,
    minimumUpsellIntentScore: settings.minimumUpsellIntentScore,
    hesitationDetectionEnabled: settings.hesitationDetectionEnabled,
    bundleSupportEnabled: settings.bundleSupportEnabled,
    analyticsEnabled: settings.analyticsEnabled,
    // Explicit opt-in: an absent, empty, or differently-cased value is off.
    liveEventsEnabled: !settings.focusedMode && isLiveEventsEnabled(),
  };
}

export function isLiveEventsEnabled() {
  return process.env.AOVBOOST_ENABLE_LIVE_EVENTS === "true";
}
