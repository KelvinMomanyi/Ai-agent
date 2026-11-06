ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "holdoutEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "holdoutPercent" INTEGER NOT NULL DEFAULT 10 CHECK ("holdoutPercent" BETWEEN 0 AND 30);
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "holdoutVersion" INTEGER NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX IF NOT EXISTS "ShopperSession_shop_id_key" ON "ShopperSession"("shop", "id");
CREATE TABLE IF NOT EXISTS "HoldoutEnrollment" (
  "id" TEXT PRIMARY KEY, "shop" TEXT NOT NULL, "sessionId" TEXT NOT NULL,
  "version" INTEGER NOT NULL, "arm" TEXT NOT NULL CHECK ("arm" IN ('exposed','holdout')),
  "percent" INTEGER NOT NULL CHECK ("percent" BETWEEN 0 AND 30),
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cartSeenAt" TIMESTAMP(3), "cartLinkedAt" TIMESTAMP(3),
  CONSTRAINT "HoldoutEnrollment_shop_sessionId_fkey" FOREIGN KEY ("shop", "sessionId") REFERENCES "ShopperSession"("shop", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "HoldoutEnrollment_shop_sessionId_version_key" ON "HoldoutEnrollment"("shop","sessionId","version");
CREATE UNIQUE INDEX IF NOT EXISTS "HoldoutEnrollment_shop_id_key" ON "HoldoutEnrollment"("shop","id");
CREATE INDEX IF NOT EXISTS "HoldoutEnrollment_shop_version_startedAt_idx" ON "HoldoutEnrollment"("shop","version","startedAt");
CREATE TABLE IF NOT EXISTS "HoldoutOrder" (
  "id" TEXT PRIMARY KEY, "shop" TEXT NOT NULL, "orderId" TEXT NOT NULL, "enrollmentId" TEXT NOT NULL,
  "revenue" DECIMAL(18,2) NOT NULL, "currency" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HoldoutOrder_shop_enrollmentId_fkey" FOREIGN KEY ("shop","enrollmentId") REFERENCES "HoldoutEnrollment"("shop","id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "HoldoutOrder_shop_orderId_key" ON "HoldoutOrder"("shop","orderId");
CREATE INDEX IF NOT EXISTS "HoldoutOrder_shop_enrollmentId_createdAt_idx" ON "HoldoutOrder"("shop","enrollmentId","createdAt");
