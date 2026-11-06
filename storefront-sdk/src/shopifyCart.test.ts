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
    const fetch = vi
      .fn()
      .mockResolvedValue(
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
