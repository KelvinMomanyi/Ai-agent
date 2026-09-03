import { describe, expect, it } from "vitest";
import type {
  CatalogCacheProduct,
  CatalogSnapshot,
} from "../models/catalogCache.server";
import type { GroundedCartContext } from "../models/chatResponse";
import type { StoreKnowledge } from "../models/storeKnowledge.server";
import { createCommerceToolLayer } from "./commerceTools.server";
import {
  calculateHesitationScore,
  calculatePurchaseIntent,
} from "./intentScoring";
import { classifyObjection } from "./objectionEngine";
import { evaluateProactiveMessage } from "./proactiveEngine";
import { rankProductRecommendations } from "./recommendationEngine";
import { determineSalesState } from "./salesStateMachine";
import {
  emptyShopperProfile,
  extractProfileUpdates,
  mergeShopperProfile,
} from "./shopperProfile";
import type { MerchantSalesSettings } from "./types";
import { rankUpsells } from "./upsellEngine";

describe("AI sales control modules", () => {
  it("extracts and merges structured shopper memory without losing earlier facts", () => {
    const first = mergeShopperProfile(
      emptyShopperProfile(),
      extractProfileUpdates(
        "I'm looking for comfortable black running shoes under KSh 5,000 in size 43 for a race this week.",
      ),
    );
    const second = mergeShopperProfile(
      first,
      extractProfileUpdates("They are for myself and durability matters too."),
    );

    expect(second.budgetMax).toBe(5000);
    expect(second.budgetCurrency).toBe("KES");
    expect(second.preferredColors).toContain("black");
    expect(second.preferredSizes).toContain("43");
    expect(second.preferences).toEqual(
      expect.arrayContaining(["comfortable", "durability"]),
    );
    expect(second.recipient).toBe("self");
  });

  it("scores high-value behavior with diminishing returns and hesitation penalties", () => {
    const profile = mergeShopperProfile(emptyShopperProfile(), {
      need: "daily running shoes",
      budgetMax: 120,
    });
    const intent = calculatePurchaseIntent({
      eventCounts: {
        page_view: 4,
        product_viewed: 3,
        variant_selected: 1,
        cart_opened: 1,
        add_to_cart: 1,
        shipping_policy: 1,
      },
      productsViewed: 2,
      repeatedProducts: 1,
      cartItemCount: 1,
      sessionDurationSeconds: 180,
      checkoutStarted: false,
      profile,
    });
    const hesitation = calculateHesitationScore({
      intentScore: intent,
      eventCounts: { cart_closed: 1, remove_from_cart: 1, idle: 1 },
      repeatedProducts: 1,
      cartItemCount: 1,
      sessionDurationSeconds: 180,
      currentObjection: "PRICE",
    });

    expect(intent).toBeGreaterThan(70);
    expect(hesitation).toBeGreaterThanOrEqual(55);
  });

  it("uses deterministic state transitions and stops selling after purchase", () => {
    const profile = mergeShopperProfile(emptyShopperProfile(), {
      need: "running shoes",
    });
    expect(
      determineSalesState({
        currentState: "DISCOVERY",
        intentScore: 64,
        hesitationScore: 10,
        cartItemCount: 0,
        productsViewed: 3,
        recommendationsShown: 1,
        recommendationsClicked: 1,
        recommendationsAccepted: 0,
        customerMessageCount: 2,
        checkoutStarted: false,
        purchaseCompleted: false,
        cartAbandoned: false,
        objection: null,
        profile,
      }),
    ).toBe("CONSIDERATION");
    expect(
      determineSalesState({
        currentState: "CHECKOUT",
        intentScore: 100,
        hesitationScore: 0,
        cartItemCount: 2,
        productsViewed: 3,
        recommendationsShown: 1,
        recommendationsClicked: 1,
        recommendationsAccepted: 1,
        customerMessageCount: 2,
        checkoutStarted: true,
        purchaseCompleted: true,
        cartAbandoned: false,
        objection: null,
        profile,
      }),
    ).toBe("PURCHASED");
  });

  it("ranks for fit first and filters unavailable, over-budget, and rejected products", () => {
    const profile = mergeShopperProfile(emptyShopperProfile(), {
      need: "daily running shoes",
      intendedUse: "daily running",
      budgetMax: 100,
      preferredColors: ["black"],
      preferredSizes: ["43"],
      preferences: ["comfort"],
    });
    const best = product("best", "Daily Comfort Runner", 90, [
      "running",
      "comfort",
    ]);
    const value = product("value", "Value Runner", 70, ["running"]);
    const unavailable = product(
      "sold",
      "Comfort Runner Pro",
      80,
      ["running", "comfort"],
      false,
    );
    const premium = product("premium", "Premium Runner", 140, [
      "running",
      "comfort",
    ]);
    const results = rankProductRecommendations({
      products: [value, unavailable, premium, best],
      query: "comfortable shoes for daily running",
      profile,
      settings,
      rejectedProductIds: [value.id],
    });

    expect(results[0].product.id).toBe(best.id);
    expect(results.map((result) => result.product.id)).not.toContain(
      unavailable.id,
    );
    expect(results.map((result) => result.product.id)).not.toContain(
      premium.id,
    );
    expect(results[0].reasons).toEqual(
      expect.arrayContaining(["Within your budget", "Available in black"]),
    );
  });

  it("returns at most one compatible upsell and never repeats a rejected one", () => {
    const shoe = product("shoe", "Daily Runner", 90, ["running"]);
    const socks = product("socks", "Running Socks", 15, ["running", "socks"]);
    const profile = mergeShopperProfile(
      emptyShopperProfile(),
      {},
      {
        purchaseIntentScore: 82,
      },
    );
    const input = {
      products: [shoe, socks],
      affinities: [
        {
          sourceId: shoe.id,
          targetId: socks.id,
          score: 0.9,
          orderCount: 30,
          reason: "Useful for longer runs",
        },
      ],
      cartProductIds: [shoe.id],
      profile,
      settings,
      cartValue: 90,
    };

    expect(rankUpsells({ ...input, rejectedProductIds: [] })).toHaveLength(1);
    expect(
      rankUpsells({ ...input, rejectedProductIds: [socks.id] }),
    ).toHaveLength(0);
  });

  it("classifies common objections and enforces proactive dismissal and cooldowns", () => {
    expect(classifyObjection("That is too expensive for me")).toBe("PRICE");
    expect(classifyObjection("Will it work with my phone?")).toBe(
      "COMPATIBILITY",
    );
    const base = {
      triggerType: "long_product_dwell",
      pageType: "product",
      dwellSeconds: 20,
      scrollDepth: 50,
      intentScore: 35,
      hesitationScore: 0,
      salesState: "INTEREST" as const,
      promptCount: 0,
      dismissed: false,
      settings,
      now: 1_000_000,
    };
    expect(evaluateProactiveMessage(base).allowed).toBe(true);
    expect(evaluateProactiveMessage({ ...base, dismissed: true }).reason).toBe(
      "shopper_dismissed",
    );
    expect(
      evaluateProactiveMessage({ ...base, lastPromptAt: 999_000 }).reason,
    ).toBe("cooldown_active");
  });

  it("validates cart mutations against the allowlisted catalog and explicit consent", () => {
    const item = product("best", "Daily Comfort Runner", 90, ["running"]);
    const catalog: CatalogSnapshot = {
      shop: "example.myshopify.com",
      refreshedAt: new Date().toISOString(),
      productCount: 1,
      products: [item],
      byId: { [item.id]: item },
      byCategory: {},
      byTag: {},
    };
    const tools = createCommerceToolLayer({
      shop: catalog.shop,
      catalog,
      cart,
      store,
      settings,
    });
    const action = {
      productId: item.id,
      variantId: item.variants[0].id,
      quantity: 2,
    };

    expect(
      tools.validateAddToCart(action, { explicitlyRequested: false }),
    ).toBeNull();
    expect(
      tools.validateAddToCart(
        { ...action, variantId: "gid://shopify/ProductVariant/missing" },
        { explicitlyRequested: true },
      ),
    ).toBeNull();
    expect(
      tools.validateAddToCart(action, { explicitlyRequested: true }),
    ).toEqual(
      expect.objectContaining({ variantId: item.variants[0].id, quantity: 2 }),
    );
  });
});

