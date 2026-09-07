// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isWidgetEnabled, WidgetManager } from "./widgetManager";

let manager: WidgetManager;
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  manager = new WidgetManager();
});
afterEach(() => {
  manager.destroyActive();
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/");
  vi.restoreAllMocks();
});

describe("widget management", () => {
  it("honors merchant settings for every configurable widget family", () => {
    const settings = {
      chatEnabled: false,
      bundlesEnabled: false,
      upsellEnabled: false,
      discountNudgeEnabled: false,
      exitIntentEnabled: false,
      postPurchaseEnabled: false,
    };
    for (const type of [
      "chat",
      "bundle",
      "upsell_drawer",
      "rec_strip",
      "social_proof",
      "discount_nudge",
      "countdown_banner",
      "exit_intent",
      "post_purchase",
    ]) {
      expect(isWidgetEnabled(type, settings)).toBe(false);
    }
    expect(isWidgetEnabled("chat", {})).toBe(true);
    expect(isWidgetEnabled("inline_alert", { chatEnabled: false })).toBe(true);
  });

  it("keeps one merchandising block and one notice alongside the assistant", () => {
    productPage();
    manager.mountDecision({
      widgetType: "chat",
      payload: { greeting: "Can I help?" },
    });
    manager.mountDecision(bundleDecision());
    manager.mountDecision({
      widgetType: "social_proof",
      payload: { products: [widgetProduct()] },
    });
    expect(
      manager.mountDecision({
        widgetType: "rec_strip",
        payload: { products: [widgetProduct()] },
      }).status,
    ).toBe("suppressed");
    expect(
      manager.mountDecision({
        widgetType: "inline_alert",
        payload: { body: "Update" },
      }).status,
    ).toBe("suppressed");
    expect(
      manager.mountDecision({
        widgetType: "toast",
        payload: { headline: "Complete the set" },
      }).status,
    ).toBe("suppressed");
    expect(manager.getStatus().mountedWidgetTypes).toEqual([
      "bundle",
      "chat",
      "social_proof",
    ]);
    document.dispatchEvent(new CustomEvent("aovboost:open-chat"));
    expect(
      widget("chat")?.shadowRoot?.querySelector("[data-input]"),
    ).not.toBeNull();
    manager.resetPageContext();
    expect(manager.getStatus().mountedWidgetTypes).toEqual(["chat"]);
    expect(document.querySelector("[data-aovboost-mount]")).toBeNull();
  });

  it("preserves visible bundle content and variant selection across repeated offers", () => {
    productPage();
    manager.mountDecision(bundleDecision());
    const original = widget("bundle");
    const picker =
      original!.shadowRoot!.querySelector<HTMLSelectElement>("select")!;
    picker.value = "gid://shopify/ProductVariant/12";
    const next = bundleDecision();
    next.payload.offerId = "offer-2";
    expect(manager.mountDecision(next).status).toBe("unchanged");
    expect(widget("bundle")).toBe(original);
    expect(picker.value).toBe("gid://shopify/ProductVariant/12");
    expect(
      document.querySelectorAll("[data-aovboost-widget='bundle']"),
    ).toHaveLength(1);
  });

  it("remounts after a theme section is replaced", () => {
    productPage();
    manager.mountDecision(bundleDecision());
    const original = widget("bundle");
    productPage();
    expect(manager.mountDecision(bundleDecision()).status).toBe("mounted");
    expect(widget("bundle")).not.toBe(original);
  });

  it("clears product widgets and the assistant when navigating to a protected page", () => {
    productPage();
    manager.mountDecision(bundleDecision());
    manager.mountDecision({ widgetType: "chat" });
    window.history.replaceState({}, "", "/checkout");
    expect(manager.mountDecision(bundleDecision()).status).toBe("suppressed");
    expect(manager.getStatus().mountedWidgetTypes).toEqual([]);
  });

  it("renders cart additions and progress inline without a competing drawer backdrop", () => {
    window.history.replaceState({}, "", "/cart");
    document.body.innerHTML =
      "<main><cart-items id='main-cart-items'><form>Items</form></cart-items><section id='main-cart-footer'>Checkout</section></main>";
    manager.mountDecision({
      widgetType: "upsell_drawer",
      payload: { products: [widgetProduct()] },
    });
    manager.mountDecision({
      widgetType: "discount_nudge",
      payload: { threshold: 100, cartValue: 50 },
    });
    expect(manager.getStatus().mountedWidgetTypes).toEqual([
      "discount_nudge",
      "upsell_drawer",
    ]);
    const upsell = widget("upsell_drawer")!;
    expect(upsell.dataset.presentation).toBe("inline");
    expect(upsell.parentElement?.previousElementSibling?.id).toBe(
      "main-cart-items",
    );
    expect(upsell.shadowRoot?.querySelector(".backdrop")).toBeNull();
    expect(upsell.shadowRoot?.querySelector(".added-note")).toBeNull();
    expect(
      widget("discount_nudge")?.parentElement?.nextElementSibling?.id,
    ).toBe("main-cart-footer");
    upsell
      .shadowRoot!.querySelector<HTMLButtonElement>("[data-dismiss]")!
      .click();
    expect(widget("upsell_drawer")).toBeNull();
  });

  it("respects dismissal after another cart addition", () => {
    window.history.replaceState({}, "", "/cart");
    document.body.innerHTML = "<main><cart-items>Items</cart-items></main>";
    localStorage.setItem(
      "aovboost_dismissed_widgets",
      JSON.stringify([
        { widgetType: "upsell_drawer", dismissedAt: Date.now() },
      ]),
    );
    expect(
      manager.mountDecision({
        widgetType: "upsell_drawer",
        payload: {
          triggerType: "cart_item_added",
          products: [widgetProduct()],
        },
      }).reason,
    ).toBe("shopper_dismissed");
    expect(widget("upsell_drawer")).toBeNull();
  });

  it("removes empty generated mounts without recording an impression", () => {
    window.history.replaceState({}, "", "/collections/all");
    document.body.innerHTML = "<main><ul id='product-grid'></ul></main>";
    const track = vi.fn();
    document.addEventListener("aovboost:track", track);
    expect(
      manager.mountDecision({
        widgetType: "rec_strip",
        payload: { products: [] },
      }).status,
    ).toBe("suppressed");
    expect(document.querySelector("[data-aovboost-mount]")).toBeNull();
    expect(track).not.toHaveBeenCalled();
    document.removeEventListener("aovboost:track", track);
  });

  it("retains a merchant slot when its campaign is dismissed and avoids replacing the timer", () => {
    document.body.innerHTML =
      "<main><div data-aovboost-slot='countdown_banner'></div></main>";
    const decision = {
      widgetType: "countdown_banner",
      payload: { endsAt: "2099-01-01" },
    };
    manager.mountDecision(decision);
    expect(manager.mountDecision(decision).status).toBe("unchanged");
    widget("countdown_banner")!
      .shadowRoot!.querySelector<HTMLButtonElement>("[data-dismiss]")!
      .click();
    expect(
      document.querySelector("[data-aovboost-slot='countdown_banner']"),
    ).not.toBeNull();
    expect(widget("countdown_banner")).toBeNull();
  });

  it("adopts the surrounding theme palette and purchase button appearance", () => {
    productPage();
    const info = document.querySelector<HTMLElement>(
      ".product__info-container",
    )!;
    info.style.cssText =
      "background-color: rgb(30, 30, 30); color: rgb(240, 240, 240); font-family: Georgia";
    document.querySelector<HTMLElement>("button[name='add']")!.style.cssText =
      "background-color: rgb(200, 180, 120); color: rgb(20, 20, 20); border-radius: 2px";
    manager.mountDecision(bundleDecision());
    const style = widget("bundle")!.style;
    expect(style.getPropertyValue("--aovboost-surface")).toBe(
      "rgb(30, 30, 30)",
    );
    expect(style.getPropertyValue("--aovboost-ink")).toBe("rgb(240, 240, 240)");
    expect(style.getPropertyValue("--aovboost-action")).toBe(
      "rgb(200, 180, 120)",
    );
    expect(style.getPropertyValue("--aovboost-radius")).toBe("2px");
  });
});

function widget(type: string) {
  return document.querySelector<HTMLElement>(
    `[data-aovboost-widget='${type}']`,
  );
}
function productPage() {
  window.history.replaceState({}, "", "/products/board");
  document.body.innerHTML =
    "<main><section id='MainProduct-1'><div class='product__info-container'><product-form><form action='/cart/add'><button name='add'>Add</button><div class='shopify-payment-button'>Pay</div></form></product-form></div></section></main>";
}
function bundleDecision() {
  return {
    widgetType: "bundle",
    payload: {
      offerId: "offer-1",
      products: [widgetProduct(), widgetProduct("2", "boots")],
    },
  };
}
function widgetProduct(id = "1", handle = "board") {
  return {
    id: `gid://shopify/Product/${id}`,
    handle,
    title: handle,
    price: "20",
    orderCount: 12,
    variants: [1, 2].map((variant) => ({
      id: `gid://shopify/ProductVariant/${id}${variant}`,
      title: `Size ${variant}`,
      price: "20",
      availableForSale: true,
    })),
  };
}
