import { createHash } from "node:crypto";
import type { AgentFactsConfig } from "../../storefront-sdk/src/agent/OfferFacts";
import type { StorefrontConfig } from "./storefrontConfig";

export type StorefrontAdmin = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<{ json: () => Promise<any> }>;
};
export const REWARD_QUERY = `#graphql
 query AOVBoostVerifiedReward($code: String!) {
  codeDiscountNodeByCode(code: $code) {
   id
   codeDiscount { __typename ... on DiscountCodeBasic {
    status startsAt endsAt usageLimit appliesOncePerCustomer
    context { __typename }
    customerGets {
     appliesOnOneTimePurchase appliesOnSubscription
     items { __typename }
     value { __typename ... on DiscountPercentage { percentage } ... on DiscountAmount { amount { amount currencyCode } appliesOnEachItem } }
    }
    minimumRequirement { __typename ... on DiscountMinimumSubtotal { greaterThanOrEqualToSubtotal { amount currencyCode } } }
   } }
  }
 }`;
export const PROOF_QUERY = `#graphql
 query AOVBoostVerifiedProof($query: String!, $after: String) {
  orders(first: 20, after: $after, query: $query, sortKey: PROCESSED_AT) {
   nodes {
    id test cancelledAt displayFinancialStatus processedAt
    lineItems(first: 25) { nodes { currentQuantity product { id } } pageInfo { hasNextPage } }
   }
   pageInfo { hasNextPage endCursor }
  }
 }`;
export const MIN_VERIFIED_PROOF_ORDERS = 5;
const TTL = 60_000,
  MAX_ENTRIES = 100;