const settings: MerchantSalesSettings = {
  agentEnabled: true,
  proactiveMessagesEnabled: true,
  proactiveDelaySeconds: 15,
  maxProactivePrompts: 2,
  maxProductRecommendations: 3,
  excludedProductIds: [],
  excludedCollectionIds: [],
  preferredProductIds: [],
  upsellPriorityProductIds: [],
  discountPermission: false,
  allowedDiscountCodes: [],
  bundleSupportEnabled: true,
  minimumProactiveConfidence: 0.65,
  minimumUpsellIntentScore: 55,
  hesitationDetectionEnabled: true,
  analyticsEnabled: true,
};

const cart: GroundedCartContext = {
  status: "loaded",
  currencyCode: "USD",
  itemCount: 0,
  subtotalPrice: 0,
  totalPrice: 0,
  totalDiscount: 0,
  discounts: [],
  items: [],
};

const store: StoreKnowledge = {
  shop: "example.myshopify.com",
  name: "Example",
  description: "",
  primaryDomain: "example.myshopify.com",
  primaryUrl: "https://example.myshopify.com",
  contactEmail: "",
  currencyCode: "USD",
  moneyFormat: "",
  moneyWithCurrencyFormat: "",
  shipsToCountries: [],
  policies: [],
  refreshedAt: new Date().toISOString(),
  source: "shop_domain_fallback",
};

function product(
  key: string,
  title: string,
  price: number,
  tags: string[],
  availableForSale = true,
): CatalogCacheProduct {
  const id = `gid://shopify/Product/${key}`;
  const variantId = `gid://shopify/ProductVariant/${key}`;
  return {
    id,
    handle: key,
    title,
    name: title,
    description: `${title} for daily use`,
    vendor: "Example",
    productType: "Shoes",
    category: "Shoes",
    collectionIds: [],
    tags,
    price: String(price),
    compareAtPrice: null,
    priceRegular: String(price),
    priceSale: null,
    image: null,
    imageUrl: null,
    imageAlt: title,
    inventory: availableForSale ? 10 : 0,
    availableForSale,
    orderCount: key === "best" ? 25 : 4,
    defaultVariantId: variantId,
    variants: [
      {
        id: variantId,
        title: "Black / 43",
        sku: key,
        price: String(price),
        compareAtPrice: null,
        quantityAvailable: availableForSale ? 10 : 0,
        availableForSale,
        selectedOptions: [
          { name: "Color", value: "Black" },
          { name: "Size", value: "43" },
        ],
      },
    ],
    searchText: `${title} ${tags.join(" ")} black size 43`,
    metafields: {},
  };
}
