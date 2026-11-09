import { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { billingRedis } from "../redis.server";
import { getAppSettings } from "./settings.server";
import {
  getEntitlements,
  limitsFor,
  entitlementCacheKey,
  type Entitlement,
  type BillingAdmin,
} from "./entitlements.server";

export const USAGE_RESERVATION_MS = 10 * 60_000;
export const USAGE_ROLLUP_SECONDS = 60;
export async function clearBillingDataCache(shop: string) {
  const month = usageMonth();
  const keys = Array.from({ length: 6 }, (_, offset) =>
    usageKeys(
      shop,
      new Date(
        Date.UTC(month.getUTCFullYear(), month.getUTCMonth() - offset, 1),
      ),
    ),
  ).flat();
  await Promise.all(
    [entitlementCacheKey(shop), ...keys].map((key) => billingRedis.del(key)),
  );
}
export function usageMonth(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
export function usageKeys(shop: string, month = usageMonth()) {
  const tag = `{usage:${encodeURIComponent(shop)}:${month.toISOString().slice(0, 7)}}`;
  return [`${tag}:totals`, `${tag}:pending`, `${tag}:rollup`];
}
export const USAGE_SCRIPT = `
-- AOVBoost monthly usage: initialized from durable cumulative totals.
redis.call('HSETNX',KEYS[1],'displayed',ARGV[1]); redis.call('HSETNX',KEYS[1],'aiCalls',ARGV[2])
redis.call('EXPIRE',KEYS[1],ARGV[3]); redis.call('ZREMRANGEBYSCORE',KEYS[2],'-inf',ARGV[4])
local op=ARGV[5]; local id=ARGV[6]; local cap=tonumber(ARGV[7]); local allowed=1
local displayed=tonumber(redis.call('HGET',KEYS[1],'displayed')); local ai=tonumber(redis.call('HGET',KEYS[1],'aiCalls'))
if op=='reserve' then
  if redis.call('HEXISTS',KEYS[1],'seen:'..id)==0 and not redis.call('ZSCORE',KEYS[2],id) then
    if cap>=0 and displayed+redis.call('ZCARD',KEYS[2])>=cap then allowed=0
    else redis.call('ZADD',KEYS[2],ARGV[8],id); redis.call('EXPIRE',KEYS[2],ARGV[3]) end
  end
elseif op=='display' then
  if redis.call('HSETNX',KEYS[1],'seen:'..id,1)==1 then displayed=redis.call('HINCRBY',KEYS[1],'displayed',1) end
  redis.call('ZREM',KEYS[2],id)
elseif op=='ai' then
  if cap>=0 and ai>=cap then allowed=0 else ai=redis.call('HINCRBY',KEYS[1],'aiCalls',1) end
end
local rollup=redis.call('SET',KEYS[3],'1','NX','EX',ARGV[9])
return {allowed,displayed,ai,redis.call('ZCARD',KEYS[2]),rollup and 1 or 0}`;

export function usageRollupQuery(
  shop: string,
  month: Date,
  displayed: number,
  aiCalls: number,
) {
  return Prisma.sql`INSERT INTO "MonthlyUsage" (shop,month,displayed,"aiCalls","updatedAt")
    VALUES (${shop},${month},${displayed},${aiCalls},CURRENT_TIMESTAMP)
    ON CONFLICT (shop,month) DO UPDATE SET displayed=GREATEST("MonthlyUsage".displayed,EXCLUDED.displayed),
      "aiCalls"=GREATEST("MonthlyUsage"."aiCalls",EXCLUDED."aiCalls"),"updatedAt"=CURRENT_TIMESTAMP`;
}
type Usage = {
  displayed: number;
  aiCalls: number;
  pending: number;
  available: boolean;
};
async function operation(
  shop: string,
  op: string,
  id = "",
  cap = -1,
  month = usageMonth(),
): Promise<Usage & { allowed: boolean }> {
  const durable = await prisma.monthlyUsage.findUnique({
    where: { shop_month: { shop, month } },
  });
  const base = {
    displayed: durable?.displayed || 0,
    aiCalls: durable?.aiCalls || 0,
    pending: 0,
  };
  try {
    const now = Date.now();
    const values = (await billingRedis.eval(
      USAGE_SCRIPT,
      usageKeys(shop, month),
      [
        base.displayed,
        base.aiCalls,
        100 * 86400,
        now,
        op,
        id,
        cap,
        now + USAGE_RESERVATION_MS,
        USAGE_ROLLUP_SECONDS,
      ],
    )) as number[];
    if (
      !Array.isArray(values) ||
      values.length !== 5 ||
      values.some((n) => !Number.isFinite(Number(n)))
    )
      throw new Error("Invalid usage totals");
    const [allowed, displayed, aiCalls, pending, rollup] = values.map(Number);
    if (rollup) {
      try {
        await prisma.$executeRaw(
          usageRollupQuery(shop, month, displayed, aiCalls),
        );
      } catch {
        // Retry the same cumulative totals on the next request; never reset counters.
        await billingRedis.del(usageKeys(shop, month)[2]);
        console.error("AOVBoost usage rollup failed", { shop });
      }
    }
    return {
      allowed: allowed === 1,
      displayed,
      aiCalls,
      pending,
      available: true,
    };
  } catch {
    return { ...base, allowed: false, available: false };
  }
}
export async function getUsage(
  shop: string,
  month = usageMonth(),
): Promise<Usage> {
  try {
    return await operation(shop, "read", "", -1, month);
  } catch {
    return { displayed: 0, aiCalls: 0, pending: 0, available: false };
  }
}
export async function getPlanStatus(shop: string, admin?: BillingAdmin) {
  const [entitlement, usage] = await Promise.all([
    getEntitlements(shop, admin),
    getUsage(shop),
  ]);
  const plan = limitsFor(entitlement);
  const displayLimitReached =
    plan.monthlyDisplays !== null &&
    usage.displayed + usage.pending >= plan.monthlyDisplays;
  const analyticsRequired =
    entitlement.tier === "free" &&
    !displayLimitReached &&
    (await getAppSettings(shop)).analyticsEnabled === false;
  return {
    entitlement,
    usage,
    plan,
    notice:
      entitlement.state === "test"
        ? "Billing test mode is active. Pro features are enabled without a Shopify subscription. AI usage limits still apply."
        : displayLimitReached
          ? "Your monthly recommendation allowance is used or reserved. New offers pause until capacity resets or you upgrade."
          : analyticsRequired
            ? "Enable analytics in recommendation settings to use the Free plan's displayed-offer allowance."
            : !usage.available && entitlement.tier === "free"
              ? "Usage verification is temporarily unavailable. New free offers pause until it recovers."
              : entitlement.state === "unverified"
                ? "Your plan needs verification. Deterministic recommendations continue; AI is paused until the plan is verified."
                : null,
  };
}
export async function reserveOfferDisplay(
  shop: string,
  offerId: string,
  entitlement?: Entitlement,
) {
  const plan = limitsFor(entitlement || (await getEntitlements(shop)));
  if (plan.monthlyDisplays === null) return true;
  try {
    return (await operation(shop, "reserve", offerId, plan.monthlyDisplays))
      .allowed;
  } catch {
    return false;
  }
}
export async function reserveMonthlyAiCall(shop?: string) {
  if (!shop) return process.env.NODE_ENV !== "production";
  try {
    const entitlement = await getEntitlements(shop);
    const cap = limitsFor(entitlement).monthlyAiCalls;
    if (cap <= 0) return false;
    return (await operation(shop, "ai", "", cap)).allowed;
  } catch {
    return false;
  }
}
export async function monthlyAiAvailable(shop: string) {
  try {
    const cap = limitsFor(await getEntitlements(shop)).monthlyAiCalls;
    if (cap <= 0) return false;
    const usage = await getUsage(shop);
    return usage.available && usage.aiCalls < cap;
  } catch {
    return false;
  }
}
export async function recordDisplayedOffers(
  shop: string,
  sessionId: string,
  ids: string[],
) {
  const unique = [...new Set(ids)]
    .filter((id) => /^[a-zA-Z0-9_-]{1,128}$/.test(id))
    .slice(0, 100);
  if (!unique.length) return;
  const offers = await prisma.offer.findMany({
    where: {
      shop,
      sessionId,
      id: { in: unique },
      createdAt: { gte: new Date(Date.now() - 31 * 86400_000) },
      widgetType: { in: ["upsell_drawer", "rec_strip", "bundle", "upsell"] },
    },
    select: { id: true, createdAt: true },
  });
  for (const offer of offers) {
    // Attribute delayed impressions to the month in which the offer was issued.
    try {
      await operation(
        shop,
        "display",
        offer.id,
        -1,
        usageMonth(offer.createdAt),
      );
    } catch {
      /* Telemetry never breaks the storefront cart or event ingestion. */
    }
  }
}
