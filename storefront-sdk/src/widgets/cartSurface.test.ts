// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WidgetManager } from "./widgetManager";
import { resolveWidgetPlacement } from "./placement";
let manager: WidgetManager;
const nativeInner = () =>
  `<div class="drawer__inner" role="dialog" aria-modal="true"><button class="drawer__close">Close cart</button><cart-drawer-items><form><div id="CartDrawer-CartItems"><table><tbody><tr><td>Cart item</td></tr></tbody></table></div></form></cart-drawer-items><footer><button name="checkout">Checkout</button></footer></div>`;
function dawn() {
  document.body.innerHTML = `<main><section><form action='/cart/add'><button name='add'>Add</button></form></section><div data-aovboost-slot='rec_strip'></div></main><cart-drawer class='active'><div id='CartDrawer'>${nativeInner()}</div></cart-drawer>`;
}
function product(n = 2) {
  return {
    id: `gid://shopify/Product/${n}`,
    handle: `product-${n}`,
    title: `Product ${n}`,
    price: "12.00",
    variantId: `gid://shopify/ProductVariant/${n + 100}`,
    variants: [
      {
        id: `gid://shopify/ProductVariant/${n + 100}`,
        title: "Default",
        price: "12.00",
        availableForSale: true,
      },
    ],
  };
}
function decision(mutationId = "one", count = 2) {
  return {
    widgetType: "upsell_drawer",
    payload: {
      offerId: `offer-${mutationId}`,
      mutationId,
      triggerType: "cart_item_added",
      maxProductRecommendations: count,
      products: [2, 3, 4, 5].map((n) => ({
        productId: product(n).id,
        reason: "Approved",
        product: product(n),
      })),
    },
  };
}
const host = () =>
  document.querySelector<HTMLElement>("[data-aovboost-widget='upsell_drawer']");
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState({}, "", "/products/shampoo");
  manager = new WidgetManager({ maxProductRecommendations: 4 });
  dawn();
});
afterEach(() => {
  manager.destroyActive();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});
