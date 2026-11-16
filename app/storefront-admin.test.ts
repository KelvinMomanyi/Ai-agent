import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultStorefrontConfig } from "./models/storefrontConfig";
const m = vi.hoisted(() => ({
  auth: vi.fn(),
  update: vi.fn(),
  count: vi.fn(),
  reward: vi.fn(),
  del: vi.fn(),
}));
vi.mock("./shopify.server", () => ({ authenticate: { admin: m.auth } }));
vi.mock("./db.server", () => ({
  default: { appSettings: { update: m.update }, product: { count: m.count } },
}));
vi.mock("./models/storefrontData.server", () => ({ verifyReward: m.reward }));
vi.mock("./models/settings.server", () => ({
  getAppSettings: async () => ({}),
}));
vi.mock("./redis.server", () => ({ redis: { del: m.del } }));
import { action } from "./routes/app.storefront";
const save = async (config: any) => {
  const form = new FormData();
  form.set("config", JSON.stringify(config));
  return action({
    request: new Request("https://app.test/app/storefront", {
      method: "POST",
      body: form,
    }),
  } as any);
};
beforeEach(() => {
  vi.resetAllMocks();
  m.auth.mockResolvedValue({
    session: { shop: "one.myshopify.com" },
    admin: {},
  });
  m.count.mockResolvedValue(1);
});
describe("merchant storefront configuration", () => {
  it("requires Shopify admin authentication before any update", async () => {
    m.auth.mockRejectedValue(new Response(null, { status: 401 }));
    await expect(save(defaultStorefrontConfig())).rejects.toBeInstanceOf(
      Response,
    );
    expect(m.update).not.toHaveBeenCalled();
  });
  it("saves valid configuration for only the authenticated shop and invalidates cached settings", async () => {
    const config = defaultStorefrontConfig();
    config.agentCoreEnabled = true;
    await save(config);
    expect(m.update).toHaveBeenCalledWith({
      where: { shop: "one.myshopify.com" },
      data: { storefrontConfig: config },
    });
    expect(m.del).toHaveBeenCalledWith("public-settings:one.myshopify.com");
  });
  it("does not persist a fabricated discount or a foreign notice product", async () => {
    const config = defaultStorefrontConfig();
    config.rewardCode = "INVALID";
    m.reward.mockRejectedValue(new Error("No real discount"));
    expect((await save(config)).init?.status).toBe(400);
    expect(m.update).not.toHaveBeenCalled();
    config.rewardCode = "";
    config.notice = {
      enabled: true,
      body: "Notice",
      productIds: ["gid://shopify/Product/1"],
    };
    m.count.mockResolvedValue(0);
    expect((await save(config)).init?.status).toBe(400);
    expect(m.update).not.toHaveBeenCalled();
  });
});
