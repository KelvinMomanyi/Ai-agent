ALTER TYPE "ProductRelationshipStatus" ADD VALUE IF NOT EXISTS 'auto_approved';
ALTER TYPE "ProductRelationshipStatus" ADD VALUE IF NOT EXISTS 'demoted';
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "pairingMode" TEXT NOT NULL DEFAULT 'review_first';
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "pairingStrictness" TEXT NOT NULL DEFAULT 'balanced';
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "pairingSensitiveKeywords" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "pairingOnboardingSeenAt" TIMESTAMP(3);
-- Materialize settings for installed shops before app constructors opt new shops into autopilot.
INSERT INTO "AppSettings" (id, shop, "pairingMode", "updatedAt")
SELECT 'autopilot-legacy:' || md5(s.shop),s.shop,'review_first',CURRENT_TIMESTAMP
FROM (SELECT shop FROM session UNION SELECT "shopDomain" FROM "Shop") s
ON CONFLICT (shop) DO NOTHING;
ALTER TABLE "ProductRelationship" ADD COLUMN IF NOT EXISTS "reasonCode" TEXT;
ALTER TABLE "ProductRelationship" ADD COLUMN IF NOT EXISTS "modelVersion" TEXT;
ALTER TABLE "ProductRelationship" ADD COLUMN IF NOT EXISTS evidence JSONB;
ALTER TABLE "ProductRelationship" ADD COLUMN IF NOT EXISTS "shownCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ProductRelationship" ADD COLUMN IF NOT EXISTS "acceptedCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ProductRelationship" ADD COLUMN IF NOT EXISTS "performanceFlag" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ProductRelationship" ADD COLUMN IF NOT EXISTS "performanceCheckedAt" TIMESTAMP(3);
ALTER TABLE "ProductRelationship" ADD COLUMN IF NOT EXISTS "previousStatus" TEXT;
CREATE TABLE IF NOT EXISTS "ProductPairingState" (
  shop TEXT NOT NULL,"productId" TEXT NOT NULL,"catalogHash" TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'dirty',"lastPairedAt" TIMESTAMP(3),revision INTEGER NOT NULL DEFAULT 0,priority INTEGER NOT NULL DEFAULT 0,
  "leaseToken" TEXT,"leaseUntil" TIMESTAMP(3),PRIMARY KEY(shop,"productId"),
  CONSTRAINT "ProductPairingState_shop_productId_fkey" FOREIGN KEY(shop,"productId") REFERENCES "Product"(shop,id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "ProductPairingState_shop_status_leaseUntil_idx" ON "ProductPairingState"(shop,status,"leaseUntil");
CREATE INDEX IF NOT EXISTS "ProductPairingState_shop_status_priority_productId_idx" ON "ProductPairingState"(shop,status,priority DESC,"productId");
ALTER TABLE "Offer" ADD COLUMN IF NOT EXISTS "pairingProvenance" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Offer" ADD COLUMN IF NOT EXISTS "pairingShownAt" TIMESTAMP(3);
ALTER TABLE "Offer" ADD COLUMN IF NOT EXISTS "pairingAcceptedIds" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "Offer" ADD COLUMN IF NOT EXISTS "pairingRollupPending" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS "Offer_shop_pairingRollupPending_createdAt_idx" ON "Offer"(shop,"pairingRollupPending","createdAt");
CREATE INDEX IF NOT EXISTS "Offer_pairingProvenance_idx" ON "Offer" USING GIN ("pairingProvenance" jsonb_path_ops);
