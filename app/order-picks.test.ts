import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultStorefrontConfig } from "./models/storefrontConfig";
const m = vi.hoisted(() => ({
  auth: vi.fn(),
  installed: vi.fn(),
  settings: vi.fn(),
  select: vi.fn(),
  holdout: vi.fn(),
  create: vi.fn(),
  reserve: vi.fn(),
  find: vi.fn(),
  proxy: vi.fn(),
  guard: vi.fn(),
  events: vi.fn(),
}));
vi.mock("./shopify.server", () => ({
  authenticate: { public: { customerAccount: m.auth } },
}));
vi.mock("./db.server", () => ({ default: { offer: { findFirst: m.find } } }));
vi.mock("./models/event.server", () => ({ ingestStorefrontEvents: m.events }));
vi.mock("./models/installedShop.server", () => ({
  isInstalledShop: m.installed,
}));
vi.mock("./models/settings.server", () => ({ getAppSettings: m.settings }));
vi.mock("./models/pairingRecommendations.server", () => ({
  selectPairingRecommendations: m.select,
  enforcePairingDecisionPolicy: m.guard,
}));
vi.mock("./models/catalogGuard.server", () => ({
  catalogProductToWidgetProduct: (p: any) => p,
}));
vi.mock("./models/entitlements.server", () => ({
  getEntitlements: async () => ({}),
  limitsFor: () => ({ features: { advancedPlacements: true } }),
}));
vi.mock("./models/session.server", () => ({
  upsertShopperSessionFromEvents: async ({ sessionId }: any) => ({
    id: sessionId,
  }),
}));
vi.mock("./models/holdout.server", () => ({ enrollHoldout: m.holdout }));
vi.mock("./models/offer.server", () => ({ createOfferRecord: m.create }));
vi.mock("./models/usage.server", () => ({ reserveOfferDisplay: m.reserve }));
vi.mock("./redis.server", () => ({ incrementRateLimit: async () => 1 }));
vi.mock("./utils/storefrontAuth.server", async (original) => ({
  ...(await original<any>()),
  verifyAppProxyRequest: m.proxy,
}));
import { action } from "./routes/api.order-picks";
import { loader } from "./routes/api.postadd";
const p = {
  id: "gid://shopify/Product/2",
  handle: "conditioner",
  title: "Conditioner",
  variants: [
    {
      id: "gid://shopify/ProductVariant/102",
      title: "Default",
      price: "12.00",
      availableForSale: true,
    },
  ],
};
const invoke = (
  body = { productIds: ["gid://shopify/Product/1"] } as Record<string, unknown>,
) =>
  action({
    request: new Request("https://app.test/api/order-picks", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  } as any);
beforeEach(() => {
  vi.resetAllMocks();
  m.auth.mockResolvedValue({
    sessionToken: { dest: "https://one.myshopify.com" },
  });
  m.proxy.mockReturnValue({ shop: "one.myshopify.com" });
  m.installed.mockResolvedValue(true);
  const config = defaultStorefrontConfig();
  config.agentCoreEnabled = true;
  m.settings.mockResolvedValue({
    storefrontConfig: config,
    postPurchaseEnabled: true,
  });
  m.select.mockResolvedValue([{ product: p }]);
  m.create.mockResolvedValue({ id: "offer" });
  m.reserve.mockResolvedValue(true);
  m.find.mockResolvedValue({
    id: "offer",
    payload: { product: p },
    triggerContext: {
      trigger: "order_status_next_cart",
      sourceProductId: "gid://shopify/Product/1",
      purchasedProductIds: ["gid://shopify/Product/1"],
    },
  });
  m.guard.mockResolvedValue({
    widgetType: "post_purchase",
    payload: { product: p },
  });
});
describe("authenticated next-cart entry point", () => {
  it("reuses an attributed offer without reserving a second offer record", async () => {
    await invoke({
      productIds: ["gid://shopify/Product/1"],
      anonymousId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    expect(m.find.mock.calls[0][0].where).toMatchObject({
      sessionId: "order_status_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    expect(m.create).not.toHaveBeenCalled();
    expect(m.reserve).toHaveBeenCalledWith("one.myshopify.com", "offer", {});
  });
  it("records impressions only for an authenticated shop/session offer and never accepts browser conversion claims", async () => {
    const event = {
      intent: "impression",
      offerId: "offer",
      anonymousId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    };
    await invoke(event);
    expect(m.events.mock.calls[0][0]).toMatchObject({
      shop: "one.myshopify.com",
      sessionId: "order_status_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      events: [
        { type: "impression", offer_id: "offer", provider_id: "post_purchase" },
      ],
    });
    m.events.mockClear();
    m.find.mockResolvedValueOnce(null);
    const rejected = await invoke(event);
    if (rejected instanceof Response) throw Error("response");
    expect(rejected.init?.status).toBe(404);
    expect(m.events).not.toHaveBeenCalled();
    await invoke({ ...event, intent: "accepted" });
    expect(m.events).not.toHaveBeenCalled();
  });
  it("authenticates using Shopify customer account tokens and returns only catalog data", async () => {
    const r = await invoke();
    if (r instanceof Response) throw Error("response");
    expect(r.data).toMatchObject({
      path: "/apps/aovboost/postadd?offer=offer",
      product: { title: "Conditioner" },
    });
    expect(m.select.mock.calls[0][0]).toMatchObject({
      shop: "one.myshopify.com",
      excludeProductIds: ["gid://shopify/Product/1"],
    });
    expect(m.find.mock.calls[0][0].where).toMatchObject({
      shop: "one.myshopify.com",
      widgetType: "post_purchase",
    });
  });
  it("rejects invalid authentication and suppresses holdout without an offer", async () => {
    m.auth.mockRejectedValueOnce(new Response(null, { status: 401 }));
    const rejected = await invoke();
    expect(rejected).toBeInstanceOf(Response);
    expect(rejected instanceof Response && rejected.status).toBe(401);
    m.holdout.mockResolvedValue({ arm: "holdout" });
    await invoke();
    expect(m.create).not.toHaveBeenCalled();
  });
  it("requires signed app-proxy access and scopes the confirmation page to a fresh offer in that shop", async () => {
    const r = await loader({
      request: new Request("https://app.test/api/postadd?offer=offer"),
    } as any);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("For your next cart");
    expect(m.find.mock.calls[0][0].where).toMatchObject({
      id: "offer",
      shop: "one.myshopify.com",
      widgetType: "post_purchase",
    });
    m.proxy.mockImplementationOnce(() => {
      throw Error("unsigned");
    });
    expect(
      (
        await loader({
          request: new Request("https://app.test/api/postadd?offer=offer"),
        } as any)
      ).status,
    ).toBe(503);
  });
  it("does not render expired, revoked or disabled offers", async () => {
    m.find.mockResolvedValueOnce(null);
    expect(
      (
        await loader({
          request: new Request("https://app.test/api/postadd?offer=offer"),
        } as any)
      ).status,
    ).toBe(404);
    m.guard.mockResolvedValue({ widgetType: null, payload: {} });
    expect(
      (
        await loader({
          request: new Request("https://app.test/api/postadd?offer=offer"),
        } as any)
      ).status,
    ).toBe(404);
  });
});
