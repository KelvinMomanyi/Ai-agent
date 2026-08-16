// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatWidget } from "./ChatWidget";

describe("ChatWidget", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    (window as any).AOVBoost = {
      shop: "teretret.myshopify.com",
      shopName: "Teretret Outdoors",
      apiBase: "/apps/aovboost",
      currency: "KES",
      moneyFormat: "KSh{{amount}}",
      locale: "en-KE",
    };
    (window as any).AOVBoostSDK = {
      getSignedAuthPayload: vi.fn().mockResolvedValue({
        shop: "teretret.myshopify.com",
        sessionId: "session-1",
        sessionToken: "signed-session-token",
      }),
      track: vi.fn(),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (window as any).AOVBoost;
    delete (window as any).AOVBoostSDK;
  });

  it("sends signed KES context and renders the grounded streamed response", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/cart.js") {
          return new Response(
            JSON.stringify({
              currency: "KES",
              item_count: 2,
              items_subtotal_price: 99800,
              total_price: 99800,
              total_discount: 0,
              items: [
                {
                  product_id: 1,
                  variant_id: 11,
                  quantity: 2,
                  product_title: "Trail Board",
                  variant_title: "Default Title",
                  handle: "trail-board",
                  final_price: 49900,
                  original_price: 49900,
                  final_line_price: 99800,
                  original_line_price: 99800,
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        if (url === "/apps/aovboost/chat") {
          return new Response(
            `data: ${JSON.stringify({
              delta:
                "Trail Board is a durable match for trail riding: /products/trail-board",
              productCards: [
                {
                  productId: "gid://shopify/Product/1",
                  title: "Trail Board",
                  handle: "trail-board",
                  variantId: "gid://shopify/ProductVariant/11",
                  imageUrl: "https://cdn.example.test/trail-board.jpg",
                  price: "KSh499.00",
                },
              ],
            })}\n\ndata: [DONE]\n\n`,
            { status: 200, headers: { "Content-Type": "text/event-stream" } },
          );
        }

        if (url === "/cart/add.js") {
          return new Response(JSON.stringify({ id: 11 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        throw new Error(`Unexpected fetch: ${url} ${init?.method || "GET"}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const widget = new ChatWidget({
      offerId: "offer-1",
      copy: { greeting: "How can I help?" },
    });
    widget.mount();

    const root = document.querySelector(
      "[data-aovboost-widget='chat']",
    )?.shadowRoot;
    expect(root?.textContent).toContain("How can I help?");
    expect(root?.textContent).toContain("Teretret Outdoors assistant");

    (root?.querySelector("[data-expand]") as HTMLButtonElement).click();
    const input = root?.querySelector("[data-input]") as HTMLInputElement;
    input.value = "Show me a trail board";
    (root?.querySelector("[data-send]") as HTMLButtonElement).click();

    await vi.waitFor(() => {
      expect(root?.textContent).toContain("Trail Board is a durable match");
      expect(root?.textContent).toContain("KSh499.00");
    });

    const chatCall = fetchMock.mock.calls.find(
      ([url]) => String(url) === "/apps/aovboost/chat",
    );
    expect(chatCall).toBeDefined();
    const requestBody = JSON.parse(String(chatCall?.[1]?.body));
    expect(requestBody).toMatchObject({
      shop: "teretret.myshopify.com",
      sessionId: "session-1",
      sessionToken: "signed-session-token",
      message: "Show me a trail board",
      currency: "KES",
      currencySource: "shopify_cart",
      moneyFormat: "KSh{{amount}}",
      storefrontContext: {
        pageType: "home",
        path: "/",
        productId: "",
        productHandle: "",
      },
      cartContext: {
        status: "loaded",
        currency: "KES",
        itemCount: 2,
        subtotalPrice: 998,
        totalPrice: 998,
        totalDiscount: 0,
        items: [
          {
            productId: "gid://shopify/Product/1",
            variantId: "gid://shopify/ProductVariant/11",
            quantity: 2,
            title: "Trail Board",
            variantTitle: "Default Title",
            handle: "trail-board",
            finalUnitPrice: 499,
            originalUnitPrice: 499,
            finalLinePrice: 998,
            originalLinePrice: 998,
          },
        ],
      },
    });
    expect(requestBody.cartContext.capturedAt).toEqual(expect.any(Number));
    expect(requestBody.messageHistory).toEqual([
      { role: "assistant", content: "How can I help?" },
    ]);

    (root?.querySelector("[data-chat-add]") as HTMLButtonElement).click();
    await vi.waitFor(() => {
      expect(root?.querySelector("[data-chat-add]")?.textContent).toBe("Added");
    });

    const cartCall = fetchMock.mock.calls.find(
      ([url]) => String(url) === "/cart/add.js",
    );
    expect(JSON.parse(String(cartCall?.[1]?.body))).toEqual({
      id: "11",
      quantity: 1,
      properties: { _aovboost_offer_id: "offer-1" },
    });
  });

  it("renders accessible input controls and escapes assistant HTML", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === "/cart.js") {
          return new Response("Unavailable", { status: 503 });
        }
        return new Response(
          `data: ${JSON.stringify({ delta: '<img src=x onerror="alert(1)">' })}\n\ndata: [DONE]\n\n`,
          { status: 200 },
        );
      }),
    );

    const widget = new ChatWidget({ copy: { greeting: "Hello" } });
    widget.mount();
    const root = document.querySelector(
      "[data-aovboost-widget='chat']",
    )?.shadowRoot;
    (root?.querySelector("[data-expand]") as HTMLButtonElement).click();

    const input = root?.querySelector("[data-input]") as HTMLInputElement;
    expect(input.getAttribute("aria-label")).toBe("Chat message");
    input.value = "hello";
    (root?.querySelector("[data-send]") as HTMLButtonElement).click();

    await vi.waitFor(() => {
      expect(root?.textContent).toContain('<img src=x onerror="alert(1)">');
    });
    expect(root?.querySelector(".bubble.assistant img")).toBeNull();
  });

  it("renders variant chips and adds the selected variant with an inline confirmation", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, _init?: RequestInit) => {
        const url = String(input);
        if (url === "/cart.js") {
          return new Response(
            JSON.stringify({
              currency: "KES",
              item_count: 0,
              total_price: 0,
              total_discount: 0,
              items: [],
            }),
            { status: 200 },
          );
        }
        if (url === "/apps/aovboost/chat") {
          return new Response(
            `data: ${JSON.stringify({
              delta: "Choose your preferred options.",
              productCards: [
                {
                  productId: "gid://shopify/Product/2",
                  title: "Hiking Hoodie",
                  handle: "hiking-hoodie",
                  variantId: "",
                  imageUrl: "https://cdn.example.test/hoodie.jpg",
                  price: "KSh8,000.00",
                  variants: [
                    {
                      id: "gid://shopify/ProductVariant/21",
                      title: "Red / Small",
                      price: "KSh8,000.00",
                      selectedOptions: [
                        { name: "Color", value: "Red" },
                        { name: "Size", value: "Small" },
                      ],
                    },
                    {
                      id: "gid://shopify/ProductVariant/22",
                      title: "Blue / Medium",
                      price: "KSh8,500.00",
                      selectedOptions: [
                        { name: "Color", value: "Blue" },
                        { name: "Size", value: "Medium" },
                      ],
                    },
                  ],
                },
              ],
            })}\n\ndata: [DONE]\n\n`,
            { status: 200 },
          );
        }
        if (url === "/cart/add.js") {
          return new Response(JSON.stringify({ id: 22 }), { status: 200 });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const widget = new ChatWidget({ copy: { greeting: "Hello" } });
    widget.mount();
    const root = document.querySelector(
      "[data-aovboost-widget='chat']",
    )?.shadowRoot;
    (root?.querySelector("[data-expand]") as HTMLButtonElement).click();
    const input = root?.querySelector("[data-input]") as HTMLInputElement;
    input.value = "Add the hiking hoodie";
    (root?.querySelector("[data-send]") as HTMLButtonElement).click();

    await vi.waitFor(() => {
      expect(root?.querySelectorAll("[data-chat-option]")).toHaveLength(4);
    });
    const addButton = root?.querySelector(
      "[data-chat-add]",
    ) as HTMLButtonElement;
    expect(addButton.disabled).toBe(true);
    const chips = Array.from(
      root?.querySelectorAll("[data-chat-option]") || [],
    ) as HTMLButtonElement[];
    chips.find((chip) => chip.dataset.optionValue === "Blue")?.click();
    chips.find((chip) => chip.dataset.optionValue === "Medium")?.click();

    expect(addButton.disabled).toBe(false);
    expect(addButton.dataset.chatAdd).toBe("gid://shopify/ProductVariant/22");
    expect(root?.querySelector("[data-product-price]")?.textContent).toBe(
      "KSh8,500.00",
    );
    addButton.click();

    await vi.waitFor(() => {
      expect(root?.querySelector("[data-cart-confirmation]")?.textContent).toBe(
        "Added to your cart.",
      );
    });
    const addCall = fetchMock.mock.calls.find(
      ([url]) => String(url) === "/cart/add.js",
    );
    expect(JSON.parse(String(addCall?.[1]?.body))).toMatchObject({
      id: "22",
      quantity: 1,
    });
  });
});
