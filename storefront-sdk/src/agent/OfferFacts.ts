import type { WidgetPayload } from "../widgets/BaseWidget";
import type { AgentContext } from "./types";
import { AGENT_LIMITS as L } from "./constants";

// New, optional frontend integration contract. Current app-proxy responses do
// not supply these facts. Only a merchant-controlled, verified data source may
// populate them; an offer's generated copy is never evidence of a reward/count.
export type AgentFactsConfig = {
  version: 1;
  reward?: {
    id: string;
    configured: true;
    description: string;
    threshold: number;
    currency: string;
    startsAt?: string;
    endsAt?: string;
    code?: string;
  };
  proof?: Array<{
    productId: string;
    verified: true;
    count: number;
    startsAt: string;
    endsAt: string;
  }>;
  alerts?: Array<{
    id: string;
    productId: string;
    body: string;
    headline?: string;
    startsAt?: string;
    endsAt?: string;
  }>;
};
type Common = { key: string; minHeight: number; expiresAt?: number };
export type FactView = Common &
  (
    | {
        type: "discount_nudge";
        description: string;
        threshold: number;
        remaining: number;
        progress: number;
        currency: string;
        code: string;
      }
    | {
        type: "countdown_banner";
        headline: string;
        body: string;
        endsAt: number;
      }
    | {
        type: "social_proof";
        title: string;
        count: number;
        startsAt: number;
        endsAt: number;
        productId: string;
      }
    | {
        type: "inline_alert";
        headline: string;
        body: string;
        productId: string;
        dismissalKey: string;
      }
  );
