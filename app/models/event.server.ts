import type { Prisma } from "@prisma/client";
import prisma from "../db.server";
import {
  type StorefrontEvent,
  upsertShopperSessionFromEvents,
} from "./session.server";
import { markOfferClick, markOfferImpression } from "./offer.server";
import { applyRecommendationEvents } from "./recommendationOutcome.server";
import { getPublicAppSettings } from "./settings.server";
import { recordHoldoutCartEvents } from "./holdout.server";
import { recordDisplayedOffers } from "./usage.server";
import { markPairingEventsPending } from "./pairingLearning.server";
import { schedulePairingDrain } from "../jobs/pairingAutopilot.server";

export async function ingestStorefrontEvents(input: {
  shop: string;
  sessionId: string;
  customerId?: string | null;
  events: StorefrontEvent[];
}) {
  const settings = await getPublicAppSettings(input.shop);
  if (settings?.analyticsEnabled === false) return null;
  // Browser events cannot attest to a purchase or its value.
  const events = input.events.filter(
    (event) =>
      !["purchase_completed", "conversion", "order_created"].includes(
        event.type,
      ),
  );
  input = { ...input, events };
  const session = await upsertShopperSessionFromEvents(input);
  await recordDisplayedOffers(
    input.shop,
    session.id,
    input.events
      .filter(
        (event) =>
          event.type === "widget_impression" || event.type === "impression",
      )
      .map((event) => String(event.offerId || event.offer_id || "")),
  );
  if (settings.holdoutEnabled)
    await recordHoldoutCartEvents(input.shop, input.sessionId, input.events);

  const storedEvents = input.events.filter(
    (event) => event.type !== "session_sync",
  );
  if (storedEvents.length > 0) {
    await prisma.shopperEvent.createMany({
      data: storedEvents.map((event) => ({
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
  try {
    await markPairingEventsPending(input.shop, session.id, input.events);
    if (
      input.events.some((event) =>
        [
          "widget_impression",
          "impression",
          "recommendation_added",
          "upsell_added",
        ].includes(event.type),
      )
    )
      schedulePairingDrain(input.shop);
  } catch {
    console.error("AOVBoost pairing telemetry is pending retry", {
      shop: input.shop,
    });
  }
  await applyRecommendationEvents({
    shop: input.shop,
    sessionId: session.id,
    events: input.events,
  });

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
