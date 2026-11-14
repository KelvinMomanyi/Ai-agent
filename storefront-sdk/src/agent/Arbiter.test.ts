// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Arbiter } from "./Arbiter";
import { SessionStore } from "./SessionStore";
import { Telemetry } from "./Telemetry";
import { Debug } from "./Debug";
import { AGENT_LIMITS as L } from "./constants";
import type {
  AgentContext,
  OfferProvider,
  SurfaceApi,
  SurfaceClass,
} from "./types";
import type { PlacementOutcome } from "../widgets/widgetManager";
let store: SessionStore,
  arbiter: Arbiter,
  context: AgentContext,
  send: ReturnType<typeof vi.fn>;
const signal = () => ({
  name: "offer_ready" as const,
  data: {},
  ts: Date.now(),
});
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};
function provider(
  id: string,
  surfaceClass: SurfaceClass,
  score: number,
  slot = id,
): OfferProvider {
  return {
    id,
    surfaceClass,
    slot,
    signals: ["offer_ready"],
    isEligible: () => ({ ok: true, reason: "eligible" }),
    score: () => score,
    mount: vi.fn((): PlacementOutcome => ({
      status: "mounted",
      reason: "test",
    })),
    unmount: vi.fn(),
  };
}
beforeEach(() => {
  sessionStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-13T08:00:00Z"));
  store = new SessionStore("test.shop");
  send = vi.fn();
  context = {
    page: { type: "product" },
    cart: {
      items: [],
      subtotal: 0,
      currency: "KES",
      lastChangeSource: "shopper",
    },
    session: store.snapshot(),
    device: { isMobile: false, prefersReducedMotion: false },
    agent: { aiHealthy: true, chatEnabled: true, holdout: false },
    config: {},
  };
  const ctx = () => ({ ...context, session: store.snapshot() });
  arbiter = new Arbiter(ctx, store, new Telemetry(send, ctx), new Debug());
});
afterEach(() => {
  arbiter.destroy();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe("central surface arbitration", () => {
  it("backs off a dismissed notice identity while allowing a different payload immediately", async () => {
    const notice = provider("inline_alert", "ambient", 40, "notice");
    let key = "inline_alert:payload_hash_a";
    notice.dismissalKey = () => key;
    arbiter.register(notice);
    arbiter.evaluate(signal());
    await settle();
    arbiter.dismiss("inline_alert");
    arbiter.evaluate(signal());
    await settle();
    expect(arbiter.mounted()).toEqual([]);
    key = "inline_alert:payload_hash_b";
    arbiter.evaluate(signal());
    await settle();
    expect(arbiter.mounted()).toEqual(["inline_alert"]);
    expect(store.snapshot().dismissed).toHaveProperty(
      "inline_alert:payload_hash_a",
    );
    expect(store.snapshot().dismissed.inline_alert).toBeUndefined();
  });
  it("uses stable priority for equal scores and exclusive ambient slots", async () => {
    const toast = provider("toast", "interruptive", 80),
      exit = provider("exit_intent", "interruptive", 80),
      cart = provider("cart_upsell", "contextual", 80);
    const bundle = provider("bundle", "ambient", 70, "merchandising"),
      strip = provider("rec_strip", "ambient", 50, "merchandising");
    for (const item of [toast, exit, cart, bundle, strip])
      arbiter.register(item);
    arbiter.evaluate(signal());
    await settle();
    expect(arbiter.mounted()).toEqual(["cart_upsell", "bundle"]);
    expect(toast.mount).not.toHaveBeenCalled();
    expect(strip.mount).not.toHaveBeenCalled();
  });
  it("reserves async mounts and cancels them before mounting a higher score", async () => {
    let finish!: (result: PlacementOutcome) => void, callbacks!: SurfaceApi;
    const toast = provider("toast", "interruptive", 50),
      cart = provider("cart_upsell", "contextual", 90);
    let cartReady = false;
    cart.isEligible = () => ({ ok: cartReady, reason: "not_ready" });
    toast.mount = vi.fn((_ctx: AgentContext, api: SurfaceApi) => {
      callbacks = api;
      return new Promise<PlacementOutcome>((resolve) => {
        finish = resolve;
      });
    });
    arbiter.register(toast);
    arbiter.register(cart);
    arbiter.evaluate(signal());
    expect(arbiter.mounted()).toEqual(["toast"]);
    cartReady = true;
    arbiter.evaluate(signal());
    expect(toast.unmount).toHaveBeenCalled();
    expect(arbiter.mounted()).toEqual(["cart_upsell"]);
    callbacks.closed();
    finish({ status: "mounted", reason: "late" });
    await settle();
    expect(arbiter.mounted()).toEqual(["cart_upsell"]);
    expect(store.snapshot().shown.toast).toBeUndefined();
  });
  it("backs off for ten minutes, then silences after a second interruptive dismissal", async () => {
    const toast = provider("toast", "interruptive", 50);
    arbiter.register(toast);
    arbiter.evaluate(signal());
    await settle();
    arbiter.dismiss("toast");
    arbiter.evaluate(signal());
    expect(arbiter.reason("toast")).toBe("dismissal_backoff");
    await vi.advanceTimersByTimeAsync(L.DISMISS_BACKOFF_FIRST_MS);
    arbiter.evaluate(signal());
    await settle();
    expect(toast.mount).toHaveBeenCalledTimes(2);
    arbiter.dismiss("toast");
    const exit = provider("exit_intent", "interruptive", 70);
    arbiter.register(exit);
    arbiter.evaluate(signal());
    expect(arbiter.reason("toast")).toBe("dismissed_session");
    expect(arbiter.reason("exit_intent")).toBe("global_silence");
  });
  it("enforces the gap, session cap and once/session exit even after expiry", async () => {
    const exit = provider("exit_intent", "interruptive", 70);
    arbiter.register(exit);
    arbiter.evaluate(signal());
    await settle();
    arbiter.release("exit_intent", "expired");
    arbiter.evaluate(signal());
    expect(arbiter.reason("exit_intent")).toBe("exit_once_per_session");
    const toast = provider("toast", "interruptive", 50);
    arbiter.register(toast);
    arbiter.evaluate(signal());
    expect(arbiter.reason("toast")).toBe("interruptive_gap");
    await vi.advanceTimersByTimeAsync(L.MIN_GAP_BETWEEN_INTERRUPTIVE_MS);
    arbiter.evaluate(signal());
    await settle();
    arbiter.release("toast", "expired");
    await vi.advanceTimersByTimeAsync(L.MIN_GAP_BETWEEN_INTERRUPTIVE_MS);
    arbiter.evaluate(signal());
    expect(arbiter.reason("toast")).toBe("session_cap");
  });
  it("silences foreground on chat and checkout, and keeps only existing ambient during chat", async () => {
    const cart = provider("cart_upsell", "contextual", 90),
      bundle = provider("bundle", "ambient", 60);
    arbiter.register(cart);
    arbiter.register(bundle);
    arbiter.evaluate(signal());
    await settle();
    store.update((state) => {
      state.chatOpen = true;
    });
    const proof = provider("proof", "ambient", 20);
    arbiter.register(proof);
    arbiter.evaluate(signal());
    expect(arbiter.mounted()).toEqual(["bundle"]);
    expect(proof.mount).not.toHaveBeenCalled();
    store.update((state) => {
      state.chatOpen = false;
      state.checkoutStarted = true;
    });
    arbiter.evaluate(signal());
    expect(cart.mount).toHaveBeenCalledTimes(1);
    expect(arbiter.reason("cart_upsell")).toBe("checkout");
  });
  it("evaluates holdout without mounting and emits would-have-shown", () => {
    context = { ...context, agent: { ...context.agent, holdout: true } };
    const toast = provider("toast", "interruptive", 50);
    arbiter.register(toast);
    arbiter.evaluate(signal());
    expect(toast.mount).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(
      "would_have_shown",
      expect.objectContaining({
        provider_id: "toast",
        holdout: true,
        session_id: expect.any(String),
      }),
    );
  });
  it("isolates a mount exception for the session and allows another provider", async () => {
    const bad = provider("cart_upsell", "contextual", 90),
      toast = provider("toast", "interruptive", 50);
    bad.mount = vi.fn(() => {
      throw new Error("do not log secrets");
    });
    arbiter.register(bad);
    arbiter.register(toast);
    arbiter.evaluate(signal());
    await settle();
    expect(store.snapshot().disabledProviders).toEqual(["cart_upsell"]);
    expect(arbiter.mounted()).toEqual(["toast"]);
    arbiter.evaluate(signal());
    expect(bad.mount).toHaveBeenCalledTimes(1);
  });
  it("unmounts page-bound surfaces on navigation without destroying conversation", async () => {
    const chat = provider("chat", "conversational", 100),
      cart = provider("cart_upsell", "contextual", 90);
    arbiter.register(chat);
    arbiter.register(cart);
    arbiter.evaluate(signal());
    await settle();
    arbiter.navigation();
    expect(arbiter.mounted()).toEqual(["chat"]);
    expect(cart.unmount).toHaveBeenCalledWith("navigation");
  });
});
