import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  profile: vi.fn(),
  claim: vi.fn(),
  preview: vi.fn(),
  products: vi.fn(),
}));
vi.mock("../db.server", () => ({
  default: { themeProfile: { upsert: mocks.profile } },
}));
vi.mock("../redis.server", () => ({ claimExpiringKey: mocks.claim }));
vi.mock("./offerPreview.server", () => ({
  getAdminOfferPreview: mocks.preview,
}));
vi.mock("./catalogCache.server", () => ({
  getCatalogProductsByIds: mocks.products,
}));
vi.mock("./themeCompatibility.server", async (original) => ({
  ...(await original<typeof import("./themeCompatibility.server")>()),
  getThemeConfig: async () => ({ themeId: "123", status: "learning" }),
}));
import {
  issueThemePreview,
  verifyThemePreview,
  saveThemePreview,
} from "./themePreview.server";
const shop = "one.myshopify.com",
  source = "gid://shopify/Product/1";
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv(
    "AOVBOOST_STOREFRONT_SESSION_SECRET",
    "synthetic-theme-preview-secret",
  );
  mocks.claim.mockResolvedValue(true);
});
afterEach(() => vi.unstubAllEnvs());
describe("isolated admin theme preview", () => {
  it("expires a preview after five minutes", () => {
    vi.useFakeTimers();
    try {
      const token = issueThemePreview(shop, source);
      vi.advanceTimersByTime(301000);
      expect(() => verifyThemePreview(token, shop)).toThrow(/expired/i);
    } finally {
      vi.useRealTimers();
    }
  });
  it("binds short-lived preview credentials to purpose, shop and source", () => {
    const token = issueThemePreview(shop, source);
    expect(verifyThemePreview(token, shop)).toMatchObject({
      shop,
      sourceProductId: source,
      purpose: "theme_preview",
    });
    expect(() => verifyThemePreview(token, "other.myshopify.com")).toThrow();
    expect(() => verifyThemePreview(token + "tampered", shop)).toThrow();
  });
  it("writes only lastPreviewResult on an existing ThemeProfile, never shopper/offer tables", async () => {
    const claims = verifyThemePreview(issueThemePreview(shop, source), shop);
    const result = await saveThemePreview(shop, claims, {
      identity: { themeId: "123", themeName: "Dawn" },
      attemptId: "preview",
      strategy: "floating_card",
      cartUi: "no_feedback",
      verified: true,
      reason: "display_verified",
      unitCost: 123,
    });
    expect(mocks.profile).toHaveBeenCalledWith({
      where: { shop_themeId: { shop, themeId: "123" } },
      create: {
        shop,
        themeId: "123",
        themeName: "Dawn",
        schemaName: null,
        lastPreviewResult: result,
      },
      update: { lastPreviewResult: result },
    });
    expect(JSON.stringify(result)).not.toMatch(/unitCost|inventory|margin/);
    mocks.claim.mockResolvedValue(false);
    await expect(
      saveThemePreview(shop, claims, {
        identity: { themeId: "123" },
        attemptId: "preview",
        strategy: "none",
        cartUi: "unknown",
        verified: false,
        reason: "all_strategies_failed",
      }),
    ).rejects.toThrow(/already/);
    expect(mocks.profile).toHaveBeenCalledTimes(1);
  });
});
