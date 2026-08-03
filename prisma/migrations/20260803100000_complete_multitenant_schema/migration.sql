-- Complete the historical schema for clean deployments and make product
-- relationships tenant-safe. Earlier deployments created most of these
-- tables with `prisma db push`, but `prisma migrate deploy` must also work on
-- a brand-new database.

DO $$
BEGIN
  IF to_regclass('public."session"') IS NULL
     AND to_regclass('public."Session"') IS NOT NULL THEN
    ALTER TABLE "Session" RENAME TO "session";
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "session" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "isOnline" BOOLEAN NOT NULL DEFAULT false,
  "scope" TEXT,
  "expires" TIMESTAMP(3),
  "accessToken" TEXT NOT NULL,
  "userId" BIGINT,
  "firstName" TEXT,
  "lastName" TEXT,
  "email" TEXT,
  "accountOwner" BOOLEAN NOT NULL DEFAULT false,
  "locale" TEXT,
  "collaborator" BOOLEAN DEFAULT false,
  "emailVerified" BOOLEAN DEFAULT false,
  CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

UPDATE "session" SET "accountOwner" = false WHERE "accountOwner" IS NULL;
ALTER TABLE "session"
  ALTER COLUMN "accountOwner" SET DEFAULT false,
  ALTER COLUMN "accountOwner" SET NOT NULL,
  ALTER COLUMN "collaborator" SET DEFAULT false,
  ALTER COLUMN "emailVerified" SET DEFAULT false;

CREATE TABLE IF NOT EXISTS "Product" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "handle" TEXT NOT NULL,
  "vendor" TEXT,
  "productType" TEXT,
  "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "price" DECIMAL(18,2) NOT NULL,
  "compareAtPrice" DECIMAL(18,2),
  "imageUrl" TEXT,
  "collectionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "metafields" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Product_pkey" PRIMARY KEY ("shop", "id")
);

