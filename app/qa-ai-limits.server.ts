import { randomUUID } from "node:crypto";
import { qaLocalAiLimitsEnabled } from "./qa-mode.server";

type Limits = readonly [number, number, number, number];
// Fail closed at capacity rather than evicting live counters and resetting budgets.
const MAX_SHOPS = 1000;
const MAX_LEASES = 1000;
const LEASE_MS = 30_000;
const shops = new Map<string, number>();
const leases = new Map<string, { shop: string; expiresAt: number }>();
let day = "";
let attempts = 0;

/** QA only: bounded per-process budgets, never a distributed production guarantee. */
export function reserveLocalQaAiAttempt(
  shop: string | undefined,
  [globalDaily, shopDaily, globalConcurrency, shopConcurrency]: Limits,
): (() => Promise<void>) | null {
  if (!qaLocalAiLimitsEnabled() || !shop) return null;
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  if (today !== day) {
    day = today;
    attempts = 0;
    shops.clear();
  }
  // Leases survive midnight; daily counters reset independently of active calls.
  for (const [id, lease] of leases)
    if (lease.expiresAt <= now) leases.delete(id);
  const used = shops.get(shop) ?? 0;
  if (
    attempts >= globalDaily ||
    used >= shopDaily ||
    leases.size >= Math.min(globalConcurrency, MAX_LEASES) ||
    [...leases.values()].filter((lease) => lease.shop === shop).length >=
      shopConcurrency ||
    (!shops.has(shop) && shops.size >= MAX_SHOPS)
  )
    return null;
  const id = randomUUID();
  attempts++;
  shops.set(shop, used + 1);
  leases.set(id, { shop, expiresAt: now + LEASE_MS });
  return async () => {
    leases.delete(id);
  };
}
