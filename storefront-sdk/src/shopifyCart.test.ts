// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cartUrl, mutateShopifyCart } from "./shopifyCart";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  delete (window as Window & { Shopify?: unknown }).Shopify;
});
describe("Shopify cart adapter", () => {
  it("uses locale-aware URLs and refreshes returned theme sections", async () => {
    Object.assign(window, { Shopify: { routes: { root: "/fr/" } } });
    document.body.innerHTML = '<div id="cart-icon-bubble">0</div>';
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
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
