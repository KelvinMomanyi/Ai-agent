ALTER TABLE "ShopperSession"
ADD COLUMN IF NOT EXISTS "customerId" TEXT,
ADD COLUMN IF NOT EXISTS "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN IF NOT EXISTS "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN IF NOT EXISTS "salesState" TEXT NOT NULL DEFAULT 'BROWSING',
ADD COLUMN IF NOT EXISTS "shopperProfile" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN IF NOT EXISTS "checkoutStarted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "purchaseCompleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "orderId" TEXT,
ADD COLUMN IF NOT EXISTS "orderValue" DECIMAL(18,2),
ADD COLUMN IF NOT EXISTS "aiAttributedRevenue" DECIMAL(18,2) NOT NULL DEFAULT 0;

ALTER TABLE "AppSettings"
ADD COLUMN IF NOT EXISTS "excludedCollectionIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN IF NOT EXISTS "preferredProductIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN IF NOT EXISTS "upsellPriorityProductIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN IF NOT EXISTS "proactiveMessagesEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS "proactiveDelaySeconds" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN IF NOT EXISTS "maxProactivePrompts" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN IF NOT EXISTS "maxProductRecommendations" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN IF NOT EXISTS "minimumProactiveConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0.65,
ADD COLUMN IF NOT EXISTS "minimumUpsellIntentScore" INTEGER NOT NULL DEFAULT 55,
ADD COLUMN IF NOT EXISTS "hesitationDetectionEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS "discountPermission" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "allowedDiscountCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN IF NOT EXISTS "bundleSupportEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS "analyticsEnabled" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS "RecommendationOutcome" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "variantId" TEXT,
  "primaryProductId" TEXT,
  "recommendationType" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "rank" INTEGER NOT NULL,
  "shopperProfileSnapshot" JSONB NOT NULL DEFAULT '{}',
  "salesState" TEXT NOT NULL,
  "shownAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "clickedAt" TIMESTAMP(3),
  "addedAt" TIMESTAMP(3),
  "purchasedAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),
  "rejectionReason" TEXT,
  "orderId" TEXT,
  "revenue" DECIMAL(18,2),
  "cartValueBefore" DECIMAL(18,2),
  "cartValueAfter" DECIMAL(18,2),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT "RecommendationOutcome_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RecommendationOutcome_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "ShopperSession"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ShopperSession_shop_salesState_updatedAt_idx"
ON "ShopperSession"("shop", "salesState", "updatedAt");
CREATE INDEX IF NOT EXISTS "ShopperSession_shop_lastActivityAt_idx"
ON "ShopperSession"("shop", "lastActivityAt");
CREATE INDEX IF NOT EXISTS "ShopperSession_shop_orderId_idx"
ON "ShopperSession"("shop", "orderId");
CREATE INDEX IF NOT EXISTS "RecommendationOutcome_shop_productId_shownAt_idx"
ON "RecommendationOutcome"("shop", "productId", "shownAt");
CREATE INDEX IF NOT EXISTS "RecommendationOutcome_sessionId_shownAt_idx"
ON "RecommendationOutcome"("sessionId", "shownAt");
CREATE INDEX IF NOT EXISTS "RecommendationOutcome_shop_orderId_idx"
ON "RecommendationOutcome"("shop", "orderId");
CREATE INDEX IF NOT EXISTS "RecommendationOutcome_shop_recommendationType_shownAt_idx"
ON "RecommendationOutcome"("shop", "recommendationType", "shownAt");