export type FactResult =
  | { ok: true; view: FactView; reason: "eligible" }
  | { ok: false; reason: string };
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const clean = (value: unknown, max = 240) => {
  if (typeof value !== "string") return "";
  const copy = value.replace(/\s+/g, " ").trim();
  return copy.length <= max &&
    !/\{\{|\$\{|\{[a-zA-Z_][a-zA-Z0-9_]*\}/.test(copy)
    ? copy
    : "";
};
const identifier = (value: unknown) =>
  typeof value === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
const productId = (value: unknown) =>
  typeof value === "string" && /^gid:\/\/shopify\/Product\/\d+$/.test(value)
    ? value
    : "";
export const FACT_TYPES = [
  "discount_nudge",
  "countdown_banner",
  "social_proof",
  "inline_alert",
];
export function factHash(value: string): string {
  let first = 2166136261,
    second = 5381;
  for (let index = 0; index < value.length; index++) {
    first = Math.imul(first ^ value.charCodeAt(index), 16777619);
    second = Math.imul(second, 33) ^ value.charCodeAt(index);
  }
  return `${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`;
}
export function factTime(value: unknown): number {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    )
  )
    return NaN;
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > new Date(Date.UTC(year, month, 0)).getUTCDate()
  )
    return NaN;
  return Date.parse(value);
}
function active(value: Record<string, unknown>, now: number): boolean {
  const start =
    value.startsAt === undefined ? -Infinity : factTime(value.startsAt);
  const end = value.endsAt === undefined ? Infinity : factTime(value.endsAt);
  return start <= now && end > now && start < end;
}
export class OfferFacts {
  constructor(
    private source: () => unknown = () => window.AOVBoost?.agentFacts,
    private campaign: () => unknown = () => window.AOVBoost?.campaign,
  ) {}
  evaluate(
    type: string,
    payload: WidgetPayload,
    ctx: AgentContext,
  ): FactResult {
    const deny = (reason: string): FactResult => ({ ok: false, reason });
    let config: Record<string, unknown>, campaign: Record<string, unknown>;
    try {
      config = record(this.source());
      campaign = record(this.campaign());
    } catch {
      return deny("facts_unavailable");
    }
    const now = Date.now();
    const validConfig = config.version === 1;
    if (type === "countdown_banner") {
      const end = factTime(campaign.endsAt);
      if (!Number.isFinite(end) || !active(campaign, now))
        return deny("future_campaign_required");
      if (payload.endsAt !== undefined && factTime(payload.endsAt) !== end)
        return deny("campaign_end_mismatch");
      const headline = clean(campaign.headline, 100),
        body = clean(campaign.body);
      return {
        ok: true,
        reason: "eligible",
        view: {
          type,
          headline,
          body,
          endsAt: end,
          expiresAt: end,
          minHeight: L.CAMPAIGN_SLOT_MIN_HEIGHT,
          key: factHash(JSON.stringify([end, headline, body])),
        },
      };
    }
    if (type === "discount_nudge") {
      const reward = record(validConfig ? config.reward : undefined),
        threshold = reward.threshold;
      if (
        reward.configured !== true ||
        !identifier(reward.id) ||
        !clean(reward.description) ||
        typeof threshold !== "number" ||
        !Number.isFinite(threshold) ||
        threshold <= 0 ||
        !active(reward, now)
      )
        return deny("configured_reward_required");
      if (
        !ctx.cart.known ||
        !Number.isFinite(ctx.cart.subtotal) ||
        ctx.cart.subtotal < 0
      )
        return deny("verified_cart_required");
      const currency = String(reward.currency || "");
      if (!/^[A-Z]{3}$/.test(currency) || currency !== ctx.cart.currency)
        return deny("reward_currency_mismatch");
      if (
        payload.threshold !== undefined &&
        Number(payload.threshold) !== threshold
      )
        return deny("reward_threshold_mismatch");
      let digits = 2;
      try {
        digits =
          new Intl.NumberFormat(undefined, {
            style: "currency",
            currency,
          }).resolvedOptions().maximumFractionDigits ?? 2;
      } catch {
        return deny("reward_currency_invalid");
      }
      const scale = 10 ** Math.min(2, digits),
        units = threshold * scale;
      if (
        !Number.isSafeInteger(Math.round(units)) ||
        Math.abs(units - Math.round(units)) > 1e-6
      )
        return deny("reward_threshold_precision");
      const cartUnits = ctx.cart.subtotal * scale;
      if (
        !Number.isSafeInteger(Math.round(cartUnits)) ||
        Math.abs(cartUnits - Math.round(cartUnits)) > 1e-6
      )
        return deny("cart_amount_precision");
      const code = reward.code === undefined ? "" : clean(reward.code, 65);
      if (
        reward.code !== undefined &&
        (!code || !/^[a-zA-Z0-9_-]{1,64}$/.test(code))
      )
        return deny("reward_code_invalid");
      return {
        ok: true,
        reason: "eligible",
        view: {
          type,
          description: clean(reward.description),
          threshold,
          remaining: Math.max(
            0,
            Math.round((threshold - ctx.cart.subtotal) * 100) / 100,
          ),
          progress: Math.min(
            100,
            Math.max(0, (ctx.cart.subtotal / threshold) * 100),
          ),
          currency,
          code,
          expiresAt:
            reward.endsAt === undefined ? undefined : factTime(reward.endsAt),
          minHeight: L.REWARD_SLOT_MIN_HEIGHT,
          key: factHash(JSON.stringify(reward)),
        },
      };
    }
    if (type === "social_proof") {
      if (ctx.page.type !== "product" || !productId(ctx.page.productId))
        return deny("current_product_required");
      const rows =
        validConfig && Array.isArray(config.proof) ? config.proof : [];
      for (const entry of rows.slice(0, L.MAX_FACTS)) {
        const proof = record(entry),
          start = factTime(proof.startsAt),
          end = factTime(proof.endsAt);
        if (
          proof.productId !== ctx.page.productId ||
          proof.verified !== true ||
          !Number.isSafeInteger(proof.count) ||
          Number(proof.count) < L.MIN_PROOF_COUNT ||
          !Number.isFinite(start) ||
          !Number.isFinite(end) ||
          start >= end ||
          end > now
        )
          continue;
        return {
          ok: true,
          reason: "eligible",
          view: {
            type,
            title: clean(ctx.page.productTitle, 160),
            productId: ctx.page.productId!,
            count: Number(proof.count),
            startsAt: start,
            endsAt: end,
            minHeight: L.PROOF_SLOT_MIN_HEIGHT,
            key: factHash(JSON.stringify(proof)),
          },
        };
      }
      return deny("verified_proof_window_required");
    }
    if (type === "inline_alert") {
      if (ctx.page.type !== "product" || !productId(ctx.page.productId))
        return deny("current_product_required");
      const rows =
        validConfig && Array.isArray(config.alerts) ? config.alerts : [];
      let dismissed = false;
      for (const entry of rows.slice(0, L.MAX_FACTS)) {
        const alert = record(entry);
        if (
          alert.productId !== ctx.page.productId ||
          !identifier(alert.id) ||
          !clean(alert.body) ||
          !active(alert, now)
        )
          continue;
        const dismissalKey = `inline_alert:${factHash(`${alert.productId}:${alert.id}`)}`;
        if (ctx.session.dismissed[dismissalKey]) {
          dismissed = true;
          continue;
        }
        return {
          ok: true,
          reason: "eligible",
          view: {
            type,
            headline: clean(alert.headline, 100),
            body: clean(alert.body),
            productId: ctx.page.productId!,
            dismissalKey,
            expiresAt:
              alert.endsAt === undefined ? undefined : factTime(alert.endsAt),
            minHeight: L.ALERT_SLOT_MIN_HEIGHT,
            key: factHash(JSON.stringify(alert)),
          },
        };
      }
      return deny(
        dismissed ? "alert_payload_dismissed" : "supplied_alert_required",
      );
    }
    return deny("unknown_fact_provider");
  }
}
