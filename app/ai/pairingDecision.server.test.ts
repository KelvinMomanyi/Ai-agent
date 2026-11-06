import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DecisionInput } from "./types";
const mocks = vi.hoisted(() => ({
  catalog: vi.fn(),
  copy: vi.fn(),
  ai: vi.fn(),
}));
vi.mock("../models/catalogCache.server", () => ({
  getRecommendationCatalog: mocks.catalog,
  getCatalogProductsByIds: vi.fn(),
}));
vi.mock("./copyWriter.server", () => ({ generateWidgetCopy: mocks.copy }));
vi.mock("./client.server", () => ({
  callAI: mocks.ai,
  parseAiJson: (raw: string) => JSON.parse(raw),
}));
import { getOfferDecision } from "./decisionEngine.server";

function product(id: number) {
  return {
    id: `gid://shopify/Product/${id}`,
    title: `Product ${id}`,
    handle: `product-${id}`,
    price: "12.00",
    tags: [],
    variants: [
      {
        id: `gid://shopify/ProductVariant/${id + 100}`,
        title: "Default",
        price: "12.00",
        availableForSale: true,
        selectedOptions: [],
      },
    ],
    metafields: {
      "aovboost.defaultVariantId": {
        value: `gid://shopify/ProductVariant/${id + 100}`,
      },
      "aovboost.availableForSale": { value: "true" },
    },
  };
}
function input(): DecisionInput {
  const target = product(3);
  return {
    shop: "one.myshopify.com",
    currentProductId: product(1).id,
    currentPageType: "product",
    cartProductIds: [product(1).id],
    cartItemCount: 1,
    recentlyDismissedWidgets: [],
    trigger: { type: "cart_item_added", payload: { productId: product(1).id } },
    session: {
      id: "session",
      anonymousId: "session",
      journeyStage: "buying",
      intentScore: 80,
      hesitationScore: 0,
      viewedProductIds: [],
      cartProductIds: [product(1).id],
      chatEngaged: false,
      totalPageViews: 1,
      sessionDuration: 10,
      context: {},
    },
    settings: {
      chatEnabled: false,
      bundlesEnabled: false,
      upsellEnabled: true,
      discountNudgeEnabled: false,
      exitIntentEnabled: false,
      postPurchaseEnabled: false,
      blockedProductIds: [],
      discountThreshold: 50,
    } as unknown as DecisionInput["settings"],
    candidates: [
      {
        id: target.id,
        productId: target.id,
        type: "product",
        widgetType: "upsell_drawer",
        title: target.title,
        score: 0.99,
        payload: {
          product: target,
          affinity: { reason: "The merchant approved this pairing." },
        },
      },
    ],
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  const products = [product(1), product(2)];
  mocks.catalog.mockResolvedValue({
    products,
    byId: Object.fromEntries(products.map((p) => [p.id, p])),
    productCount: products.length,
    refreshedAt: new Date().toISOString(),
  });
  mocks.copy.mockResolvedValue({ headline: "You may also like" });
});

describe("pairing candidates control rendered decisions", () => {
  it("renders the selected approved target and reason instead of rebuilding the hot catalog order", async () => {
    const result = await getOfferDecision(input());
    expect(result.widgetType).toBe("upsell_drawer");
    expect((result.payload.products as any[]).map((p) => p.productId)).toEqual([
      product(3).id,
    ]);
    expect((result.payload.products as any[])[0].reason).toBe(
      "The merchant approved this pairing.",
    );
    expect(mocks.ai).not.toHaveBeenCalled();
    expect(mocks.copy.mock.calls[0][4].useAI).toBe(false);
  });
  it("uses the same approved complement when building a product-page catalog bundle", async () => {
    const value = input();
    value.cartProductIds = [];
    value.cartItemCount = 0;
    value.session.cartProductIds = [];
    value.session.journeyStage = "discovering";
    value.trigger = { type: "initial" };
    value.settings.bundlesEnabled = true;
    const result = await getOfferDecision(value);
    expect(result.widgetType).toBe("bundle");
    expect((result.payload.products as any[]).map((p) => p.productId)).toEqual([
      product(1).id,
      product(3).id,
    ]);
    expect(mocks.copy.mock.calls[0][4].useAI).toBe(false);
    expect(mocks.ai).not.toHaveBeenCalled();
  });
});
