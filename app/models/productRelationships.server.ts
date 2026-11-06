import prisma from "../db.server";
import { filterCatalogProducts } from "./catalogGuard.server";
import { getCatalogProductsByIds } from "./catalogCache.server";
import { HIGH_CONFIDENCE_PAIRING } from "./productPairings";
import { Prisma } from "@prisma/client";
import {
  normalizePairingMode,
  normalizeStrictness,
  pairingReason,
} from "./pairingAutopilot";
export function pairingTrafficQuery(shop: string) {
  return Prisma.sql`SELECT p.id AS "productId",COUNT(*)::int views FROM "ShopperEvent" e JOIN "Product" p ON p.shop=${shop}
    AND p.id=CASE WHEN e.payload->>'productId' ~ '^[0-9]+$' THEN 'gid://shopify/Product/'||(e.payload->>'productId') ELSE e.payload->>'productId' END
    WHERE e.shop=${shop} AND e.type IN ('product_view','product_viewed') AND e."createdAt">=${new Date(Date.now() - 14 * 86400_000)}
    GROUP BY p.id ORDER BY views DESC,p.id LIMIT 50`;
}
export function reviewPairingIdsQuery(
  shop: string,
  sources: Array<{ productId: string; views: number }>,
) {
  return Prisma.sql`WITH traffic(id,views) AS (VALUES ${Prisma.join(sources.slice(0, 100).map((row) => Prisma.sql`(${row.productId}::text,${row.views}::int)`))})
    SELECT r.id FROM "ProductRelationship" r JOIN traffic t ON r."sourceProductId"=t.id
    WHERE r.shop=${shop} AND r.kind='complement' AND (r.status::text IN ('suggested','demoted') OR r."performanceFlag"=true)
    ORDER BY t.views DESC,r.confidence ASC,r.id LIMIT 100`;
}

export class PairingAdminError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = "PairingAdminError";
  }
}

export async function topPairingProducts(shop: string, search = "") {
  const text = search.trim().slice(0, 80);
  const filter = text
    ? {
        OR: [
          { title: { contains: text, mode: "insensitive" as const } },
          { vendor: { contains: text, mode: "insensitive" as const } },
        ],
      }
    : {};
  const stats = await prisma.productOrderStat.findMany({
    where: { shop, orderCount: { gt: 0 }, product: { shop, ...filter } },
    include: { product: true },
    orderBy: [{ orderCount: "desc" }, { productId: "asc" }],
    take: 50,
  });
  const fill =
    stats.length < 50
      ? await prisma.product.findMany({
          where: {
            shop,
            id: { notIn: stats.map(({ productId }) => productId) },
            ...filter,
          },
          orderBy: [{ title: "asc" }, { id: "asc" }],
          take: 50 - stats.length,
        })
      : [];
  return [
    ...stats.map(({ product, orderCount }) => ({ product, orderCount })),
    ...fill.map((product) => ({ product, orderCount: 0 })),
  ];
}