CREATE TABLE IF NOT EXISTS "ProductAffinity" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "score" DOUBLE PRECISION NOT NULL,
  "reason" TEXT,
  "orderCount" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "ProductAffinity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ProductOrderStat" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "orderCount" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "ProductOrderStat_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Bundle" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "discountType" TEXT NOT NULL,
  "discountValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "triggerProductIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Bundle_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "BundleItem" (
  "id" TEXT NOT NULL,
  "bundleId" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "BundleItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ShopperSession" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "anonymousId" TEXT NOT NULL,
  "journeyStage" TEXT NOT NULL DEFAULT 'discovering',
  "intentScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "hesitationScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "viewedProductIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "cartProductIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "chatEngaged" BOOLEAN NOT NULL DEFAULT false,
  "totalPageViews" INTEGER NOT NULL DEFAULT 0,
  "sessionDuration" INTEGER NOT NULL DEFAULT 0,
  "context" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ShopperSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ShopperEvent" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShopperEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Offer" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "widgetType" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "triggerContext" JSONB NOT NULL,
  "aiProvider" TEXT,
  "shown" BOOLEAN NOT NULL DEFAULT false,
  "clicked" BOOLEAN NOT NULL DEFAULT false,
  "converted" BOOLEAN NOT NULL DEFAULT false,
  "revenueImpact" DECIMAL(18,2),
  "abVariant" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ChatMessage" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "provider" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "storeId" TEXT,
  "metadata" JSONB,
  "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Experiment" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "widgetType" TEXT NOT NULL,
  "trafficSplit" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "controlConfig" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "treatmentConfig" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  CONSTRAINT "Experiment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AppSettings" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "chatEnabled" BOOLEAN NOT NULL DEFAULT true,
  "chatGreeting" TEXT NOT NULL DEFAULT 'Hi! Can I help you find the perfect product?',
  "bundlesEnabled" BOOLEAN NOT NULL DEFAULT true,
  "upsellEnabled" BOOLEAN NOT NULL DEFAULT true,
  "discountNudgeEnabled" BOOLEAN NOT NULL DEFAULT true,
  "discountThreshold" DECIMAL(18,2) NOT NULL DEFAULT 50,
  "exitIntentEnabled" BOOLEAN NOT NULL DEFAULT true,
  "postPurchaseEnabled" BOOLEAN NOT NULL DEFAULT true,
  "aiTone" TEXT NOT NULL DEFAULT 'friendly',
  "brandVoice" TEXT,
  "blockedProductIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AppSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "VisitorSession" (
  "id" TEXT NOT NULL,
  "visitorId" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "sessionStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastActivity" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "device" TEXT,
  "trafficSource" TEXT,
  "referrer" TEXT,
  "viewedProducts" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "cartAdds" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "cartRemoves" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "scrollDepths" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "pageViews" INTEGER NOT NULL DEFAULT 0,
  "totalDwellMs" INTEGER NOT NULL DEFAULT 0,
  "intentProfile" TEXT NOT NULL DEFAULT 'browsing',
  "intentScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  CONSTRAINT "VisitorSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CrossStoreInsight" (
  "id" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "metricName" TEXT NOT NULL,
  "value" DOUBLE PRECISION NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CrossStoreInsight_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ShopConfig" ADD COLUMN IF NOT EXISTS "brandVoice" TEXT DEFAULT '';

-- Backfill the tenant key on bundle items created before it was stored there.
ALTER TABLE "BundleItem" ADD COLUMN IF NOT EXISTS "shop" TEXT;
UPDATE "BundleItem" AS item
SET "shop" = bundle."shop"
FROM "Bundle" AS bundle
WHERE item."bundleId" = bundle."id" AND item."shop" IS NULL;
ALTER TABLE "BundleItem" ALTER COLUMN "shop" SET NOT NULL;

-- Remove the old globally-unique product relationships before replacing them
-- with composite (shop, product id) relationships.
ALTER TABLE "ProductAffinity" DROP CONSTRAINT IF EXISTS "ProductAffinity_sourceId_fkey";
ALTER TABLE "ProductAffinity" DROP CONSTRAINT IF EXISTS "ProductAffinity_targetId_fkey";
ALTER TABLE "ProductAffinity" DROP CONSTRAINT IF EXISTS "ProductAffinity_shop_sourceId_fkey";
ALTER TABLE "ProductAffinity" DROP CONSTRAINT IF EXISTS "ProductAffinity_shop_targetId_fkey";
ALTER TABLE "ProductOrderStat" DROP CONSTRAINT IF EXISTS "ProductOrderStat_productId_fkey";
ALTER TABLE "ProductOrderStat" DROP CONSTRAINT IF EXISTS "ProductOrderStat_shop_productId_fkey";
ALTER TABLE "BundleItem" DROP CONSTRAINT IF EXISTS "BundleItem_productId_fkey";
ALTER TABLE "BundleItem" DROP CONSTRAINT IF EXISTS "BundleItem_shop_productId_fkey";

ALTER TABLE "Product" DROP CONSTRAINT IF EXISTS "Product_pkey";
DROP INDEX IF EXISTS "Product_shop_id_key";
ALTER TABLE "Product" ADD CONSTRAINT "Product_pkey" PRIMARY KEY ("shop", "id");
DROP INDEX IF EXISTS "ProductOrderStat_productId_key";

CREATE INDEX IF NOT EXISTS "Product_shop_idx" ON "Product"("shop");
CREATE INDEX IF NOT EXISTS "ProductAffinity_shop_sourceId_score_idx" ON "ProductAffinity"("shop", "sourceId", "score" DESC);
CREATE UNIQUE INDEX IF NOT EXISTS "ProductAffinity_shop_sourceId_targetId_key" ON "ProductAffinity"("shop", "sourceId", "targetId");
CREATE INDEX IF NOT EXISTS "ProductOrderStat_shop_idx" ON "ProductOrderStat"("shop");
CREATE UNIQUE INDEX IF NOT EXISTS "ProductOrderStat_shop_productId_key" ON "ProductOrderStat"("shop", "productId");
CREATE INDEX IF NOT EXISTS "Bundle_shop_isActive_idx" ON "Bundle"("shop", "isActive");
CREATE INDEX IF NOT EXISTS "BundleItem_shop_productId_idx" ON "BundleItem"("shop", "productId");
CREATE INDEX IF NOT EXISTS "ShopperSession_shop_updatedAt_idx" ON "ShopperSession"("shop", "updatedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "ShopperSession_shop_anonymousId_key" ON "ShopperSession"("shop", "anonymousId");
CREATE INDEX IF NOT EXISTS "ShopperEvent_sessionId_createdAt_idx" ON "ShopperEvent"("sessionId", "createdAt");
CREATE INDEX IF NOT EXISTS "ShopperEvent_shop_type_createdAt_idx" ON "ShopperEvent"("shop", "type", "createdAt");
CREATE INDEX IF NOT EXISTS "Offer_shop_widgetType_createdAt_idx" ON "Offer"("shop", "widgetType", "createdAt");
CREATE INDEX IF NOT EXISTS "Offer_sessionId_idx" ON "Offer"("sessionId");
CREATE INDEX IF NOT EXISTS "ChatMessage_sessionId_createdAt_idx" ON "ChatMessage"("sessionId", "createdAt");
CREATE INDEX IF NOT EXISTS "Experiment_shop_isActive_idx" ON "Experiment"("shop", "isActive");
CREATE UNIQUE INDEX IF NOT EXISTS "AppSettings_shop_key" ON "AppSettings"("shop");
CREATE INDEX IF NOT EXISTS "VisitorSession_storeId_visitorId_idx" ON "VisitorSession"("storeId", "visitorId");
CREATE INDEX IF NOT EXISTS "VisitorSession_storeId_lastActivity_idx" ON "VisitorSession"("storeId", "lastActivity");
CREATE UNIQUE INDEX IF NOT EXISTS "CrossStoreInsight_category_metricName_key" ON "CrossStoreInsight"("category", "metricName");

ALTER TABLE "ProductAffinity"
  ADD CONSTRAINT "ProductAffinity_shop_sourceId_fkey"
  FOREIGN KEY ("shop", "sourceId") REFERENCES "Product"("shop", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductAffinity"
  ADD CONSTRAINT "ProductAffinity_shop_targetId_fkey"
  FOREIGN KEY ("shop", "targetId") REFERENCES "Product"("shop", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductOrderStat"
  ADD CONSTRAINT "ProductOrderStat_shop_productId_fkey"
  FOREIGN KEY ("shop", "productId") REFERENCES "Product"("shop", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BundleItem"
  ADD CONSTRAINT "BundleItem_shop_productId_fkey"
  FOREIGN KEY ("shop", "productId") REFERENCES "Product"("shop", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BundleItem_bundleId_fkey') THEN
    ALTER TABLE "BundleItem"
      ADD CONSTRAINT "BundleItem_bundleId_fkey"
      FOREIGN KEY ("bundleId") REFERENCES "Bundle"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ShopperEvent_sessionId_fkey') THEN
    ALTER TABLE "ShopperEvent"
      ADD CONSTRAINT "ShopperEvent_sessionId_fkey"
      FOREIGN KEY ("sessionId") REFERENCES "ShopperSession"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Offer_sessionId_fkey') THEN
    ALTER TABLE "Offer"
      ADD CONSTRAINT "Offer_sessionId_fkey"
      FOREIGN KEY ("sessionId") REFERENCES "ShopperSession"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChatMessage_sessionId_fkey') THEN
    ALTER TABLE "ChatMessage"
      ADD CONSTRAINT "ChatMessage_sessionId_fkey"
      FOREIGN KEY ("sessionId") REFERENCES "ShopperSession"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
