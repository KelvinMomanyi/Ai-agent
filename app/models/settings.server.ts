import type { AppSettings } from "@prisma/client";
import prisma from "../db.server";

export type PublicAppSettings = {
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
    create: { shop },
  });
}

export async function getPublicAppSettings(shop: string) {
  return toPublicAppSettings(await getAppSettings(shop));
}

export function toPublicAppSettings(settings: AppSettings): PublicAppSettings {
  return {
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
    liveEventsEnabled: isLiveEventsEnabled(),
  };
}

export function isLiveEventsEnabled() {
  return process.env.AOVBOOST_ENABLE_LIVE_EVENTS === "true";
}
