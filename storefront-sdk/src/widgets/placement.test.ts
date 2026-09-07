// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getStorefrontPage, resolveWidgetPlacement } from "./placement";

const bundle = {
  products: [
    { id: "1", handle: "board" },
    { id: "2", handle: "boots" },
  ],
};
const form =
  "<product-form><form action='/cart/add'><button name='add'>Add to cart</button><div class='shopify-payment-button'>Express pay</div></form></product-form>";

beforeEach(() => {
  window.history.replaceState({}, "", "/products/board");
  document.body.innerHTML = `<main><section id='MainProduct-1'><div class='product__info-container'>${form}<p class='product__description'>Description</p></div></section></main>`;
});
afterEach(() => {
  document.body.innerHTML = "";
  delete document.body.dataset.template;
  window.history.replaceState({}, "", "/");
  vi.unstubAllGlobals();
});

describe("theme placement boundaries", () => {
  it("protects non-shopping routes even when theme metadata is stale", () => {
    document.body.dataset.template = "product";
    window.history.replaceState({}, "", "/en-ke/pages/about");
    expect(getStorefrontPage()).toBe("other");
    expect(resolveWidgetPlacement("chat", {}).target).toBeNull();
  });
  it.each([
    "/",
    "/collections/all",
    "/cart",
    "/pages/about",
    "/search",
    "/account",
    "/checkout",
    "/checkouts/abc/thank_you",
  ])("never places bundles on %s", (path) => {
    window.history.replaceState({}, "", path);
    expect(resolveWidgetPlacement("bundle", bundle).target).toBeNull();
    expect(document.querySelector("[data-aovboost-mount]")).toBeNull();
  });
  it.each(["/collections/snow/products/board", "/en-ke/products/board"])(
    "recognizes product context on %s",
    (path) => {
      window.history.replaceState({}, "", path);
      expect(getStorefrontPage()).toBe("product");
      expect(resolveWidgetPlacement("bundle", bundle).target).not.toBeNull();
    },
  );
  it("places a relevant bundle after the full purchase form and express payment", () => {
    const payment = document.querySelector(".shopify-payment-button");
    const target = resolveWidgetPlacement("bundle", bundle).target;
    expect(target?.previousElementSibling?.tagName).toBe("PRODUCT-FORM");
    expect(target?.nextElementSibling?.className).toBe("product__description");
    expect(payment?.closest("form")).not.toBeNull();
    expect(target?.closest("form")).toBeNull();
  });
  it.each([
    "<header>FORM</header>",
    "<footer>FORM</footer>",
    "<nav>FORM</nav>",
    "<quick-add-modal>FORM</quick-add-modal>",
    "<cart-drawer open>FORM</cart-drawer>",
    "<div class='card-wrapper'>FORM</div>",
    "<product-card>FORM</product-card>",
    "<div hidden>FORM</div>",
    "<div style='display:none'>FORM</div>",
    "<div style='position:fixed'>FORM</div>",
    "<div aria-hidden='true'>FORM</div>",
    "<details>FORM</details>",
    "<div data-sticky-add-to-cart>FORM</div>",
  ])("ignores secondary/hidden purchase controls: %s", (wrapper) => {
    document
      .querySelector("main")!
      .insertAdjacentHTML("afterbegin", wrapper.replace("FORM", form));
    const target = resolveWidgetPlacement("bundle", bundle).target;
    expect(target).not.toBeNull();
    expect(target?.closest("#MainProduct-1")).not.toBeNull();
  });
  it("does not fall back to main or body if there is no safe purchase area", () => {
    document.body.innerHTML = `<main><h1>Product</h1><quick-add-modal>${form}</quick-add-modal></main>`;
    expect(resolveWidgetPlacement("bundle", bundle).target).toBeNull();
    expect(document.querySelector("[data-aovboost-mount]")).toBeNull();
  });
  it("ignores installment forms and secondary featured products", () => {
    document
      .querySelector(".product__info-container")!
      .insertAdjacentHTML(
        "afterbegin",
        "<form id='product-form-installment-1' action='/cart/add'></form>",
      );
    document
      .querySelector("main")!
      .insertAdjacentHTML(
        "afterbegin",
        `<section><product-info>${form}</product-info></section>`,
      );
    expect(
      resolveWidgetPlacement("bundle", bundle).target?.closest(
        "#MainProduct-1",
      ),
    ).not.toBeNull();
  });
  it("skips ambiguous primary forms", () => {
    document
      .querySelector(".product__info-container")!
      .insertAdjacentHTML("beforeend", form);
    expect(resolveWidgetPlacement("bundle", bundle).target).toBeNull();
  });
  it("keeps quantity and purchase controls grouped in their flex row", () => {
    document.querySelector(".product__info-container")!.innerHTML =
      `<div id='buy-buttons' style='display:flex'><input aria-label='Quantity'>${form}</div>`;
    const target = resolveWidgetPlacement("bundle", bundle).target;
    expect(target?.previousElementSibling?.id).toBe("buy-buttons");
    expect(target?.parentElement?.className).toBe("product__info-container");
  });
  it("places after a separate express checkout block", () => {
    document.querySelector(".product__info-container")!.innerHTML =
      `<div id='purchase'>${form.replace("<div class='shopify-payment-button'>Express pay</div>", "")}</div><div id='express'><div class='shopify-payment-button'>Pay</div></div>`;
    expect(
      resolveWidgetPlacement("bundle", bundle).target?.previousElementSibling
        ?.id,
    ).toBe("express");
  });
  it("does not inject a new column into an unknown grid layout", () => {
    document.querySelector<HTMLElement>(
      ".product__info-container",
    )!.style.display = "grid";
    expect(resolveWidgetPlacement("bundle", bundle).target).toBeNull();
  });
  it("keeps the theme's page gutters when placing after a full section", () => {
    document.querySelector("#MainProduct-1")!.classList.add("page-width");
    const target = resolveWidgetPlacement("rec_strip", {}).target;
    expect(target?.classList.contains("page-width")).toBe(true);
    expect(target?.style.maxWidth).toBe("");
  });
  it("requires the bundle to contain the current product", () => {
    expect(
      resolveWidgetPlacement("bundle", {
        products: [{ handle: "boots" }, { handle: "jacket" }],
      }).target,
    ).toBeNull();
    expect(
      resolveWidgetPlacement("bundle", { products: [{ handle: "board" }] })
        .target,
    ).toBeNull();
  });
  it("honors a safe merchant slot while ignoring slots inside purchase forms", () => {
    document
      .querySelector("form")!
      .insertAdjacentHTML(
        "beforeend",
        "<div data-aovboost-slot='bundle' id='unsafe'></div>",
      );
    document
      .querySelector("main")!
      .insertAdjacentHTML(
        "beforeend",
        "<div data-aovboost-slot='bundle' id='chosen'></div>",
      );
    expect(resolveWidgetPlacement("bundle", bundle).target?.id).toBe("chosen");
  });
  it("places recommendations after the collection grid and pagination", () => {
    window.history.replaceState({}, "", "/collections/all");
    document.body.innerHTML =
      "<main><h1>All products</h1><div id='ProductGridContainer'><ul id='product-grid'></ul><nav>Pages</nav></div></main>";
    expect(
      resolveWidgetPlacement("rec_strip", {}).target?.previousElementSibling
        ?.id,
    ).toBe("ProductGridContainer");
  });
  it("places product recommendations outside the main product section", () => {
    expect(
      resolveWidgetPlacement("rec_strip", {}).target?.previousElementSibling
        ?.id,
    ).toBe("MainProduct-1");
  });
  it("leaves existing theme recommendations in charge", () => {
    document
      .querySelector("main")!
      .insertAdjacentHTML(
        "beforeend",
        "<product-recommendations><a href='/products/boots'>Boots</a></product-recommendations>",
      );
    expect(resolveWidgetPlacement("rec_strip", {}).target).toBeNull();
  });
  it("requires a deliberate homepage slot instead of inserting before the hero", () => {
    window.history.replaceState({}, "", "/");
    document.body.innerHTML =
      "<main><section class='hero'>Hero</section></main>";
    expect(resolveWidgetPlacement("rec_strip", {}).target).toBeNull();
    document
      .querySelector("main")!
      .insertAdjacentHTML(
        "beforeend",
        "<div data-aovboost-slot='rec_strip' id='chosen'></div>",
      );
    expect(resolveWidgetPlacement("rec_strip", {}).target?.id).toBe("chosen");
  });
  it("requires a safe campaign slot and a real future end time", () => {
    expect(
      resolveWidgetPlacement("countdown_banner", { endsAt: "2099-01-01" })
        .target,
    ).toBeNull();
    document
      .querySelector("main")!
      .insertAdjacentHTML(
        "beforeend",
        "<div data-aovboost-slot='countdown_banner' id='campaign'></div>",
      );
    expect(resolveWidgetPlacement("countdown_banner", {}).target).toBeNull();
    expect(
      resolveWidgetPlacement("countdown_banner", { endsAt: "2000-01-01" })
        .target,
    ).toBeNull();
    expect(
      resolveWidgetPlacement("countdown_banner", { endsAt: "2099-01-01" })
        .target?.id,
    ).toBe("campaign");
  });
  it("avoids overlays on mobile and over an open theme cart", () => {
    vi.stubGlobal("innerWidth", 390);
    expect(resolveWidgetPlacement("toast", {}).target).toBeNull();
    vi.stubGlobal("innerWidth", 1280);
    document.body.insertAdjacentHTML(
      "beforeend",
      "<cart-drawer open></cart-drawer>",
    );
    expect(resolveWidgetPlacement("exit_intent", {}).target).toBeNull();
    document.querySelector("cart-drawer")!.setAttribute("hidden", "");
    expect(resolveWidgetPlacement("toast", {}).target).toBe(document.body);
  });
});
