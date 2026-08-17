// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { EventBus } from "./eventBus";

describe("EventBus cart verification", () => {
  it("emits add_to_cart only after Shopify confirms a successful add", async () => {
    const recordEvent = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 422 }), {
          status: 422,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 202,
            product_id: 101,
            variant_id: 202,
            quantity: 1,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    window.fetch = fetchMock as typeof window.fetch;
    const bus = new EventBus({
      shop: "example.myshopify.com",
      sessionManager: {
        anonymousId: "session-1",
        recordEvent,
        getAuthPayload: () => ({ sessionToken: "token" }),
        getSignedAuthPayload: vi.fn().mockResolvedValue(null),
      } as any,
    });
    bus.init();

    await window.fetch("/cart/add.js", {
      method: "POST",
      body: JSON.stringify({ id: 202, quantity: 1 }),
    });
    await window.fetch("/cart/add.js", {
      method: "POST",
      body: JSON.stringify({ id: 202, quantity: 1 }),
    });

    await vi.waitFor(() => {
      expect(
        recordEvent.mock.calls.filter(([event]) => event.type === "add_to_cart"),
      ).toHaveLength(1);
    });
    expect(
      recordEvent.mock.calls.find(([event]) => event.type === "add_to_cart")?.[0],
    ).toMatchObject({
      productId: "gid://shopify/Product/101",
      variantId: "gid://shopify/ProductVariant/202",
      source: "verified_fetch_response",
    });
  });
});
