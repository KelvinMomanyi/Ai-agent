import prisma from "../db.server";
import { cacheKeys, claimExpiringKey } from "../redis.server";

export const LIVE_EVENT_WINDOW_MS = 10 * 60 * 1000;
export const LIVE_POLL_INTERVAL_MS = 10 * 1000;

const LIVE_EVENT_TYPES = [
  "price_drop_webhook",
  "low_inventory_alert",
] as const;

export type LiveEventType = (typeof LIVE_EVENT_TYPES)[number];

export type StorefrontLiveEvent = {
  id: string;
  type: LiveEventType;
  productId: string;
  title?: string;
  occurredAt: string;
  oldPrice?: number;
  newPrice?: number;
  inventoryQuantity?: number;
};

/**
 * Returns webhook events only for the product represented by this session's
 * latest navigation. Event rows are the durable polling log; the Redis claim
 * enforces one type/product/session delivery per rolling ten-minute window.
 */
export async function getPendingStorefrontLiveEvents(input: {
  shop: string;
  sessionId: string;
  now?: Date;
}): Promise<StorefrontLiveEvent[]> {
  const now = input.now || new Date();
  const cutoff = new Date(now.getTime() - LIVE_EVENT_WINDOW_MS);
  const session = await prisma.shopperSession.findFirst({
    where: {
      shop: input.shop,
      OR: [{ id: input.sessionId }, { anonymousId: input.sessionId }],
    },
    select: { id: true },
  });
  if (!session) return [];

  const [latestProductView, latestPageView] = await Promise.all([
    prisma.shopperEvent.findFirst({
      where: {
        shop: input.shop,
        sessionId: session.id,
        type: "product_view",
        createdAt: { gte: cutoff },
      },
      orderBy: { createdAt: "desc" },
      select: { payload: true, createdAt: true },
    }),
    prisma.shopperEvent.findFirst({
      where: {
        shop: input.shop,
        sessionId: session.id,
        type: "page_view",
        createdAt: { gte: cutoff },
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);

  if (!latestProductView) return [];
  if (
    latestPageView &&
    latestPageView.createdAt.getTime() > latestProductView.createdAt.getTime()
  ) {
    return [];
  }

  const activeProductId = getProductId(latestProductView.payload);
  if (!activeProductId) return [];

  const rows = await prisma.event.findMany({
    where: {
      storeId: input.shop,
      event: { in: [...LIVE_EVENT_TYPES] },
      timestamp: { gte: latestProductView.createdAt, lte: now },
    },
    orderBy: { timestamp: "desc" },
    take: 50,
  });

  const newestByType = new Map<LiveEventType, (typeof rows)[number]>();
  for (const row of rows) {
    if (!isLiveEventType(row.event) || newestByType.has(row.event)) continue;
    if (!sameProduct(getProductId(row.data), activeProductId)) continue;
    newestByType.set(row.event, row);
  }

  const deliverable: StorefrontLiveEvent[] = [];
  for (const [eventType, row] of newestByType) {
    const productId = getProductId(row.data);
    const claimed = await claimExpiringKey(
      cacheKeys.liveDelivery(
        input.shop,
        session.id,
        eventType,
        productId,
      ),
      LIVE_EVENT_WINDOW_MS / 1000,
    );
    if (!claimed) continue;
    deliverable.push(toStorefrontLiveEvent(row, eventType, productId));
  }

  return deliverable.sort((left, right) =>
    left.occurredAt.localeCompare(right.occurredAt),
  );
}

function toStorefrontLiveEvent(
  row: {
    id: string;
    timestamp: Date;
    data: unknown;
  },
  type: LiveEventType,
  productId: string,
): StorefrontLiveEvent {
  const data = asRecord(row.data);
  const title = toOptionalText(data.title, 200);
  const oldPrice = toOptionalNumber(data.oldPrice);
  const newPrice = toOptionalNumber(data.newPrice);
  const inventoryQuantity = toOptionalNumber(data.inventoryQuantity);

  return {
    id: row.id,
    type,
    productId,
    occurredAt: row.timestamp.toISOString(),
    ...(title ? { title } : {}),
    ...(type === "price_drop_webhook" && oldPrice !== undefined
      ? { oldPrice }
      : {}),
    ...(type === "price_drop_webhook" && newPrice !== undefined
      ? { newPrice }
      : {}),
    ...(type === "low_inventory_alert" && inventoryQuantity !== undefined
      ? { inventoryQuantity }
      : {}),
  };
}

function isLiveEventType(value: string): value is LiveEventType {
  return (LIVE_EVENT_TYPES as readonly string[]).includes(value);
}

function getProductId(value: unknown) {
  const data = asRecord(value);
  const product = asRecord(data.product);
  return String(
    data.productId || data.product_id || data.productGid || product.id || "",
  ).trim();
}

function sameProduct(left: string, right: string) {
  const leftKey = productKey(left);
  const rightKey = productKey(right);
  return Boolean(leftKey && rightKey && leftKey === rightKey);
}

function productKey(value: string) {
  return value.split("?")[0].split("/").filter(Boolean).pop() || "";
}

function toOptionalText(value: unknown, maxLength: number) {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, maxLength) : undefined;
}

function toOptionalNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}
