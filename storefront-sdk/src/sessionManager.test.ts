// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionManager } from "./sessionManager";
import { defaultThemeConfig } from "../../shared/themeCompatibility";

let manager: SessionManager;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-02T12:00:00Z"));
  localStorage.clear();
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        shop: "shop.test",
        sessionId: "session",
        sessionToken: "token",
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        settings: { analyticsEnabled: true, chatEnabled: true },
      }),
      { status: 200 },
    ),
  );
});
afterEach(() => {
  delete (window as any).Shopify;
  manager?.destroy();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("SessionManager request and activity budget", () => {
  it("refreshes the profile after a theme ID change without renewing a valid signed identity", async () => {
    (window as any).Shopify = {
      theme: { id: 123, name: "Dawn", schema_name: "Dawn" },
    };
    const session = {
      shop: "shop.test",
      sessionId: "session",
      sessionToken: "token",
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      settings: { analyticsEnabled: true },
    };
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ...session, theme: defaultThemeConfig("123") }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            settings: { analyticsEnabled: true },
            theme: defaultThemeConfig("456"),
          }),
        ),
      );
    manager = new SessionManager("shop.test");
    await manager.init();
    expect(manager.getSettings().themeCompatibility?.themeId).toBe("123");
    manager.destroy();
    (window as any).Shopify.theme.id = 456;
    manager = new SessionManager("shop.test");
    await manager.init();
    expect(manager.getSettings().themeCompatibility).toMatchObject({
      themeId: "456",
      status: "learning",
      genericDrawer: false,
    });
    expect(vi.mocked(fetch).mock.calls[1][0]).toContain("/config");
    expect(
      JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body)).theme.themeId,
    ).toBe("456");
  });
  it("uses bootstrap settings without a redundant config call or separate heartbeat", async () => {
    manager = new SessionManager("shop.test");
    await manager.init();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(manager.getSettings().chatEnabled).toBe(true);
    manager.destroy();
    manager = new SessionManager("shop.test");
    await manager.init();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(manager.getSettings().analyticsEnabled).toBe(true);
  });

  it("excludes hidden and idle time but resumes counting visible activity", async () => {
    manager = new SessionManager("shop.test");
    await manager.init();
    await vi.advanceTimersByTimeAsync(30_000);
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(300_000);
    expect(manager.getSnapshot().sessionDuration).toBe(30);
    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(100_000);
    expect(manager.getSnapshot().sessionDuration).toBe(120);
    document.dispatchEvent(new Event("pointerdown"));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(manager.getSnapshot().sessionDuration).toBe(130);
  });
});
