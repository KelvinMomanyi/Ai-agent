-- Preserve existing rows and installations lacking settings before new-row defaults change.
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "focusedMode" BOOLEAN NOT NULL DEFAULT false;
INSERT INTO "AppSettings" ("id", "shop", "focusedMode", "chatEnabled", "bundlesEnabled", "upsellEnabled", "discountNudgeEnabled", "exitIntentEnabled", "postPurchaseEnabled", "proactiveMessagesEnabled", "maxProductRecommendations", "hesitationDetectionEnabled", "bundleSupportEnabled", "updatedAt")
SELECT 'phase4_' || md5(installed.shop), installed.shop, false, true, true, true, true, true, true, true, 3, true, true, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "shop" FROM "Session" UNION SELECT "shopDomain" AS shop FROM "Shop") AS installed
WHERE installed.shop <> ''
ON CONFLICT ("shop") DO NOTHING;
ALTER TABLE "AppSettings"
  ALTER COLUMN "focusedMode" SET DEFAULT true,
  ALTER COLUMN "chatEnabled" SET DEFAULT false,
  ALTER COLUMN "bundlesEnabled" SET DEFAULT false,
  ALTER COLUMN "discountNudgeEnabled" SET DEFAULT false,
  ALTER COLUMN "exitIntentEnabled" SET DEFAULT false,
  ALTER COLUMN "postPurchaseEnabled" SET DEFAULT false,
  ALTER COLUMN "proactiveMessagesEnabled" SET DEFAULT false,
  ALTER COLUMN "maxProductRecommendations" SET DEFAULT 2,
  ALTER COLUMN "hesitationDetectionEnabled" SET DEFAULT false,
  ALTER COLUMN "bundleSupportEnabled" SET DEFAULT false;
