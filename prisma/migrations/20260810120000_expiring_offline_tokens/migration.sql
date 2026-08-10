-- Store the rotating credentials and their expiry metadata required by
-- Shopify's expiring offline access tokens.
ALTER TABLE "session"
ADD COLUMN "refreshToken" TEXT,
ADD COLUMN "refreshTokenExpires" TIMESTAMP(3);
