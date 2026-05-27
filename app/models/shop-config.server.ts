import type { PrismaClient } from "@prisma/client";
import {
  defaultEngineConfig,
  normalizeEngineConfig,
  type EngineConfig,
} from "./revenue-engine.server";

let revenueConfigSchemaReady = false;

export async function ensureRevenueEngineConfigSchema(prisma: PrismaClient) {
  if (revenueConfigSchemaReady) return;

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ShopConfig" (
      "shopDomain" TEXT NOT NULL,
      "discountPercentage" INTEGER NOT NULL DEFAULT 10,
      "offerStrategy" TEXT NOT NULL DEFAULT 'Focus on high-value complementary items with a gentle discount sweetener.',
      "minProductPrice" DOUBLE PRECISION NOT NULL DEFAULT 20.0,
      "revenueMode" TEXT NOT NULL DEFAULT 'aov',
      "enableAutopilot" BOOLEAN NOT NULL DEFAULT true,
      "enableDynamicBundles" BOOLEAN NOT NULL DEFAULT true,
      "enableExperimentation" BOOLEAN NOT NULL DEFAULT true,
      "enableBehavioralTargeting" BOOLEAN NOT NULL DEFAULT true,
      "primaryPlacement" TEXT NOT NULL DEFAULT 'inline',
      "maxBundleItems" INTEGER NOT NULL DEFAULT 3,
      "urgencyLevel" TEXT NOT NULL DEFAULT 'balanced',
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "ShopConfig_pkey" PRIMARY KEY ("shopDomain")
    )
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "ShopConfig"
    ADD COLUMN IF NOT EXISTS "brandVoice" TEXT DEFAULT '',
    ADD COLUMN IF NOT EXISTS "revenueMode" TEXT NOT NULL DEFAULT 'aov',
    ADD COLUMN IF NOT EXISTS "enableAutopilot" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS "enableDynamicBundles" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS "enableExperimentation" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS "enableBehavioralTargeting" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS "primaryPlacement" TEXT NOT NULL DEFAULT 'inline',
    ADD COLUMN IF NOT EXISTS "maxBundleItems" INTEGER NOT NULL DEFAULT 3,
    ADD COLUMN IF NOT EXISTS "urgencyLevel" TEXT NOT NULL DEFAULT 'balanced',
    ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  `);

  revenueConfigSchemaReady = true;
}

export function withRevenueEngineDefaults(
  config?: Partial<EngineConfig> | null,
): EngineConfig {
  return {
    ...defaultEngineConfig,
    ...normalizeEngineConfig(config),
  };
}
