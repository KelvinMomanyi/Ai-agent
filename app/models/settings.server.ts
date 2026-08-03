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
  };
}
