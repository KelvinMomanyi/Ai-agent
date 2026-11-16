// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import render from "./OrderStatus";
let api, fetcher;
beforeEach(() => {
  api = {
    order: { value: { id: "gid://shopify/Order/1" } },
    lines: {
      value: [{ merchandise: { product: { id: "gid://shopify/Product/1" } } }],
    },
    sessionToken: { get: vi.fn(async () => "synthetic") },
    shop: { storefrontUrl: "https://example.myshopify.com" },
    storage: { read: vi.fn(async () => null), write: vi.fn(async () => {}) },
  };
  vi.stubGlobal("shopify", api);
  fetcher = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          anonymousId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          offerId: "offer",
          product: { title: "Actual catalog product" },
          path: "/apps/aovboost/postadd?offer=offer",
        }),
      ),
  );
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});
describe("Shopify order-status next-cart block", () => {
  it("fetches with a transient session token and renders an explicit new-cart link", async () => {
    await render();
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer synthetic",
    );
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      productIds: ["gid://shopify/Product/1"],
      anonymousId: null,
    });
    expect(document.querySelector("s-link").getAttribute("href")).toBe(
      "https://example.myshopify.com/apps/aovboost/postadd?offer=offer",
    );
    expect(document.body.textContent).toContain(
      "completed order stays as placed",
    );
    expect(api.storage.write).toHaveBeenCalledWith(
      "aovboost_next_cart_visitor_v1",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
    await vi.waitFor(() =>
      expect(
        fetcher.mock.calls.some(
          ([, init]) => JSON.parse(init.body).intent === "impression",
        ),
      ).toBe(true),
    );
    document.querySelector("s-link").dispatchEvent(new Event("click"));
    await vi.waitFor(() =>
      expect(
        fetcher.mock.calls.some(
          ([, init]) => JSON.parse(init.body).intent === "interaction",
        ),
      ).toBe(true),
    );
  });
  it("does not request recommendations for an unconfirmed or cancelled order", async () => {
    api.order.value = undefined;
    await render();
    api.order.value = {
      id: "gid://shopify/Order/1",
      cancelledAt: "2026-11-15",
    };
    await render();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("survives blocked storage and hides unavailable or unsafe responses", async () => {
    api.storage.read.mockRejectedValue(new Error("blocked"));
    api.storage.write.mockRejectedValue(new Error("blocked"));
    await expect(render()).resolves.toBeUndefined();
    document.body.innerHTML = "";
    fetcher.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          product: { title: "Bad" },
          path: "https://unsafe.example",
        }),
      ),
    );
    await render();
    expect(document.body.children).toHaveLength(0);
    fetcher.mockRejectedValueOnce(new Error("unavailable"));
    await expect(render()).resolves.toBeUndefined();
    expect(document.body.children).toHaveLength(0);
  });
});
