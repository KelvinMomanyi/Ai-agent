import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sessionFindFirst: vi.fn(),
  shopperEventFindFirst: vi.fn(),
  eventFindMany: vi.fn(),
  claimExpiringKey: vi.fn(),
  liveDelivery: vi.fn(
    (_shop, sessionId, type, productId) =>
      `delivery:${sessionId}:${type}:${productId}`,
  ),
}));

vi.mock("../db.server", () => ({
  default: {
    shopperSession: { findFirst: mocks.sessionFindFirst },
    shopperEvent: { findFirst: mocks.shopperEventFindFirst },
    event: { findMany: mocks.eventFindMany },
  },
}));

vi.mock("../redis.server", () => ({
  cacheKeys: { liveDelivery: mocks.liveDelivery },
  claimExpiringKey: mocks.claimExpiringKey,
}));

import {
  getPendingStorefrontLiveEvents,
  LIVE_EVENT_WINDOW_MS,
} from "./liveEvents.server";
import { isLiveEventsEnabled } from "./settings.server";

const now = new Date("2026-08-11T12:10:00.000Z");
const productViewedAt = new Date("2026-08-11T12:05:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sessionFindFirst.mockResolvedValue({ id: "session-db-id" });
  mocks.shopperEventFindFirst
    .mockResolvedValueOnce({
      payload: { productId: "gid://shopify/Product/123" },
      createdAt: productViewedAt,
    })
    .mockResolvedValueOnce({ createdAt: productViewedAt });
  mocks.claimExpiringKey.mockResolvedValue(true);
});

describe("getPendingStorefrontLiveEvents", () => {
  it("delivers only allowlisted fields for the actively viewed product", async () => {
    mocks.eventFindMany.mockResolvedValue([
      eventRow("price-1", "price_drop_webhook", {
        productId: "123",
        title: "Trail shoe",
        oldPrice: 120,
        newPrice: 99,
        discountValue: 999,
      }),
      eventRow("stock-1", "low_inventory_alert", {
        productId: "gid://shopify/Product/123",
        inventoryQuantity: 4,
        arbitraryHtml: "<script>bad()</script>",
      }),
      eventRow("other-product", "price_drop_webhook", {
        productId: "gid://shopify/Product/456",
        newPrice: 1,
      }),
    ]);

    const events = await getPendingStorefrontLiveEvents({
      shop: "example.myshopify.com",
      sessionId: "signed-session-id",
      now,
    });

    expect(events).toEqual([
      {
        id: "price-1",
        type: "price_drop_webhook",
        productId: "123",
        title: "Trail shoe",
        oldPrice: 120,
        newPrice: 99,
        occurredAt: "2026-08-11T12:09:00.000Z",
      },
      {
        id: "stock-1",
        type: "low_inventory_alert",
        productId: "gid://shopify/Product/123",
        inventoryQuantity: 4,
        occurredAt: "2026-08-11T12:09:00.000Z",
      },
    ]);
    expect(mocks.claimExpiringKey).toHaveBeenCalledTimes(2);
    expect(mocks.claimExpiringKey).toHaveBeenCalledWith(
      "delivery:session-db-id:price_drop_webhook:123",
      LIVE_EVENT_WINDOW_MS / 1000,
    );
  });

  it("does not deliver after the session navigates away from the product", async () => {
    mocks.shopperEventFindFirst.mockReset();
    mocks.shopperEventFindFirst
      .mockResolvedValueOnce({
        payload: { productId: "gid://shopify/Product/123" },
        createdAt: productViewedAt,
      })
      .mockResolvedValueOnce({
        createdAt: new Date("2026-08-11T12:06:00.000Z"),
      });

    await expect(
      getPendingStorefrontLiveEvents({
        shop: "example.myshopify.com",
        sessionId: "signed-session-id",
        now,
      }),
    ).resolves.toEqual([]);
    expect(mocks.eventFindMany).not.toHaveBeenCalled();
  });

  it("suppresses a second type/product/session delivery during the claim window", async () => {
    mocks.eventFindMany.mockResolvedValue([
      eventRow("price-1", "price_drop_webhook", {
        productId: "gid://shopify/Product/123",
        newPrice: 99,
      }),
    ]);
    mocks.claimExpiringKey.mockResolvedValue(false);

    await expect(
      getPendingStorefrontLiveEvents({
        shop: "example.myshopify.com",
        sessionId: "signed-session-id",
        now,
      }),
    ).resolves.toEqual([]);
  });
});

describe("isLiveEventsEnabled", () => {
  it("defaults off and requires the exact true opt-in", () => {
    const original = process.env.AOVBOOST_ENABLE_LIVE_EVENTS;
    try {
      delete process.env.AOVBOOST_ENABLE_LIVE_EVENTS;
      expect(isLiveEventsEnabled()).toBe(false);
      process.env.AOVBOOST_ENABLE_LIVE_EVENTS = "TRUE";
      expect(isLiveEventsEnabled()).toBe(false);
      process.env.AOVBOOST_ENABLE_LIVE_EVENTS = "true";
      expect(isLiveEventsEnabled()).toBe(true);
    } finally {
      if (original === undefined) {
        delete process.env.AOVBOOST_ENABLE_LIVE_EVENTS;
      } else {
        process.env.AOVBOOST_ENABLE_LIVE_EVENTS = original;
      }
    }
  });
});

function eventRow(
  id: string,
  event: "price_drop_webhook" | "low_inventory_alert",
  data: Record<string, unknown>,
) {
  return {
    id,
    event,
    orderId: null,
    storeId: "example.myshopify.com",
    timestamp: new Date("2026-08-11T12:09:00.000Z"),
    data,
    createdAt: new Date("2026-08-11T12:09:00.000Z"),
    updatedAt: new Date("2026-08-11T12:09:00.000Z"),
  };
}
