import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  graphql: vi.fn(),
  redirect: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock("./shopify.server", () => ({ authenticate: { admin: mocks.auth } }));
vi.mock("./models/entitlements.server", async (original) => ({
  ...(await original<typeof import("./models/entitlements.server")>()),
  invalidateEntitlements: mocks.invalidate,
}));
import { upgradeAction } from "./models/upgrade.server";
import { PLAN_CONFIG } from "./models/entitlements.server";
const original = structuredClone(PLAN_CONFIG);
const req = (intent = "upgrade") =>
  ({
    request: new Request("https://app.test/app/plan", {
      method: "POST",
      body: new URLSearchParams({
        intent,
        shop: "other.myshopify.com",
        amount: "0",
      }),
    }),
  }) as any;
beforeEach(() => {
  vi.resetAllMocks();
  PLAN_CONFIG.billingTestMode = false;
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("VERCEL_ENV", undefined);
  vi.stubEnv("VERCEL", undefined);
  vi.stubEnv("SHOPIFY_APP_URL", "https://app.test");
  mocks.auth.mockResolvedValue({
    session: { shop: "one.myshopify.com" },
    admin: { graphql: mocks.graphql },
    redirect: mocks.redirect,
  });
  mocks.redirect.mockImplementation((url, options) => ({ url, options }));
});
afterEach(() => {
  Object.assign(PLAN_CONFIG, structuredClone(original));
  vi.unstubAllEnvs();
});
describe("explicit plan actions", () => {
  it("authenticates but never creates a charge or invalidates billing while test mode is active", async () => {
    PLAN_CONFIG.billingTestMode = true;
    PLAN_CONFIG.billingSource = "admin_api";
    PLAN_CONFIG.upgradeMode = "billing_api";
    PLAN_CONFIG.proRecurringPrice = {
      amount: 7,
      currencyCode: "USD",
      interval: "EVERY_30_DAYS",
      test: false,
    } as any;
    expect(((await upgradeAction(req())) as any).init.status).toBe(409);
    PLAN_CONFIG.upgradeMode = "shopify_hosted";
    expect(((await upgradeAction(req())) as any).init.status).toBe(409);
    expect(((await upgradeAction(req("refresh"))) as any).data).toEqual({
      ok: true,
    });
    expect(mocks.auth).toHaveBeenCalledTimes(3);
    expect(mocks.graphql).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });
  it("requires admin authentication and never creates a charge without configured pricing", async () => {
    const result = (await upgradeAction(req())) as any;
    expect(result.init.status).toBe(409);
    expect(mocks.graphql).not.toHaveBeenCalled();
    mocks.auth.mockRejectedValueOnce(
      new Response("Unauthorized", { status: 401 }),
    );
    await expect(upgradeAction(req())).rejects.toBeInstanceOf(Response);
  });
  it("uses the Shopify-hosted selector when configured without creating a Billing API charge", async () => {
    PLAN_CONFIG.upgradeMode = "shopify_hosted";
    await upgradeAction(req());
    expect(mocks.redirect).toHaveBeenCalledWith(
      "https://admin.shopify.com/store/one/charges/ai-agent-21/pricing_plans",
      { target: "_top" },
    );
    expect(mocks.graphql).not.toHaveBeenCalled();
  });
  it("uses only server-configured prices and verifies Shopify's returned confirmation URL", async () => {
    PLAN_CONFIG.billingSource = "admin_api";
    PLAN_CONFIG.upgradeMode = "billing_api";
    PLAN_CONFIG.proRecurringPrice = {
      amount: 7,
      currencyCode: "USD",
      interval: "EVERY_30_DAYS",
      test: true,
    } as any;
    mocks.graphql.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            appSubscriptionCreate: {
              userErrors: [],
              confirmationUrl:
                "https://admin.shopify.com/store/one/charges/confirm",
            },
          },
        }),
      ),
    );
    await upgradeAction(req());
    expect(mocks.graphql.mock.calls[0][1].variables).toMatchObject({
      name: "Pro",
      test: true,
      returnUrl: "https://app.test/app/plan",
      lineItems: [
        {
          plan: {
            appRecurringPricingDetails: {
              price: { amount: 7, currencyCode: "USD" },
            },
          },
        },
      ],
    });
    expect(mocks.redirect).toHaveBeenCalledTimes(1);
    mocks.graphql.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            appSubscriptionCreate: {
              userErrors: [],
              confirmationUrl: "https://evil.test/charge",
            },
          },
        }),
      ),
    );
    expect(((await upgradeAction(req())) as any).init.status).toBe(503);
    expect(mocks.redirect).toHaveBeenCalledTimes(1);
  });
  it("refreshes only the authenticated shop and rejects unknown actions", async () => {
    await upgradeAction(req("refresh"));
    expect(mocks.invalidate).toHaveBeenCalledWith("one.myshopify.com");
    expect(((await upgradeAction(req("delete"))) as Response).status).toBe(400);
  });
});
