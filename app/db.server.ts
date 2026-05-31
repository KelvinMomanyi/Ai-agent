import { PrismaClient } from "@prisma/client";

declare global {
  var prismaGlobal: PrismaClient;
}

if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = new PrismaClient();
  }
}

const prisma = global.prismaGlobal ?? new PrismaClient();

// Programmatic schema fallback sync for Neon serverless / Vercel databases
if (process.env.NODE_ENV === "production" || true) {
  (async () => {
    try {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "VisitorSession" (
            "id" TEXT NOT NULL,
            "visitorId" TEXT NOT NULL,
            "storeId" TEXT NOT NULL,
            "sessionStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "lastActivity" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "device" TEXT,
            "trafficSource" TEXT,
            "referrer" TEXT,
            "viewedProducts" JSONB NOT NULL DEFAULT '[]',
            "cartAdds" JSONB NOT NULL DEFAULT '[]',
            "cartRemoves" JSONB NOT NULL DEFAULT '[]',
            "scrollDepths" JSONB NOT NULL DEFAULT '{}',
            "pageViews" INTEGER NOT NULL DEFAULT 0,
            "totalDwellMs" INTEGER NOT NULL DEFAULT 0,
            "intentProfile" TEXT NOT NULL DEFAULT 'browsing',
            "intentScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
            CONSTRAINT "VisitorSession_pkey" PRIMARY KEY ("id")
        );
      `);
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "ChatMessage" (
            "id" TEXT NOT NULL,
            "sessionId" TEXT NOT NULL,
            "storeId" TEXT NOT NULL,
            "role" TEXT NOT NULL,
            "content" TEXT NOT NULL,
            "metadata" JSONB,
            "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
        );
      `);
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "CrossStoreInsight" (
            "id" TEXT NOT NULL,
            "category" TEXT NOT NULL,
            "metricName" TEXT NOT NULL,
            "value" DOUBLE PRECISION NOT NULL,
            "confidence" DOUBLE PRECISION NOT NULL,
            "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "CrossStoreInsight_pkey" PRIMARY KEY ("id")
        );
      `);
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "VisitorSession_storeId_visitorId_idx" ON "VisitorSession"("storeId", "visitorId");
      `);
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "VisitorSession_storeId_lastActivity_idx" ON "VisitorSession"("storeId", "lastActivity");
      `);
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "ChatMessage_sessionId_timestamp_idx" ON "ChatMessage"("sessionId", "timestamp");
      `);
      try {
        await prisma.$executeRawUnsafe(`
          CREATE UNIQUE INDEX IF NOT EXISTS "CrossStoreInsight_category_metricName_key" ON "CrossStoreInsight"("category", "metricName");
        `);
      } catch (e) {
        // Fallback catch for unique index if database driver/engine has variations
      }
      console.log("Auto schema check completed successfully.");
    } catch (error) {
      console.error("Auto table creation failed:", error);
    }
  })();
}

export default prisma;
