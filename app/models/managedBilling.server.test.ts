import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getManagedSubscriptions } from "./managedBilling.server";
import { billingSource } from "./billingConfiguration.server";

const shop = "one.myshopify.com";
const identity = { id: "gid://shopify/Shop/123", myshopifyDomain: shop };
const graphql = vi.fn();
const fetchMock = vi.fn();
const result = (subscription: unknown) =>
  new Response(JSON.stringify({ data: { activeSubscription: subscription } }));
const subscription = (handle = "pro_plan") => ({
  shop: identity,
  items: [{ handle, price: { active: true } }],
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("SHOPIFY_PARTNER_ID", "12345");
  vi.stubEnv("SHOPIFY_PARTNER_APP_ID", "gid://shopify/App/456");
  vi.stubEnv("SHOPIFY_PARTNER_API_TOKEN", "synthetic-test-token");
  vi.stubEnv("AOVBOOST_MANAGED_PRO_HANDLES", "pro_plan");
  vi.stubEnv("AOVBOOST_MANAGED_FREE_HANDLES", "free_plan");
  vi.stubGlobal("fetch", fetchMock);
  graphql.mockImplementation(
    async () => new Response(JSON.stringify({ data: { shop: identity } })),
  );
  fetchMock.mockImplementation(async () => result(subscription()));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Shopify App Pricing verification", () => {
  it("queries the Partner API with the authenticated shop ID and maps configured handles", async () => {
    expect(await getManagedSubscriptions(shop, { graphql })).toEqual([
      { name: "Pro", status: "ACTIVE" },
    ]);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://partners.shopify.com/12345/api/2026-07/graphql.json",
    );
    expect(JSON.parse(options.body).variables).toEqual({
      appId: "gid://shopify/App/456",
      shopId: identity.id,
    });
    expect(options.redirect).toBe("error");
    expect(options.headers["X-Shopify-Access-Token"]).toBe(
      "synthetic-test-token",
    );
    fetchMock.mockResolvedValueOnce(result(subscription("free_plan")));
    expect(await getManagedSubscriptions(shop, { graphql })).toEqual([
      { name: "Free", status: "ACTIVE" },
    ]);
  });
  it("distinguishes a verified absence of a contract from a missing response field", async () => {
    fetchMock.mockResolvedValueOnce(result(null));
    expect(await getManagedSubscriptions(shop, { graphql })).toBeNull();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: {} })));
    await expect(getManagedSubscriptions(shop, { graphql })).rejects.toThrow(
      /unavailable/,
    );
  });
  it("preserves unknown plan names for the existing paid-plan review policy", async () => {
    fetchMock.mockResolvedValueOnce(result(subscription("renamed_pro")));
    expect(await getManagedSubscriptions(shop, { graphql })).toEqual([
      { name: "Managed plan: renamed_pro", status: "ACTIVE" },
    ]);
  });
  it.each([
    {
      ...subscription(),
      shop: { ...identity, myshopifyDomain: "other.myshopify.com" },
    },
    { ...subscription(), shop: { ...identity, id: "gid://shopify/Shop/999" } },
    { ...subscription(), items: [] },
    {
      ...subscription(),
      items: [{ handle: "pro_plan", price: { active: false } }],
    },
    { ...subscription(), items: [{ handle: "pro_plan", price: {} }] },
  ])(
    "refuses mismatched or incomplete subscription data: %j",
    async (value) => {
      fetchMock.mockResolvedValueOnce(result(value));
      await expect(
        getManagedSubscriptions(shop, { graphql }),
      ).rejects.toThrow();
    },
  );
  it("refuses an Admin identity mismatch before sending a Partner request", async () => {
    graphql.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            shop: { ...identity, myshopifyDomain: "other.myshopify.com" },
          },
        }),
      ),
    );
    await expect(getManagedSubscriptions(shop, { graphql })).rejects.toThrow(
      /identity/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("refuses missing credentials without attempting a request", async () => {
    vi.stubEnv("SHOPIFY_PARTNER_API_TOKEN", "");
    await expect(getManagedSubscriptions(shop, { graphql })).rejects.toThrow(
      /configured/,
    );
    expect(graphql).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("fails closed on HTTP errors and partial GraphQL failures", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          errors: [{ message: "denied" }],
          data: { activeSubscription: subscription() },
        }),
      ),
    );
    await expect(getManagedSubscriptions(shop, { graphql })).rejects.toThrow(
      /unavailable/,
    );
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 429 }));
    await expect(getManagedSubscriptions(shop, { graphql })).rejects.toThrow(
      /unavailable/,
    );
  });
  it("accepts only explicitly supported billing sources", () => {
    vi.stubEnv("AOVBOOST_BILLING_SOURCE", "shopify_app_pricing");
    expect(billingSource()).toBe("shopify_app_pricing");
    vi.stubEnv("AOVBOOST_BILLING_SOURCE", "anything_else");
    expect(billingSource()).toBe("unconfirmed");
  });
});