export async function pairingAdminData(
  shop: string,
  sourceId?: string,
  search = "",
) {
  const topPromise = topPairingProducts(shop);
  const [top, displayed, settings] = await Promise.all([
    topPromise,
    search ? topPairingProducts(shop, search) : topPromise,
    prisma.appSettings.findUnique({
      where: { shop },
      select: {
        verticalPreset: true,
        pairingMode: true,
        pairingStrictness: true,
        pairingSensitiveKeywords: true,
      },
    }),
  ]);
  const source = sourceId
    ? await prisma.product.findFirst({ where: { shop, id: sourceId } })
    : displayed[0]?.product || null;
  const traffic = await prisma.$queryRaw<
    Array<{ productId: string; views: number }>
  >(pairingTrafficQuery(shop));
  const queueSourceIds = [
    ...new Set([
      ...traffic.map((row) => row.productId),
      ...top.map((row) => row.product.id),
    ]),
  ].slice(0, 100);
  const reviewIds = queueSourceIds.length
    ? await prisma.$queryRaw<Array<{ id: string }>>(
        reviewPairingIdsQuery(
          shop,
          queueSourceIds.map((productId) => ({
            productId,
            views:
              traffic.find((row) => row.productId === productId)?.views || 0,
          })),
        ),
      )
    : [];
  const [rows, covered, queue] = await Promise.all([
    source
      ? prisma.productRelationship.findMany({
          where: { shop, sourceProductId: source.id },
          include: { target: true },
          orderBy: [
            { status: "asc" },
            { position: "asc" },
            { createdAt: "asc" },
            { id: "asc" },
          ],
          take: 100,
        })
      : Promise.resolve([]),
    top.length
      ? prisma.productRelationship.groupBy({
          by: ["sourceProductId", "status"],
          where: {
            shop,
            sourceProductId: { in: top.map(({ product }) => product.id) },
            kind: "complement",
            status: {
              in:
                normalizePairingMode(settings?.pairingMode) === "autopilot"
                  ? ["approved", "auto_approved"]
                  : ["approved"],
            },
          },
        })
      : Promise.resolve([]),
    reviewIds.length
      ? prisma.productRelationship.findMany({
          where: {
            shop,
            id: { in: reviewIds.map((row) => row.id) },
            kind: "complement",
            OR: [
              { status: { in: ["suggested", "demoted"] } },
              { performanceFlag: true },
            ],
          },
          include: { source: true, target: true },
          orderBy: [{ confidence: "asc" }, { id: "asc" }],
          take: 100,
        })
      : Promise.resolve([]),
  ]);
  const summary = (product: {
    id: string;
    title: string;
    imageUrl: string | null;
  }) => ({ id: product.id, title: product.title, imageUrl: product.imageUrl });
  return {
    source: source ? summary(source) : null,
    products: displayed.map(({ product, orderCount }) => ({
      ...summary(product),
      orderCount,
    })),
    generationSourceIds: top.map(({ product }) => product.id),
    coverage: {
      count: new Set(covered.map((row) => row.sourceProductId)).size,
      total: top.length,
      merchant: covered.filter((row) => row.status === "approved").length,
      autopilot: covered.filter((row) => row.status === "auto_approved").length,
    },
    mode: normalizePairingMode(settings?.pairingMode),
    strictness: normalizeStrictness(settings?.pairingStrictness),
    sensitiveKeywords: settings?.pairingSensitiveKeywords || [],
    attentionCount: queue.length,
    reviewQueue: queue
      .map((row) => ({
        id: row.id,
        kind: row.kind,
        status: row.status,
        confidence: row.confidence,
        sourceProductId: row.sourceProductId,
        sourceTitle: row.source.title,
        target: summary(row.target),
        origin: row.origin,
        views:
          traffic.find((entry) => entry.productId === row.sourceProductId)
            ?.views || 0,
        why: evidenceExplanation(row.evidence, row.performanceFlag),
      }))
      .sort(
        (a, b) =>
          b.views - a.views ||
          a.confidence - b.confidence ||
          a.id.localeCompare(b.id),
      )
      .slice(0, 100),
    preset:
      settings?.verticalPreset === "beauty_haircare"
        ? "beauty_haircare"
        : "generic",
    relationships: rows.map((row) => ({
      id: row.id,
      sourceProductId: row.sourceProductId,
      kind: row.kind,
      status: row.status,
      origin: row.origin,
      reason: row.reason,
      confidence: row.confidence,
      position: row.position,
      performanceFlag: row.performanceFlag,
      why: evidenceExplanation(row.evidence, row.performanceFlag),
      target: summary(row.target),
    })),
  };
}
function evidenceExplanation(value: unknown, flagged = false) {
  const evidence =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const fields = Array.isArray(evidence.fields)
    ? evidence.fields
        .filter(
          (field): field is string =>
            typeof field === "string" &&
            /^(source|target)\.(title|tags|productType|vendor|collectionIds)$|^affinity\.orderCount$/.test(
              field,
            ),
        )
        .slice(0, 8)
    : [];
  const labels: Record<string, string> = {
    title: "product titles",
    tags: "catalog tags",
    productType: "product types",
    vendor: "shared brand",
    collectionIds: "shared collections",
    orderCount: "recorded co-purchases",
  };
  const reasons = [
    ...new Set(
      fields.map((field) => labels[field.split(".")[1]]).filter(Boolean),
    ),
  ];
  return `${evidence.sensitive === true ? "Sensitive wording requires your review. " : ""}${flagged ? "Acceptance is below comparable pairs; review recommended. " : ""}${reasons.length ? `Matched ${reasons.join(", ")}.` : "Merchant selection or legacy catalog pairing."}`;
}

