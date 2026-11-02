// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionManager } from "./sessionManager";

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
  manager?.destroy();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("SessionManager request and activity budget", () => {
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
