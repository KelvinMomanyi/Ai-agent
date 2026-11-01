import { Session } from "@shopify/shopify-api";
import type { SessionStorage } from "@shopify/shopify-app-session-storage";
import { describe, expect, it, vi } from "vitest";
import {
  ensureExpiringOfflineToken,
  hasExpiringOfflineToken,
} from "./offline-token-migration.server";

function perpetualSession(shop = "legacy-shop.myshopify.com") {
  return new Session({
    id: `offline_${shop}`,
    shop,
    state: "existing-oauth-state",
    isOnline: false,
    scope: "read_products",
    accessToken: "old-access-token",
  });
}

function rotatedSession(shop = "legacy-shop.myshopify.com") {
  return new Session({
    id: `offline_${shop}`,
    shop,
    state: "",
    isOnline: false,
    scope: "read_products",
    accessToken: "new-access-token",
    expires: new Date(Date.now() + 60 * 60 * 1000),
    refreshToken: "new-refresh-token",
    refreshTokenExpires: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
  });
}

function memoryStorage(initial: Session, storeResults: boolean[] = [true]) {
  let stored = initial;
  const storeSession = vi.fn(async (session: Session) => {
    const result = storeResults.shift() ?? true;
    if (result) stored = session;
    return result;
  });
  const storage = {
    storeSession,
    loadSession: vi.fn(async (id: string) =>
      stored.id === id ? stored : undefined,
    ),
    deleteSession: vi.fn(async () => true),
    deleteSessions: vi.fn(async () => true),
    findSessionsByShop: vi.fn(async () => [stored]),
  } satisfies SessionStorage;
  return { storage, storeSession };
}

describe("offline token migration", () => {
  it("recognizes a complete expiring offline token", () => {
    expect(hasExpiringOfflineToken(rotatedSession())).toBe(true);
    expect(hasExpiringOfflineToken(perpetualSession())).toBe(false);
  });

  it("exchanges and persists a perpetual token before returning it", async () => {
    const original = perpetualSession();
    const rotated = rotatedSession();
    const { storage, storeSession } = memoryStorage(original);
    const migrate = vi.fn(async () => ({ session: rotated }));

    const result = await ensureExpiringOfflineToken(original, storage, migrate);

    expect(migrate).toHaveBeenCalledWith({
      shop: original.shop,
      nonExpiringOfflineAccessToken: original.accessToken,
    });
    expect(storeSession).toHaveBeenCalledWith(rotated);
    expect(result.state).toBe(original.state);
    expect(hasExpiringOfflineToken(result)).toBe(true);
  });

  it("uses one exchange for concurrent requests from the same shop", async () => {
    const original = perpetualSession("parallel-shop.myshopify.com");
    const rotated = rotatedSession(original.shop);
    const { storage } = memoryStorage(original);
    const migrate = vi.fn(async () => ({ session: rotated }));

    const [first, second] = await Promise.all([
      ensureExpiringOfflineToken(original, storage, migrate),
      ensureExpiringOfflineToken(original, storage, migrate),
    ]);

    expect(migrate).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
  });

  it("retries storage after Shopify has performed the irreversible exchange", async () => {
    const original = perpetualSession("retry-shop.myshopify.com");
    const rotated = rotatedSession(original.shop);
    const { storage, storeSession } = memoryStorage(original, [
      false,
      false,
      true,
    ]);

    await ensureExpiringOfflineToken(original, storage, async () => ({
      session: rotated,
    }));

    expect(storeSession).toHaveBeenCalledTimes(3);
  });

  it("requires reauthorization for partially stored expiring credentials", async () => {
    const incomplete = perpetualSession("incomplete-shop.myshopify.com");
    incomplete.expires = new Date(Date.now() + 60_000);
    const { storage } = memoryStorage(incomplete);
    const migrate = vi.fn();

    await expect(
      ensureExpiringOfflineToken(incomplete, storage, migrate),
    ).rejects.toThrow("incomplete expiry metadata");
    expect(migrate).not.toHaveBeenCalled();
  });

  it("retries thrown storage failures without repeating the token exchange", async () => {
    const original = perpetualSession("throwing-storage.myshopify.com");
    const { storage, storeSession } = memoryStorage(original);
    storeSession.mockRejectedValueOnce(new Error("database unavailable"));
    const migrate = vi.fn(async () => ({
      session: rotatedSession(original.shop),
    }));
    await ensureExpiringOfflineToken(original, storage, migrate);
    expect(storeSession).toHaveBeenCalledTimes(2);
    expect(migrate).toHaveBeenCalledTimes(1);
  });

  it("reports a persistence failure instead of declaring migration successful", async () => {
    const original = perpetualSession("failed-storage.myshopify.com");
    const { storage, storeSession } = memoryStorage(original, [
      false,
      false,
      false,
    ]);
    await expect(
      ensureExpiringOfflineToken(original, storage, async () => ({
        session: rotatedSession(original.shop),
      })),
    ).rejects.toThrow("could not be persisted");
    expect(storeSession).toHaveBeenCalledTimes(3);
  });

  it("rejects credentials returned for a different store", async () => {
    const original = perpetualSession("expected-store.myshopify.com");
    const { storage, storeSession } = memoryStorage(original);
    await expect(
      ensureExpiringOfflineToken(original, storage, async () => ({
        session: rotatedSession("different-store.myshopify.com"),
      })),
    ).rejects.toThrow("incomplete expiring token data");
    expect(storeSession).not.toHaveBeenCalled();
  });
});
