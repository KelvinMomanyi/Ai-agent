import { createHash } from "node:crypto";
import config from "../config/plans.json";
import prisma from "../db.server";
import { billingRedis } from "../redis.server";

export const PLAN_CONFIG = config;
export type PlanTier = "free" | "pro";
export type Entitlement = {
  tier: PlanTier | "unverified";
  subscriptionName: string | null;
  checkedAt: number;
  state: "verified" | "grace" | "unverified";
  unmapped: boolean;
};
export type BillingAdmin = {
  graphql: (query: string, options?: any) => Promise<Response>;
};
export const ENTITLEMENT_CACHE_SECONDS = 300;
export const ENTITLEMENT_GRACE_MS = 24 * 60 * 60 * 1000;
export const SUBSCRIPTIONS_QUERY = `#graphql
  query AOVBoostActiveSubscriptions {
    currentAppInstallation { activeSubscriptions { id name status test } }
  }`;
const pending = new Map<string, Promise<Entitlement>>();
const configVersion = () =>
  createHash("sha256")
    .update(
      JSON.stringify([
        config.billingSource,
        config.tiers.free.subscriptionNames,
        config.tiers.pro.subscriptionNames,
      ]),
    )
    .digest("hex")
    .slice(0, 16);
export const entitlementCacheKey = (shop: string) => `entitlement:${shop}`;

