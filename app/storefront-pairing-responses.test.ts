import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import type { AppSettings } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  cache: vi.fn(),
  fresh: vi.fn(),
  relationships: vi.fn(),
  decision: vi.fn(),
  candidates: vi.fn(),
  createOffer: vi.fn(),
  auth: vi.fn(),
  publicSettings: vi.fn(),
  receipt: vi.fn(),
  shopperSession: vi.fn(),
  measurement: vi.fn(),
  entitlement: vi.fn(),
  usage: vi.fn(),
  reserve: vi.fn(),
}));
vi.mock("./db.server", () => ({
  default: {
    recommendationOutcome: { findMany: async () => [] },
    product: {
      findFirst: async ({ where }: any) => ({
        id: where.id,
        title: "Shampoo",
        productType: "Shampoo",
        vendor: "Brand",
        tags: [],
        collectionIds: [],
        price: "20",
        metafields: {},
      }),
      aggregate: async () => ({
        _max: { updatedAt: "2026-11-05" },
        _count: { _all: 2 },
      }),
    },
    productRelationship: { findMany: mocks.relationships },
    productAffinity: { findMany: async () => [] },
    experiment: { findFirst: async () => null },
  },
}));
vi.mock("./jobs/pairingAutopilot.server", () => ({
  schedulePairingDrain: vi.fn(),
}));
vi.mock("./models/catalogCache.server", () => ({
  getCatalogProductsByIds: mocks.fresh,
}));
vi.mock("./ai/decisionEngine.server", () => ({
  getOfferDecision: mocks.decision,
}));
vi.mock("./models/offer.server", () => ({
  buildOfferCandidates: mocks.candidates,
  createOfferRecord: mocks.createOffer,
}));
vi.mock("./models/installedShop.server", () => ({
  isInstalledShop: async () => true,
}));
vi.mock("./models/productLookup.server", () => ({
  findProductIdsByVariants: async () => [],
}));
vi.mock("./models/session.server", () => ({
  getShopperSession: mocks.shopperSession,
  toShopperSessionSnapshot: (session: { id: string }) => ({
    id: session.id,
    anonymousId: session.id,
    journeyStage: "buying",
    salesState: "BUYING",
    cartProductIds: [],
    viewedProductIds: [],
    context: {},
    intentScore: 70,
    hesitationScore: 0,
    totalPageViews: 1,
    sessionDuration: 20,
    chatEngaged: false,
  }),
  upsertShopperSessionFromEvents: vi.fn(),
}));
vi.mock("./redis.server", () => ({
  getJsonCache: mocks.cache,
  setJsonCache: vi.fn(),
  incrementRateLimit: async () => 1,
  cacheKeys: {
    offerRateLimit: (id: string) => `rate:${id}`,
    liveRateLimit: (id: string) => `live:${id}`,
    offer: (_id: string, context: string) => `offer:${context}`,
    experiment: () => "experiment",
  },
  redis: { get: async () => "catalog-version" },
}));
vi.mock("./models/settings.server", async (original) => ({
  ...(await original<typeof import("./models/settings.server")>()),
  getPublicAppSettings: mocks.publicSettings,
}));
vi.mock("./models/onboarding.server", () => ({
  recordAuthenticatedStorefrontSession: mocks.receipt,
}));
vi.mock("./models/holdout.server", () => ({
  enrollHoldout: mocks.measurement,
}));
vi.mock("./models/entitlements.server", async (original) => ({
  ...(await original<typeof import("./models/entitlements.server")>()),
  getEntitlements: mocks.entitlement,
}));
vi.mock("./models/usage.server", () => ({
  getUsage: mocks.usage,
  reserveOfferDisplay: mocks.reserve,
}));
vi.mock("./models/liveEvents.server", () => ({
  LIVE_POLL_INTERVAL_MS: 7500,
  getPendingStorefrontLiveEvents: async () => [
    {
      id: "event",
      type: "low_inventory_alert",
      productId: "gid://shopify/Product/2",
      inventoryQuantity: 17,
    },
  ],
}));
vi.mock("./utils/storefrontAuth.server", async (original) => ({
  ...(await original<typeof import("./utils/storefrontAuth.server")>()),
  authenticateStorefrontRequest: mocks.auth,
  verifyAppProxyRequest: () => ({
    shop: "one.myshopify.com",
    customerId: null,
  }),
}));
import { action as offerAction } from "./routes/api.offer";
import { action as configAction } from "./routes/api.config";
import { action as liveAction } from "./routes/api.live";
import { loader as sessionLoader } from "./routes/api.session";
import { toPublicAppSettings } from "./models/settings.server";
import { stripPrivateSignals } from "./utils/storefrontPayload.server";

