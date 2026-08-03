CREATE TABLE "CatalogSyncJob" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "phase" TEXT NOT NULL DEFAULT 'fetching',
    "cursor" TEXT,
    "syncedProductIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "syncedCount" INTEGER NOT NULL DEFAULT 0,
    "affinityOffset" INTEGER NOT NULL DEFAULT 0,
    "affinityTotal" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogSyncJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CatalogSyncJob_shop_key" ON "CatalogSyncJob"("shop");
CREATE INDEX "CatalogSyncJob_phase_updatedAt_idx" ON "CatalogSyncJob"("phase", "updatedAt");
