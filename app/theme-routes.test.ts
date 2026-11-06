import type { ActionFunctionArgs } from "react-router";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  update: vi.fn(),
  profile: vi.fn(),
  remove: vi.fn(),
  preview: vi.fn(),
  record: vi.fn(),
  storeAuth: vi.fn(),
  summary: vi.fn(),
  upsert: vi.fn(),
}));
vi.mock("./shopify.server", () => ({ authenticate: { admin: mocks.auth } }));
vi.mock("./redis.server", () => ({ redis: { del: vi.fn() } }));
vi.mock("./db.server", () => ({
  default: {
    appSettings: { updateMany: mocks.update },
    themeProfile: { updateMany: mocks.profile },
    themeReport: { deleteMany: mocks.remove },
    $transaction: (promises: any[]) => Promise.all(promises),
  },
}));
vi.mock("./models/settings.server", () => ({
  getAppSettings: async () => ({
    placementPreference: "auto",
    recommendationFont: "inherit",
  }),
}));
vi.mock("./models/themeCompatibility.server", async (original) => ({
  ...(await original<typeof import("./models/themeCompatibility.server")>()),
  getThemeSummary: mocks.summary,
  recordThemeReport: mocks.record,
}));
vi.mock("./models/offerPreview.server", () => ({
  getAdminOfferPreview: mocks.preview,
}));
vi.mock("./utils/storefrontAuth.server", async (original) => ({
  ...(await original<typeof import("./utils/storefrontAuth.server")>()),
  authenticateStorefrontRequest: mocks.storeAuth,
}));
import { action as adminAction } from "./routes/app.theme";
import { action as reportAction } from "./routes/api.theme-report";
const shop = "one.myshopify.com";
function post(
  path: string,
  body: BodyInit,
  contentType: string,
): ActionFunctionArgs {
  return {
    request: new Request(`https://app.example${path}`, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body,
    }),
  } as ActionFunctionArgs;
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv(
    "AOVBOOST_STOREFRONT_SESSION_SECRET",
    "synthetic-theme-preview-secret",
  );
  mocks.auth.mockResolvedValue({ session: { shop } });
  mocks.storeAuth.mockReturnValue({ shop, sessionId: "signed" });
  mocks.record.mockResolvedValue(true);
  mocks.preview.mockResolvedValue({
    source: { id: "gid://shopify/Product/1", handle: "shampoo" },
    products: [{}],
  });
});
afterEach(() => vi.unstubAllEnvs());
describe("theme admin and signed report routes", () => {
  it("saves only validated preferences for the authenticated shop and scopes reset", async () => {
    await adminAction(
      post(
        "/app/theme",
        new URLSearchParams({
          intent: "save",
          shop: "forged",
          preference: "floating_card",
          accent: "#123456",
          radius: "12",
          font: "system",
        }),
        "application/x-www-form-urlencoded",
      ),
    );
    expect(mocks.update).toHaveBeenCalledWith({
      where: { shop },
      data: {
        placementPreference: "floating_card",
        recommendationAccentColor: "#123456",
        recommendationRadius: 12,
        recommendationFont: "system",
      },
    });
    const bad = await adminAction(
      post(
        "/app/theme",
        new URLSearchParams({
          intent: "save",
          preference: "bad",
          font: "system",
        }),
        "application/x-www-form-urlencoded",
      ),
    );
    expect((bad as any).init.status).toBe(400);
    await adminAction(
      post(
        "/app/theme",
        new URLSearchParams({ intent: "reset", themeId: "123" }),
        "application/x-www-form-urlencoded",
      ),
    );
    expect(mocks.remove).toHaveBeenCalledWith({
      where: { shop, themeId: "123", kind: "display" },
    });
  });
  it("creates a short-lived preview link for the authenticated shop without recording an offer", async () => {
    const response = await adminAction(
      post(
        "/app/theme",
        new URLSearchParams({ intent: "preview" }),
        "application/x-www-form-urlencoded",
      ),
    );
    const url = new URL((response.data as { previewUrl: string }).previewUrl);
    expect(url.hostname).toBe(shop);
    expect(url.pathname).toBe("/products/shampoo");
    expect(url.searchParams.get("aovboost_preview")).toBeTruthy();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
  });
  it("tries a bounded alternate preview source when the first has no eligible pairing", async () => {
    mocks.preview
      .mockResolvedValueOnce({
        source: { id: "gid://shopify/Product/1", handle: "sensitive" },
        sources: [
          { id: "gid://shopify/Product/1" },
          { id: "gid://shopify/Product/2" },
        ],
        products: [],
      })
      .mockResolvedValueOnce({
        source: { id: "gid://shopify/Product/2", handle: "shampoo" },
        sources: [],
        products: [{}],
      });
    const response = await adminAction(
      post(
        "/app/theme",
        new URLSearchParams({ intent: "preview" }),
        "application/x-www-form-urlencoded",
      ),
    );
    expect(
      new URL((response.data as { previewUrl: string }).previewUrl).pathname,
    ).toBe("/products/shampoo");
    expect(mocks.preview).toHaveBeenCalledTimes(2);
    expect(mocks.preview).toHaveBeenLastCalledWith(
      shop,
      "gid://shopify/Product/2",
    );
  });
  it("requires signed auth and rejects oversized bodies before ingestion", async () => {
    const report = {
      identity: { themeId: "123", themeName: "Dawn" },
      attemptId: "one",
      offerId: "offer",
      strategy: "floating_card",
      cartUi: "unknown",
      verified: true,
      reason: "display_verified",
    };
    await reportAction(
      post(
        "/api/theme-report",
        JSON.stringify({ shop: "forged", report }),
        "application/json",
      ),
    );
    expect(mocks.record).toHaveBeenCalledWith(
      shop,
      "signed",
      expect.objectContaining({ attemptId: "one" }),
    );
    mocks.record.mockClear();
    const result = await reportAction(
      post(
        "/api/theme-report",
        JSON.stringify({ extra: "x".repeat(5000) }),
        "application/json",
      ),
    );
    expect((result as any).init?.status).toBe(400);
    expect(mocks.record).not.toHaveBeenCalled();
    mocks.storeAuth.mockImplementationOnce(() => {
      throw new Error("unsigned");
    });
    await reportAction(
      post("/api/theme-report", JSON.stringify({ report }), "application/json"),
    );
    expect(mocks.record).not.toHaveBeenCalled();
  });
});
