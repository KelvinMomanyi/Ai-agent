import { PrismaClient } from "@prisma/client";
import { Redis } from "@upstash/redis";

// Read-only checks. Never emit connection strings, credentials, raw errors or
// product/customer data. The selected env file determines the target services.
const shop = process.argv[2];
if (shop && !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) {
  throw new Error("Pass a permanent myshopify.com shop domain");
}
const prisma = new PrismaClient({ log: [] });
const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
        retry: { retries: 0 },
        signal: () => AbortSignal.timeout(5000),
      })
    : null;
const report = {};
function failure(error) {
  const message = error instanceof Error ? error.message : "";
  if (/expired|archived|deleted|not found|suspended/i.test(message))
    return "service_inactive";
  if (/WRONGPASS|unauthorized|invalid.*token|authentication/i.test(message))
    return "authentication_failed";
  if (/limit|quota|maximum|exceeded/i.test(message)) return "quota_or_limit";
  if (/NOPERM|not allowed|unsupported|disabled/i.test(message))
    return "operation_not_permitted";
  if (/P2021|P2022/.test(String(error?.code))) return "schema_missing";
  if (/timeout|aborted/i.test(message)) return "timeout";
  if (
    /^(P[0-9]{4}|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|CERT_HAS_EXPIRED|UNABLE_TO_VERIFY_LEAF_SIGNATURE|UND_ERR_CONNECT_TIMEOUT)$/.test(
      String(error?.code),
    )
  )
    return error.code;
  if (error?.cause) return failure(error.cause);
  return "connection_or_operation_failed";
}
try {
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.$executeRaw`SET LOCAL statement_timeout = '5000ms'`;
      const [schema] = await tx.$queryRaw`
      SELECT to_regclass('public."MonthlyUsage"') IS NOT NULL AS "monthlyUsage",
        to_regclass('public."EntitlementSnapshot"') IS NOT NULL AS "entitlements",
        to_regclass('public."Product"') IS NOT NULL AS "catalog"`;
      report.database = { available: true, schema };
      if (shop && schema.catalog) {
        const [counts] =
          await tx.$queryRaw`SELECT COUNT(*)::int AS stored FROM "Product" WHERE shop=${shop}`;
        report.catalog = counts;
      }
      if (shop && schema.monthlyUsage) {
        // Check actual table permissions and column compatibility, without values.
        await tx.$queryRaw`SELECT displayed, "aiCalls" FROM "MonthlyUsage" WHERE shop=${shop} LIMIT 1`;
      }
    },
    { timeout: 10000 },
  );
} catch (error) {
  report.database = { available: false, reason: failure(error) };
} finally {
  await prisma.$disconnect();
}
if (!redis) report.redis = { available: false, reason: "not_configured" };
else {
  try {
    report.redis = { available: (await redis.ping()) === "PONG" };
    // Read-only Lua checks support and the exact commands used by catalog fills
    // and monthly usage. It never reserves capacity or initializes counters.
    if (shop) {
      const tag = `{usage:${encodeURIComponent(shop)}:${new Date().toISOString().slice(0, 7)}}`;
      const values = await redis.eval(
        "return {redis.call('EXISTS',KEYS[1]),redis.call('TTL',KEYS[2]),redis.call('TYPE',KEYS[3]).ok,redis.call('TYPE',KEYS[4]).ok}",
        [
          `catalog:${shop}:last-hot`,
          `catalog:${shop}:hot-fill`,
          `${tag}:totals`,
          `${tag}:pending`,
        ],
        [],
      );
      report.redis.catalogAndUsage = values;
    } else await redis.eval("return 1", [], []);
    report.redis.lua = true;
  } catch (error) {
    report.redis = {
      ...report.redis,
      available: false,
      reason: failure(error),
    };
  }
}
console.log(JSON.stringify(report, null, 2));
if (
  !report.database?.available ||
  !report.redis?.available ||
  Object.values(report.database?.schema || {}).some((exists) => !exists)
)
  process.exitCode = 1;
