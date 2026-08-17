import { describe, expect, it } from "vitest";
import {
  buildGeneratedCatalogBundlePayload,
  buildHeuristicOfferDecision,
} from "./decisionEngine.server";
import type { DecisionInput } from "./types";

describe("revenue widget routing", () => {
  it("keeps the assistant available through its own bootstrap trigger", () => {
    expect(
      decision({ trigger: trigger("assistant_bootstrap") }).widgetType,
    ).toBe("chat");
  });

  it("shows a catalog-backed complementary bundle on product pages", () => {
    expect(
      decision({
        currentPageType: "product",
        currentProductId: "gid://shopify/Product/1",
        trigger: trigger("initial"),
      }).widgetType,
    ).toBe("bundle");
  });

  it("prioritizes an upsell drawer after a live cart addition", () => {
    expect(
      decision({
        currentPageType: "product",
        cartProductIds: ["gid://shopify/Product/1"],
        cartItemCount: 1,
        trigger: trigger("cart_item_added", { cartValue: 80 }),
      }).widgetType,
    ).toBe("upsell_drawer");
  });

  it("builds a no-fake-discount bundle from verified catalog products", () => {
    const source = catalogProduct("1", "Trail Board");
    const complement = catalogProduct("2", "Trail Pack");
    const payload = buildGeneratedCatalogBundlePayload(
      {},
      {
        sourceProduct: source,
        currentProductId: source.id,
        affinities: [
          {
            targetId: complement.id,
            target: complement,
            reason: "Same catalog category.",
          },
        ],
      },
    );

    expect(payload).toMatchObject({
      bundle: {
        discountType: "none",
        discountValue: "0",
        generatedFromCatalog: true,
      },
      currentProductId: source.id,
    });
    expect((payload as any).products.map((item: any) => item.productId)).toEqual(
      [source.id, complement.id],
    );
  });

  it("requires a verified future end time for countdown urgency", () => {
    expect(
      decision({
        trigger: trigger("flash_sale_window", {
          endsAt: "not-a-campaign-date",
        }),
      }).widgetType,
    ).toBeNull();
  });

  it("shows social proof only when store order data supports it", () => {
    const candidate = {
      id: "gid://shopify/Product/2",
      type: "product",
      widgetType: "social_proof",
      productId: "gid://shopify/Product/2",
      title: "Verified Add-on",
      score: 0.8,
      payload: { affinity: { orderCount: 12 } },
    };
    expect(
      decision({
        currentPageType: "product",
        trigger: trigger("social_proof"),
        candidates: [candidate],
      }).widgetType,
    ).toBe("social_proof");
    expect(
      decision({
        currentPageType: "product",
        trigger: trigger("social_proof"),
        candidates: [
          { ...candidate, payload: { affinity: { orderCount: 0 } } },
        ],
      }).widgetType,
    ).toBeNull();
  });
});

function decision(overrides: Partial<DecisionInput> = {}) {
  return buildHeuristicOfferDecision(
    {
      shop: "example.myshopify.com",
      session: {
        id: "session-1",
        anonymousId: "session-1",
        journeyStage: "discovering",
        intentScore: 20,
        hesitationScore: 0,
        viewedProductIds: [],
        cartProductIds: [],
        chatEngaged: false,
        totalPageViews: 1,
        sessionDuration: 10,
        context: {},
      },
      currentPageType: "home",
      cartProductIds: [],
      cartVariantIds: [],
      cartItemCount: 0,
      recentlyDismissedWidgets: [],
      settings: {
        chatEnabled: true,
        chatGreeting: "How can I help?",
        bundlesEnabled: true,
        upsellEnabled: true,
        discountNudgeEnabled: true,
        discountThreshold: 100,
        exitIntentEnabled: true,
        postPurchaseEnabled: true,
      } as any,
      candidates: [
        {
          id: "gid://shopify/Product/2",
          type: "product",
          widgetType: "rec_strip",
          productId: "gid://shopify/Product/2",
          title: "Verified Add-on",
          score: 0.8,
          payload: {},
        },
      ],
      trigger: trigger("initial"),
      ...overrides,
    },
    0,
  );
}

function trigger(type: string, payload: Record<string, unknown> = {}) {
  return { type, payload };
}

function catalogProduct(id: string, title: string) {
  const productId = `gid://shopify/Product/${id}`;
  const variantId = `gid://shopify/ProductVariant/${id}1`;
  const variant = {
    id: variantId,
    title: "Default",
    sku: "",
    price: "20.00",
    compareAtPrice: null,
    quantityAvailable: 10,
    availableForSale: true,
    selectedOptions: [],
  };
  return {
    id: productId,
    handle: title.toLowerCase().replace(/\s+/g, "-"),
    title,
    name: title,
    description: "",
    vendor: "",
    productType: "Accessories",
    category: "Accessories",
    tags: ["trail"],
    price: "20.00",
    compareAtPrice: null,
    priceRegular: "20.00",
    priceSale: null,
    image: null,
    imageUrl: null,
    imageAlt: title,
    inventory: 10,
    availableForSale: true,
    defaultVariantId: variantId,
    variants: [variant],
    searchText: title.toLowerCase(),
    metafields: {
      "aovboost.availableForSale": { value: "true", type: "boolean" },
      "aovboost.defaultVariantId": {
        value: variantId,
        type: "single_line_text_field",
      },
      "aovboost.variants": [variant],
    },
  };
}
