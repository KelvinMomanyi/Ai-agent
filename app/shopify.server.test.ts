import { Session } from "@shopify/shopify-api";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadSession: vi.fn(),
  migrate: vi.fn(),
  backgroundAdmin: vi.fn(),
  authenticatedAdmin: vi.fn(),
  applicationAdmin: vi.fn(),
  hasSigningKey: vi.fn(),
  shopUpsert: vi.fn(),
  afterAuth: vi.fn(),
  SessionPersistenceError: class extends Error {},
}));
vi.mock("./db.server", () => ({
  default: { shop: { upsert: mocks.shopUpsert } },
}));
vi.mock("./upstash-session-storage.server", () => ({
  SessionPersistenceError: mocks.SessionPersistenceError,
  UpstashSessionStorage: class {
    loadSession = mocks.loadSession;
  },
}));
vi.mock("./services/offline-token-migration.server", () => ({
  ensureExpiringOfflineToken: mocks.migrate,
}));
vi.mock("./services/application-only-token.server", async (original) => ({
  ...(await original<
    typeof import("./services/application-only-token.server")
  >()),
  getApplicationOnlyAdminContext: mocks.applicationAdmin,
  hasApplicationOnlyCredentials: mocks.hasSigningKey,
}));
vi.mock("@shopify/shopify-app-react-router/server", async (original) => ({
  ...(await original<
    typeof import("@shopify/shopify-app-react-router/server")
  >()),
  shopifyApp: (config: {
    sessionStorage: unknown;
    hooks: { afterAuth: (context: unknown) => Promise<void> };
  }) => {
    mocks.afterAuth.mockImplementation(config.hooks.afterAuth);
    return {
      sessionStorage: config.sessionStorage,
      authenticate: { admin: mocks.authenticatedAdmin },
      unauthenticated: { admin: mocks.backgroundAdmin },
    };
  },
}));
import { authenticate, unauthenticated } from "./shopify.server";

beforeEach(() => {
  // Preserve the captured afterAuth implementation across tests.
  vi.clearAllMocks();
  mocks.loadSession.mockReset();
  mocks.migrate.mockReset();
  mocks.backgroundAdmin.mockReset();
  mocks.authenticatedAdmin.mockReset();
  mocks.hasSigningKey.mockReset();
});

describe("interactive Shopify authentication", () => {
  it("returns a retryable error when the SDK cannot persist credentials", async () => {
    mocks.authenticatedAdmin.mockRejectedValue(
      new mocks.SessionPersistenceError("not persisted"),
    );
    await expect(
      authenticate.admin(new Request("https://app.example.com/app")),
    ).rejects.toMatchObject({ status: 503 });
    expect(mocks.migrate).not.toHaveBeenCalled();
    expect(mocks.backgroundAdmin).not.toHaveBeenCalled();
    expect(mocks.authenticatedAdmin).toHaveBeenCalledTimes(1);
  });

  it("preserves Shopify authentication redirects", async () => {
    const redirect = new Response(null, { status: 302 });
    mocks.authenticatedAdmin.mockRejectedValue(redirect);
    await expect(
      authenticate.admin(new Request("https://app.example.com/app")),
    ).rejects.toBe(redirect);
  });

  it("returns the authenticated context when no migration is needed", async () => {
    const session = { shop: "test.myshopify.com" };
    const context = { session, admin: {} };
    mocks.authenticatedAdmin.mockResolvedValue(context);
    mocks.migrate.mockResolvedValue(session);
    expect(
      await authenticate.admin(new Request("https://app.example.com/app")),
    ).toBe(context);
    expect(mocks.backgroundAdmin).not.toHaveBeenCalled();
  });

  it("stores installation metadata without duplicating session credentials", async () => {
    await mocks.afterAuth({
      session: {
        shop: "test.myshopify.com",
        accessToken: "fake-access",
        refreshToken: "fake-refresh",
        scope: "read_products",
      },
    });
    expect(mocks.shopUpsert).toHaveBeenCalledWith({
      where: { shopDomain: "test.myshopify.com" },
      update: { scope: "read_products" },
      create: {
        shopDomain: "test.myshopify.com",
        accessToken: "",
        scope: "read_products",
      },
    });
    expect(JSON.stringify(mocks.shopUpsert.mock.calls)).not.toContain("fake-");
  });
});

describe("background Shopify authentication", () => {
  it("migrates stored legacy credentials before creating the background client", async () => {
    const stored = new Session({
      id: "offline_test.myshopify.com",
      shop: "test.myshopify.com",
      state: "",
      isOnline: false,
      accessToken: "legacy",
    });
    mocks.loadSession.mockResolvedValue(stored);
    mocks.backgroundAdmin.mockResolvedValue({ session: stored, admin: {} });
    await unauthenticated.admin(stored.shop);
    expect(mocks.migrate).toHaveBeenCalledWith(stored, expect.anything());
    expect(mocks.migrate.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.backgroundAdmin.mock.invocationCallOrder[0],
    );
  });

  it("uses signed application access without requiring a stored refresh token", async () => {
    mocks.hasSigningKey.mockReturnValue(true);
    const context = { session: { shop: "test.myshopify.com" }, admin: {} };
    mocks.applicationAdmin.mockResolvedValue(context);
    expect(await unauthenticated.admin("test.myshopify.com")).toBe(context);
    expect(mocks.loadSession).not.toHaveBeenCalled();
    expect(mocks.migrate).not.toHaveBeenCalled();
  });

  it("keeps missing-session handling in the Shopify library when no key is configured", async () => {
    mocks.loadSession.mockResolvedValue(undefined);
    mocks.backgroundAdmin.mockRejectedValue(new Error("session missing"));
    await expect(unauthenticated.admin("test.myshopify.com")).rejects.toThrow(
      "session missing",
    );
    expect(mocks.applicationAdmin).not.toHaveBeenCalled();
  });

  it("does not hide a migration persistence failure", async () => {
    mocks.loadSession.mockResolvedValue({ id: "offline_test.myshopify.com" });
    mocks.migrate.mockRejectedValue(new Error("could not persist"));
    await expect(unauthenticated.admin("test.myshopify.com")).rejects.toThrow(
      "could not persist",
    );
    expect(mocks.backgroundAdmin).not.toHaveBeenCalled();
  });

  it("rejects invalid shop domains before looking up or requesting credentials", async () => {
    await expect(unauthenticated.admin("evil.example.com")).rejects.toThrow(
      "permanent lowercase",
    );
    expect(mocks.loadSession).not.toHaveBeenCalled();
    expect(mocks.applicationAdmin).not.toHaveBeenCalled();
  });
});
