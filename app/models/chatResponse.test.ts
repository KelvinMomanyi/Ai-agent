import { describe, expect, it } from "vitest";
import type { CatalogCacheProduct } from "./catalogCache.server";
import {
  buildCartSummaryReply,
  buildCatalogFallbackReply,
  classifyMessageIntent,
  enforceReplyCurrency,
  findRequestedCartProduct,
  formatCartContextForPrompt,
  formatCatalogProductsForPrompt,
  formatPrice,
  getReplyProductCards,
  normalizeLiveCartContext,
  sanitizeMessageHistory,
  validateGroundedAiChatResponse,
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
    expect(classifyMessageIntent("Do you deliver to Uganda?")).toBe(
      "shipping_policy",
    );
    expect(classifyMessageIntent("Can I return this?")).toBe("returns_policy");
    expect(classifyMessageIntent("Do you stock a trail board?")).toBe(
      "product_availability",
    );
    expect(classifyMessageIntent("What is the total cost in my cart?")).toBe(
      "cart_summary",
    );
    expect(classifyMessageIntent("Is my bag empty?")).toBe("cart_summary");
    expect(classifyMessageIntent("Hello there")).toBe("general");
  });

  it("grounds live cart contents, quantities, variants, and totals", () => {
    const cart = normalizeLiveCartContext(
      {
        status: "loaded",
        currency: "KES",
        itemCount: 2,
        totalPrice: 898,
        totalDiscount: 100,
        items: [
          {
            productId: "1",
            variantId: "11",
            quantity: 2,
            title: "Tampered title",
            variantTitle: "Default Title",
            handle: "trail-board",
            finalUnitPrice: 449,
            originalUnitPrice: 499,
            finalLinePrice: 898,
            originalLinePrice: 998,
          },
        ],
      },
      [product()],
    );

    expect(cart).toMatchObject({
      status: "loaded",
      currencyCode: "KES",
      itemCount: 2,
      totalPrice: 898,
      totalDiscount: 100,
      items: [
        {
          productId: "gid://shopify/Product/1",
          variantId: "gid://shopify/ProductVariant/11",
          title: "Trail Board",
          variantTitle: "",
          quantity: 2,
        },
      ],
    });
    const reply = buildCartSummaryReply(cart, kes);
    expect(reply).toContain("2 items");
    expect(reply).toContain("current total of KSh898.00");
    expect(reply).toContain("saving KSh100.00");
    expect(reply).toContain("2 × Trail Board — KSh898.00");
    expect(reply).not.toContain("Tampered title");
  });

  it("never turns an unavailable cart read into a false empty answer", () => {
    const cart = normalizeLiveCartContext(
      { status: "unavailable", items: [] },
      [product()],
    );
    expect(buildCartSummaryReply(cart, kes)).toContain("won’t guess");
    expect(buildCartSummaryReply(cart, kes)).not.toContain("currently empty");
    expect(formatCartContextForPrompt(cart, kes)).toContain(
      "Do not say it is empty",
    );
  });

  it("keeps Shopify cart-only items out of the recommendation catalog", () => {
    const cart = normalizeLiveCartContext(
      {
        status: "loaded",
        currency: "KES",
        itemCount: 1,
        totalPrice: 250,
        items: [
          {
            productId: "gid://shopify/Product/999",
            variantId: "gid://shopify/ProductVariant/9991",
            quantity: 1,
            title: "Archived Store Item",
            handle: "trail-board",
            finalLinePrice: 250,
          },
        ],
      },
      [product()],
    );

    expect(cart.items[0].product).toBeNull();
    expect(formatCartContextForPrompt(cart, kes)).toContain(
      "not eligible for recommendation or productIds",
    );
    expect(buildCartSummaryReply(cart, kes)).toContain("Archived Store Item");
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

  it("does not recommend unrelated products when no catalog item matches", () => {
    expect(
      buildCatalogFallbackReply(
        "Do you sell espresso machines?",
        [product()],
        [],
        "product_availability",
        kes,
      ),
    ).toContain("couldn’t find an exact match");

    expect(
      buildCatalogFallbackReply(
        "Do you sell waterproof socks?",
        [
          product({
            description: "A waterproof board for trail riding",
          }),
        ],
        [],
        "product_availability",
        kes,
      ),
    ).toContain("couldn’t find an exact match");
  });

  it("validates model product IDs and renders product facts canonically", () => {
    const catalog = [product()];
    const validated = validateGroundedAiChatResponse({
      value: {
        reply: "This is the closest verified match for trail riding.",
        productIds: ["gid://shopify/Product/1"],
        followUpQuestion: "Would you like help comparing its options?",
      },
      catalog,
      fallback: "fallback",
      currency: kes,
    });

    expect(validated.fallbackUsed).toBe(false);
    expect(validated.reply).toContain(
      "Trail Board (KSh499.00) /products/trail-board",
    );
    expect(validated.products).toEqual(catalog);

    expect(
      validateGroundedAiChatResponse({
        value: {
          reply: "Try this imaginary item.",
          productIds: ["gid://shopify/Product/999"],
        },
        catalog,
        fallback: "fallback",
        currency: kes,
      }),
    ).toEqual({ reply: "fallback", products: [], fallbackUsed: true });
  });

  it("gives the model exact descriptions, variants, and currency context", () => {
    const prompt = formatCatalogProductsForPrompt([product()], kes);
    expect(prompt).toContain("ID: gid://shopify/Product/1");
    expect(prompt).toContain("Verified description: A board for trail riding");
    expect(prompt).toContain("Current price: KSh499.00");
    expect(prompt).toContain("Availability: sellable now");
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
