import prisma from "../db.server";
import { normalizePairingMode } from "./pairingAutopilot";
import { productGid } from "./productPairings";
export type ServedPair = {
  relationshipId: string | null;
  sourceProductId: string;
  targetProductId: string;
  origin: "merchant" | "autopilot" | "affinity" | "catalog";
  status: string;
  confidence: number | null;
  reasonCode: string;
  modelVersion: string | null;
};
export async function capturePairingProvenance(
  shop: string,
  sourceProductId: string,
  targetIds: string[],
): Promise<ServedPair[] | null> {
  if (!sourceProductId || !targetIds.length) return [];
  sourceProductId = productGid(sourceProductId);
  const ids = [...new Set(targetIds.map(productGid))].slice(0, 20);
  const [settings, rows, affinities] = await Promise.all([
    prisma.appSettings.findUnique({
      where: { shop },
      select: { pairingMode: true },
    }),
    prisma.productRelationship.findMany({
      where: { shop, sourceProductId, targetProductId: { in: ids } },
      take: ids.length * 3,
    }),
    prisma.productAffinity.findMany({
      where: {
        shop,
        sourceId: sourceProductId,
        targetId: { in: ids },
        orderCount: { gt: 0 },
        score: { gt: 0 },
      },
      select: { targetId: true },
      take: ids.length,
    }),
  ]);
  if (
    rows.some(
      (row) =>
        row.kind === "exclude" ||
        row.kind === "upgrade" ||
        row.status === "rejected" ||
        row.status === "demoted" ||
        (row.status === "auto_approved" &&
          normalizePairingMode(settings?.pairingMode) !== "autopilot"),
    )
  )
    return null;
  return ids.map((targetProductId) => {
    const row = rows.find(
      (entry) =>
        entry.targetProductId === targetProductId &&
        entry.kind === "complement" &&
        ["approved", "auto_approved"].includes(entry.status),
    );
    const affinity = affinities.some(
      (entry) => entry.targetId === targetProductId,
    );
    return {
      relationshipId: row?.id || null,
      sourceProductId,
      targetProductId,
      origin:
        row?.status === "approved"
          ? "merchant"
          : row?.status === "auto_approved"
            ? "autopilot"
            : affinity
              ? "affinity"
              : "catalog",
      status: row?.status || "fallback",
      confidence: row ? row.confidence : null,
      reasonCode:
        row?.status === "approved"
          ? "merchant_selected"
          : row?.reasonCode ||
            (affinity ? "frequently_bought_together" : "catalog_selected"),
      modelVersion: row?.modelVersion || null,
    };
  });
}
