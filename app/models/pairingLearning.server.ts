import { Prisma, type AppSettings } from "@prisma/client";
import prisma from "../db.server";
import { withCommerceTransaction } from "./commerceTransaction.server";
import type { StorefrontEvent } from "./session.server";
import type { ServedPair } from "./pairingProvenance.server";
import {
  approvalStatus,
  inPriceBand,
  isSensitivePair,
  nearDuplicate,
  normalizePairingMode,
  pairingEvidence,
} from "./pairingAutopilot";
import { isCatalogProductAvailable } from "./productCatalogMapping";
import {
  underperformingBaseline,
  PAIRING_MIN_IMPRESSIONS,
  PAIRING_CONFIDENCE_Z,
} from "./pairingLearning";
import { normalizeVerticalPreset } from "./productPairings";
export const PAIRING_ROLLUP_OFFERS = 50;
export const PAIRING_MIN_DISTINCT_SESSIONS = 20;
export function pairingBaselineQuery(shop: string) {
  const z = PAIRING_CONFIDENCE_Z,
    z2 = z * z;
  return Prisma.sql`WITH qualified AS (
    SELECT "acceptedCount"::float8 / "shownCount" p, "shownCount"::float8 n
    FROM "ProductRelationship" WHERE shop=${shop} AND kind='complement'
    AND status::text IN ('approved','auto_approved') AND "shownCount">=${PAIRING_MIN_IMPRESSIONS}
    AND "acceptedCount" BETWEEN 0 AND "shownCount"
  ), bounds AS (SELECT GREATEST(0,(p+${z2}/(2*n)-${z}*sqrt(p*(1-p)/n+${z2}/(4*n*n)))/(1+${z2}/n)) lower_bound FROM qualified)
  SELECT COUNT(*)::int peers, percentile_cont(0.5) WITHIN GROUP (ORDER BY lower_bound)::float8 AS "medianLower" FROM bounds`;
}
export async function markPairingEventsPending(
  shop: string,
  sessionId: string,
  events: StorefrontEvent[],
) {
  const ids = [
    ...new Set(
      events
        .filter((event) =>
          [
            "widget_impression",
            "impression",
            "recommendation_added",
            "upsell_added",
          ].includes(event.type),
        )
        .map((event) => String(event.offerId || event.offer_id || "")),
    ),
  ]
    .filter((id) => /^[\w-]{1,128}$/.test(id))
    .slice(0, 100);
  if (ids.length)
    await prisma.offer.updateMany({
      where: {
        shop,
        sessionId,
        id: { in: ids },
        widgetType: { in: ["upsell_drawer", "rec_strip", "upsell"] },
      },
      data: { pairingRollupPending: true },
    });
}
export async function rollupPairingEvents(shop: string) {
  return withCommerceTransaction(
    `pairing-rollup:${shop}`,
    "batch",
    async (tx) => {
      const offers = await tx.offer.findMany({
        where: { shop, pairingRollupPending: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: PAIRING_ROLLUP_OFFERS,
      });
      for (const offer of offers) {
        // Lock/clear first: an event writer that races this transaction leaves it pending again.
        await tx.offer.updateMany({
          where: { shop, id: offer.id },
          data: { pairingRollupPending: false },
        });
        const pairs = Array.isArray(offer.pairingProvenance)
          ? (offer.pairingProvenance as unknown as ServedPair[])
          : [];
        if (!pairs.length) continue;
        const events = await tx.shopperEvent.findMany({
          where: {
            shop,
            sessionId: offer.sessionId,
            createdAt: { gte: offer.createdAt },
            type: {
              in: [
                "widget_impression",
                "impression",
                "recommendation_added",
                "upsell_added",
              ],
            },
            OR: [
              { payload: { path: ["offerId"], equals: offer.id } },
              { payload: { path: ["offer_id"], equals: offer.id } },
            ],
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: 250,
        });
        const impression = events.find((event) =>
          ["widget_impression", "impression"].includes(event.type),
        );
        if (!impression && !offer.pairingShownAt) continue;
        const shownAt = offer.pairingShownAt || impression!.createdAt;
        const accepted = new Set(offer.pairingAcceptedIds);
        for (const pair of pairs.slice(0, 20)) {
          if (!pair.relationshipId) continue;
          const added = events.some(
            (event) =>
              ["recommendation_added", "upsell_added"].includes(event.type) &&
              event.createdAt >= shownAt &&
              String((event.payload as any)?.productId) ===
                pair.targetProductId,
          );
          const data = {
            ...(!offer.pairingShownAt ? { shownCount: { increment: 1 } } : {}),
            ...(added && !accepted.has(pair.relationshipId)
              ? { acceptedCount: { increment: 1 } }
              : {}),
          };
          if (Object.keys(data).length)
            await tx.productRelationship.updateMany({
              where: {
                shop,
                id: pair.relationshipId,
                sourceProductId: pair.sourceProductId,
                targetProductId: pair.targetProductId,
              },
              data,
            });
          if (added) accepted.add(pair.relationshipId);
        }
        await tx.offer.updateMany({
          where: { shop, id: offer.id },
          data: { pairingShownAt: shownAt, pairingAcceptedIds: [...accepted] },
        });
      }
      return offers.length;
    },
  );
}
export async function evaluatePairingPerformance(
  shop: string,
  settings: AppSettings,
) {
  const rows = await prisma.productRelationship.findMany({
    where: {
      shop,
      kind: "complement",
      status: { in: ["approved", "auto_approved"] },
      shownCount: { gte: PAIRING_MIN_IMPRESSIONS },
    },
    orderBy: [
      { performanceCheckedAt: { sort: "asc", nulls: "first" } },
      { id: "asc" },
    ],
    take: 20,
  });
  if (!rows.length) return;
  const [baseline] = await prisma.$queryRaw<
    Array<{ peers: number; medianLower: number | null }>
  >(pairingBaselineQuery(shop));
  for (const row of rows) {
    await prisma.productRelationship.updateMany({
      where: { shop, id: row.id },
      data: { performanceCheckedAt: new Date() },
    });
    if (
      !underperformingBaseline(
        row,
        baseline?.peers || 0,
        baseline?.medianLower || 0,
      )
    )
      continue;
    const sessions = await prisma.$queryRaw<
      Array<{ count: number }>
    >(Prisma.sql`
      SELECT COUNT(*)::int count FROM (SELECT DISTINCT "sessionId" FROM "Offer" WHERE shop=${shop} AND "pairingShownAt" IS NOT NULL
      AND "createdAt">=${new Date(Date.now() - 31 * 86400_000)}
      AND "pairingProvenance" @> ${JSON.stringify([{ relationshipId: row.id }])}::jsonb LIMIT ${PAIRING_MIN_DISTINCT_SESSIONS}) sample`);
    if ((sessions[0]?.count || 0) < PAIRING_MIN_DISTINCT_SESSIONS) continue;
    await prisma.productRelationship.updateMany({
      where: { shop, id: row.id, status: row.status },
      data: {
        performanceFlag: true,
        ...(row.status === "auto_approved" ? { status: "demoted" } : {}),
      },
    });
    if (
      row.status !== "auto_approved" ||
      normalizePairingMode(settings.pairingMode) !== "autopilot"
    )
      continue;
    const [source, alternatives, excluded] = await Promise.all([
      prisma.product.findFirst({ where: { shop, id: row.sourceProductId } }),
      prisma.productRelationship.findMany({
        where: {
          shop,
          sourceProductId: row.sourceProductId,
          kind: "complement",
          status: "suggested",
        },
        orderBy: [{ confidence: "desc" }, { position: "asc" }],
        include: { target: true },
        take: 10,
      }),
      prisma.productRelationship.findMany({
        where: {
          shop,
          sourceProductId: row.sourceProductId,
          OR: [
            { kind: "exclude" },
            { status: { in: ["rejected", "demoted"] } },
          ],
        },
        select: { targetProductId: true },
        take: 100,
      }),
    ]);
    if (
      !source ||
      !isCatalogProductAvailable(source.metafields) ||
      settings.blockedProductIds.includes(source.id)
    )
      continue;
    const replacement = alternatives.find((pair) => {
      const target = pair.target;
      return (
        !excluded.some((entry) => entry.targetProductId === target.id) &&
        !settings.blockedProductIds.includes(target.id) &&
        ![source, target].some((p) =>
          p.collectionIds.some((id) =>
            settings.excludedCollectionIds.includes(id),
          ),
        ) &&
        isCatalogProductAvailable(target.metafields) &&
        inPriceBand(source, target) &&
        !nearDuplicate(source, target) &&
        pairingEvidence(
          source,
          target,
          normalizeVerticalPreset(settings.verticalPreset),
        ).some((entry) => entry.reasonCode === pair.reasonCode) &&
        approvalStatus({
          mode: settings.pairingMode,
          strictness: settings.pairingStrictness,
          confidence: pair.confidence,
          sensitive: isSensitivePair(
            source,
            target,
            settings.pairingSensitiveKeywords,
          ),
          fallback: pair.origin !== "ai",
        }) === "auto_approved"
      );
    });
    if (replacement)
      await prisma.productRelationship.updateMany({
        where: { shop, id: replacement.id, status: "suggested" },
        data: { status: "auto_approved" },
      });
  }
}
