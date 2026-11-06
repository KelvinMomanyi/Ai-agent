import { createHash } from "node:crypto";
import type { AppSettings } from "@prisma/client";
import type { HoldoutMeasurement } from "../../shared/holdout";
import prisma from "../db.server";
import { getAppSettings } from "./settings.server";
import {
  upsertShopperSessionFromEvents,
  type StorefrontEvent,
} from "./session.server";
import {
  measurementLink,
  verifyMeasurementLink,
} from "../utils/measurementLink.server";
import type { OrderAttribution } from "./attribution.server";

export function holdoutArm(shop: string, anonymousId: string, percent: number) {
  const bucket =
    createHash("sha256")
      .update(`${shop}\0${anonymousId}`)
      .digest()
      .readUInt32BE(0) % 10_000;
  return bucket < Math.max(0, Math.min(30, percent)) * 100
    ? ("holdout" as const)
    : ("exposed" as const);
}
export async function enrollHoldout(
  shop: string,
  sessionId: string,
  supplied?: AppSettings,
): Promise<HoldoutMeasurement | null> {
  const settings = supplied || (await getAppSettings(shop));
  if (
    !settings.holdoutEnabled ||
    settings.holdoutPercent <= 0 ||
    settings.analyticsEnabled === false
  )
    return null;
  const session = await upsertShopperSessionFromEvents({
    shop,
    sessionId,
    events: [],
  });
  const version = settings.holdoutVersion;
  const enrollment = await prisma.holdoutEnrollment.upsert({
    where: { shop_sessionId_version: { shop, sessionId: session.id, version } },
    update: {},
    create: {
      shop,
      sessionId: session.id,
      version,
      percent: settings.holdoutPercent,
      arm: holdoutArm(shop, session.anonymousId, settings.holdoutPercent),
    },
  });
  return {
    arm: enrollment.arm as HoldoutMeasurement["arm"],
    version: enrollment.version,
    percent: enrollment.percent,
    link: measurementLink(shop, session.id, version),
  };
}
export async function recordHoldoutCartEvents(
  shop: string,
  sessionId: string,
  events: StorefrontEvent[],
) {
  const settings = await getAppSettings(shop);
  if (
    !settings.holdoutEnabled ||
    settings.holdoutPercent <= 0 ||
    !settings.analyticsEnabled
  )
    return;
  const enrollment = await enrollHoldout(shop, sessionId, settings);
  if (!enrollment) return;
  const sawCart = events.some(
    (event) =>
      (event.type === "cart_update" || event.type === "cart_restored") &&
      Number(event.cartItemCount) > 0,
  );
  const enrolledSessionId = verifyMeasurementLink(
    shop,
    enrollment.link,
  )?.sessionId;
  const linked = events.some((event) => {
    const link =
      event.type === "measurement_cart_linked"
        ? verifyMeasurementLink(shop, event.measurementLink)
        : null;
    return (
      link?.sessionId === enrolledSessionId &&
      link?.version === enrollment.version
    );
  });
  if (enrolledSessionId && (sawCart || linked))
    await prisma.holdoutEnrollment.updateMany({
      where: {
        shop,
        sessionId: enrolledSessionId,
        version: enrollment.version,
      },
      data: {
        ...(sawCart || linked ? { cartSeenAt: new Date() } : {}),
        ...(linked ? { cartLinkedAt: new Date() } : {}),
      },
    });
}
export async function recordHoldoutOrder(
  shop: string,
  order: Record<string, any>,
  attribution: OrderAttribution,
) {
  const assignment = attribution.measurement;
  if (!assignment) return;
  const enrollment = await prisma.holdoutEnrollment.findUnique({
    where: {
      shop_sessionId_version: {
        shop,
        sessionId: assignment.sessionId,
        version: assignment.version,
      },
    },
  });
  if (!enrollment) return;
  const money = order.total_price_set?.shop_money;
  const revenue = Number(money?.amount ?? order.total_price);
  const currency = String(money?.currency_code || order.currency || "");
  const createdAt = new Date(order.created_at);
  const orderId = String(order.admin_graphql_api_id || order.id || "");
  if (
    !orderId ||
    !Number.isFinite(revenue) ||
    revenue < 0 ||
    !/^[A-Z]{3}$/.test(currency) ||
    !Number.isFinite(createdAt.getTime())
  )
    return;
  await prisma.holdoutOrder.upsert({
    where: { shop_orderId: { shop, orderId } },
    update: {},
    create: {
      shop,
      orderId,
      enrollmentId: enrollment.id,
      revenue: String(revenue),
      currency,
      createdAt,
    },
  });
}
