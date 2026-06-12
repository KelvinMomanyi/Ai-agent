import type { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { queues } from "../redis.server";
import {
  type StorefrontEvent,
  upsertShopperSessionFromEvents,
} from "./session.server";
import {
  markOfferClick,
  markOfferConversion,
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
        createdAt: event.ts ? new Date(Number(event.ts)) : new Date(),
      })),
    });
  }

  await updateOfferTracking(input.shop, input.events);

  if (input.events.some((event) => event.type === "add_to_cart")) {
    await queues.generateOfferQueue.add("generate-offer", {
      sessionId: session.id,
      shop: input.shop,
      trigger: "add_to_cart",
    });
  }

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
      if (event.type === "purchase" || event.type === "conversion") {
        await markOfferConversion(shop, offerId, event.revenueImpact as string);
      }
    }),
  );
}
