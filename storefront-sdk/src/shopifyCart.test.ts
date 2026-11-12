// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cartUrl, mutateShopifyCart } from "./shopifyCart";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  delete (window as Window & { Shopify?: unknown }).Shopify;
  delete (window as Window & { trapFocus?: unknown }).trapFocus;
});
describe("Shopify cart adapter", () => {
  it("refreshes Velour's dynamic cart section and badge, preserves notes and shadow card, and rebinds native controls", async () => {
    document.body.innerHTML = `
      <div id="shopify-section-sections--88__header"><header><button id="native-menu">Menu</button><span class="badge is-hidden" data-cart-count aria-hidden="true">0</span></header></div>
      <main><div id="shopify-section-template--77__cart"><div class="cart-container"><form action="/fr/cart" method="post"><table><tbody><tr class="cart-item"><td>Original</td></tr></tbody></table><textarea name="note">Saved note</textarea><p class="cart-subtotal__value">KSh 500</p></form></div><section data-aovboost-mount="adaptive-cart"><div data-aovboost-widget="upsell_drawer"></div></section></div></main>`;
    const host = document.querySelector<HTMLElement>("[data-aovboost-widget]")!;
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = "<button>Added</button>";
    const button = root.querySelector("button")!;
    const cardClick = vi.fn();
    button.addEventListener("click", cardClick);
    button.focus();
    document.querySelector<HTMLTextAreaElement>("textarea")!.value =
      "Unsaved instructions";
    const menu = document.getElementById("native-menu")!;
    const menuClick = vi.fn();
    menu.addEventListener("click", menuClick);
    const sectionLoad = vi.fn((event: Event) => {
      const form = (event.target as Element).querySelector("form");
      if (form) form.setAttribute("data-native-bound", "true");
    });
    document.addEventListener("shopify:section:load", sectionLoad);
    try {
      const fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: 123,
            sections: {
              "template--77__cart":
                '<div id="shopify-section-template--77__cart"><div class="cart-container"><form action="/fr/cart"><table><tbody><tr class="cart-item"><td>Original</td></tr><tr class="cart-item"><td>Recommended</td></tr></tbody></table><textarea name="note">Saved note</textarea><p class="cart-subtotal__value">KSh 750</p></form></div></div>',
              "sections--88__header":
                '<div id="shopify-section-sections--88__header"><header><button id="native-menu">Menu</button><span class="badge" data-cart-count aria-hidden="false">2</span></header></div>',
            },
          }),
          { status: 200 },
        ),
      );
      vi.stubGlobal("fetch", fetch);
      await mutateShopifyCart("add", { id: "123", quantity: 1 });
      expect(JSON.parse(fetch.mock.calls[0][1].body).sections).toEqual([
        "template--77__cart",
        "sections--88__header",
      ]);
      expect(document.querySelectorAll(".cart-item")).toHaveLength(2);
      expect(document.querySelector(".cart-subtotal__value")!.textContent).toBe(
        "KSh 750",
      );
      expect(
        document.querySelector<HTMLTextAreaElement>("textarea")!.value,
      ).toBe("Unsaved instructions");
      expect(document.querySelector("[data-cart-count]")!.textContent).toBe(
        "2",
      );
      expect(
        document
          .querySelector("[data-cart-count]")!
          .getAttribute("aria-hidden"),
      ).toBe("false");
      expect(
        document
          .querySelector("[data-cart-count]")!
          .classList.contains("is-hidden"),
      ).toBe(false);
      expect(
        document.querySelector("form")!.getAttribute("data-native-bound"),
      ).toBe("true");
      expect(sectionLoad).toHaveBeenCalledOnce();
      expect(document.querySelector("[data-aovboost-widget]")).toBe(host);
      expect(host.closest("form,table")).toBeNull();
      expect(root.activeElement).toBe(button);
      expect(document.activeElement).toBe(host);
      button.click();
      expect(cardClick).toHaveBeenCalledOnce();
      menu.click();
      expect(menuClick).toHaveBeenCalledOnce();
      expect(document.getElementById("native-menu")).toBe(menu);
      expect(fetch).toHaveBeenCalledOnce();
    } finally {
      document.removeEventListener("shopify:section:load", sectionLoad);
    }
  });

  it("retries missing dynamic section HTML with a read and never repeats the accepted add", async () => {
    document.body.innerHTML =
      '<div id="shopify-section-template--77__cart"><form action="/cart"><p>Old cart</p></form></div>';
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: 123, sections: { "template--77__cart": null } }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            "template--77__cart":
              '<div id="shopify-section-template--77__cart"><form action="/cart"><p>Updated cart</p></form></div>',
          }),
        ),
      );
    vi.stubGlobal("fetch", fetch);
    await expect(
      mutateShopifyCart("add", { id: "123", quantity: 1 }),
    ).resolves.toMatchObject({ id: 123 });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][1].method).toBe("POST");
    expect(new URL(fetch.mock.calls[1][0]).searchParams.get("sections")).toBe(
      "template--77__cart",
    );
    expect(fetch.mock.calls[1][1].method).toBeUndefined();
    expect(document.querySelector("form")!.textContent).toBe("Updated cart");
  });

  it("does not request more than five sections or refresh unrelated product forms", async () => {
    document.body.innerHTML =
      '<div id="shopify-section-product"><form action="/cart/add"><button>Add</button></form></div>' +
      Array.from(
        { length: 7 },
        (_, index) =>
          `<div id="shopify-section-header-${index}"><span data-cart-count>1</span></div>`,
      ).join("");
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            id: 123,
            sections: Object.fromEntries(
              Array.from({ length: 7 }, (_, index) => [
                `header-${index}`,
                `<div id="shopify-section-header-${index}"><span data-cart-count>2</span></div>`,
              ]),
            ),
          }),
        ),
      );
    vi.stubGlobal("fetch", fetch);
    await mutateShopifyCart("add", { id: "123", quantity: 1 });
    const sections = JSON.parse(fetch.mock.calls[0][1].body).sections;
    expect(sections).toHaveLength(5);
    expect(sections).not.toContain("product");
    expect(document.querySelector('form[action="/cart/add"]')).not.toBeNull();
  });

  it("requests Dawn's snippet drawer section, invokes its controller and restores native focus/trapping", async () => {
    const markup = `<div id='CartDrawer'><div class='drawer__inner' role='dialog'><button class='drawer__close'>Close</button><div id='CartDrawer-CartItems'>Updated items</div><button name='checkout'>Checkout</button></div></div>`;
    document.body.innerHTML = `<cart-drawer class='active'>${markup.replace("Updated items", "Old items")}</cart-drawer>`;
    const drawer = document.querySelector("cart-drawer") as HTMLElement & {
      renderContents?: (result: any) => void;
      getSectionsToRender?: () => Array<{ id: string }>;
    };
    drawer.querySelector<HTMLElement>(".drawer__close")!.focus();
    const renderContents = vi.fn((result) => {
      drawer.innerHTML = result.sections["cart-drawer"];
    });
    drawer.renderContents = renderContents;
    drawer.getSectionsToRender = () => [{ id: "cart-drawer" }];
    const trapFocus = vi.fn((_root, target) => target.focus());
    Object.assign(window, { trapFocus });
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ id: 123, sections: { "cart-drawer": markup } }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetch);
    await mutateShopifyCart("add", { id: "123", quantity: 1 });
    expect(JSON.parse(fetch.mock.calls[0][1].body).sections).toContain(
      "cart-drawer",
    );
    expect(fetch.mock.calls[0][1].headers["X-AOVBoost-Recommendation"]).toBe(
      "1",
    );
    expect(renderContents).toHaveBeenCalledOnce();
    expect(document.getElementById("CartDrawer-CartItems")!.textContent).toBe(
      "Updated items",
    );
    expect(document.activeElement).toBe(drawer.querySelector(".drawer__close"));
    expect(trapFocus).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("keeps a successful add accepted if the native renderer throws", async () => {
    document.body.innerHTML = `<cart-drawer class='active'><div id='CartDrawer'><div class='drawer__inner' role='dialog'><button>Cart</button></div></div></cart-drawer>`;
    Object.assign(document.querySelector("cart-drawer")!, {
      renderContents: () => {
        throw new Error("Theme renderer failed");
      },
    });
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 123,
          sections: {
            "cart-drawer":
              "<div id='CartDrawer'><div class='drawer__inner' role='dialog'>Updated</div></div>",
          },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetch);
    expect(
      await mutateShopifyCart("add", { id: "123", quantity: 1 }),
    ).toMatchObject({ id: 123 });
    expect(document.getElementById("CartDrawer")!.textContent).toBe("Updated");
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("uses locale-aware URLs and refreshes returned theme sections", async () => {
    Object.assign(window, { Shopify: { routes: { root: "/fr/" } } });
    document.body.innerHTML = '<div id="cart-icon-bubble">0</div>';
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 123,
          sections: {
            "cart-icon-bubble": '<div id="cart-icon-bubble">2</div>',
          },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await mutateShopifyCart("add", { id: "123", quantity: 2 });
    expect(fetchMock.mock.calls[0][0]).toBe("/fr/cart/add.js");
    expect(document.getElementById("cart-icon-bubble")?.textContent).toBe("2");
  });
  it("does not retry or lose a successful cart mutation when a section is missing", async () => {
    document.body.innerHTML = '<div id="cart-icon-bubble">0</div>';
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ id: 123, sections: { "cart-icon-bubble": null } }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    expect(
      await mutateShopifyCart("add", { id: "123", quantity: 1 }),
    ).toMatchObject({ id: 123 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("rejects external route roots and propagates failed cart responses", async () => {
    Object.assign(window, {
      Shopify: { routes: { root: "//outside.example/" } },
    });
    expect(cartUrl("change")).toBe("/cart/change.js");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("Unavailable", { status: 422 })),
    );
    expect(
      await mutateShopifyCart("change", { id: "line-key", quantity: 0 }),
    ).toBeNull();
  });
});
