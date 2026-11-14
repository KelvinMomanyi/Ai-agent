// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentCore } from "./AgentCore";
import { mutateShopifyCart } from "../shopifyCart";
import { WIDGET_PROVIDERS } from "./providers";
import { AGENT_LIMITS as L } from "./constants";
import { EventBus } from "../eventBus";
let core: AgentCore;
let mount: ReturnType<typeof vi.fn>, track: ReturnType<typeof vi.fn>;
const event = (type: string, detail: Record<string, unknown> = {}) =>
  document.dispatchEvent(
    new CustomEvent("aovboost:event", { detail: { ...detail, type } }),
  );
const cart = (source = "shopper") => ({
  cartItems: [
    {
      productId: "gid://shopify/Product/1",
      variantId: "gid://shopify/ProductVariant/101",
      quantity: 1,
    },
  ],
  cartValue: 20,
  currency: "KES",
  confirmed: true,
  mutationId: "m1",
  variantId: "101",
  quantity: 1,
  cartSource: source,
  cartMutationType: "add_to_cart",
});
beforeEach(() => {
  sessionStorage.clear();
  vi.useFakeTimers();
  track = vi.fn();
  mount = vi.fn().mockResolvedValue({ status: "mounted", reason: "test" });
  core = new AgentCore({
    shop: "test.shop",
    apiBase: "/apps/aovboost",
    settings: { chatEnabled: false },
    bridge: {
      mountProvider: mount,
      unmountProvider: vi.fn(),
      getProviderElement: () => null,
    },
    enabled: () => true,
    track,
    trigger: vi.fn(),
  });
  core.init();
});
afterEach(() => {
  core.destroy();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  window.AOVBoost = undefined;
  document.body.innerHTML = "";
  history.replaceState({}, "", "/");
});
describe("legacy event bridge and providers", () => {
  it("keeps undo restoration out of offer acceptance attribution and recursive upsells", () => {
    event("cart_update", { ...cart("aov_chat"), undo: true });
    expect(track.mock.calls.some(([type]) => type === "accepted")).toBe(false);
    core.offer(
      {
        widgetType: "upsell_drawer",
        payload: { triggerType: "cart_item_added", mutationId: "m1" },
      },
      "cart_item_added",
    );
    expect(mount).not.toHaveBeenCalled();
  });
  it("clears active-chat state when the health gate removes chat programmatically", async () => {
    core.destroy();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response('{"ok":true}')),
    );
    let closed: (() => void) | undefined;
    core = new AgentCore({
      shop: "test.shop",
      apiBase: "/apps/aovboost",
      settings: { chatEnabled: true },
      bridge: {
        mountProvider: async (decision) => {
          closed = decision.payload?.agentOnDestroy;
          return { status: "mounted", reason: "test" };
        },
        unmountProvider: () => closed?.(),
        getProviderElement: () => null,
      },
      enabled: () => true,
      track,
      trigger: vi.fn(),
    });
    core.init();
    await vi.advanceTimersByTimeAsync(0);
    core.offer({ widgetType: "chat" }, "initial");
    await Promise.resolve();
    event("chat_opened");
    expect(core.context().session.chatOpen).toBe(true);
    core.health.record(false);
    expect(core.context().session.chatOpen).toBe(false);
    expect(core.arbiter.mounted()).toEqual([]);
  });
  it("emits one confirmed helper quantity change after refresh instead of also emitting the intercepted response", async () => {
    window.AOVBoost = { agent_core_enabled: true };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response('{"items":[],"item_count":0}')),
    );
    const recordEvent = vi.fn();
    const bus = new EventBus({
      shop: "test.shop",
      sessionManager: {
        anonymousId: "synthetic",
        recordEvent,
        getSettings: () => ({}),
        getSnapshot: () => ({ viewedProductIds: [] }),
        getAuthPayload: () => ({ sessionToken: "" }),
        ensureAuthenticated: async () => false,
        getSignedAuthPayload: async () => null,
      } as any,
    });
    bus.init();
    try {
      await mutateShopifyCart(
        "change",
        { id: "line-1", quantity: 2 },
        "aov_chat",
      );
      expect(
        recordEvent.mock.calls.filter(
          ([event]) => event.type === "quantity_changed",
        ),
      ).toHaveLength(1);
      expect(
        recordEvent.mock.calls.find(
          ([event]) => event.type === "quantity_changed",
        )?.[0],
      ).toMatchObject({ cartSource: "aov_chat", confirmed: true });
    } finally {
      bus.destroy();
    }
  });
  it("has adapters for all eleven registered widget types and no unprompted network calls when chat is disabled", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    event("page_view");
    expect(Object.keys(WIDGET_PROVIDERS)).toHaveLength(11);
    expect(fetch).not.toHaveBeenCalled();
    expect(Object.isFrozen(core.context().session.shown)).toBe(true);
    expect(core.context().session.pageViews).toBe(1);
  });
  it("waits for the product dwell threshold with a visible price before admitting one toast", async () => {
    core.destroy();
    history.replaceState({}, "", "/products/shampoo");
    document.body.innerHTML =
      '<main><span class="price">KES 200</span></main><div data-aovboost-widget="chat"></div>';
    vi.spyOn(
      document.querySelector(".price")!,
      "getBoundingClientRect",
    ).mockReturnValue({
      height: 20,
      width: 80,
      top: 10,
      bottom: 30,
      left: 0,
      right: 80,
      x: 0,
      y: 10,
      toJSON: () => ({}),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response('{"ok":true}')),
    );
    const trigger = vi.fn();
    core = new AgentCore({
      shop: "test.shop",
      apiBase: "/apps/aovboost",
      settings: { chatEnabled: true },
      bridge: {
        mountProvider: mount,
        unmountProvider: vi.fn(),
        getProviderElement: () =>
          document.querySelector("[data-aovboost-widget='chat']"),
      },
      enabled: () => true,
      track,
      trigger,
    });
    core.init();
    event("product_viewed", { productId: "gid://shopify/Product/1" });
    core.offer({ widgetType: "toast" }, "price_hesitation");
    await vi.advanceTimersByTimeAsync(L.HESITATION_DWELL_MS - 1);
    expect(mount).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mount).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveBeenCalledWith("price_hesitation", {
      productId: "gid://shopify/Product/1",
    });
    core.offer({ widgetType: "toast" }, "price_hesitation");
    expect(mount).toHaveBeenCalledTimes(1);
  });
  it("passes the core backoff to existing offer requests without retaining the legacy thirty-minute frontend window", async () => {
    event("cart_update", cart());
    core.offer(
      {
        widgetType: "upsell_drawer",
        payload: { triggerType: "cart_item_added", mutationId: "m1" },
      },
      "cart_item_added",
    );
    await Promise.resolve();
    core.arbiter.dismiss("cart_upsell");
    expect(core.getDismissedWidgets()).toEqual(["upsell_drawer"]);
    await vi.advanceTimersByTimeAsync(L.DISMISS_BACKOFF_FIRST_MS);
    expect(core.getDismissedWidgets()).toEqual([]);
  });
  it("requires an authoritative cart snapshot before allowing a shopper upsell", async () => {
    const decision = {
      widgetType: "upsell_drawer",
      payload: { triggerType: "cart_item_added", mutationId: "m1" },
    };
    event("add_to_cart", { ...cart(), cartItems: undefined });
    core.offer(decision, "cart_item_added");
    expect(mount).not.toHaveBeenCalled();
    event("cart_update", cart());
    expect(mount).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    core.offer(decision, "cart_item_added");
    expect(mount).toHaveBeenCalledTimes(1);
  });
  it.each([
    "aov_upsell",
    "aov_bundle",
    "aov_strip",
    "aov_chat",
    "aov_exit",
    "aov_postadd",
  ])(
    "blocks recursive upsells and attributes refreshed acceptance for %s",
    (source) => {
      event("cart_update", cart(source));
      core.offer(
        {
          widgetType: "upsell_drawer",
          payload: { triggerType: "cart_item_added", mutationId: "m1" },
        },
        "cart_item_added",
      );
      expect(mount).not.toHaveBeenCalled();
      expect(track).toHaveBeenCalledWith(
        "accepted",
        expect.objectContaining({
          trigger_signal: "cart_add_confirmed",
          ai_healthy: false,
          holdout: false,
          page_type: "home",
        }),
      );
    },
  );
  it("does not report quantity changes or restored cart as an add acceptance", () => {
    event("cart_update", {
      ...cart("aov_chat"),
      cartMutationType: "quantity_changed",
    });
    event("cart_update", { ...cart("aov_chat"), confirmed: false });
    expect(
      track.mock.calls.filter(([type]) => type === "accepted"),
    ).toHaveLength(0);
  });
  it("suppresses chat and its dependent CTAs when availability is unknown", () => {
    for (const widgetType of [
      "chat",
      "toast",
      "countdown_banner",
      "discount_nudge",
    ])
      core.offer({ widgetType }, "price_hesitation");
    expect(mount).not.toHaveBeenCalled();
  });
  it("uses non-AI exit action for a populated cart and rejects unengaged exit", () => {
    event("exit_intent");
    core.offer({ widgetType: "exit_intent" }, "exit_intent");
    expect(mount).not.toHaveBeenCalled();
    event("cart_update", cart());
    expect(mount).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          immediate: true,
          cartHasItems: true,
        }),
      }),
    );
  });
  it("suppresses mounted contextual surfaces immediately on a checkout click", async () => {
    event("cart_update", cart());
    core.offer(
      {
        widgetType: "upsell_drawer",
        payload: { triggerType: "cart_item_added", mutationId: "m1" },
      },
      "cart_item_added",
    );
    await Promise.resolve();
    expect(core.arbiter.mounted()).toEqual(["cart_upsell"]);
    event("checkout_clicked");
    expect(core.arbiter.mounted()).toEqual([]);
  });
  it("tags helper adds and publishes completion after a missing-section retry has refreshed the cart", async () => {
    vi.useRealTimers();
    window.AOVBoost = { agent_core_enabled: true };
    document.body.innerHTML =
      '<div id="shopify-section-template--77__cart"><form action="/cart"><p>Old</p></form></div>';
    let finish!: (response: Response) => void;
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: 101, sections: { "template--77__cart": null } }),
        ),
      )
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      );
    vi.stubGlobal("fetch", fetch);
    const completed = vi.fn();
    document.addEventListener("aovboost:cart-mutation", completed);
    try {
      const add = mutateShopifyCart(
        "add",
        { id: 101, quantity: 1 },
        "aov_strip",
      );
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
      expect(completed).not.toHaveBeenCalled();
      finish(
        new Response(
          JSON.stringify({
            "template--77__cart":
              '<div id="shopify-section-template--77__cart"><form action="/cart"><p>Updated</p></form></div>',
          }),
        ),
      );
      await add;
      expect(document.querySelector("form")?.textContent).toBe("Updated");
      expect(completed).toHaveBeenCalledOnce();
      expect(completed.mock.calls[0][0].detail).toMatchObject({
        cartSource: "aov_strip",
        confirmed: true,
        recommendationOrigin: true,
      });
      expect(fetch.mock.calls[0][1].headers["X-AOVBoost-Source"]).toBe(
        "aov_strip",
      );
      expect(
        fetch.mock.calls.filter(([, init]) => init.method === "POST"),
      ).toHaveLength(1);
    } finally {
      document.removeEventListener("aovboost:cart-mutation", completed);
    }
  });
});