async function ownedPair(
  shop: string,
  sourceProductId: string,
  targetProductId: string,
) {
  if (sourceProductId === targetProductId)
    throw new PairingAdminError("Choose a different target product.");
  const products = await prisma.product.findMany({
    where: { shop, id: { in: [sourceProductId, targetProductId] } },
    select: { id: true },
    take: 2,
  });
  if (products.length !== 2)
    throw new PairingAdminError(
      "Both products must belong to your synced catalog.",
      404,
    );
}

export async function changeRelationshipStatus(
  shop: string,
  id: string,
  status: "approved" | "rejected",
) {
  const row = await prisma.productRelationship.findFirst({
    where: { shop, id },
  });
  if (!row || row.kind === "exclude")
    throw new PairingAdminError("Pairing not found.", 404);
  if (status === "approved") {
    const excluded = await prisma.productRelationship.findFirst({
      where: {
        shop,
        sourceProductId: row.sourceProductId,
        targetProductId: row.targetProductId,
        kind: "exclude",
      },
    });
    if (excluded)
      throw new PairingAdminError(
        "Remove this product's exclusion before approving the pairing.",
        409,
      );
  }
  const result = await prisma.productRelationship.updateMany({
    where: { shop, id, kind: { not: "exclude" }, status: row.status },
    data:
      status === "approved"
        ? {
            status,
            origin: "merchant",
            reasonCode: "merchant_selected",
            reason: pairingReason("merchant_selected"),
            performanceFlag: false,
            previousStatus: null,
          }
        : {
            status,
            previousStatus:
              row.status === "rejected" ? row.previousStatus : row.status,
          },
  });
  if (!result.count)
    throw new PairingAdminError(
      "This pairing changed. Refresh it before reviewing again.",
      409,
    );
  return result;
}
export async function undoPairingRejection(shop: string, id: string) {
  const row = await prisma.productRelationship.findFirst({
    where: { shop, id, kind: "complement", status: "rejected" },
  });
  if (!row) throw new PairingAdminError("Rejected pairing not found.", 404);
  const status = ["approved", "auto_approved", "demoted"].includes(
    row.previousStatus || "",
  )
    ? (row.previousStatus as "approved" | "auto_approved" | "demoted")
    : "suggested";
  const excluded = await prisma.productRelationship.findFirst({
    where: {
      shop,
      sourceProductId: row.sourceProductId,
      targetProductId: row.targetProductId,
      kind: "exclude",
    },
  });
  if (excluded)
    throw new PairingAdminError(
      "Remove the exclusion before undoing rejection.",
      409,
    );
  return prisma.productRelationship.updateMany({
    where: { shop, id, status: "rejected" },
    data: { status, previousStatus: null },
  });
}

