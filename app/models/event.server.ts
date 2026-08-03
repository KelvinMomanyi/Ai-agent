import type { Prisma } from "@prisma/client";
import prisma from "../db.server";
import {
  type StorefrontEvent,
  upsertShopperSessionFromEvents,
} from "./session.server";
import {
  markOfferClick,
  markOfferImpression,
} from "./offer.server";

export async function ingestStorefrontEvents(input: {
  shop: string;
  sessionId: string;
  events: StorefrontEvent[];
}) {
  const session = await upsertShopperSessionFromEvents(input);

  if (input.events.length > 0) {
    await prisma.shopperEvent.createMany({
      data: input.events.map((event) => ({
        shop: input.shop,
        sessionId: session.id,
        type: event.type,
        payload: event as Prisma.InputJsonValue,
        createdAt:
          typeof event.ts === "number" && Number.isFinite(event.ts)
            ? new Date(event.ts)
            : new Date(),
      })),
    });
  }

  await updateOfferTracking(input.shop, input.events);

  return session;
}

async function updateOfferTracking(shop: string, events: StorefrontEvent[]) {
  await Promise.all(
    events.map(async (event) => {
      const offerId = String(event.offerId || event.offer_id || "");
      if (!offerId) return;

      if (event.type === "widget_impression" || event.type === "impression") {
        await markOfferImpression(shop, offerId);
      }
      if (event.type === "widget_click" || event.type === "click") {
        await markOfferClick(shop, offerId);
      }
      // Conversions are intentionally not accepted from the browser. Shopify's
      // signed order webhook (or the authenticated post-purchase flow) is the
      // source of truth for revenue attribution.
    }),
  );
}
