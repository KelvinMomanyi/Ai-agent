// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { Telemetry } from "./Telemetry";
import { SessionStore } from "./SessionStore";
import type { AgentContext, OfferProvider } from "./types";
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});
it("records viewed only after continuous half visibility for one second and cancels on unmount", async () => {
  vi.useFakeTimers();
  let notify!: IntersectionObserverCallback;
  const disconnect = vi.fn();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        notify = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  const host = document.createElement("div");
  document.body.append(host);
  const ctx: AgentContext = {
    page: { type: "product" },
    cart: {
      items: [],
      subtotal: 0,
      currency: "KES",
      lastChangeSource: "shopper",
    },
    session: new SessionStore("telemetry.test").snapshot(),
    device: { isMobile: false, prefersReducedMotion: false },
    agent: { aiHealthy: true, chatEnabled: true, holdout: false },
    config: {},
  };
  const send = vi.fn();
  const telemetry = new Telemetry(send, () => ctx);
  const provider: OfferProvider = {
    id: "bundle",
    surfaceClass: "ambient",
    element: () => host,
    slot: "merchandising",
    signals: ["product_view"],
    isEligible: () => ({ ok: true, reason: "test" }),
    score: () => 50,
    mount: () => ({ status: "mounted", reason: "test" }),
    unmount: () => {},
  };
  const stop = telemetry.observe(provider, "product_view");
  const visible = (ratio: number) =>
    notify(
      [
        {
          isIntersecting: ratio > 0,
          intersectionRatio: ratio,
        } as IntersectionObserverEntry,
      ],
      {} as IntersectionObserver,
    );
  visible(0.4);
  await vi.advanceTimersByTimeAsync(1100);
  expect(send).not.toHaveBeenCalled();
  visible(0.5);
  await vi.advanceTimersByTimeAsync(700);
  visible(0);
  await vi.advanceTimersByTimeAsync(500);
  expect(send).not.toHaveBeenCalled();
  visible(0.5);
  await vi.advanceTimersByTimeAsync(700);
  visible(0.9);
  await vi.advanceTimersByTimeAsync(299);
  expect(send).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(send).toHaveBeenCalledWith(
    "viewed",
    expect.objectContaining({
      provider_id: "bundle",
      surface_class: "ambient",
      trigger_signal: "product_view",
      page_type: "product",
      holdout: false,
      ai_healthy: true,
    }),
  );
  stop();
  visible(1);
  await vi.advanceTimersByTimeAsync(2000);
  expect(send).toHaveBeenCalledTimes(1);
  expect(disconnect).toHaveBeenCalled();
});

it("whitelists new event fields and preserves offer/mutation correlation without URLs or private payloads", () => {
  const ctx: any = {
    page: { type: "cart" },
    session: new SessionStore("privacy.test").snapshot(),
    agent: {
      aiHealthy: true,
      holdout: false,
      assignment: { source: "agent", version: 1, percent: 10 },
    },
  };
  const send = vi.fn(),
    telemetry = new Telemetry(send, () => ctx),
    provider = {
      id: "cart_upsell",
      surfaceClass: "contextual" as const,
      attribution: () => ({
        offer_id: "offer-one",
        trigger_signal: "cart_item_added",
      }),
    };
  telemetry.emit("impression", provider, "offer_ready");
  provider.attribution = () => ({
    offer_id: "offer-two",
    trigger_signal: "manual",
  });
  telemetry.emit("accepted", provider, "cart_add_confirmed", undefined, {
    offer_id: "offer-one",
    mutation_id: "mutation-1",
    cart_source: "aov_upsell",
    email: "never-send",
    sessionToken: "never-send",
    cartSnapshot: { token: "never-send" },
  });
  const accepted = send.mock.calls.at(-1)![1];
  expect(accepted).toMatchObject({
    offer_id: "offer-one",
    offerId: "offer-one",
    mutation_id: "mutation-1",
    cart_source: "aov_upsell",
    trigger_signal: "cart_item_added",
    holdout_source: "agent",
    holdout_percent: 10,
    url: "",
    referrer: "",
  });
  expect(JSON.stringify(accepted)).not.toContain("never-send");
  expect(
    telemetry.project({ type: "impression", provider_id: "__proto__" }),
  ).toBeNull();
  const legacy = { type: "widget_click", offerId: "legacy", action: "add" };
  expect(telemetry.project(legacy)).toBe(legacy);
});
it("deduplicates a holdout candidate without generating real impression or acceptance events", () => {
  const ctx: any = {
    page: { type: "product" },
    session: { ...new SessionStore("shadow.test").snapshot(), pageViews: 1 },
    agent: { aiHealthy: true, holdout: true },
  };
  const send = vi.fn(),
    telemetry = new Telemetry(send, () => ctx),
    provider = {
      id: "bundle",
      surfaceClass: "ambient" as const,
      attribution: () => ({ offer_id: "offer-one", trigger_signal: "initial" }),
    };
  telemetry.emit("would_have_shown", provider, "offer_ready");
  telemetry.emit("would_have_shown", provider, "cart_change");
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0][0]).toBe("would_have_shown");
  expect(send.mock.calls[0][1]).toMatchObject({
    holdout: true,
    offer_id: "offer-one",
  });
});
it("requires a fresh visible second after the tab is hidden and cancels disconnected targets", async () => {
  vi.useFakeTimers();
  let notify!: IntersectionObserverCallback,
    visibility: DocumentVisibilityState = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(
    () => visibility,
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        notify = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  const host = document.createElement("div");
  document.body.appendChild(host);
  const send = vi.fn();
  const ctx: any = {
    page: { type: "product" },
    session: new SessionStore("visibility.test").snapshot(),
    agent: { aiHealthy: true, holdout: false },
  };
  const telemetry = new Telemetry(send, () => ctx),
    provider: any = {
      id: "chat",
      surfaceClass: "conversational",
      element: () => host,
    };
  const stop = telemetry.observe(provider, "initial");
  notify(
    [
      {
        isIntersecting: true,
        intersectionRatio: 0.8,
      } as IntersectionObserverEntry,
    ],
    {} as IntersectionObserver,
  );
  await vi.advanceTimersByTimeAsync(700);
  visibility = "hidden";
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(1000);
  expect(send).not.toHaveBeenCalled();
  visibility = "visible";
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(999);
  expect(send).not.toHaveBeenCalled();
  host.remove();
  await vi.advanceTimersByTimeAsync(1);
  expect(send).not.toHaveBeenCalled();
  stop();
});