export async function saveMerchantPair(input: {
  shop: string;
  sourceProductId: string;
  targetProductId: string;
  replaceId?: string;
  exclude?: boolean;
  reason?: string;
}) {
  await ownedPair(input.shop, input.sourceProductId, input.targetProductId);
  const reason = String(
    input.reason ||
      (input.exclude
        ? "Excluded by your store."
        : "Selected by your store to go with this product."),
  )
    .trim()
    .replace(/[<>]/g, "")
    .slice(0, 240);
  return prisma.$transaction(async (tx) => {
    const { shop, sourceProductId, targetProductId } = input;
    if (input.replaceId) {
      const old = await tx.productRelationship.findFirst({
        where: {
          shop,
          id: input.replaceId,
          sourceProductId,
          kind: { not: "exclude" },
        },
      });
      if (!old)
        throw new PairingAdminError("Pairing to replace was not found.", 404);
    }
    if (!input.exclude) {
      const excluded = await tx.productRelationship.findFirst({
        where: { shop, sourceProductId, targetProductId, kind: "exclude" },
      });
      if (excluded)
        throw new PairingAdminError(
          "Remove this product's exclusion first.",
          409,
        );
    }
    if (input.replaceId)
      await tx.productRelationship.updateMany({
        where: {
          shop,
          id: input.replaceId,
          sourceProductId,
          kind: { not: "exclude" },
        },
        data: { status: "rejected" },
      });
    if (input.exclude)
      await tx.productRelationship.updateMany({
        where: {
          shop,
          sourceProductId,
          targetProductId,
          kind: { in: ["complement", "upgrade"] },
        },
        data: { status: "rejected" },
      });
    const kind = input.exclude ? ("exclude" as const) : ("complement" as const);
    return tx.productRelationship.upsert({
      where: {
        shop_sourceProductId_targetProductId_kind: {
          shop,
          sourceProductId,
          targetProductId,
          kind,
        },
      },
      update: {
        status: "approved",
        origin: "merchant",
        reason,
        reasonCode: "merchant_selected",
        previousStatus: null,
      },
      create: {
        shop,
        sourceProductId,
        targetProductId,
        kind,
        status: "approved",
        origin: "merchant",
        reasonCode: "merchant_selected",
        reason,
      },
    });
  });
}

export async function removePairingExclusion(shop: string, id: string) {
  return prisma.productRelationship.deleteMany({
    where: { shop, id, kind: "exclude" },
  });
}

export async function bulkApprovePairings(shop: string) {
  const top = await topPairingProducts(shop);
  if (!top.length) return 0;
  const rows = await prisma.productRelationship.findMany({
    where: {
      shop,
      sourceProductId: { in: top.map(({ product }) => product.id) },
      kind: "complement",
      status: "suggested",
      confidence: { gte: HIGH_CONFIDENCE_PAIRING },
    },
    select: { id: true, sourceProductId: true, targetProductId: true },
    orderBy: { id: "asc" },
    take: 250,
  });
  const ids = Array.from(
    new Set(rows.map(({ targetProductId }) => targetProductId)),
  );
  const [settings, excluded, products] = await Promise.all([
    prisma.appSettings.findUnique({
      where: { shop },
      select: { blockedProductIds: true, excludedCollectionIds: true },
    }),
    rows.length
      ? prisma.productRelationship.findMany({
          where: {
            shop,
            sourceProductId: { in: top.map(({ product }) => product.id) },
            targetProductId: { in: ids },
            kind: "exclude",
          },
          select: { sourceProductId: true, targetProductId: true },
          take: 50 * ids.length,
        })
      : Promise.resolve([]),
    Promise.all(
      [ids.slice(0, 100), ids.slice(100, 200), ids.slice(200)]
        .filter((chunk) => chunk.length)
        .map((chunk) => getCatalogProductsByIds(shop, chunk)),
    ),
  ]);
  const available = new Set(
    filterCatalogProducts(products.flat(), settings?.blockedProductIds || [])
      .filter(
        (product) =>
          !(product.collectionIds || []).some((id) =>
            settings?.excludedCollectionIds.includes(id),
          ),
      )
      .map(({ id }) => id),
  );
  const denied = new Set(
    excluded.map((row) => `${row.sourceProductId}:${row.targetProductId}`),
  );
  const approvedIds = rows
    .filter(
      (row) =>
        available.has(row.targetProductId) &&
        !denied.has(`${row.sourceProductId}:${row.targetProductId}`),
    )
    .map(({ id }) => id);
  if (!approvedIds.length) return 0;
  const result = await prisma.productRelationship.updateMany({
    where: {
      shop,
      id: { in: approvedIds },
      status: "suggested",
      kind: "complement",
      confidence: { gte: HIGH_CONFIDENCE_PAIRING },
    },
    data: {
      status: "approved",
      origin: "merchant",
      reasonCode: "merchant_selected",
      performanceFlag: false,
      previousStatus: null,
    },
  });
  return result.count;
}
