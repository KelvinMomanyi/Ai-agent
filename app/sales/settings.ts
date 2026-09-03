import type { AppSettings } from "@prisma/client";
import type { MerchantSalesSettings } from "./types";

export function toMerchantSalesSettings(
  settings: AppSettings,
): MerchantSalesSettings {
  return {
    agentEnabled: settings.chatEnabled,
    proactiveMessagesEnabled: settings.proactiveMessagesEnabled !== false,
    proactiveDelaySeconds: clamp(settings.proactiveDelaySeconds ?? 15, 10, 120),
    maxProactivePrompts: clamp(settings.maxProactivePrompts ?? 2, 0, 5),
    maxProductRecommendations: clamp(
      settings.maxProductRecommendations ?? 3,
      1,
      4,
    ),
    excludedProductIds: settings.blockedProductIds || [],
    excludedCollectionIds: settings.excludedCollectionIds || [],
    preferredProductIds: settings.preferredProductIds || [],
    upsellPriorityProductIds: settings.upsellPriorityProductIds || [],
    discountPermission: settings.discountPermission === true,
    allowedDiscountCodes: settings.allowedDiscountCodes || [],
    bundleSupportEnabled:
      settings.bundleSupportEnabled !== false && settings.bundlesEnabled,
    minimumProactiveConfidence: clampNumber(
      settings.minimumProactiveConfidence ?? 0.65,
      0,
      1,
    ),
    minimumUpsellIntentScore: clamp(
      settings.minimumUpsellIntentScore ?? 55,
      0,
      100,
    ),
    hesitationDetectionEnabled: settings.hesitationDetectionEnabled !== false,
    analyticsEnabled: settings.analyticsEnabled !== false,
  };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.round(Math.min(Math.max(Number(value) || 0, minimum), maximum));
}

function clampNumber(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(Number(value) || 0, minimum), maximum);
}
