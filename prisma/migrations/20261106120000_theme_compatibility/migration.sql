ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "placementPreference" TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "recommendationAccentColor" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "recommendationRadius" INTEGER;
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "recommendationFont" TEXT NOT NULL DEFAULT 'inherit';
CREATE TABLE IF NOT EXISTS "ThemeProfile" (
 shop TEXT NOT NULL,"themeId" TEXT NOT NULL,"themeName" TEXT NOT NULL,"schemaName" TEXT,"cartUi" TEXT,
 strategy TEXT NOT NULL DEFAULT 'native_drawer',selectors JSONB,status TEXT NOT NULL DEFAULT 'learning',
 attempts INTEGER NOT NULL DEFAULT 0,"verifiedDisplays" INTEGER NOT NULL DEFAULT 0,failures INTEGER NOT NULL DEFAULT 0,
 "lastVerifiedAt" TIMESTAMP(3),"lastPreviewResult" JSONB,"updatedAt" TIMESTAMP(3) NOT NULL,
 PRIMARY KEY(shop,"themeId"), FOREIGN KEY(shop) REFERENCES "AppSettings"(shop) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "ThemeProfile_shop_updatedAt_idx" ON "ThemeProfile"(shop,"updatedAt");
CREATE TABLE IF NOT EXISTS "ThemeReport" (
 id TEXT PRIMARY KEY,shop TEXT NOT NULL,"themeId" TEXT NOT NULL,"sessionHash" TEXT NOT NULL,"attemptId" TEXT NOT NULL,"offerId" TEXT,
 kind TEXT NOT NULL DEFAULT 'display',strategy TEXT NOT NULL,"cartUi" TEXT NOT NULL,verified BOOLEAN NOT NULL,reason TEXT NOT NULL,
 selector TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(shop,"themeId") REFERENCES "ThemeProfile"(shop,"themeId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "ThemeReport_shop_themeId_sessionHash_attemptId_key" ON "ThemeReport"(shop,"themeId","sessionHash","attemptId");
CREATE INDEX IF NOT EXISTS "ThemeReport_shop_themeId_kind_createdAt_idx" ON "ThemeReport"(shop,"themeId",kind,"createdAt");
CREATE INDEX IF NOT EXISTS "ThemeReport_shop_createdAt_idx" ON "ThemeReport"(shop,"createdAt");
