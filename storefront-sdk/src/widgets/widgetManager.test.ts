// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { isWidgetEnabled, WidgetManager } from "./widgetManager";

afterEach(() => {
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/");
});

describe("isWidgetEnabled", () => {
  it("honors merchant settings for every configurable widget family", () => {
    const settings = {
      chatEnabled: false,
      bundlesEnabled: false,
      upsellEnabled: false,
      discountNudgeEnabled: false,
      exitIntentEnabled: false,
      postPurchaseEnabled: false,
    };

    expect(isWidgetEnabled("chat", settings)).toBe(false);
    expect(isWidgetEnabled("bundle", settings)).toBe(false);
    expect(isWidgetEnabled("upsell_drawer", settings)).toBe(false);
    expect(isWidgetEnabled("rec_strip", settings)).toBe(false);
    expect(isWidgetEnabled("social_proof", settings)).toBe(false);
    expect(isWidgetEnabled("discount_nudge", settings)).toBe(false);
    expect(isWidgetEnabled("countdown_banner", settings)).toBe(false);
    expect(isWidgetEnabled("exit_intent", settings)).toBe(false);
    expect(isWidgetEnabled("post_purchase", settings)).toBe(false);
  });

  it("keeps backward-compatible defaults and unrelated system widgets", () => {
    expect(isWidgetEnabled("chat", {})).toBe(true);
    expect(isWidgetEnabled("inline_alert", { chatEnabled: false })).toBe(true);
  });

  it("keeps chat, merchandising, banner, and overlay slots active together", () => {
    localStorage.clear();
    document.body.innerHTML =
      "<main><div data-product-description></div></main>";
    const manager = new WidgetManager({
      chatEnabled: true,
      upsellEnabled: true,
      discountNudgeEnabled: true,
    });

    manager.mountDecision({
      widgetType: "chat",
      payload: { offerId: "chat-1", greeting: "Can I help?" },
    });
    manager.mountDecision({
      widgetType: "rec_strip",
      payload: { offerId: "rec-1", products: [widgetProduct()] },
    });
    manager.mountDecision({
      widgetType: "social_proof",
      payload: { offerId: "proof-1", products: [widgetProduct()] },
    });
    manager.mountDecision({
      widgetType: "discount_nudge",
      payload: { offerId: "goal-1", threshold: 100, cartValue: 82 },
    });
    manager.mountDecision({
      widgetType: "toast",
      payload: { offerId: "toast-1", headline: "Complete the set" },
    });

    expect(activeWidgetTypes()).toEqual([
      "chat",
      "discount_nudge",
      "rec_strip",
      "social_proof",
      "toast",
    ]);
    expect(
      document.querySelector<HTMLElement>(
        "[data-aovboost-widget='social_proof']",
      )?.shadowRoot?.textContent,
    ).toContain("12 verified orders include Verified Add-on");
    document.dispatchEvent(new CustomEvent("aovboost:open-chat"));
    expect(
      document
        .querySelector<HTMLElement>("[data-aovboost-widget='chat']")
        ?.shadowRoot?.querySelector("[data-input]"),
    ).not.toBeNull();

    manager.mountDecision({
      widgetType: "upsell_drawer",
      payload: { offerId: "upsell-1", products: [widgetProduct()] },
    });
    expect(activeWidgetTypes()).toEqual([
      "chat",
      "discount_nudge",
      "rec_strip",
      "social_proof",
      "upsell_drawer",
    ]);

    manager.resetPageContext();
    expect(activeWidgetTypes()).toEqual(["chat", "discount_nudge"]);

    manager.destroyActive();
    expect(activeWidgetTypes()).toEqual([]);
  });

  it("places collection recommendations before the product grid", () => {
    localStorage.clear();
    window.history.replaceState({}, "", "/collections/all");
    document.body.innerHTML =
      "<main><h1>All products</h1><ul id='product-grid'></ul></main>";
    const manager = new WidgetManager({ upsellEnabled: true });

    manager.mountDecision({
      widgetType: "rec_strip",
      payload: { offerId: "rec-collection", products: [widgetProduct()] },
    });

    const mount = document.querySelector(
      "[data-aovboost-mount='collection-recommendations']",
    );
    expect(mount?.nextElementSibling?.id).toBe("product-grid");
    expect(manager.getStatus().mountedWidgetTypes).toContain("rec_strip");
  });

  it("always refreshes the verified upsell after a new cart addition", () => {
    localStorage.setItem(
      "aovboost_dismissed_widgets",
      JSON.stringify([
        { widgetType: "upsell_drawer", dismissedAt: Date.now() },
      ]),
    );
    const manager = new WidgetManager({ upsellEnabled: true });

    manager.mountDecision({
      widgetType: "upsell_drawer",
      payload: {
        offerId: "upsell-1",
        triggerType: "cart_item_added",
        products: [widgetProduct("2", "First complement")],
      },
    });
    manager.mountDecision({
      widgetType: "upsell_drawer",
      payload: {
        offerId: "upsell-2",
        triggerType: "cart_item_added",
        products: [widgetProduct("3", "Second complement")],
      },
    });

    const drawers = document.querySelectorAll(
      "[data-aovboost-widget='upsell_drawer']",
    );
    expect(drawers).toHaveLength(1);
    expect((drawers[0] as HTMLElement).shadowRoot?.textContent).toContain(
      "Second complement",
    );
    expect(
      (drawers[0] as HTMLElement).shadowRoot?.querySelector("[data-timer]"),
    ).toBeNull();
  });
});

function activeWidgetTypes() {
  return Array.from(
    document.querySelectorAll<HTMLElement>("[data-aovboost-widget]"),
  )
    .map((element) => element.dataset.aovboostWidget)
    .sort();
}

function widgetProduct(id = "2", title = "Verified Add-on") {
  return {
    id: `gid://shopify/Product/${id}`,
    productId: `gid://shopify/Product/${id}`,
    variantId: `gid://shopify/ProductVariant/${id}2`,
    title,
    handle: title.toLowerCase().replace(/\s+/g, "-"),
    imageUrl: "",
    price: "20.00",
    variants: [
      {
        id: `gid://shopify/ProductVariant/${id}2`,
        title: "Default",
        sku: "ADD-ON",
        price: "20.00",
        compareAtPrice: null,
        quantityAvailable: 10,
        availableForSale: true,
        selectedOptions: [],
      },
    ],
    orderCount: 12,
  };
}