export function mapSubscriptions(
  subscriptions: Array<{ name: string; status: string }>,
): Entitlement {
  const active = subscriptions.filter((sub) => sub.status === "ACTIVE");
  const names = new Set(
    config.tiers.pro.subscriptionNames.map((name) => name.trim().toLowerCase()),
  );
  const recognized = active.find((sub) =>
    names.has(sub.name.trim().toLowerCase()),
  );
  const freeNames = new Set(
    config.tiers.free.subscriptionNames.map((name: string) =>
      name.trim().toLowerCase(),
    ),
  );
  const free = active.find((sub) =>
    freeNames.has(sub.name.trim().toLowerCase()),
  );
  // An unrecognized ACTIVE subscription is paid until its mapping is reviewed.
  // Never downgrade a merchant because a plan was renamed in Shopify.
  const unknown = active.find(
    (sub) =>
      !freeNames.has(sub.name.trim().toLowerCase()) &&
      !names.has(sub.name.trim().toLowerCase()),
  );
  const subscription = recognized || unknown || free;
  const confirmedEmpty = config.billingSource === "admin_api";
  return {
    tier: subscription
      ? recognized || unknown
        ? "pro"
        : free
          ? "free"
          : "pro"
      : confirmedEmpty
        ? "free"
        : "unverified",
    subscriptionName: subscription?.name || null,
    checkedAt: Date.now(),
    state: subscription || confirmedEmpty ? "verified" : "unverified",
    unmapped: Boolean(subscription && subscription === unknown),
  };
}
export function limitsFor(entitlement: Entitlement) {
  if (entitlement.tier === "unverified")
    return {
      ...config.tiers.pro,
      label: "Awaiting verification",
      monthlyAiCalls: 0,
    };
  return config.tiers[entitlement.tier];
}
function valid(value: any): value is Entitlement {
  return (
    value &&
    ["free", "pro"].includes(value.tier) &&
    Number.isFinite(value.checkedAt) &&
    value.checkedAt <= Date.now() &&
    Date.now() - value.checkedAt < ENTITLEMENT_GRACE_MS
  );
}
function fromRow(row: any): Entitlement | null {
  if (!row || row.source !== configVersion()) return null;
  const value = {
    tier: row.tier,
    subscriptionName: row.subscriptionName,
    checkedAt: new Date(row.verifiedAt).getTime(),
    state: "verified",
    unmapped: row.unmapped,
  };
  return valid(value) ? (value as Entitlement) : null;
}
export async function getEntitlements(
  shop: string,
  admin?: BillingAdmin,
): Promise<Entitlement> {
  const key = entitlementCacheKey(shop);
  let cached: Entitlement | null = null;
  try {
    const raw = await billingRedis.get(key);
    const entry = typeof raw === "string" ? JSON.parse(raw) : raw;
    cached = entry?.source === configVersion() ? entry.entitlement : null;
    if (
      valid(cached) &&
      Date.now() - cached.checkedAt < ENTITLEMENT_CACHE_SECONDS * 1000
    )
      return { ...cached, state: "verified" };
  } catch {
    /* PostgreSQL is the durable fallback, including on Redis failure. */
  }
  const running = pending.get(key);
  if (running) return running;
  const task = refresh(shop, cached, admin).finally(() => pending.delete(key));
  if (pending.size < 100) pending.set(key, task);
  return task;
}
async function refresh(
  shop: string,
  cached: Entitlement | null,
  supplied?: BillingAdmin,
): Promise<Entitlement> {
  let previous = valid(cached) ? cached : null;
  try {
    let row: Awaited<ReturnType<typeof prisma.entitlementSnapshot.findUnique>> =
      null;
    try {
      row = await prisma.entitlementSnapshot.findUnique({ where: { shop } });
    } catch {
      /* Query Shopify when durable snapshot storage is temporarily unavailable. */
    }
    const stored = fromRow(row);
    if (stored && (!previous || stored.checkedAt > previous.checkedAt))
      previous = stored;
    if (
      stored &&
      !row!.refreshRequired &&
      Date.now() - stored.checkedAt < 300_000
    )
      return stored;
    // Modern Shopify App Pricing requires a separate Partner API integration.
    // Do not infer "free" from its empty Admin API subscriptions list.
    if (
      config.billingSource === "shopify_app_pricing" ||
      config.billingSource === "unconfirmed"
    )
      throw new Error("Billing source requires configuration");
    const admin =
      supplied ||
      (await (await import("../shopify.server")).unauthenticated.admin(shop))
        .admin;
    const response = await admin.graphql(SUBSCRIPTIONS_QUERY, {
      tries: 1,
      signal: AbortSignal.timeout(1500),
    });
    const result = await response.json();
    const subscriptions =
      result.data?.currentAppInstallation?.activeSubscriptions;
    if (
      !response.ok ||
      result.errors?.length ||
      !Array.isArray(subscriptions) ||
      !subscriptions.every(
        (sub: any) =>
          typeof sub.name === "string" && typeof sub.status === "string",
      )
    )
      throw new Error("Subscription query unavailable");
    const entitlement = mapSubscriptions(subscriptions);
    if (entitlement.state === "unverified")
      return previous ? { ...previous, state: "grace" } : entitlement;
    try {
      await prisma.entitlementSnapshot.upsert({
        where: { shop },
        create: {
          shop,
          tier: entitlement.tier,
          subscriptionName: entitlement.subscriptionName,
          verifiedAt: new Date(entitlement.checkedAt),
          source: configVersion(),
          unmapped: entitlement.unmapped,
        },
        update: {
          tier: entitlement.tier,
          subscriptionName: entitlement.subscriptionName,
          verifiedAt: new Date(entitlement.checkedAt),
          source: configVersion(),
          unmapped: entitlement.unmapped,
          refreshRequired: false,
        },
      });
    } catch {
      console.error("AOVBoost verified entitlement could not be persisted", {
        shop,
      });
    }
    try {
      await billingRedis.set(
        entitlementCacheKey(shop),
        JSON.stringify({ source: configVersion(), entitlement }),
        ENTITLEMENT_CACHE_SECONDS,
      );
    } catch {
      /* A confirmed result is usable even when cache persistence fails. */
    }
    return entitlement;
  } catch {
    if (previous) return { ...previous, state: "grace" };
    return {
      tier: "unverified",
      subscriptionName: null,
      state: "unverified",
      checkedAt: 0,
      unmapped: false,
    };
  }
}
export async function invalidateEntitlements(shop: string) {
  // Keep the last verified plan available for the outage grace period.
  await prisma.entitlementSnapshot.updateMany({
    where: { shop },
    data: { refreshRequired: true },
  });
  await billingRedis.del(entitlementCacheKey(shop));
}
export function hostedUpgradeUrl(shop: string) {
  if (
    config.upgradeMode !== "shopify_hosted" ||
    !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop) ||
    !/^[a-z0-9-]+$/.test(config.appHandle)
  )
    return null;
  return `https://admin.shopify.com/store/${shop.replace(/\.myshopify\.com$/, "")}/charges/${config.appHandle}/pricing_plans`;
}
