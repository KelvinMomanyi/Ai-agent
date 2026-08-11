-- Repair deployments where the Prisma Client reached production before the
-- expiring-offline-token migration, or where migration history and the
-- physical Session table drifted apart. This remains safe after the original
-- 20260810120000 migration because both additions are idempotent.
ALTER TABLE "session"
ADD COLUMN IF NOT EXISTS "refreshToken" TEXT,
ADD COLUMN IF NOT EXISTS "refreshTokenExpires" TIMESTAMP(3);
