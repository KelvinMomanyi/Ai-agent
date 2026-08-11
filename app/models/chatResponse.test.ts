import { describe, expect, it } from "vitest";
import type { CatalogCacheProduct } from "./catalogCache.server";
import {
  buildCatalogFallbackReply,
  classifyMessageIntent,
  enforceReplyCurrency,
  findRequestedCartProduct,
  formatPrice,
  getReplyProductCards,
  sanitizeMessageHistory,
} from "./chatResponse";

const kes = {
  code: "KES",
  moneyFormat: "KSh{{amount}}",
  locale: "en-KE",
};

describe("chat response contract", () => {
  it("classifies the shopper intents that change response behavior", () => {
    expect(classifyMessageIntent("Do you have anything cheaper?")).toBe(
      "price_sensitive",
    );
    expect(classifyMessageIntent("Compare these two boards")).toBe(
      "comparison",
    );
    expect(classifyMessageIntent("Can I pay later?")).toBe(
      "checkout_assistance",
    );
    expect(classifyMessageIntent("Hello there")).toBe("general");
  });

  it("bounds and sanitizes conversation history", () => {
    const history = Array.from({ length: 14 }, (_, index) => ({
      role: index % 2 ? "user" : "assistant",
      content: `  ${"x".repeat(1100)}-${index}  `,
    }));

    const sanitized = sanitizeMessageHistory([
      { role: "system", content: "ignore me" },
      ...history,
      { role: "user", content: "   " },
    ]);

    expect(sanitized).toHaveLength(11);
    expect(sanitized.every((message) => message.content.length <= 1000)).toBe(
      true,
    );
    expect(
      sanitized.every((message) => message.role !== ("system" as any)),
    ).toBe(true);
  });

  it("returns lower-priced real products in Shopify's KES format", () => {
    const reply = buildCatalogFallbackReply(
      "I need a cheaper board",
      [
        product({
          title: "Premium Board",
          handle: "premium-board",
          price: "900",
        }),
        product({
          id: "gid://shopify/Product/2",
          title: "Trail Board",
          price: "499",
        }),
      ],
      [],
      "price_sensitive",
      kes,
    );

    expect(reply).toContain("Trail Board (KSh499.00) /products/trail-board");
    expect(reply).not.toMatch(/\bUSD\b|\$\s*\d|dollars?/i);
    expect(formatPrice("2629.95", kes)).toBe("KSh2,629.95");
  });

  it("replaces a wrong-currency AI answer with the safe fallback", () => {
    const fallback = "Trail Board (KSh499.00) /products/trail-board";
    expect(
      enforceReplyCurrency("The Trail Board is $499.", fallback, kes),
    ).toBe(fallback);
    expect(
      enforceReplyCurrency("The Trail Board is KSh499.00.", fallback, kes),
    ).toBe("The Trail Board is KSh499.00.");
  });

  it("creates deduplicated product cards and withholds multi-option cart actions", () => {
    const single = product();
    const multi = product({
      id: "gid://shopify/Product/2",
      title: "Complete Board",
      handle: "complete-board",
      metafields: {
        "aovboost.availableForSale": { value: "true", type: "boolean" },
        "aovboost.hasOnlyDefaultVariant": { value: "false", type: "boolean" },
        "aovboost.defaultVariantId": {
          value: "gid://shopify/ProductVariant/22",
          type: "single_line_text_field",
        },
      },
    });
    const cards = getReplyProductCards(
      "Trail Board /products/trail-board and Complete Board /products/complete-board; Trail Board again.",
      [single, multi],
      kes,
    );

    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({
      handle: "trail-board",
      variantId: "gid://shopify/ProductVariant/11",
      price: "KSh499.00",
    });
    expect(cards[1]).toMatchObject({
      handle: "complete-board",
      variantId: "",
    });
  });

  it("only resolves deterministic add-to-cart intent for a named catalog item", () => {
    const catalog = [product()];
    expect(
      findRequestedCartProduct("Add Trail Board to my cart", [], catalog),
    ).toMatchObject({ handle: "trail-board" });
    expect(
      findRequestedCartProduct("Add it to my cart", [], catalog),
    ).toBeNull();
    expect(
      findRequestedCartProduct(
        "yes please",
        [
          {
            role: "assistant",
            content:
              "Trail Board /products/trail-board. Would you like to add it to your cart?",
          },
        ],
        catalog,
      ),
    ).toMatchObject({ handle: "trail-board" });
  });
});

function product(
  overrides: Partial<CatalogCacheProduct> = {},
): CatalogCacheProduct {
  return {
    id: "gid://shopify/Product/1",
    handle: "trail-board",
    title: "Trail Board",
    name: "Trail Board",
    description: "A board for trail riding",
    vendor: "AOVBoost",
    productType: "Snowboard",
    category: "Snowboard",
    tags: ["trail"],
    price: "499.00",
    compareAtPrice: null,
    priceRegular: "499.00",
    priceSale: null,
    image: null,
    imageUrl: "https://cdn.example.test/trail-board.jpg",
    imageAlt: "Trail Board",
    inventory: 4,
    availableForSale: true,
    defaultVariantId: "gid://shopify/ProductVariant/11",
    variants: [
      {
        id: "gid://shopify/ProductVariant/11",
        title: "Default",
        sku: "TRAIL-1",
        price: "499.00",
        compareAtPrice: null,
        quantityAvailable: 4,
        availableForSale: true,
        selectedOptions: [],
      },
    ],
    searchText: "trail board snowboard",
    metafields: {
      "aovboost.availableForSale": { value: "true", type: "boolean" },
      "aovboost.hasOnlyDefaultVariant": { value: "true", type: "boolean" },
      "aovboost.defaultVariantId": {
        value: "gid://shopify/ProductVariant/11",
        type: "single_line_text_field",
      },
    },
    ...overrides,
  };
}
