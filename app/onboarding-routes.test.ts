import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  admin: vi.fn(),
  graphql: vi.fn(),
  metrics: vi.fn(),
  readiness: vi.fn(),
  count: vi.fn(),
  ensureSync: vi.fn(),
  progress: vi.fn(),
  checklist: vi.fn(),
  preview: vi.fn(),
  settingsFind: vi.fn(),
  settingsUpsert: vi.fn(),
  redisDel: vi.fn(),
  installed: vi.fn(),
  proxy: vi.fn(),
  issue: vi.fn(),
  publicSettings: vi.fn(),
  receipt: vi.fn(),
  isAuthError: vi.fn(),
}));
vi.mock("./shopify.server", () => ({ authenticate: { admin: mocks.admin } }));
vi.mock("./jobs/pairingAutopilot.server", () => ({
  schedulePairingDrain: vi.fn(),
  markPairingPolicyDirty: vi.fn(),
}));
vi.mock("./db.server", () => ({
  default: {
    bundle: { count: mocks.count },
    appSettings: {
      findUnique: mocks.settingsFind,
      upsert: mocks.settingsUpsert,
    },
  },
}));
vi.mock("./models/analytics.server", () => ({
  getDashboardMetrics: mocks.metrics,
}));
vi.mock("./models/catalogCache.server", () => ({
  getCatalogReadiness: mocks.readiness,
}));
vi.mock("./jobs/aovboost.server", () => ({
  ensureInitialCatalogSync: mocks.ensureSync,
  getCatalogSyncProgress: mocks.progress,
}));
vi.mock("./models/onboarding.server", () => ({
  getSetupChecklist: mocks.checklist,
  recordAuthenticatedStorefrontSession: mocks.receipt,
}));
vi.mock("./models/offerPreview.server", () => ({
  getAdminOfferPreview: mocks.preview,
}));
vi.mock("./redis.server", () => ({
  redis: { del: mocks.redisDel },
  cacheKeys: { syncProgress: (shop: string) => `sync:${shop}` },
}));
vi.mock("./models/installedShop.server", () => ({
  isInstalledShop: mocks.installed,
}));
vi.mock("./models/settings.server", () => ({
  getPublicAppSettings: mocks.publicSettings,
}));
vi.mock("./models/holdout.server", () => ({ enrollHoldout: async () => null }));
vi.mock("./models/holdoutAnalytics.server", () => ({
  getHoldoutReport: async () => ({ enabled: false, lift: null }),
}));
vi.mock("./utils/storefrontAuth.server", () => ({
  verifyAppProxyRequest: mocks.proxy,
  issueStorefrontSession: mocks.issue,
  renewalSessionId: () => undefined,
  isStorefrontAuthError: mocks.isAuthError,
  logStorefrontAuthError: vi.fn(),
}));

import { loader as homeLoader } from "./routes/app._index";
import {
  loader as previewLoader,
  action as previewAction,
} from "./routes/app.preview";
import { action as settingsAction } from "./routes/app.settings";
import { loader as sessionLoader } from "./routes/api.session";

