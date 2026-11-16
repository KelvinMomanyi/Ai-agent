import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultStorefrontConfig } from "./models/storefrontConfig";
const m = vi.hoisted(() => ({
  auth: vi.fn(),
  installed: vi.fn(),
  settings: vi.fn(),
  session: vi.fn(),
  holdout: vi.fn(),
  limit: vi.fn(),
  facts: vi.fn(),
  product: vi.fn(),
  prior: vi.fn(),
  create: vi.fn(),
  reserve: vi.fn(),
  allowed: true,
}));
vi.mock("./db.server", () => ({
  default: { product: { findFirst: m.product }, offer: { findFirst: m.prior } },
}));
vi.mock("./utils/storefrontAuth.server", async (original) => ({
  ...(await original<any>()),
  authenticateStorefrontRequest: m.auth,
}));
vi.mock("./models/installedShop.server", () => ({
  isInstalledShop: m.installed,
}));
vi.mock("./models/settings.server", () => ({ getAppSettings: m.settings }));
vi.mock("./models/session.server", () => ({ getShopperSession: m.session }));
vi.mock("./models/holdout.server", () => ({ enrollHoldout: m.holdout }));
vi.mock("./models/storefrontData.server", () => ({
  resolveStorefrontData: m.facts,
  factKey: (x: any) => JSON.stringify(x),
}));
vi.mock("./models/entitlements.server", () => ({
  getEntitlements: async () => ({}),
  limitsFor: () => ({ features: { advancedPlacements: m.allowed } }),
}));
vi.mock("./models/usage.server", () => ({ reserveOfferDisplay: m.reserve }));
vi.mock("./models/offer.server", () => ({ createOfferRecord: m.create }));
vi.mock("./redis.server", () => ({ incrementRateLimit: m.limit }));
import { action } from "./routes/api.experience";
import { StorefrontAuthError } from "./utils/storefrontAuth.server";
const invoke = async (
  body: any = {
    pageType: "product",
    productId: "gid://shopify/Product/1",
    currency: "KES",
  },
) => {
  const result = await action({
    request: new Request("https://app.test/api/experience", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  } as any);
  if (result instanceof Response) throw new Error("Unexpected raw response");
  return result;
};
beforeEach(() => {
  vi.resetAllMocks();
  m.allowed = true;
  m.auth.mockReturnValue({ shop: "one.myshopify.com", sessionId: "session" });
  m.installed.mockResolvedValue(true);
  m.session.mockResolvedValue({ id: "session" });
  m.limit.mockResolvedValue(1);
  m.product.mockResolvedValue({ id: "gid://shopify/Product/1" });
  const config = defaultStorefrontConfig();
  config.agentCoreEnabled = true;
  m.settings.mockResolvedValue({
    storefrontConfig: config,
    focusedMode: false,
    discountNudgeEnabled: true,
    upsellEnabled: true,
  });
  m.facts.mockResolvedValue({
    agentFacts: {
      version: 1,
      alerts: [
        {
          id: "notice",
          productId: "gid://shopify/Product/1",
          body: "Supplied",
        },
      ],
    },
    automaticPlacements: true,
  });
  m.create.mockResolvedValue({ id: "offer" });
  m.reserve.mockResolvedValue(true);
});
describe("authenticated storefront facts", () => {
  it("publishes a real notice with an attributed offer and the explicit placement policy", async () => {
    const r = await invoke();
    expect(r.init?.status).toBeUndefined();
    expect(r.data).toMatchObject({
      automaticPlacements: true,
      offers: [{ widgetType: "inline_alert", payload: { offerId: "offer" } }],
    });
    expect(m.create.mock.calls[0][0]).toMatchObject({
      shop: "one.myshopify.com",
      sessionId: "session",
      triggerContext: { trigger: "verified_fact" },
    });
  });
  it.each([
    "off",
    "focused",
    "holdout",
    "plan",
    "unknown_session",
    "foreign_product",
    "checkout",
  ])("does not fetch or issue facts when %s", async (condition) => {
    if (condition === "off")
      m.settings.mockResolvedValue({
        storefrontConfig: defaultStorefrontConfig(),
      });
    if (condition === "focused")
      m.settings.mockResolvedValue({
        storefrontConfig: {
          ...defaultStorefrontConfig(),
          agentCoreEnabled: true,
        },
        focusedMode: true,
      });
    if (condition === "holdout")
      m.holdout.mockResolvedValue({ arm: "holdout" });
    if (condition === "plan") m.allowed = false;
    if (condition === "unknown_session") m.session.mockResolvedValue(null);
    if (condition === "foreign_product") m.product.mockResolvedValue(null);
    const r = await invoke(
      condition === "checkout" ? { pageType: "checkout" } : undefined,
    );
    expect(r.data.offers).toEqual([]);
    expect(m.facts).not.toHaveBeenCalled();
    expect(m.create).not.toHaveBeenCalled();
  });
  it("rejects invalid signatures and rate limits before fetching facts", async () => {
    m.auth.mockImplementationOnce(() => {
      throw new StorefrontAuthError("bad signature");
    });
    expect((await invoke()).init?.status).toBe(401);
    m.limit.mockResolvedValue(11);
    expect((await invoke()).init?.status).toBe(429);
    expect(m.facts).not.toHaveBeenCalled();
  });
  it("keeps quota denial and upstream failures quiet", async () => {
    m.reserve.mockResolvedValue(false);
    expect((await invoke()).data.offers).toEqual([]);
    m.facts.mockRejectedValue(new Error("upstream"));
    expect((await invoke()).init?.status).toBe(503);
  });
});
