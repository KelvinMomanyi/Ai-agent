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
      moneyFormat: "KSh{{amount}}",
      storefrontContext: {
        pageType: "home",
        path: "/",
        productId: "",
        productHandle: "",
      },
    });
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
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            `data: ${JSON.stringify({ delta: '<img src=x onerror="alert(1)">' })}\n\ndata: [DONE]\n\n`,
            { status: 200 },
          ),
        ),
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
});