const shop = "one.myshopify.com";
function post(path: string, values: Record<string, string>) {
  return {
    request: new Request(`https://app.example.com${path}`, {
      method: "POST",
      body: new URLSearchParams(values),
    }),
  } as ActionFunctionArgs;
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("SHOPIFY_API_KEY", "public-test-key");
  mocks.admin.mockResolvedValue({
    session: { shop },
    admin: { graphql: mocks.graphql },
  });
  mocks.graphql.mockResolvedValue({
    json: async () => ({ data: { shop: { currencyCode: "KES" } } }),
  });
  mocks.readiness.mockResolvedValue({
    actionableProductCount: 2,
    storedProductCount: 2,
  });
  mocks.progress.mockResolvedValue({
    status: "fetching",
    done: 2,
    updatedAt: "2026-11-05T10:00:00Z",
  });
  mocks.checklist.mockResolvedValue([]);
  mocks.settingsUpsert.mockImplementation(async ({ create }) => create);
  mocks.preview.mockResolvedValue({
    sources: [],
    source: { id: "gid://shopify/Product/1" },
    products: [{ id: "gid://shopify/Product/2" }],
  });
  mocks.proxy.mockReturnValue({ shop, customerId: null });
  mocks.installed.mockResolvedValue(true);
  mocks.issue.mockReturnValue({
    shop,
    sessionId: "synthetic-session",
    sessionToken: "synthetic-token",
  });
  mocks.isAuthError.mockImplementation((error) => error?.status === 401);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("onboarding route boundaries", () => {
  it("validates holdout limits, requires analytics and starts a new cohort on configuration change", async () => {
    for (const holdoutPercent of ["-1", "31", "1.5", "not-a-number"]) {
      const result = await settingsAction(
        post("/app/settings", {
          holdoutEnabled: "true",
          holdoutPercent,
          analyticsEnabled: "true",
        }),
      );
      expect(result.init?.status).toBe(400);
    }
    expect(mocks.settingsUpsert).not.toHaveBeenCalled();
    const invalid = await settingsAction(
      post("/app/settings", {
        holdoutEnabled: "true",
        holdoutPercent: "10",
        analyticsEnabled: "false",
      }),
    );
    expect(invalid.init?.status).toBe(400);
    mocks.settingsFind.mockResolvedValue({
      holdoutEnabled: false,
      holdoutPercent: 10,
      holdoutVersion: 1,
    });
    await settingsAction(
      post("/app/settings", {
        holdoutEnabled: "true",
        holdoutPercent: "10",
        analyticsEnabled: "true",
      }),
    );
    expect(mocks.settingsUpsert.mock.calls[0][0].update).toMatchObject({
      holdoutEnabled: true,
      holdoutPercent: 10,
      holdoutVersion: { increment: 1 },
    });
  });
  it("keeps existing holdout settings when older forms omit the new fields", async () => {
    await settingsAction(post("/app/settings", { analyticsEnabled: "true" }));
    expect(mocks.settingsUpsert.mock.calls[0][0].update).not.toHaveProperty(
      "holdoutEnabled",
    );
    expect(mocks.settingsUpsert.mock.calls[0][0].create).toMatchObject({
      holdoutEnabled: false,
      holdoutPercent: 10,
    });
  });
  it("applies focused mode only on explicit opt-in and retains the recommendation count", async () => {
    await settingsAction(
      post("/app/settings", {
        focusedMode: "true",
        upsellEnabled: "true",
        chatEnabled: "true",
        bundlesEnabled: "true",
        proactiveMessagesEnabled: "true",
        maxProductRecommendations: "4",
      }),
    );
    expect(mocks.settingsUpsert.mock.calls[0][0]).toMatchObject({
      where: { shop },
      update: {
        focusedMode: true,
        upsellEnabled: true,
        chatEnabled: false,
        bundlesEnabled: false,
        proactiveMessagesEnabled: false,
        maxProductRecommendations: 4,
      },
    });
    mocks.settingsUpsert.mockClear();
    await settingsAction(
      post("/app/settings", { upsellEnabled: "true", chatEnabled: "true" }),
    );
    expect(mocks.settingsUpsert.mock.calls[0][0].update).not.toHaveProperty(
      "focusedMode",
    );
    expect(mocks.settingsUpsert.mock.calls[0][0].update.chatEnabled).toBe(true);
  });
  it("saves the selected vertical and rejects unsupported presets", async () => {
    await settingsAction(
      post("/app/settings", { verticalPreset: "beauty_haircare" }),
    );
    expect(mocks.settingsUpsert.mock.calls[0][0]).toMatchObject({
      where: { shop },
      update: { verticalPreset: "beauty_haircare" },
      create: { verticalPreset: "beauty_haircare" },
    });
    mocks.settingsUpsert.mockClear();
    const result = await settingsAction(
      post("/app/settings", { verticalPreset: "unsupported" }),
    );
    expect(result.init?.status).toBe(400);
    expect(mocks.settingsUpsert).not.toHaveBeenCalled();
  });
  it("loads durable progress and the server checklist without provider status on Home", async () => {
    const result = await homeLoader({
      request: new Request("https://app.example.com/app"),
    } as LoaderFunctionArgs);
    expect(result.data.syncProgress).toMatchObject({
      status: "fetching",
      done: 2,
    });
    expect(result.data).not.toHaveProperty("providers");
    expect(mocks.ensureSync).toHaveBeenCalledWith(shop);
    expect(mocks.progress).toHaveBeenCalledWith(shop);
    expect(mocks.checklist).toHaveBeenCalledWith(
      shop,
      expect.anything(),
      result.data.syncProgress,
    );
    expect(
      new URL(result.data.themeEditorUrl!).searchParams.get("activateAppId"),
    ).toBe("public-test-key/aovboost");
  });
  it("authenticates the preview loader and makes no tracking or settings writes", async () => {
    const request = new Request(
      "https://app.example.com/app/preview?sourceProductId=gid%3A%2F%2Fshopify%2FProduct%2F1",
    );
    const result = await previewLoader({ request } as LoaderFunctionArgs);
    expect(result.data.currencyCode).toBe("KES");
    expect(mocks.admin).toHaveBeenCalledWith(request);
    expect(mocks.preview).toHaveBeenCalledWith(shop, "gid://shopify/Product/1");
    expect(mocks.settingsUpsert).not.toHaveBeenCalled();
    expect(mocks.receipt).not.toHaveBeenCalled();
    expect(mocks.issue).not.toHaveBeenCalled();
  });
  it("requires admin authentication before reading the preview", async () => {
    const redirect = new Response(null, { status: 302 });
    mocks.admin.mockRejectedValueOnce(redirect);
    await expect(
      previewLoader({
        request: new Request("https://app.example.com/app/preview"),
      } as LoaderFunctionArgs),
    ).rejects.toBe(redirect);
    expect(mocks.preview).not.toHaveBeenCalled();
  });
  it("records only explicit merchant acknowledgement in their settings", async () => {
    const result = await previewAction(
      post("/app/preview", {
        intent: "reviewed",
        sourceProductId: "gid://shopify/Product/1",
        shop: "other.myshopify.com",
      }),
    );
    expect(result.status).toBe(302);
    expect(result.headers.get("Location")).toBe("/app");
    expect(mocks.settingsUpsert).toHaveBeenCalledWith({
      where: { shop },
      update: { onboardingPreviewedAt: expect.any(Date) },
      create: {
        shop,
        pairingMode: "autopilot",
        onboardingPreviewedAt: expect.any(Date),
      },
    });
    expect(mocks.receipt).not.toHaveBeenCalled();
  });
  it("does not mark an empty preview reviewed", async () => {
    mocks.preview.mockResolvedValueOnce({ source: null, products: [] });
    expect(
      (await previewAction(post("/app/preview", { intent: "reviewed" })))
        .status,
    ).toBe(409);
    expect(mocks.settingsUpsert).not.toHaveBeenCalled();
  });
  it("persists all four picker lists in the unchanged tenant-scoped array format", async () => {
    const values = {
      blockedProductIds: "gid://shopify/Product/1, gid://shopify/Product/2",
      preferredProductIds: "gid://shopify/Product/3",
      upsellPriorityProductIds: "gid://shopify/Product/4",
      excludedCollectionIds:
        "gid://shopify/Collection/5, gid://shopify/Collection/6",
    };
    await settingsAction(post("/app/settings", values));
    const call = mocks.settingsUpsert.mock.calls[0][0];
    expect(call.where).toEqual({ shop });
    for (const [key, value] of Object.entries(values))
      expect(call.update[key]).toEqual(value.split(", "));
    expect(call.update).not.toHaveProperty("onboardingPreviewedAt");
    expect(call.update).not.toHaveProperty("verticalPreset");
  });
  it("records a connection receipt only after signature and installation checks", async () => {
    const result = await sessionLoader({
      request: new Request("https://app.example.com/api/session"),
    } as LoaderFunctionArgs);
    if (result instanceof Response) throw new Error("Expected session data");
    expect(result.data).toHaveProperty("sessionId", "synthetic-session");
    expect(mocks.receipt).toHaveBeenCalledWith(shop);
    expect(mocks.receipt.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.proxy.mock.invocationCallOrder[0],
    );
    expect(mocks.receipt.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.installed.mock.invocationCallOrder[0],
    );
  });
  it("rejects unauthenticated storefront requests without connection receipts", async () => {
    mocks.proxy.mockImplementationOnce(() => {
      throw Object.assign(new Error("bad signature"), { status: 401 });
    });
    const result = await sessionLoader({
      request: new Request("https://app.example.com/api/session"),
    } as LoaderFunctionArgs);
    if (result instanceof Response)
      throw new Error("Expected session error data");
    expect(result.init?.status).toBe(401);
    expect(mocks.receipt).not.toHaveBeenCalled();
    expect(mocks.issue).not.toHaveBeenCalled();
  });
  it("does not record a connection for an uninstalled shop", async () => {
    mocks.installed.mockResolvedValueOnce(false);
    const result = await sessionLoader({
      request: new Request("https://app.example.com/api/session"),
    } as LoaderFunctionArgs);
    if (result instanceof Response)
      throw new Error("Expected session error data");
    expect(result.init?.status).toBe(401);
    expect(mocks.receipt).not.toHaveBeenCalled();
  });
  it("keeps session issuance working if setup telemetry cannot be saved", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.receipt.mockRejectedValueOnce(new Error("database unavailable"));
    const result = await sessionLoader({
      request: new Request("https://app.example.com/api/session"),
    } as LoaderFunctionArgs);
    if (result instanceof Response) throw new Error("Expected session data");
    expect(result.data).toHaveProperty("sessionToken", "synthetic-token");
  });
});
