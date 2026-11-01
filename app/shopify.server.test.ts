import { Session } from "@shopify/shopify-api";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadSession: vi.fn(),
  migrate: vi.fn(),
  backgroundAdmin: vi.fn(),
  authenticatedAdmin: vi.fn(),
  applicationAdmin: vi.fn(),
  hasSigningKey: vi.fn(),
}));
vi.mock("./db.server", () => ({ default: {} }));
vi.mock("./upstash-session-storage.server", () => ({
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
  shopifyApp: (config: { sessionStorage: unknown }) => ({
    sessionStorage: config.sessionStorage,
    authenticate: { admin: mocks.authenticatedAdmin },
    unauthenticated: { admin: mocks.backgroundAdmin },
  }),
}));
import { unauthenticated } from "./shopify.server";

beforeEach(() => vi.resetAllMocks());

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
