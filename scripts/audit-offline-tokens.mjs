import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
try {
  const offline = { isOnline: false, accessToken: { not: "" } };
  const [total, nonExpiring, expiring, incomplete, expiredRefreshTokens] =
    await Promise.all([
      prisma.session.count({ where: offline }),
      prisma.session.count({
        where: {
          ...offline,
          expires: null,
          refreshToken: null,
          refreshTokenExpires: null,
        },
      }),
      prisma.session.count({
        where: {
          ...offline,
          expires: { not: null },
          refreshToken: { not: null },
          refreshTokenExpires: { not: null },
        },
      }),
      prisma.session.count({
        where: {
          ...offline,
          AND: [
            {
              OR: [
                { expires: { not: null } },
                { refreshToken: { not: null } },
                { refreshTokenExpires: { not: null } },
              ],
            },
            {
              OR: [
                { expires: null },
                { refreshToken: null },
                { refreshTokenExpires: null },
              ],
            },
          ],
        },
      }),
      prisma.session.count({
        where: { ...offline, refreshTokenExpires: { lte: new Date() } },
      }),
    ]);
  console.log(
    JSON.stringify(
      {
        totalOfflineSessions: total,
        nonExpiring,
        expiring,
        incomplete,
        expiredRefreshTokens,
      },
      null,
      2,
    ),
  );
} catch (error) {
  // Connection errors can include sensitive connection details. Print only codes.
  console.error(
    `Offline token audit failed (${error.code || error.name || "unknown"}).`,
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