const cache = new Map<string, { until: number; value: unknown }>();
const pending = new Map<string, Promise<unknown>>();
export const factKey = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function cached<T>(
  key: string,
  load: () => Promise<T>,
  fresh = false,
): Promise<T> {
  if (!fresh) {
    const row = cache.get(key);
    if (row && row.until > Date.now()) return row.value as T;
    const running = pending.get(key);
    if (running) return running as Promise<T>;
  }
  const task = load()
    .then((value) => {
      cache.set(key, { until: Date.now() + TTL, value });
      if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
      return value;
    })
    .finally(() => {
      if (pending.get(key) === task) pending.delete(key);
    });
  pending.set(key, task);
  return task;
}
async function graph(
  admin: StorefrontAdmin,
  query: string,
  variables: Record<string, unknown>,
) {
  const value = await (await admin.graphql(query, { variables })).json();
  if (value.errors?.length || !value.data)
    throw new Error("Shopify verification is temporarily unavailable.");
  return value.data;
}
export type VerifiedReward = NonNullable<AgentFactsConfig["reward"]> & {
  verifiedUntil: string;
  oneTimeOnly: boolean;
};
export async function verifyReward(
  admin: StorefrontAdmin,
  code: string,
  now = Date.now(),
): Promise<VerifiedReward> {
  const node = (await graph(admin, REWARD_QUERY, { code }))
    .codeDiscountNodeByCode;
  const discount = node?.codeDiscount,
    gets = discount?.customerGets;
  const money = discount?.minimumRequirement?.greaterThanOrEqualToSubtotal;
  const threshold = Number(money?.amount),
    currency = money?.currencyCode;
  if (
    discount?.__typename !== "DiscountCodeBasic" ||
    !["ACTIVE", "SCHEDULED"].includes(discount.status) ||
    discount.context?.__typename !== "DiscountBuyerSelectionAll" ||
    gets?.items?.__typename !== "AllDiscountItems" ||
    !gets.appliesOnOneTimePurchase ||
    discount.usageLimit !== null ||
    discount.appliesOncePerCustomer ||
    !(threshold > 0) ||
    !Number.isFinite(threshold) ||
    !/^[A-Z]{3}$/.test(currency || "")
  )
    throw new Error(
      "Choose a storewide percentage or fixed-amount code with a minimum spend, all customers eligible, and no usage limit.",
    );
  const start = Date.parse(discount.startsAt),
    end = discount.endsAt ? Date.parse(discount.endsAt) : Infinity;
  if (!Number.isFinite(start) || !(end > Math.max(now, start)))
    throw new Error(
      "Choose a discount with a valid current or future schedule.",
    );
  const value = gets.value;
  let description: string;
  if (
    value?.__typename === "DiscountPercentage" &&
    Number.isFinite(value.percentage) &&
    value.percentage > 0 &&
    value.percentage <= 1
  )
    description = `${Number((value.percentage * 100).toFixed(4))}% off`;
  else if (
    value?.__typename === "DiscountAmount" &&
    !value.appliesOnEachItem &&
    value.amount?.currencyCode === currency &&
    Number(value.amount.amount) > 0
  ) {
    description = `${new Intl.NumberFormat("en", { style: "currency", currency }).format(Number(value.amount.amount))} off`;
  } else
    throw new Error(
      "This discount's reward is not supported by the cart spend target.",
    );
  return {
    id: factKey(node.id),
    configured: true,
    description,
    threshold,
    currency,
    code,
    startsAt: new Date(start).toISOString(),
    ...(Number.isFinite(end) ? { endsAt: new Date(end).toISOString() } : {}),
    verifiedUntil: new Date(now + TTL).toISOString(),
    oneTimeOnly: !gets.appliesOnSubscription,
  };
}
type ProofSnapshot = {
  startsAt: string;
  endsAt: string;
  counts: Record<string, number>;
};
export async function readVerifiedProof(
  admin: StorefrontAdmin,
  days: 7 | 30,
  now = Date.now(),
): Promise<ProofSnapshot> {
  const end = new Date(now);
  end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end.getTime() - days * 86400_000),
    counts: Record<string, number> = {},
    seen = new Set<string>();
  let after: string | undefined;
  for (let page = 0; page < 10; page++) {
    const connection = (
      await graph(admin, PROOF_QUERY, {
        query: `test:false financial_status:paid -status:cancelled processed_at:>=${start.toISOString()} processed_at:<${end.toISOString()}`,
        after,
      })
    ).orders;
    if (!Array.isArray(connection?.nodes) || !connection.pageInfo)
      throw new Error("Order history is unavailable.");
    for (const order of connection.nodes) {
      if (!order.id || seen.has(order.id)) continue;
      seen.add(order.id);
      const at = Date.parse(order.processedAt);
      if (
        order.test !== false ||
        order.cancelledAt ||
        order.displayFinancialStatus !== "PAID" ||
        !(at >= start.getTime() && at < end.getTime())
      )
        continue;
      if (
        order.lineItems?.pageInfo?.hasNextPage ||
        !Array.isArray(order.lineItems?.nodes)
      )
        throw new Error(
          "The order window needs a complete history refresh before proof can be shown.",
        );
      const products = new Set<string>(
        order.lineItems.nodes
          .filter(
            (l: any) =>
              Number.isSafeInteger(l.currentQuantity) && l.currentQuantity > 0,
          )
          .map((l: any) => l.product?.id)
          .filter(
            (id: unknown) =>
              typeof id === "string" &&
              /^gid:\/\/shopify\/Product\/\d+$/.test(id),
          ),
      );
      for (const id of products) counts[id] = (counts[id] || 0) + 1;
    }
    if (!connection.pageInfo.hasNextPage)
      return {
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        counts,
      };
    if (
      !connection.pageInfo.endCursor ||
      connection.pageInfo.endCursor === after
    )
      break;
    after = connection.pageInfo.endCursor;
  }
  throw new Error(
    "The order window needs a complete history refresh before proof can be shown.",
  );
}
export async function resolveStorefrontData(input: {
  shop: string;
  config: StorefrontConfig;
  productId?: string;
  pageType: string;
  currency?: string;
  admin?: StorefrontAdmin;
  now?: number;
}) {
  const { config, shop, productId, pageType } = input,
    now = input.now ?? Date.now();
  const facts: AgentFactsConfig & { reward?: VerifiedReward } = { version: 1 },
    status: { reward?: string; proof?: string } = {};
  const current = (v: { startsAt?: string; endsAt?: string }) =>
    (!v.startsAt || Date.parse(v.startsAt) <= now) &&
    (!v.endsAt || Date.parse(v.endsAt) > now);
  const campaign =
    config.campaign.enabled && current(config.campaign)
      ? config.campaign
      : undefined;
  if (
    config.notice.enabled &&
    current(config.notice) &&
    productId &&
    config.notice.productIds.includes(productId)
  )
    facts.alerts = [
      {
        id: factKey(config.notice),
        productId,
        body: config.notice.body,
        ...(config.notice.startsAt ? { startsAt: config.notice.startsAt } : {}),
        ...(config.notice.endsAt ? { endsAt: config.notice.endsAt } : {}),
      },
    ];
  if (
    (config.rewardCode && pageType === "cart") ||
    (config.proof.enabled && productId)
  ) {
    let admin = input.admin;
    try {
      admin ||= (
        await (await import("../shopify.server")).unauthenticated.admin(shop)
      ).admin;
    } catch {
      status.reward = "unavailable";
      status.proof = "unavailable";
    }
    if (admin) {
      if (config.rewardCode && pageType === "cart")
        try {
          const reward = await cached(
            `reward:${shop}:${config.rewardCode}`,
            () => verifyReward(admin!, config.rewardCode),
          );
          if (
            Date.parse(reward.verifiedUntil) > now &&
            current(reward) &&
            (!input.currency || input.currency === reward.currency)
          )
            facts.reward = reward;
        } catch {
          status.reward = "unavailable";
        }
      if (config.proof.enabled && productId)
        try {
          const window = new Date(now).toISOString().slice(0, 10);
          const proof = await cached(
            `proof:${shop}:${config.proof.windowDays}:${window}`,
            () => readVerifiedProof(admin!, config.proof.windowDays),
          );
          if (proof.counts[productId] >= MIN_VERIFIED_PROOF_ORDERS)
            facts.proof = [
              {
                productId,
                verified: true,
                count: proof.counts[productId],
                startsAt: proof.startsAt,
                endsAt: proof.endsAt,
              },
            ];
        } catch {
          status.proof = "unavailable";
        }
    }
  }
  return {
    campaign,
    agentFacts: facts,
    automaticPlacements: config.automaticPlacements,
    status,
  };
}
