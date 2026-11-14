// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OfferFacts, factTime } from "./OfferFacts";
import { AgentVoice } from "./AgentVoice";
import { SessionStore } from "./SessionStore";
import { createFactSurface } from "./FactSurfaces";
import { BaseWidget, text } from "../widgets/BaseWidget";
import type { AgentContext } from "./types";
import type { WidgetDependencies } from "./experienceTypes";
import { AGENT_LIMITS as L } from "./constants";

const productId = "gid://shopify/Product/1";
const before = "2026-11-01T00:00:00Z",
  end = "2026-11-12T23:59:59Z",
  future = "2026-11-14T00:00:00Z";
let source: any, campaign: any, ctx: AgentContext, facts: OfferFacts;
const reward = () => ({
  id: "cart-offer-v1",
  configured: true,
  description: "the configured shipping offer",
  threshold: 50,
  currency: "KES",
});
const proof = () => ({
  productId,
  verified: true,
  count: 5,
  startsAt: before,
  endsAt: end,
});
const alert = () => ({
  id: "notice-v1",
  productId,
  body: "Store collection is available on weekdays.",
});
beforeEach(() => {
  sessionStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-13T08:00:00Z"));
  source = { version: 1 };
  campaign = {};
  facts = new OfferFacts(
    () => source,
    () => campaign,
  );
  ctx = {
    page: { type: "product", productId, productTitle: "Trail jacket" },
    cart: {
      items: [],
      subtotal: 20,
      currency: "KES",
      known: true,
      lastChangeSource: "shopper",
    },
    session: new SessionStore("facts.test").snapshot(),
    device: { isMobile: false, prefersReducedMotion: false },
    agent: { aiHealthy: false, chatEnabled: false, holdout: false },
    config: { discountThreshold: 50 },
  };
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = "";
});
describe("truthful offer facts", () => {
  it("does not treat generated copy, threshold or affinity counts as reward/proof/alert evidence", () => {
    const payload = {
      threshold: 50,
      copy: {
        rewardDescription: "Free shipping",
        subheadline: "Only one left",
      },
      products: [{ id: productId, orderCount: 500 }],
      body: "Inventory is limited",
    };
    for (const type of ["discount_nudge", "social_proof", "inline_alert"])
      expect(facts.evaluate(type, payload, ctx).ok).toBe(false);
  });
  it.each([
    undefined,
    "",
    "tomorrow",
    123,
    "2026-11-14",
    "2026-11-14T00:00:00",
    "2026-02-31T00:00:00Z",
    before,
  ])(
    "rejects missing, relative, ambiguous, impossible or expired campaign dates: %s",
    (value) => {
      campaign = { endsAt: value };
      expect(facts.evaluate("countdown_banner", {}, ctx)).toMatchObject({
        ok: false,
        reason: "future_campaign_required",
      });
    },
  );
  it("uses the configured absolute deadline and rejects rolling replacement dates/future starts", () => {
    campaign = { endsAt: future };
    expect(facts.evaluate("countdown_banner", {}, ctx).ok).toBe(true);
    expect(
      facts.evaluate(
        "countdown_banner",
        { endsAt: "2026-11-15T00:00:00Z" },
        ctx,
      ),
    ).toMatchObject({ ok: false, reason: "campaign_end_mismatch" });
    campaign.startsAt = "2026-11-13T09:00:00Z";
    expect(facts.evaluate("countdown_banner", {}, ctx).ok).toBe(false);
    expect(factTime("2026-11-14T03:00:00+03:00")).toBe(factTime(future));
  });
  it("links a live cart to a configured reward and clamps progress without claiming application", () => {
    source.reward = reward();
    const first = facts.evaluate("discount_nudge", { threshold: "50" }, ctx);
    expect(first).toMatchObject({
      ok: true,
      view: { remaining: 30, progress: 40, currency: "KES" },
    });
    const full = facts.evaluate(
      "discount_nudge",
      {},
      { ...ctx, cart: { ...ctx.cart, subtotal: 75 } },
    );
    expect(full).toMatchObject({
      ok: true,
      view: { remaining: 0, progress: 100 },
    });
    if (first.ok && full.ok) {
      const voice = new AgentVoice();
      expect(voice.fact(first.view, "en-KE").body).toContain(
        new Intl.NumberFormat("en-KE", {
          style: "currency",
          currency: "KES",
        }).format(30),
      );
      expect(voice.fact(full.view).body).not.toMatch(
        /applied|earned|unlocked|discount added/i,
      );
    }
  });
  it.each([
    { configured: false },
    { threshold: 0 },
    { threshold: -1 },
    { threshold: NaN },
    { threshold: 50.001 },
    { threshold: Number.MAX_SAFE_INTEGER },
    { description: "" },
    { description: "{{reward}}" },
    { description: "x".repeat(241) },
    { endsAt: before },
    { code: "bad code" },
    { code: "x".repeat(100) },
  ])("rejects incomplete/invalid reward facts %j", (bad) => {
    source.reward = { ...reward(), ...bad };
    expect(facts.evaluate("discount_nudge", {}, ctx).ok).toBe(false);
  });
  it("requires a known cart, matching currency and consistent threshold; preserves zero carts", () => {
    source.reward = reward();
    expect(
      facts.evaluate(
        "discount_nudge",
        {},
        { ...ctx, cart: { ...ctx.cart, known: false } },
      ).ok,
    ).toBe(false);
    expect(
      facts.evaluate(
        "discount_nudge",
        {},
        { ...ctx, cart: { ...ctx.cart, currency: "USD" } },
      ),
    ).toMatchObject({ reason: "reward_currency_mismatch" });
    expect(
      facts.evaluate("discount_nudge", { threshold: 100 }, ctx),
    ).toMatchObject({ reason: "reward_threshold_mismatch" });
    expect(
      facts.evaluate(
        "discount_nudge",
        {},
        { ...ctx, cart: { ...ctx.cart, subtotal: 0 } },
      ),
    ).toMatchObject({ ok: true, view: { progress: 0, remaining: 50 } });
    expect(
      facts.evaluate(
        "discount_nudge",
        {},
        { ...ctx, cart: { ...ctx.cart, subtotal: -1 } },
      ).ok,
    ).toBe(false);
    expect(
      facts.evaluate(
        "discount_nudge",
        {},
        { ...ctx, cart: { ...ctx.cart, subtotal: 49.999 } },
      ).ok,
    ).toBe(false);
  });
  it("formats zero-decimal currencies without hiding fractional remainders", () => {
    source.reward = { ...reward(), currency: "JPY", threshold: 1000 };
    const yen = {
      ...ctx,
      cart: { ...ctx.cart, currency: "JPY", subtotal: 500 },
    };
    const result = facts.evaluate("discount_nudge", {}, yen);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(new AgentVoice().fact(result.view, "ja-JP").body).toContain(
        new Intl.NumberFormat("ja-JP", {
          style: "currency",
          currency: "JPY",
        }).format(500),
      );
    source.reward.threshold = 1000.5;
    expect(facts.evaluate("discount_nudge", {}, yen).ok).toBe(false);
  });
  it.each([0, 4, 4.9, -1, Infinity, Number.MAX_SAFE_INTEGER + 1, "8"])(
    "hides unverified/below-minimum/non-integer counts: %s",
    (count) => {
      source.proof = [{ ...proof(), count }];
      expect(facts.evaluate("social_proof", {}, ctx).ok).toBe(false);
    },
  );
  it("shows the exact verified current-product count with the supplied completed UTC window", () => {
    source.proof = [proof()];
    const result = facts.evaluate("social_proof", {}, ctx);
    expect(result).toMatchObject({
      ok: true,
      view: {
        count: L.MIN_PROOF_COUNT,
        productId,
        startsAt: Date.parse(before),
        endsAt: Date.parse(end),
      },
    });
    if (result.ok) {
      const copy = new AgentVoice().fact(result.view, "en");
      expect(copy.body).toContain("5 verified orders included Trail jacket");
      expect(copy.detail).toContain("2026-11-01 00:00:00 UTC");
      expect(copy.detail).toContain("2026-11-12 23:59:59 UTC");
    }
    source.proof = [{ ...proof(), productId: "gid://shopify/Product/2" }];
    expect(facts.evaluate("social_proof", {}, ctx).ok).toBe(false);
  });
  it.each([
    { verified: false },
    { startsAt: undefined },
    { startsAt: future },
    { endsAt: future },
    { endsAt: before },
  ])("rejects proof without a verified closed window %j", (bad) => {
    source.proof = [{ ...proof(), ...bad }];
    expect(facts.evaluate("social_proof", {}, ctx).ok).toBe(false);
  });
  it("remembers dismissal by notice identity across offer IDs and copy edits, while allowing a new notice", () => {
    source.alerts = [alert()];
    const first = facts.evaluate("inline_alert", { offerId: "offer-a" }, ctx);
    expect(first.ok).toBe(true);
    if (!first.ok || first.view.type !== "inline_alert") return;
    ctx = {
      ...ctx,
      session: {
        ...ctx.session,
        dismissed: {
          [first.view.dismissalKey]: { count: 1, lastAt: Date.now() },
        },
      },
    };
    source.alerts[0].body = "Updated public collection hours.";
    expect(
      facts.evaluate("inline_alert", { offerId: "offer-b" }, ctx),
    ).toMatchObject({ ok: false, reason: "alert_payload_dismissed" });
    source.alerts.push({ ...alert(), id: "notice-v2" });
    expect(facts.evaluate("inline_alert", {}, ctx).ok).toBe(true);
    expect(first.view.dismissalKey).not.toContain("notice-v1");
    expect(first.view.dismissalKey).not.toContain("weekdays");
  });
  it.each([
    { body: "" },
    { body: "{productTitle}" },
    { id: "" },
    { productId: "gid://shopify/Product/2" },
    { endsAt: before },
    { startsAt: future },
  ])("rejects missing/stale/placeholder alert facts %j", (bad) => {
    source.alerts = [{ ...alert(), ...bad }];
    expect(facts.evaluate("inline_alert", {}, ctx).ok).toBe(false);
  });
});
describe("managed fact rendering", () => {
  function surface(type: string) {
    const initial = facts.evaluate(type, {}, ctx);
    if (!initial.ok) throw new Error(initial.reason);
    const listeners = new Set<() => void>(),
      failed = vi.fn();
    const widget = createFactSurface(
      {
        BaseWidget,
        text,
        cartUrl: () => "/fr/cart.js",
      } as unknown as WidgetDependencies,
      { agentIdentity: new AgentVoice().identity, presentation: "inline" },
      type,
      {
        voice: new AgentVoice(),
        locale: () => "en-KE",
        view: () => {
          const result = facts.evaluate(type, {}, ctx);
          return result.ok ? result.view : undefined;
        },
        subscribe: (listener) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        failed,
      },
    );
    const slot = document.createElement("div");
    slot.style.position = "static";
    document.body.appendChild(slot);
    widget.mount(slot);
    return {
      widget,
      root: widget.getElement().shadowRoot!,
      update: () => listeners.forEach((listener) => listener()),
      listeners,
      failed,
      slot,
    };
  }
  it("updates progress from shared snapshots with no cart request and no automatic expiry at the threshold", async () => {
    source.reward = reward();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { widget, root, update } = surface("discount_nudge");
    expect(
      root.querySelector("[data-progress]")?.getAttribute("aria-valuenow"),
    ).toBe("40");
    expect(root.querySelector("a")?.getAttribute("href")).toBe("/fr/cart");
    ctx = { ...ctx, cart: { ...ctx.cart, subtotal: 100 } };
    update();
    expect(
      root.querySelector("[data-progress]")?.getAttribute("aria-valuenow"),
    ).toBe("100");
    await vi.advanceTimersByTimeAsync(4000);
    expect(widget.isMounted()).toBe(true);
    ctx = { ...ctx, cart: { ...ctx.cart, currency: "USD" } };
    update();
    expect(widget.isMounted()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    widget.destroy();
  });
  it("expires at the real deadline and cleans subscriptions without changing the reserved slot", async () => {
    campaign = { endsAt: new Date(Date.now() + 1500).toISOString() };
    const { widget, root, listeners, slot } = surface("countdown_banner");
    const beforeStyle = slot.style.cssText;
    expect(root.querySelector("[data-timer]")?.textContent).toBe("0h 0m 02s");
    await vi.advanceTimersByTimeAsync(1500);
    expect(widget.isMounted()).toBe(false);
    expect(listeners.size).toBe(0);
    expect(slot.style.position).toBe("static");
    expect(beforeStyle).toContain("relative");
    expect(slot.style.height).toBe("");
  });
  it("escapes supplied text, avoids placeholder copy and records no raw notice data in storage", () => {
    source.alerts = [{ ...alert(), body: '<img src=x onerror="alert(1)">' }];
    const { widget, root } = surface("inline_alert");
    expect(root.querySelector("img")).toBeNull();
    expect(root.querySelector("[data-body]")?.textContent).toContain("<img");
    expect(JSON.stringify({ ...sessionStorage })).not.toContain("<img");
    widget.destroy();
  });
  it("isolates a failing update and cleans the mounted surface", () => {
    source.reward = reward();
    const { widget, update, failed, listeners } = surface("discount_nudge");
    Object.defineProperty(source.reward, "description", {
      get() {
        throw new Error("Synthetic provider exception");
      },
    });
    expect(() => update()).not.toThrow();
    expect(failed).toHaveBeenCalledTimes(1);
    expect(widget.isMounted()).toBe(false);
    expect(listeners.size).toBe(0);
  });
});
