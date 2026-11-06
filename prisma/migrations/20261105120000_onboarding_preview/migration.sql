ALTER TABLE "AppSettings"
ADD COLUMN IF NOT EXISTS "onboardingPreviewedAt" TIMESTAMP(3);