const shop = "one.myshopify.com",
  targetId = "gid://shopify/Product/2";
const privateKeys =
  /"(?:unitCost|unit_cost|costCurrency|margin|marginBand|inventory(?:Quantity|_quantity)?|quantityAvailable|sellableOnlineQuantity)"/i;
const settings = {
  shop,
  chatEnabled: true,
  bundlesEnabled: false,
  upsellEnabled: true,
  discountNudgeEnabled: false,
  discountThreshold: 50,
  exitIntentEnabled: false,
  postPurchaseEnabled: false,
  blockedProductIds: [],
  excludedCollectionIds: [],
  preferredProductIds: [],
  upsellPriorityProductIds: [],
  maxProductRecommendations: 3,
  proactiveMessagesEnabled: false,
  proactiveDelaySeconds: 15,
  maxProactivePrompts: 2,
  minimumProactiveConfidence: 0.65,
  minimumUpsellIntentScore: 55,
  hesitationDetectionEnabled: true,
  bundleSupportEnabled: false,
  analyticsEnabled: true,
  unitCost: 3,
  inventoryQuantity: 17,
  margin: 0.5,
} as unknown as AppSettings;
function post(path: string, body: unknown) {
  return {
    request: new Request(`https://app.example.com${path}`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
  } as ActionFunctionArgs;
}
function offer(reason = "Approved reason") {
  return {
    widgetType: "rec_strip",
    aiProvider: "heuristic",
    confidence: 1,
    reasoning: "test",
    payload: {
      products: [{ productId: targetId, reason }],
      private: { unitCost: 3, margin: 0.5, inventoryQuantity: 17 },
    },
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("SHOPIFY_API_SECRET", "synthetic-signing-secret");
  vi.stubEnv("AOVBOOST_STOREFRONT_SESSION_SECRET", "synthetic-session-secret");
  mocks.auth.mockReturnValue({ shop, sessionId: "session", customerId: null });
  mocks.shopperSession.mockResolvedValue({
    id: "session",
    shop,
    salesState: "BUYING",
  });
  mocks.measurement.mockResolvedValue(null);
  mocks.cache.mockImplementation(async (key) =>
    key === `settings:${shop}` ? settings : null,
  );
  mocks.relationships.mockImplementation(async ({ where }) =>
    where.kind?.in || where.status?.in
      ? [{ targetProductId: targetId, status: "approved", kind: "complement" }]
      : [],
  );
  mocks.fresh.mockImplementation(async (_shop, ids) =>
    ids.includes(targetId)
      ? [
          {
            id: targetId,
            title: "Conditioner",
            handle: "conditioner",
            price: "12.00",
            compareAtPrice: null,
            imageUrl: null,
            tags: [],
            collectionIds: [],
            availableForSale: true,
            defaultVariantId: "gid://shopify/ProductVariant/102",
            inventory: 17,
            variants: [
              {
                id: "gid://shopify/ProductVariant/102",
                title: "Default",
                price: "12.00",
                compareAtPrice: null,
                quantityAvailable: 17,
                availableForSale: true,
                selectedOptions: [],
                sku: "",
              },
            ],
            metafields: {
              "aovboost.availableForSale": { value: "true" },
              "aovboost.hasOnlyDefaultVariant": { value: "true" },
              "aovboost.defaultVariantId": {
                value: "gid://shopify/ProductVariant/102",
              },
            },
          },
        ]
      : [],
  );
  mocks.candidates.mockResolvedValue([
    {
      id: targetId,
      productId: targetId,
      type: "product",
      widgetType: "rec_strip",
      title: "Conditioner",
      score: 1,
      payload: { affinity: { reason: "Approved reason" } },
    },
  ]);
  mocks.decision.mockResolvedValue(offer());
  mocks.createOffer.mockResolvedValue({ id: "fresh-offer" });
  mocks.entitlement.mockResolvedValue({ tier: "pro", state: "verified" });
  mocks.usage.mockResolvedValue({ displayed: 0, pending: 0, available: true });
  mocks.reserve.mockResolvedValue(true);
  mocks.publicSettings.mockResolvedValue(toPublicAppSettings(settings));
});
afterEach(() => vi.unstubAllEnvs());

describe("serialized storefront response privacy and pairing cache", () => {
  it("withholds a holdout offer before candidates, AI or offer writes while retaining its signed session", async () => {
    mocks.measurement.mockResolvedValue({
      arm: "holdout",
      version: 2,
      percent: 10,
      link: "m1.synthetic",
    });
    const result = await offerAction(
      post("/api/offer", {
        shop,
        sessionId: "session",
        trigger: "cart_item_added",
        cartProductIds: ["gid://shopify/Product/1"],
        cartItemCount: 1,
        triggerPayload: { confirmed: true, mutationId: "one" },
      }),
    );
    if (result instanceof Response)
      throw new Error("Expected holdout decision");
    expect(result.data).toMatchObject({
      widgetType: null,
      reasoning: "holdout_assigned",
      measurement: { arm: "holdout" },
    });
    expect(mocks.candidates).not.toHaveBeenCalled();
    expect(mocks.decision).not.toHaveBeenCalled();
    expect(mocks.createOffer).not.toHaveBeenCalled();
    expect(mocks.shopperSession).toHaveBeenCalled();
    expect(JSON.stringify(result.data)).not.toMatch(privateKeys);
  });
  const body = {
    shop,
    sessionId: "session",
    trigger: "initial",
    currentPageType: "product",
    currentProductId: "gid://shopify/Product/1",
    cartProductIds: ["gid://shopify/Product/1"],
    cartItemCount: 1,
  };
  it("stops a free shop at its displayed allowance before AI or offer creation", async () => {
    mocks.entitlement.mockResolvedValue({ tier: "free", state: "verified" });
    mocks.usage.mockResolvedValue({
      displayed: 500,
      pending: 0,
      available: true,
    });
    const result = (await offerAction(
      post("/api/offer", {
        ...body,
        trigger: "cart_item_added",
        triggerPayload: { confirmed: true, mutationId: "capped" },
      }),
    )) as any;
    expect(result.data).toMatchObject({
      widgetType: null,
      reasoning: "plan_display_allowance",
    });
    expect(mocks.candidates).not.toHaveBeenCalled();
    expect(mocks.decision).not.toHaveBeenCalled();
    expect(mocks.createOffer).not.toHaveBeenCalled();
    expect(JSON.stringify(result.data)).not.toMatch(privateKeys);
  });
  it("does not let a free shop bypass display accounting by disabling analytics", async () => {
    mocks.entitlement.mockResolvedValue({ tier: "free", state: "verified" });
    mocks.cache.mockImplementation(async (key) =>
      key === `settings:${shop}`
        ? { ...settings, analyticsEnabled: false }
        : null,
    );
    const result = (await offerAction(post("/api/offer", body))) as any;
    expect(result.data).toMatchObject({
      widgetType: null,
      reasoning: "plan_usage_requires_analytics",
    });
    expect(mocks.candidates).not.toHaveBeenCalled();
    expect(mocks.createOffer).not.toHaveBeenCalled();
  });
  it("does not deliver an offer if a competing request reserved the remaining free capacity", async () => {
    mocks.entitlement.mockResolvedValue({ tier: "free", state: "verified" });
    mocks.reserve.mockResolvedValue(false);
    const result = (await offerAction(
      post("/api/offer", {
        ...body,
        trigger: "cart_item_added",
        triggerPayload: { confirmed: true, mutationId: "last" },
      }),
    )) as any;
    expect(result.data).toMatchObject({
      widgetType: null,
      reasoning: "plan_display_allowance",
    });
    expect(mocks.reserve).toHaveBeenCalledWith(
      shop,
      "fresh-offer",
      expect.objectContaining({ tier: "free" }),
    );
  });
  it("enforces advanced placement access for free shops without changing the cart selector", async () => {
    mocks.entitlement.mockResolvedValue({ tier: "free", state: "verified" });
    const result = (await offerAction(post("/api/offer", body))) as any;
    expect(result.data).toMatchObject({
      widgetType: null,
      reasoning: "plan_advanced_placements",
    });
    expect(mocks.candidates).not.toHaveBeenCalled();
  });
  it("uses the actual cart-selection path independently of chat and creates each shopper's own offer", async () => {
    mocks.cache.mockImplementation(async (key) =>
      key === `settings:${shop}`
        ? { ...settings, focusedMode: true, chatEnabled: false }
        : key.startsWith("offer:")
          ? offer()
          : null,
    );
    mocks.createOffer
      .mockResolvedValueOnce({ id: "offer-one" })
      .mockResolvedValueOnce({ id: "offer-two" });
    const cartBody = {
      ...body,
      trigger: "cart_item_added",
      triggerPayload: {
        confirmed: true,
        mutationId: "one",
        productId: "gid://shopify/Product/1",
      },
    };
    const first = await offerAction(post("/api/offer", cartBody));
    mocks.auth.mockReturnValue({
      shop,
      sessionId: "session-two",
      customerId: null,
    });
    mocks.shopperSession.mockResolvedValue({
      id: "session-two",
      shop,
      salesState: "BUYING",
    });
    const second = await offerAction(
      post("/api/offer", {
        ...cartBody,
        triggerPayload: { ...cartBody.triggerPayload, mutationId: "two" },
      }),
    );
    if (first instanceof Response || second instanceof Response)
      throw new Error("Expected cart data");
    expect(first.data).toMatchObject({
      widgetType: "upsell_drawer",
      payload: { offerId: "offer-one", mutationId: "one" },
    });
    expect(second.data).toMatchObject({
      widgetType: "upsell_drawer",
      payload: { offerId: "offer-two", mutationId: "two" },
    });
    expect(
      mocks.createOffer.mock.calls.map(([arg]) => [arg.shop, arg.sessionId]),
    ).toEqual([
      [shop, "session"],
      [shop, "session-two"],
    ]);
    expect(mocks.decision).not.toHaveBeenCalled();
    expect(JSON.stringify([first.data, second.data])).not.toMatch(privateKeys);
  });
  it.each(["unconfirmed", "restored", "empty", "own-add"])(
    "does not create shopper offers for %s carts",
    async (mode) => {
      const result = await offerAction(
        post("/api/offer", {
          ...body,
          trigger: mode === "restored" ? "cart_restored" : "cart_item_added",
          ...(mode === "empty" ? { cartProductIds: [], cartItemCount: 0 } : {}),
          triggerPayload: {
            mutationId: "one",
            confirmed: mode !== "unconfirmed",
            recommendationOrigin: mode === "own-add",
          },
        }),
      );
      if (result instanceof Response)
        throw new Error("Expected empty cart decision");
      expect(result.data).toMatchObject({ widgetType: null });
      expect(mocks.createOffer).not.toHaveBeenCalled();
    },
  );
  it("rehydrates and strips private signals before storing or returning an offer", async () => {
    const result = await offerAction(post("/api/offer", body));
    if (result instanceof Response) throw new Error("Expected offer data");
    expect(result.data).toMatchObject({
      widgetType: "rec_strip",
      payload: { offerId: "fresh-offer" },
    });
    expect(JSON.stringify(result.data)).not.toMatch(privateKeys);
    expect(JSON.stringify(mocks.createOffer.mock.calls)).not.toMatch(
      privateKeys,
    );
    expect((result.data as any).payload.products[0].product.price).toBe(
      "12.00",
    );
  });
  it("rechecks an old cached offer, strips quantities and writes each shopper's own provenance record", async () => {
    const cached = offer();
    (cached.payload.products[0] as any).product = {
      quantityAvailable: 17,
      inventoryQuantity: 17,
    };
    mocks.cache.mockImplementation(async (key) =>
      key === `settings:${shop}`
        ? settings
        : key.startsWith("offer:")
          ? cached
          : null,
    );
    const result = await offerAction(post("/api/offer", body));
    if (result instanceof Response) throw new Error("Expected offer data");
    expect((result.data as any).widgetType).toBe("rec_strip");
    expect(JSON.stringify(result.data)).not.toMatch(privateKeys);
    expect(mocks.decision).not.toHaveBeenCalled();
    expect(mocks.createOffer).toHaveBeenCalledWith(
      expect.objectContaining({
        shop,
        sessionId: "session",
        triggerContext: expect.objectContaining({
          sourceProductId: body.currentProductId,
        }),
      }),
    );
    expect((result.data as any).payload.offerId).toBe("fresh-offer");
    mocks.auth.mockReturnValue({ shop, sessionId: "second", customerId: null });
    mocks.shopperSession.mockResolvedValue({
      id: "second",
      shop,
      salesState: "BUYING",
    });
    mocks.createOffer.mockResolvedValueOnce({ id: "second-offer" });
    const second = await offerAction(
      post("/api/offer", { ...body, sessionId: "second" }),
    );
    expect((second as any).data.payload.offerId).toBe("second-offer");
    expect(mocks.createOffer).toHaveBeenLastCalledWith(
      expect.objectContaining({ sessionId: "second" }),
    );
  });
  it("does not reuse a cached list after approved ordering or reasons change", async () => {
    mocks.cache.mockImplementation(async (key) =>
      key === `settings:${shop}`
        ? settings
        : key.startsWith("offer:")
          ? offer("Old catalog reason")
          : null,
    );
    await offerAction(post("/api/offer", body));
    expect(mocks.decision).toHaveBeenCalledTimes(1);
    expect(mocks.createOffer).toHaveBeenCalledTimes(1);
  });
  it("recomputes shopper experiment assignment instead of copying a cached shopper's variant", async () => {
    mocks.cache.mockImplementation(async (key) =>
      key === `settings:${shop}`
        ? settings
        : key.startsWith("offer:")
          ? {
              ...offer(),
              payload: { ...offer().payload, abVariant: "treatment" },
            }
          : null,
    );
    await offerAction(post("/api/offer", body));
    expect(mocks.decision).toHaveBeenCalledTimes(1);
    expect(mocks.createOffer).toHaveBeenCalledTimes(1);
  });
  it("keeps private fields out of config and signed session responses", async () => {
    const config = await configAction(post("/api/config", body));
    const session = await sessionLoader({
      request: new Request("https://app.example.com/api/session"),
    } as LoaderFunctionArgs);
    expect(JSON.stringify(config)).not.toMatch(privateKeys);
    expect(JSON.stringify(session)).not.toMatch(privateKeys);
    if (session instanceof Response || !("sessionToken" in session.data))
      throw new Error("Expected signed session data");
    const claims = JSON.parse(
      Buffer.from(
        session.data.sessionToken.split(".")[1],
        "base64url",
      ).toString("utf8"),
    );
    expect(Object.keys(claims).sort()).toEqual([
      "exp",
      "iat",
      "shop",
      "sid",
      "v",
    ]);
  });
  it("keeps raw inventory out of live alerts while retaining the event", async () => {
    vi.stubEnv("AOVBOOST_ENABLE_LIVE_EVENTS", "true");
    const result = await liveAction(post("/api/live", body));
    if (result instanceof Response) throw new Error("Expected live event data");
    expect((result.data as any).events[0]).toMatchObject({
      type: "low_inventory_alert",
      productId: targetId,
    });
    expect(JSON.stringify(result.data)).not.toMatch(privateKeys);
  });
  it("strips aliases recursively while preserving cart quantity and availability", () => {
    const result = stripPrivateSignals({
      quantity: 2,
      availableForSale: true,
      variants: [
        {
          quantity_available: 17,
          available: 17,
          unit_cost: 5,
          marginBand: "high",
          price: "12.00",
        },
      ],
      metadata: { inventory_levels: [1, 2] },
    });
    expect(result).toEqual({
      quantity: 2,
      availableForSale: true,
      variants: [{ price: "12.00" }],
      metadata: {},
    });
  });
});
