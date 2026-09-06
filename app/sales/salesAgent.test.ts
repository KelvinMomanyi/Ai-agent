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
import {
  applyGroundedProfileUpdates,
  executeSalesReadTools,
  parseSalesAgentResponse,
  requestedQuantity,
  salesAllowsRecommendations,
} from "./agentOrchestrator.server";
import { resolveSalesCartIntent } from "./cartIntent";
import { resolveCartLineIntent } from "./cartLineIntent";

describe("AI sales control modules", () => {
  it("keeps budgets, sizes and preference corrections separate", () => {
    expect(
      extractProfileUpdates("My budget is under 100").preferredSizes,
    ).toBeUndefined();
    expect(
      extractProfileUpdates("Size 43 with a budget under 5000"),
    ).toMatchObject({ budgetMax: 5000, preferredSizes: ["43"] });
    expect(
      extractProfileUpdates("Budget between KES 2,000 and 5,000"),
    ).toMatchObject({ budgetMin: 2000, budgetMax: 5000 });
    const old = mergeShopperProfile(null, {
      preferredColors: ["black"],
      budgetMax: 100,
    });
    expect(
      mergeShopperProfile(
        old,
        extractProfileUpdates("Actually blue instead of black"),
      ).preferredColors,
    ).toEqual(["blue"]);
    expect(
      mergeShopperProfile(old, extractProfileUpdates("No budget limit"))
        .budgetMax,
    ).toBeNull();
  });

  it("never ranks an unrelated, rejected or excluded collection product", () => {
    const item = product("best", "Daily Running Shoes", 90, ["running"]);
    const input = {
      products: [item],
      query: "refrigerator",
      profile: emptyShopperProfile(),
      settings,
    };
    expect(rankProductRecommendations(input)).toEqual([]);
    expect(
      rankProductRecommendations({
        ...input,
        query: "running",
        rejectedProductIds: [item.id],
      }),
    ).toEqual([]);
    expect(
      rankProductRecommendations({
        ...input,
        query: "running",
        products: [{ ...item, collectionIds: ["blocked"] }],
        settings: { ...settings, excludedCollectionIds: ["blocked"] },
      }),
    ).toEqual([]);
  });

  it("uses the selected variant price and treats preference options as alternatives", () => {
    const item = product("best", "Running Shoes", 50, ["running"]);
    item.variants[0].price = "120";
    const profile = mergeShopperProfile(null, {
      budgetMax: 100,
      preferredColors: ["black", "blue"],
    });
    expect(
      rankProductRecommendations({
        products: [item],
        query: "running",
        profile,
        settings,
      }),
    ).toEqual([]);
    item.variants[0].price = "90";
    const ranked = rankProductRecommendations({
      products: [item],
      query: "running",
      profile,
      settings,
    });
    expect(ranked[0].product.price).toBe("90");
    expect(ranked[0].recommendedVariantId).toBe(item.variants[0].id);
    expect(
      rankProductRecommendations({
        products: [item],
        query: "running",
        profile: { ...profile, budgetCurrency: "KES" },
        currencyCode: "USD",
        settings,
      }),
    ).toEqual([]);
  });

  it("validates structured responses and accepts only grounded memory", () => {
    expect(
      parseSalesAgentResponse({
        message: "Hello",
        toolCalls: [
          { name: "execute_sql", arguments: { query: "DROP TABLE" } },
        ],
      }),
    ).toBeNull();
    expect(
      parseSalesAgentResponse({
        message: "Hello",
        action: {
          type: "add_to_cart",
          productId: "p",
          variantId: "v",
          quantity: 1.5,
        },
      }),
    ).toBeNull();
    expect(
      parseSalesAgentResponse({
        message: "Hello",
        toolCalls: [{ name: "get_cart", arguments: {} }],
      }),
    ).not.toBeNull();
    const profile = applyGroundedProfileUpdates(
      emptyShopperProfile(),
      { budgetMax: 1, need: "luxury watches", intendedUse: "daily running" },
      "I need shoes for daily running, budget under 100",
    );
    expect(profile.budgetMax).toBe(100);
    expect(profile.need).not.toBe("luxury watches");
    expect(profile.intendedUse).toBe("daily running, budget under 100");
    expect(salesAllowsRecommendations("PURCHASED")).toBe(false);
    expect(salesAllowsRecommendations("CHECKOUT")).toBe(false);
  });

  it("executes bounded read tools without accepting invented IDs or mutations", () => {
    const item = product("best", "Daily Runner", 90, ["running"]);
    const tools = createCommerceToolLayer({
      shop: store.shop,
      catalog: {
        shop: store.shop,
        refreshedAt: "",
        productCount: 1,
        products: [item],
        byId: { [item.id]: item },
        byCategory: {},
        byTag: {},
      },
      cart,
      store,
      settings,
    });
    expect(
      executeSalesReadTools(
        [{ name: "get_product", arguments: { productId: item.id } }],
        tools,
      )[0],
    ).toMatchObject({ name: "get_product", result: { id: item.id } });
    expect(
      executeSalesReadTools(
        [
          {
            name: "compare_products",
            arguments: { productIds: [item.id, "invented"] },
          },
        ],
        tools,
      )[0],
    ).toHaveProperty("error");
    expect(
      executeSalesReadTools(
        [{ name: "add_to_cart", arguments: { productId: item.id } }],
        tools,
      ),
    ).toEqual([]);
    for (const quantity of [0, -1, 1.5, NaN, Infinity, 11])
      expect(
        tools.validateAddToCart(
          { productId: item.id, variantId: item.variants[0].id, quantity },
          { explicitlyRequested: true },
        ),
      ).toBeNull();
  });

  it("keeps an explicitly requested quantity while asking for a missing size", () => {
    const item = product("best", "Running Shoes", 90, ["running"]);
    item.variants.push({
      ...item.variants[0],
      id: "gid://shopify/ProductVariant/second",
      title: "Black / 44",
      selectedOptions: [
        { name: "Color", value: "Black" },
        { name: "Size", value: "44" },
      ],
    });
    const first = resolveSalesCartIntent({
      message: "Put two in my cart",
      history: [
        { role: "assistant", content: "I'd start with Running Shoes." },
      ],
      products: [item],
      now: 1000,
    });
    expect(first?.quantity).toBe(2);
    expect(first?.pending).not.toBeNull();
    const next = resolveSalesCartIntent({
      message: "size 44",
      history: [],
      products: [item],
      pending: first?.pending,
      now: 2000,
    });
    expect(next?.quantity).toBe(2);
    expect(next?.variant?.id).toBe("gid://shopify/ProductVariant/second");
    expect(
      resolveSalesCartIntent({
        message: "Don't add it",
        history: [],
        products: [item],
        pending: first?.pending,
        now: 2000,
      }),
    ).toBeNull();
    expect(
      resolveSalesCartIntent({
        message: "44",
        history: [],
        products: [item],
        pending: first?.pending,
        now: 900000,
      }),
    ).toBeNull();
    expect(requestedQuantity("Add 20 to my cart")).toBeNull();
  });

  it("resolves only explicit, unambiguous cart line changes", () => {
    const populated = {
      ...cart,
      items: [
        {
          lineId: "line-key",
          product: null,
          productId: "p",
          variantId: "v",
          title: "Runner",
          variantTitle: "Black",
          handle: "runner",
          quantity: 2,
          finalUnitPrice: 90,
          originalUnitPrice: 90,
          finalLinePrice: 180,
          originalLinePrice: 180,
        },
      ],
    };
    expect(
      resolveCartLineIntent("Remove Runner from my cart", populated)?.action,
    ).toMatchObject({
      type: "remove_from_cart",
      expectedQuantity: 2,
      quantity: 0,
    });
    expect(
      resolveCartLineIntent("Change Runner quantity to 3", populated)?.action,
    ).toMatchObject({ type: "update_cart_line", quantity: 3 });
    expect(resolveCartLineIntent("Don't remove Runner", populated)).toBeNull();
    expect(
      resolveCartLineIntent("Remove it", {
        ...populated,
        items: [...populated.items, ...populated.items],
      })?.action,
    ).toBeUndefined();
  });

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