describe("native cart placement and lifecycle", () => {
  it("does not let a browsing strip suppress the cart surface or add another dialog", () => {
    manager.mountDecision({
      widgetType: "rec_strip",
      payload: { products: [product()] },
    });
    expect(manager.mountDecision(decision()).status).toBe("mounted");
    expect(manager.getStatus().mountedWidgetTypes).toEqual([
      "rec_strip",
      "upsell_drawer",
    ]);
    expect(host()?.closest(".drawer__inner")).not.toBeNull();
    expect(host()?.closest("form")).toBeNull();
    expect(
      host()?.shadowRoot?.querySelector(".backdrop, [role='dialog']"),
    ).toBeNull();
    expect(document.querySelector("button[name='checkout']")).not.toBeNull();
  });
  it("supports an explicit merchant drawer slot on a different theme", () => {
    document.body.innerHTML = `<main></main><section data-aovboost-cart-drawer aria-hidden='false' role='dialog' aria-modal='true'><button data-cart-close>Close</button><div data-aovboost-slot='upsell_drawer'></div><button>Checkout</button></section>`;
    expect(manager.mountDecision(decision()).reason).toBe(
      "native_cart_drawer_slot",
    );
    expect(host()?.parentElement?.dataset.aovboostSlot).toBe("upsell_drawer");
  });
  it.each(["closed", "another-dialog", "ambiguous", "unsafe-slot"])(
    "shows nothing for %s drawers",
    (mode) => {
      if (mode === "closed")
        document.querySelector("cart-drawer")!.classList.remove("active");
      if (mode === "another-dialog")
        document.body.insertAdjacentHTML(
          "beforeend",
          "<dialog open><button>Other task</button></dialog>",
        );
      if (mode === "ambiguous")
        document.body.insertAdjacentHTML(
          "beforeend",
          `<section data-aovboost-cart-drawer><div data-aovboost-slot='upsell_drawer'></div></section>`,
        );
      if (mode === "unsafe-slot")
        document.body.innerHTML = `<main></main><section data-aovboost-cart-drawer><form><div data-aovboost-slot='upsell_drawer'></div></form></section>`;
      expect(
        resolveWidgetPlacement("upsell_drawer", decision().payload).target,
      ).toBeNull();
      expect(manager.mountDecision(decision()).status).toBe("suppressed");
      expect(host()).toBeNull();
    },
  );
  it("keeps general drawer/dialog protections for browsing widgets", () => {
    document.querySelector("main")!.innerHTML = "";
    document
      .querySelector(".drawer__inner")!
      .insertAdjacentHTML(
        "beforeend",
        "<div data-aovboost-slot='rec_strip'></div>",
      );
    expect(
      resolveWidgetPlacement("rec_strip", { products: [product()] }).target,
    ).toBeNull();
  });
  it("renders four configured cards and refreshes on a new mutation while preserving a stable decision", () => {
    manager.mountDecision(decision("one", 4));
    const original = host();
    expect(
      original!.shadowRoot!.querySelectorAll(".product-card"),
    ).toHaveLength(4);
    const duplicate = decision("one", 4);
    duplicate.payload.offerId = "another-offer-record";
    expect(manager.mountDecision(duplicate).status).toBe("unchanged");
    expect(host()).toBe(original);
    expect(manager.mountDecision(decision("two", 4)).status).toBe("mounted");
    expect(host()).not.toBe(original);
    expect(
      document.querySelectorAll("[data-aovboost-widget='upsell_drawer']"),
    ).toHaveLength(1);
  });
  it("reattaches the existing card after section replacement and stops after dismissal", async () => {
    manager.mountDecision(decision());
    const original = host()!;
    document.querySelector("#CartDrawer")!.innerHTML = nativeInner();
    await vi.waitFor(() => expect(host()).toBe(original));
    original
      .shadowRoot!.querySelector<HTMLButtonElement>("[data-dismiss]")!
      .click();
    document.querySelector("#CartDrawer")!.innerHTML = nativeInner();
    await new Promise((resolve) => window.setTimeout(resolve, 100));
    expect(host()).toBeNull();
    expect(manager.mountDecision(decision("two")).reason).toBe(
      "shopper_dismissed",
    );
  });
  it("bridges Tab through shadow controls and returns focus on Escape without closing the cart", () => {
    const nativeClose =
      document.querySelector<HTMLButtonElement>(".drawer__close")!;
    nativeClose.focus();
    manager.mountDecision(decision());
    const card = host()!,
      root = card.shadowRoot!;
    card.focus();
    const close = root.querySelector<HTMLButtonElement>("[data-dismiss]")!;
    expect(root.activeElement).toBe(close);
    close.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey: true,
        bubbles: true,
        composed: true,
      }),
    );
    expect(document.activeElement).toBe(nativeClose);
    const last = Array.from(
      root.querySelectorAll<HTMLButtonElement>("button"),
    ).at(-1)!;
    last.focus();
    last.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        bubbles: true,
        composed: true,
      }),
    );
    expect(document.activeElement).toBe(
      document.querySelector("[name='checkout']"),
    );
    close.focus();
    const nativeEscape = vi.fn();
    document
      .querySelector("cart-drawer")!
      .addEventListener("keyup", nativeEscape);
    close.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        composed: true,
      }),
    );
    nativeClose.dispatchEvent(
      new KeyboardEvent("keyup", { key: "Escape", bubbles: true }),
    );
    expect(host()).toBeNull();
    expect(document.activeElement).toBe(nativeClose);
    expect(nativeEscape).not.toHaveBeenCalled();
  });
  it("records one impression only when the card is actually visible in the viewport", () => {
    const callbacks: IntersectionObserverCallback[] = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          callbacks.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 300,
      height: 100,
      top: 0,
      left: 0,
      bottom: 100,
      right: 300,
    } as DOMRect);
    const track = vi.fn();
    document.addEventListener("aovboost:track", track);
    manager.mountDecision(decision());
    expect(track).not.toHaveBeenCalled();
    const drawer = document.querySelector("cart-drawer")!;
    drawer.classList.remove("active");
    const visible = [
      { isIntersecting: true, intersectionRatio: 1 },
    ] as IntersectionObserverEntry[];
    callbacks[0](visible, {} as IntersectionObserver);
    expect(track).not.toHaveBeenCalled();
    drawer.classList.add("active");
    callbacks[0](visible, {} as IntersectionObserver);
    callbacks[0](visible, {} as IntersectionObserver);
    expect(
      track.mock.calls.filter(
        ([event]) => event.detail.type === "widget_impression",
      ),
    ).toHaveLength(1);
    document.removeEventListener("aovboost:track", track);
  });
});
