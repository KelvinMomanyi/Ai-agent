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
  // Disconnect unused connections in serverless
  process.on("beforeExit", async () => {
    await prisma.$disconnect();
  });
}

export default prisma;
