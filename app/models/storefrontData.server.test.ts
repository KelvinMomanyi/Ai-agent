import { describe, expect, it, vi } from "vitest";
import { defaultStorefrontConfig } from "./storefrontConfig";
import {
  readVerifiedProof,
  resolveStorefrontData,
  verifyReward,
} from "./storefrontData.server";

const now = Date.parse("2026-11-15T12:00:00Z");
const product = "gid://shopify/Product/1";
function admin(value: unknown) {
  return {
    graphql: vi.fn(async () => ({ json: async () => ({ data: value }) })),
  };
}
function discount() {
  return {
    id: "gid://shopify/DiscountCodeNode/1",
    codeDiscount: {
      __typename: "DiscountCodeBasic",
      status: "ACTIVE",
      startsAt: "2026-11-01T00:00:00Z",
      endsAt: null,
      usageLimit: null,
      appliesOncePerCustomer: false,
      context: { __typename: "DiscountBuyerSelectionAll" },
      customerGets: {
        appliesOnOneTimePurchase: true,
        appliesOnSubscription: false,
        items: { __typename: "AllDiscountItems" },
        value: { __typename: "DiscountPercentage", percentage: 0.1 },
      },
      minimumRequirement: {
        __typename: "DiscountMinimumSubtotal",
        greaterThanOrEqualToSubtotal: { amount: "1000", currencyCode: "KES" },
      },
    },
  };
}
const order = (id: string, changes = {}) => ({
  id,
  test: false,
  cancelledAt: null,
  displayFinancialStatus: "PAID",
  processedAt: "2026-11-12T12:00:00Z",
  lineItems: {
    nodes: [
      { currentQuantity: 1, product: { id: product } },
      { currentQuantity: 2, product: { id: product } },
    ],
    pageInfo: { hasNextPage: false },
  },
  ...changes,
});
const orders = (nodes: unknown[], hasNextPage = false) => ({
  orders: { nodes, pageInfo: { hasNextPage, endCursor: "next" } },
});

describe("verified storefront data", () => {
  it("derives the reward and threshold from an actual storewide discount", async () => {
    const api = admin({ codeDiscountNodeByCode: discount() });
    expect(await verifyReward(api, "REAL10", now)).toMatchObject({
      configured: true,
      description: "10% off",
      threshold: 1000,
      currency: "KES",
      code: "REAL10",
      oneTimeOnly: true,
      verifiedUntil: "2026-11-15T12:01:00.000Z",
    });
    expect(api.graphql.mock.calls[0]).toBeDefined();
  });
  it.each([
    "limited",
    "customer",
    "products",
    "expired",
    "zero",
    "shipping",
    "per_item",
  ])("fails closed for unsupported reward %s", async (kind) => {
    const node: any = discount(),
      d = node.codeDiscount;
    if (kind === "limited") d.usageLimit = 2;
    if (kind === "customer") d.context.__typename = "DiscountCustomers";
    if (kind === "products")
      d.customerGets.items.__typename = "DiscountProducts";
    if (kind === "expired") d.endsAt = "2026-11-14T00:00:00Z";
    if (kind === "zero") d.customerGets.value.percentage = 0;
    if (kind === "shipping") d.__typename = "DiscountCodeFreeShipping";
    if (kind === "per_item")
      d.customerGets.value = {
        __typename: "DiscountAmount",
        appliesOnEachItem: true,
        amount: { amount: "10", currencyCode: "KES" },
      };
    await expect(
      verifyReward(admin({ codeDiscountNodeByCode: node }), "REAL", now),
    ).rejects.toThrow();
  });
  it("counts distinct paid non-test uncancelled orders in a complete UTC window", async () => {
    const api = admin(
      orders([
        order("a"),
        order("a"),
        order("b", { test: true }),
        order("c", { cancelledAt: "2026-11-13" }),
        order("d", { displayFinancialStatus: "REFUNDED" }),
        order("e", { processedAt: "2026-11-15T01:00:00Z" }),
        order("f"),
      ]),
    );
    expect(await readVerifiedProof(api, 7, now)).toEqual({
      startsAt: "2026-11-08T00:00:00.000Z",
      endsAt: "2026-11-15T00:00:00.000Z",
      counts: { [product]: 2 },
    });
  });
  it("never publishes a partial order window or partial line items", async () => {
    await expect(
      readVerifiedProof(
        admin(
          orders([
            order("a", {
              lineItems: { nodes: [], pageInfo: { hasNextPage: true } },
            }),
          ]),
        ),
        7,
        now,
      ),
    ).rejects.toThrow("complete history");
    await expect(
      readVerifiedProof(admin(orders([order("a")], true)), 7, now),
    ).rejects.toThrow("complete history");
    await expect(
      readVerifiedProof(
        {
          graphql: async () => ({
            json: async () => ({ errors: [{ message: "denied" }] }),
          }),
        },
        7,
        now,
      ),
    ).rejects.toThrow("temporarily unavailable");
  });
  it("shows only active targeted merchant facts without a Shopify request", async () => {
    const config = defaultStorefrontConfig(),
      api = admin({});
    config.campaign = {
      enabled: true,
      headline: "Actual campaign",
      body: "",
      endsAt: "2026-11-16T00:00:00Z",
    };
    config.notice = {
      enabled: true,
      productIds: [product],
      body: "Supplied notice",
    };
    const data = await resolveStorefrontData({
      shop: "facts-1.myshopify.com",
      config,
      productId: product,
      pageType: "product",
      admin: api,
      now,
    });
    expect(data.agentFacts.alerts?.[0].body).toBe("Supplied notice");
    expect(data.campaign?.headline).toBe("Actual campaign");
    expect(api.graphql).not.toHaveBeenCalled();
    const expired = await resolveStorefrontData({
      shop: "facts-1.myshopify.com",
      config,
      pageType: "home",
      now: now + 86400_000,
    });
    expect(expired.campaign).toBeUndefined();
    expect(expired.agentFacts.alerts).toBeUndefined();
  });
  it("coalesces proof reads but never publishes counts below five", async () => {
    const config = defaultStorefrontConfig();
    config.proof.enabled = true;
    const api = admin(orders([order("1"), order("2"), order("3"), order("4")]));
    const input = {
      shop: "coalesced.myshopify.com",
      config,
      productId: product,
      pageType: "product",
      admin: api,
      now,
    };
    const [a, b] = await Promise.all([
      resolveStorefrontData(input),
      resolveStorefrontData(input),
    ]);
    expect(a.agentFacts.proof).toBeUndefined();
    expect(b.agentFacts.proof).toBeUndefined();
    expect(api.graphql).toHaveBeenCalledTimes(1);
    const positive = await resolveStorefrontData({
      ...input,
      shop: "proof-positive.myshopify.com",
      admin: admin(
        orders(Array.from({ length: 5 }, (_, i) => order(String(i)))),
      ),
    });
    expect(positive.agentFacts.proof?.[0]).toMatchObject({
      count: 5,
      verified: true,
      productId: product,
    });
  });
});
