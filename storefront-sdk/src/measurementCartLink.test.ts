// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MeasurementCartLink } from "./measurementCartLink";
import { isWidgetEnabled, WidgetManager } from "./widgets/widgetManager";
import { EventBus } from "./eventBus";
import { SessionManager } from "./sessionManager";
let linker: MeasurementCartLink | undefined, bus: EventBus | undefined;
const measurement = (arm: "holdout" | "exposed") => ({
  arm,
  version: 1,
  percent: 10,
  link: `m1.${arm}.synthetic`,
});
beforeEach(() => {
  localStorage.clear();
  Object.assign(window, { Shopify: { routes: { root: "/fr/" } } });
});
afterEach(() => {
  linker?.destroy();
  bus?.destroy();
  linker = undefined;
  bus = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (window as any).Shopify;
});
const cart = () =>
  document.dispatchEvent(
    new CustomEvent("aovboost:event", {
      detail: { type: "cart_update", cartItemCount: 1 },
    }),
  );
describe("identical invisible cart linkage for both arms", () => {
  it("links holdout after a cart update derived from the original add payload", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    const recordEvent = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const session = {
      anonymousId: "session",
      recordEvent,
      getSnapshot: () => ({ viewedProductIds: [] }),
      getSettings: () => ({ analyticsEnabled: false }),
      getAuthPayload: () => ({ sessionToken: "synthetic" }),
      getMeasurement: () => measurement("holdout"),
    } as any;
    bus = new EventBus({ shop: "one", sessionManager: session });
    linker = new MeasurementCartLink(session, bus);
    linker.init();
    bus.track("cart_update", {
      type: "add_to_cart",
      confirmed: true,
      mutationId: "confirmed-add",
      cartItemCount: 1,
    });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(recordEvent.mock.calls[0][0].type).toBe("cart_update");
    expect(fetch.mock.calls[0][0]).toBe("/fr/cart/update.js");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      attributes: { __aovboost_measurement__: measurement("holdout").link },
    });
  });
  it.each(["holdout", "exposed"] as const)(
    "links the %s arm without changing lines or opening a widget",
    async (arm) => {
      const track = vi.fn(),
        fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
      vi.stubGlobal("fetch", fetch);
      linker = new MeasurementCartLink(
        { getMeasurement: () => measurement(arm) } as any,
        { track } as any,
      );
      linker.init();
      cart();
      await vi.waitFor(() => expect(track).toHaveBeenCalledOnce());
      expect(fetch.mock.calls[0][0]).toBe("/fr/cart/update.js");
      expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
        attributes: { __aovboost_measurement__: measurement(arm).link },
      });
      expect(fetch.mock.calls[0][1].headers).not.toHaveProperty(
        "Authorization",
      );
      cart();
      await Promise.resolve();
      expect(fetch).toHaveBeenCalledOnce();
    },
  );
  it("does not block a cart event on metadata I/O and bounds retries", async () => {
    const track = vi.fn(),
      fetch = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetch);
    linker = new MeasurementCartLink(
      { getMeasurement: () => measurement("holdout") } as any,
      { track } as any,
    );
    linker.init();
    for (let i = 0; i < 5; i++) {
      cart();
      await Promise.resolve();
      await Promise.resolve();
    }
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(track).not.toHaveBeenCalled();
  });
  it("skips empty carts and shops without enabled measurement", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    linker = new MeasurementCartLink(
      { getMeasurement: () => null } as any,
      { track: vi.fn() } as any,
    );
    linker.init();
    cart();
    await Promise.resolve();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not classify its metadata write as a new cart mutation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 200 })),
    );
    const recordEvent = vi.fn();
    bus = new EventBus({
      shop: "one",
      sessionManager: {
        anonymousId: "session",
        recordEvent,
        getSnapshot: () => ({ viewedProductIds: [] }),
        getAuthPayload: () => ({ sessionToken: "fake" }),
        getSignedAuthPayload: async () => null,
      } as any,
    });
    bus.init();
    await fetch("/fr/cart/update.js", {
      method: "POST",
      headers: { "X-AOVBoost-Measurement": "1" },
      body: JSON.stringify({
        attributes: { __aovboost_measurement__: "m1.link" },
      }),
    });
    expect(
      recordEvent.mock.calls.filter(([event]) =>
        ["quantity_changed", "remove_from_cart", "add_to_cart"].includes(
          event.type,
        ),
      ),
    ).toHaveLength(0);
  });
  it("blocks every widget family for holdout and releases them when the server returns exposed", () => {
    for (const type of [
      "chat",
      "upsell_drawer",
      "rec_strip",
      "bundle",
      "post_purchase",
      "inline_alert",
      "exit_intent",
    ])
      expect(isWidgetEnabled(type, { holdout: true })).toBe(false);
    const manager = new WidgetManager({ holdout: true });
    manager.setHoldout(false);
    expect(manager.getStatus().settings.holdout).toBe(false);
    manager.destroyActive();
  });
  it("retains the signed identity token on renewal instead of creating a new randomized shopper", async () => {
    const old = {
      shop: "one",
      sessionId: "stable-id",
      sessionToken: "old-signed-token",
      expiresAt: 1,
      settings: {},
      measurement: measurement("holdout"),
    };
    localStorage.setItem("aovboost_storefront_session", JSON.stringify(old));
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            ...old,
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetch);
    const session = new SessionManager("one");
    await session.init();
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer old-signed-token",
    );
    expect(session.anonymousId).toBe("stable-id");
    expect(session.getSettings().holdout).toBe(true);
    session.applyMeasurement(null);
    expect(session.getSettings().holdout).not.toBe(true);
    session.destroy();
  });
});
