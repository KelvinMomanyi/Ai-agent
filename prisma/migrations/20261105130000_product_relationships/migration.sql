ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "verticalPreset" TEXT NOT NULL DEFAULT 'generic';

DO $$ BEGIN
  CREATE TYPE "ProductRelationshipKind" AS ENUM ('complement', 'upgrade', 'exclude');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "ProductRelationshipStatus" AS ENUM ('suggested', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "ProductRelationshipOrigin" AS ENUM ('merchant', 'ai', 'affinity');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "ProductRelationship" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "sourceProductId" TEXT NOT NULL,
  "targetProductId" TEXT NOT NULL,
  "kind" "ProductRelationshipKind" NOT NULL DEFAULT 'complement',
  "status" "ProductRelationshipStatus" NOT NULL DEFAULT 'suggested',
  "origin" "ProductRelationshipOrigin" NOT NULL DEFAULT 'merchant',
  "reason" TEXT,
  "position" INTEGER NOT NULL DEFAULT 0,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK ("confidence" >= 0 AND "confidence" <= 1),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductRelationship_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductRelationship_shop_sourceProductId_fkey" FOREIGN KEY ("shop", "sourceProductId") REFERENCES "Product"("shop", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProductRelationship_shop_targetProductId_fkey" FOREIGN KEY ("shop", "targetProductId") REFERENCES "Product"("shop", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProductRelationship_shop_sourceProductId_targetProductId_key" ON "ProductRelationship"("shop", "sourceProductId", "targetProductId", "kind");
CREATE INDEX IF NOT EXISTS "ProductRelationship_shop_sourceProductId_status_idx" ON "ProductRelationship"("shop", "sourceProductId", "status");
CREATE INDEX IF NOT EXISTS "ProductRelationship_shop_targetProductId_idx" ON "ProductRelationship"("shop", "targetProductId");
