// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionStore } from "./SessionStore";
import { SignalBus } from "./SignalBus";
import { AgentHealth } from "./AgentHealth";
import { AGENT_LIMITS as L } from "./constants";
import { Debug } from "./Debug";

beforeEach(() => {
  sessionStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  window.__AOVBOOST_DEBUG__ = false;
  history.replaceState({}, "", "/");
});
describe("versioned session store", () => {
  it("persists anonymous counters and returns detached state without credentials or cart data", () => {
    const store = new SessionStore("test.shop");
    store.update((state) => {
      state.pageViews = 3;
      state.shown.toast = 1;
      Object.assign(state, {
        sessionToken: "must-not-save",
        email: "must-not-save",
        cartToken: "must-not-save",
      });
    });
    const copy = store.snapshot();
    copy.shown.toast = 99;
    expect(store.snapshot().shown.toast).toBe(1);
    expect(new SessionStore("test.shop").snapshot()).toMatchObject({
      id: copy.id,
      pageViews: 3,
      shown: { toast: 1 },
    });
    expect(
      sessionStorage.getItem("aovboost_agent_session_v1:test.shop"),
    ).not.toContain("must-not-save");
  });
  it.each([
    "{",
    "null",
    '{"version":2,"state":{"pageViews":90}}',
    '{"version":1,"state":{"pageViews":"oops","dismissed":{"toast":null}}}',
  ])("survives corrupt/incompatible storage %s", (saved) => {
    sessionStorage.setItem("aovboost_agent_session_v1:test.shop", saved);
    const store = new SessionStore("test.shop");
    expect(store.snapshot().pageViews).toBe(0);
    expect(store.snapshot().dismissed).toEqual({});
  });
  it("continues caps in memory when reads and writes are blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const store = new SessionStore("test.shop");
    store.update((state) => {
      state.interruptiveCount++;
    });
    expect(store.snapshot().interruptiveCount).toBe(1);
  });
});
describe("signal isolation", () => {
  it("preserves order, supports unsubscribe and isolates a throwing subscriber", () => {
    const failed = vi.fn();
    const seen: string[] = [];
    const bus = new SignalBus(failed);
    bus.on("cart_change", () => {
      throw new Error("widget failure");
    });
    const stop = bus.on("cart_change", (signal) => {
      seen.push(String(signal.data.source));
    });
    bus.on("*", (signal) => seen.push(signal.name));
    bus.publish("cart_change", { source: "shopper" });
    stop();
    bus.publish("cart_change");
    expect(seen).toEqual(["shopper", "cart_change", "cart_change"]);
    expect(failed).toHaveBeenCalledTimes(2);
    bus.destroy();
    bus.publish("cart_change");
    expect(failed).toHaveBeenCalledTimes(2);
  });
});
describe("health circuit", () => {
  it("coalesces probes, times out, and does not throw to the page", async () => {
    const probe = vi.fn(() => new Promise<boolean>(() => {}));
    const changed = vi.fn();
    const health = new AgentHealth(probe, changed);
    const first = health.probe();
    expect(health.probe()).toBe(first);
    await vi.advanceTimersByTimeAsync(L.HEALTH_TIMEOUT_MS);
    expect(await first).toBe(false);
    expect(probe).toHaveBeenCalledTimes(1);
    health.destroy();
  });
  it("opens after three failures, waits two minutes, then recovers with a half-open probe", async () => {
    const probe = vi.fn().mockResolvedValue(true);
    const health = new AgentHealth(probe, vi.fn());
    health.record(false);
    health.record(false);
    health.record(false);
    expect(health.isOpen).toBe(true);
    expect(await health.probe()).toBe(false);
    expect(probe).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(L.BREAKER_OPEN_MS - 1);
    expect(probe).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(health.isHealthy).toBe(true);
    expect(health.isOpen).toBe(false);
    expect(probe).toHaveBeenCalledTimes(1);
    health.destroy();
  });
  it("drops failures outside the rolling window and cancels retry on destruction", async () => {
    const probe = vi.fn().mockResolvedValue(false);
    const health = new AgentHealth(probe, vi.fn());
    health.record(false);
    vi.setSystemTime(Date.now() + L.BREAKER_WINDOW_MS + 1);
    health.record(false);
    health.record(false);
    expect(health.isOpen).toBe(false);
    health.destroy();
    await vi.advanceTimersByTimeAsync(L.BREAKER_OPEN_MS);
    expect(probe).not.toHaveBeenCalled();
  });
});
describe("debug privacy and ring", () => {
  it("is silent by default and records only the last 50 decisions when requested", () => {
    const log = vi.spyOn(console, "debug").mockImplementation(() => {});
    const quiet = new Debug();
    quiet.decision({ signal: "idle", ts: 0, candidates: [], accepted: [] });
    expect(log).not.toHaveBeenCalled();
    quiet.destroy();
    history.replaceState({}, "", "/?aov_debug=1");
    const debug = new Debug();
    for (let ts = 0; ts < 60; ts++)
      debug.decision({ signal: "idle", ts, candidates: [], accepted: [] });
    const api = window.__AOVBOOST_DEBUG__;
    expect(typeof api).toBe("object");
    if (api && typeof api === "object") {
      expect(api.decisions()).toHaveLength(50);
      expect(api.decisions()[0].ts).toBe(10);
    }
    debug.destroy();
  });
});
