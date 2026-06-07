import { PrismaClient } from "@prisma/client";

declare global {
  var prismaGlobal: PrismaClient | undefined;
}

const prisma =
  global.prismaGlobal ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  global.prismaGlobal = prisma;
} else {
  process.on("beforeExit", async () => {
    await prisma.$disconnect();
  });
}

// Retry wrapper for connection issues
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  delayMs = 100,
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      if (i === maxRetries - 1) throw error;
      if (error.code === "ECONNREFUSED" || error.code === "ECONNRESET" || error.code === "ETIMEDOUT") {
        await new Promise((resolve) => setTimeout(resolve, delayMs * (i + 1)));
        continue;
      }
      throw error;
    }
  }
  throw new Error("Max retries exceeded");
}

export default prisma;
