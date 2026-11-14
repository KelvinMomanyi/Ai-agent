// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentVoice } from "./AgentVoice";
import { MobileExitSignals } from "./MobileExitSignals";
import { createToast } from "./Surfaces";
import { CartUndo } from "./CartUndo";
import { SessionStore } from "./SessionStore";
import { BaseWidget, text } from "../widgets/BaseWidget";
import type { AgentContext } from "./types";
import type { Experience, WidgetDependencies } from "./experienceTypes";
import { AGENT_LIMITS as L } from "./constants";
const context = (): AgentContext => ({
  page: {
    type: "product",
    productId: "gid://shopify/Product/1",
    productTitle: "Trail jacket",
    variantId: "gid://shopify/ProductVariant/101",
  },
  cart: {
    items: [],
    subtotal: 0,
    currency: "KES",
    known: true,
    lastChangeSource: "shopper",
  },
  session: new SessionStore("experience.test").snapshot(),
  device: { isMobile: true, prefersReducedMotion: false },
  agent: { aiHealthy: true, chatEnabled: true, holdout: false },
  config: {},
});
beforeEach(() => {
  sessionStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = "";
});
describe("agent experience", () => {
  it("uses verified product fields, safe fallbacks and anonymous cart metadata in its handoff", () => {
    const voice = new AgentVoice("  Test\nStore  "),
      ctx = context();
    expect(voice.identity).toEqual({
      name: "Test Store assistant",
      avatar: "T",
    });
    expect(voice.handoff(ctx, "price_hesitation")).toMatchObject({
      productId: ctx.page.productId,
      variantId: ctx.page.variantId,
      suggestedOpeningLine: "What would you like to know about Trail jacket?",
      cartSnapshot: { status: "loaded", currency: "KES" },
    });
    expect(voice.toast({ ...ctx, page: { type: "product" } }).headline).toBe(
      "Need a hand choosing?",
    );
    expect(
      voice.handoff(
        { ...ctx, page: { type: "product", productId: "invalid" } },
        "bad trigger",
      ),
    ).toMatchObject({
      trigger: "launcher",
      suggestedOpeningLine: "What would you like help with?",
    });
    expect(voice.exit(ctx).offerLine).not.toMatch(
      /discount|code|order|expire/i,
    );
  });
  it("publishes mobile idle only for engaged, quiet shopping sessions", async () => {
    let ctx = context();
    const emit = vi.fn();
    const mobile = new MobileExitSignals(() => ctx, emit);
    mobile.init();
    await vi.advanceTimersByTimeAsync(L.MOBILE_IDLE_MS);
    expect(emit).not.toHaveBeenCalled();
    ctx = { ...ctx, session: { ...ctx.session, pageViews: 2, chatOpen: true } };
    mobile.refresh();
    await vi.advanceTimersByTimeAsync(L.MOBILE_IDLE_MS);
    expect(emit).not.toHaveBeenCalled();
    ctx = { ...ctx, session: { ...ctx.session, chatOpen: false } };
    mobile.refresh();
    await vi.advanceTimersByTimeAsync(L.MOBILE_IDLE_MS);
    expect(emit).toHaveBeenCalledExactlyOnceWith("idle");
    await vi.advanceTimersByTimeAsync(L.MOBILE_IDLE_MS * 2);
    expect(emit).toHaveBeenCalledTimes(1);
    mobile.destroy();
  });
  it("detects fast scroll-up and back without intercepting history", async () => {
    const ctx = {
        ...context(),
        session: { ...context().session, pageViews: 2 },
      },
      emit = vi.fn();
    vi.stubGlobal("scrollY", 500);
    const mobile = new MobileExitSignals(() => ctx, emit);
    mobile.init();
    for (const y of [450, 400, 350, 300]) {
      vi.stubGlobal("scrollY", y);
      window.dispatchEvent(new Event("scroll"));
      await vi.advanceTimersByTimeAsync(40);
    }
    expect(emit).toHaveBeenCalledWith("scroll_up");
    mobile.navigation();
    const event = new PopStateEvent("popstate", { cancelable: true });
    window.dispatchEvent(event);
    await vi.advanceTimersByTimeAsync(0);
    expect(event.defaultPrevented).toBe(false);
    expect(emit).toHaveBeenLastCalledWith("back");
    mobile.destroy();
  });
  it("keeps desktop sessions out of mobile exit and cancels timers on destroy", async () => {
    const ctx = {
        ...context(),
        device: { ...context().device, isMobile: false },
        session: { ...context().session, pageViews: 2 },
      },
      emit = vi.fn();
    const mobile = new MobileExitSignals(() => ctx, emit);
    mobile.init();
    await vi.advanceTimersByTimeAsync(L.MOBILE_IDLE_MS * 2);
    expect(emit).not.toHaveBeenCalled();
    mobile.destroy();
  });
  it("pauses toast expiry while hovered OR focused and resumes the remaining time", async () => {
    const voice = new AgentVoice(),
      ctx = context();
    const experience: Experience = {
      voice,
      memory: { messages: [] },
      healthy: () => true,
      retry: async () => true,
      handoff: (trigger) => voice.handoff(ctx, trigger),
    };
    const toast = createToast(
      { BaseWidget, text } as WidgetDependencies,
      {},
      experience,
      ctx,
    );
    toast.mount();
    const root = toast.getElement().shadowRoot!,
      box = root.querySelector("aside")!;
    await vi.advanceTimersByTimeAsync(4000);
    box.dispatchEvent(new Event("mouseenter"));
    root.querySelector<HTMLButtonElement>("[data-chat]")!.focus();
    await vi.advanceTimersByTimeAsync(20000);
    box.dispatchEvent(new Event("mouseleave"));
    await vi.advanceTimersByTimeAsync(20000);
    expect(toast.isMounted()).toBe(true);
    root.querySelector<HTMLButtonElement>("[data-chat]")!.blur();
    await vi.advanceTimersByTimeAsync(4999);
    expect(toast.isMounted()).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(toast.isMounted()).toBe(false);
  });
});
describe("conservative cart undo", () => {
  const cart = (quantity: number) => ({
    currency: "KES",
    items: quantity
      ? [
          {
            key: "line-1",
            variant_id: 101,
            quantity,
            properties: { engraving: "private" },
            selling_plan_allocation: { selling_plan: { id: 42 } },
          },
        ]
      : [],
  });
  const confirm = () =>
    document.dispatchEvent(
      new CustomEvent("aovboost:event", {
        detail: { type: "add_to_cart", confirmed: true },
      }),
    );
  it("reverses only its unchanged line and marks the refresh-preserving write as undo", async () => {
    let live = cart(1);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(live))),
    );
    const mutate = vi.fn(async () => {
      live = cart(1);
      return {};
    });
    const changed = vi.fn();
    const undo = new CartUndo(
      { cartUrl: () => "/cart.js", mutateShopifyCart: mutate } as any,
      changed,
    );
    await undo.perform(async () => {
      live = cart(2);
      confirm();
      return {};
    });
    expect(changed).toHaveBeenLastCalledWith(true);
    expect(await undo.undo()).toBe("ok");
    expect(mutate).toHaveBeenCalledExactlyOnceWith(
      "change",
      { id: "line-1", quantity: 1 },
      "aov_chat",
      { undo: true },
    );
    expect(await undo.undo()).toBe("changed");
    undo.destroy();
  });
  it("refuses stale undo after a shopper change", async () => {
    let live = cart(1);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(live))),
    );
    const mutate = vi.fn();
    const undo = new CartUndo(
      { cartUrl: () => "/cart.js", mutateShopifyCart: mutate } as any,
      vi.fn(),
    );
    await undo.perform(async () => {
      live = cart(2);
      confirm();
      return {};
    });
    live = cart(3);
    expect(await undo.undo()).toBe("changed");
    expect(mutate).not.toHaveBeenCalled();
    undo.destroy();
  });
  it("restores a removed custom line exactly, without persisting its properties", async () => {
    let live = cart(1);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(live))),
    );
    const mutate = vi.fn(async () => {
      live = cart(1);
      return {};
    });
    const undo = new CartUndo(
      { cartUrl: () => "/cart.js", mutateShopifyCart: mutate } as any,
      vi.fn(),
    );
    await undo.perform(async () => {
      live = cart(0);
      confirm();
      return {};
    });
    expect(await undo.undo()).toBe("ok");
    expect(mutate).toHaveBeenCalledWith(
      "add",
      {
        items: [
          {
            id: 101,
            quantity: 1,
            properties: { engraving: "private" },
            selling_plan: 42,
          },
        ],
      },
      "aov_chat",
      { undo: true },
    );
    expect(JSON.stringify({ ...sessionStorage })).not.toContain("private");
    undo.destroy();
  });
});
