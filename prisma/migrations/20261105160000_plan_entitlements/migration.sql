CREATE TABLE IF NOT EXISTS "EntitlementSnapshot" (
  "shop" TEXT PRIMARY KEY, "tier" TEXT NOT NULL, "subscriptionName" TEXT,
  "source" TEXT NOT NULL, "unmapped" BOOLEAN NOT NULL DEFAULT false,
  "verifiedAt" TIMESTAMP(3) NOT NULL, "refreshRequired" BOOLEAN NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS "MonthlyUsage" (
  "shop" TEXT NOT NULL, "month" DATE NOT NULL,
  "displayed" INTEGER NOT NULL DEFAULT 0 CHECK ("displayed">=0),
  "aiCalls" INTEGER NOT NULL DEFAULT 0 CHECK ("aiCalls">=0),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("shop", "month")
);
