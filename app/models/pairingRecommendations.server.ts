import type { AppSettings } from "@prisma/client";
import type { OfferDecision, OfferCandidate } from "../ai/types";
import prisma from "../db.server";
import {
  getCatalogProductsByIds,
  getRecommendationCatalog,
  pickCatalogProducts,
  type CatalogCacheProduct,
} from "./catalogCache.server";
import {
  enforceCatalogBackedDecision,
  filterCatalogProducts,
} from "./catalogGuard.server";
import { productGid, normalizeVerticalPreset } from "./productPairings";
import { stripPrivateSignals } from "../utils/storefrontPayload.server";
import {
  inPriceBand,
  isSensitivePair,
  nearDuplicate,
  normalizePairingMode,
  pairingReason,
  pairingEvidence,
  approvalStatus,
  type AutopilotProduct,
} from "./pairingAutopilot";

export type PairingRules = Pick<
  AppSettings,
  | "blockedProductIds"
  | "excludedCollectionIds"
  | "preferredProductIds"
  | "upsellPriorityProductIds"
>;
type PairingPolicy = {
  verticalPreset?: string;
  pairingMode?: string;
  pairingStrictness?: string;
  pairingSensitiveKeywords?: string[];
};
function currentAutoPair(
  source: AutopilotProduct,
  target: AutopilotProduct,
  row: { confidence: number; origin: string; reasonCode: string | null },
  policy: PairingPolicy | null | undefined,
  orders = 0,
) {
  return (
    approvalStatus({
      mode: policy?.pairingMode,
      strictness: policy?.pairingStrictness,
      confidence: row.confidence,
      sensitive: isSensitivePair(
        source,
        target,
        policy?.pairingSensitiveKeywords,
      ),
      fallback: row.origin !== "ai",
    }) === "auto_approved" &&
    pairingEvidence(
      source,
      target,
      normalizeVerticalPreset(policy?.verticalPreset),
      orders,
    ).some((entry) => entry.reasonCode === row.reasonCode)
  );
}
const MAX_CONTEXT_PRODUCTS = 100;
const MAX_POOL_PRODUCTS = 150;
type PairPolicy = { targetProductId: string; kind: string; status: string };

export function pairingDeniedTargets(
  primary: PairPolicy[],
  exclusions: Array<{ targetProductId: string }>,
) {
  return new Set([
    ...exclusions.map((row) => row.targetProductId),
    ...primary
      .filter(
        (row) =>
          row.kind === "upgrade" ||
          row.status === "rejected" ||
          row.status === "demoted",
      )
      .map((row) => row.targetProductId),
  ]);
}

export async function getPairingDenials(input: {
  shop: string;
  sourceProductId?: string;
  cartProductIds?: string[];
  targetProductIds: string[];
  settings?: PairingPolicy & Partial<PairingRules>;
}) {
  const sources = Array.from(
    new Set(
      [input.sourceProductId || "", ...(input.cartProductIds || [])]
        .filter(Boolean)
        .map(productGid),
    ),
  );
  const targets = Array.from(new Set(input.targetProductIds.map(productGid)));
  if (!sources.length || !targets.length) return new Set<string>();
  if (
    sources.length > MAX_CONTEXT_PRODUCTS ||
    targets.length > MAX_POOL_PRODUCTS
  )
    return new Set(targets);
  const [primary, exclusions] = await Promise.all([
    input.sourceProductId
      ? prisma.productRelationship.findMany({
          where: {
            shop: input.shop,
            sourceProductId: productGid(input.sourceProductId),
            targetProductId: { in: targets },
            kind: { in: ["complement", "upgrade"] },
          },
          select: { targetProductId: true, kind: true, status: true },
          take: targets.length * 2,
        })
      : Promise.resolve([]),
    prisma.productRelationship.findMany({
      where: {
        shop: input.shop,
        sourceProductId: { in: sources },
        targetProductId: { in: targets },
        OR: [
          { kind: "exclude" },
          { kind: "complement", status: { in: ["rejected", "demoted"] } },
        ],
      },
      select: { targetProductId: true },
      take: sources.length * targets.length,
    }),
  ]);
  const denied = pairingDeniedTargets(primary, exclusions);
  if (primary.some((row) => row.status === "auto_approved")) {
    const mode =
      input.settings?.pairingMode ??
      (
        await prisma.appSettings.findUnique({
          where: { shop: input.shop },
          select: { pairingMode: true },
        })
      )?.pairingMode;
    if (normalizePairingMode(mode) !== "autopilot")
      primary
        .filter((row) => row.status === "auto_approved")
        .forEach((row) => denied.add(row.targetProductId));
  }
  return denied;
}

export async function selectPairingRecommendations(input: {
  shop: string;
  sourceProductId?: string;
  cartProductIds?: string[];
  excludeProductIds?: string[];
  settings?: PairingRules & PairingPolicy;
  limit?: number;
}) {
  const sourceId = input.sourceProductId
    ? productGid(input.sourceProductId)
    : undefined;
  const [rules, catalog, sourceOwned, approved, affinities] = await Promise.all(
    [
      input.settings ||
        prisma.appSettings.findUnique({
          where: { shop: input.shop },
          select: {
            blockedProductIds: true,
            excludedCollectionIds: true,
            preferredProductIds: true,
            upsellPriorityProductIds: true,
            pairingMode: true,
            pairingStrictness: true,
            pairingSensitiveKeywords: true,
            verticalPreset: true,
          },
        }),
      getRecommendationCatalog({ shop: input.shop, sourceProductId: sourceId }),
      sourceId
        ? prisma.product.findFirst({
            where: { shop: input.shop, id: sourceId },
            select: {
              id: true,
              title: true,
              vendor: true,
              productType: true,
              tags: true,
              collectionIds: true,
              price: true,
              metafields: true,
            },
          })
        : Promise.resolve(true),
      sourceId
        ? prisma.productRelationship.findMany({
            where: {
              shop: input.shop,
              sourceProductId: sourceId,
              kind: "complement",
              status: { in: ["approved", "auto_approved"] },
            },
            select: {
              targetProductId: true,
              reasonCode: true,
              status: true,
              confidence: true,
              origin: true,
            },
            orderBy: [
              { status: "asc" },
              { position: "asc" },
              { createdAt: "asc" },
              { id: "asc" },
            ],
            take: 50,
          })
        : Promise.resolve([]),
      sourceId
        ? prisma.productAffinity.findMany({
            where: {
              shop: input.shop,
              sourceId,
              orderCount: { gt: 0 },
              score: { gt: 0 },
            },
            select: { targetId: true, score: true, orderCount: true },
            orderBy: [{ score: "desc" }, { targetId: "asc" }],
            take: 50,
          })
        : Promise.resolve([]),
    ],
  );
  if (!sourceOwned) return [];
  const excludedIds = [
    ...(rules?.blockedProductIds || []),
    ...(input.excludeProductIds || []),
  ].map(productGid);
  const fallback = pickCatalogProducts({
    catalog,
    sourceProductId: sourceId,
    cartProductIds: input.cartProductIds,
    excludeProductIds: excludedIds,
    limit: 50,
  });
  const ids = Array.from(
    new Set([
      ...approved.map((row) => row.targetProductId),
      ...affinities.map((row) => row.targetId),
      ...fallback.map(({ id }) => id),
    ]),
  ).slice(0, MAX_POOL_PRODUCTS);
  const chunks = [ids.slice(0, 100), ids.slice(100)].filter(
    (chunk) => chunk.length,
  );
  const [freshChunks, denied] = await Promise.all([
    Promise.all(
      chunks.map((chunk) => getCatalogProductsByIds(input.shop, chunk)),
    ),
    getPairingDenials({
      shop: input.shop,
      sourceProductId: sourceId,
      cartProductIds: input.cartProductIds,
      targetProductIds: ids,
      settings: rules || undefined,
    }),
  ]);
  const excludedCollections = new Set(rules?.excludedCollectionIds || []);
  const inCart = new Set([
    sourceId || "",
    ...(input.cartProductIds || []).map(productGid),
  ]);
  const sourceProduct =
    sourceOwned && typeof sourceOwned === "object" && "title" in sourceOwned
      ? sourceOwned
      : null;
  const merchantTargets = new Set(
    approved
      .filter((row) => row.status !== "auto_approved")
      .map((row) => row.targetProductId),
  );
  const activeAuto = normalizePairingMode(rules?.pairingMode) === "autopilot";
  const policyTarget = (product: CatalogCacheProduct) => ({
    ...product,
    collectionIds: product.collectionIds || [],
  });
  approved
    .filter((row) => row.status === "auto_approved" && !activeAuto)
    .forEach((row) => denied.add(row.targetProductId));
  for (const row of approved)
    if (row.status === "auto_approved" && sourceProduct) {
      const target = freshChunks
        .flat()
        .find((product) => product.id === row.targetProductId);
      if (
        !target ||
        !currentAutoPair(
          sourceProduct,
          policyTarget(target),
          row,
          rules,
          affinities.find((pair) => pair.targetId === row.targetProductId)
            ?.orderCount,
        )
      )
        denied.add(row.targetProductId);
    }
  const fresh = filterCatalogProducts(freshChunks.flat(), excludedIds).filter(
    (product) =>
      !denied.has(product.id) &&
      !inCart.has(product.id) &&
      (!sourceProduct ||
        merchantTargets.has(product.id) ||
        (!isSensitivePair(
          sourceProduct,
          policyTarget(product),
          rules?.pairingSensitiveKeywords,
        ) &&
          !nearDuplicate(sourceProduct, policyTarget(product)) &&
          inPriceBand(sourceProduct, policyTarget(product)))) &&
      !(product.collectionIds || []).some((id) => excludedCollections.has(id)),
  );
  const byId = new Map(fresh.map((product) => [product.id, product]));
  const results: Array<{
    product: CatalogCacheProduct;
    reason: string;
    tier: "approved" | "auto_approved" | "copurchase" | "catalog";
  }> = [];
  const seen = new Set<string>();
  const add = (
    id: string,
    reason: string,
    tier: (typeof results)[number]["tier"],
  ) => {
    const product = byId.get(id);
    if (product && !seen.has(id)) {
      results.push({ product, reason, tier });
      seen.add(id);
    }
  };
  approved
    .filter((row) => row.status !== "auto_approved")
    .forEach((row) =>
      add(row.targetProductId, pairingReason("merchant_selected"), "approved"),
    );
  if (activeAuto)
    approved
      .filter((row) => row.status === "auto_approved")
      .forEach((row) =>
        add(
          row.targetProductId,
          pairingReason(
            row.reasonCode,
            sourceProduct?.title,
            byId.get(row.targetProductId)?.title,
          ),
          "auto_approved",
        ),
      );
  affinities.forEach((row) =>
    add(
      row.targetId,
      pairingReason("frequently_bought_together"),
      "copurchase",
    ),
  );
  const preferred = new Set(
    [
      ...(rules?.preferredProductIds || []),
      ...(rules?.upsellPriorityProductIds || []),
    ].map(productGid),
  );
  fallback
    .map((product, index) => ({ product, index }))
    .sort(
      (a, b) =>
        Number(preferred.has(b.product.id)) -
          Number(preferred.has(a.product.id)) || a.index - b.index,
    )
    .forEach(({ product }) =>
      add(product.id, pairingReason("catalog_selected"), "catalog"),
    );
  return results.slice(0, Math.max(1, Math.min(input.limit || 5, 20)));
}

export function cachedProductsMatchCandidates(
  decision: OfferDecision,
  candidates: OfferCandidate[],
) {
  if (
    !["upsell_drawer", "rec_strip", "social_proof", "post_purchase"].includes(
      decision.widgetType || "",
    )
  )
    return true;
  const products = Array.isArray(decision.payload.products)
    ? decision.payload.products
    : [];
  const selected = candidates.filter(
    (candidate) => candidate.type === "product",
  );
  if (!products.length || products.length > selected.length) return false;
  return products.every((item, index) => {
    const record = item as Record<string, any>;
    return (
      productGid(
        String(record.productId || record.targetId || record.product?.id || ""),
      ) === selected[index].productId &&
      String(record.reason || "") ===
        String(
          (selected[index].payload.affinity as { reason?: string })?.reason ||
            "",
        )
    );
  });
}

export async function enforcePairingDecisionPolicy(input: {
  shop: string;
  sourceProductId?: string;
  cartProductIds?: string[];
  settings: PairingRules & PairingPolicy;
  decision: OfferDecision;
}): Promise<OfferDecision> {
  if (!input.decision.widgetType) return stripPrivateSignals(input.decision);
  const ids = new Set<string>();
  let visited = 0;
  const collect = (value: unknown, depth = 0) => {
    if (++visited > 2000 || depth > 10) return;
    if (
      typeof value === "string" &&
      /^gid:\/\/shopify\/Product\/\d+$/.test(value)
    )
      ids.add(value);
    else if (Array.isArray(value))
      value.slice(0, 100).forEach((item) => collect(item, depth + 1));
    else if (value && typeof value === "object")
      Object.values(value).forEach((item) => collect(item, depth + 1));
  };
  collect(input.decision.payload);
  // Run the existing guard first: numeric IDs/handles become canonical product IDs.
  const guarded = await enforceCatalogBackedDecision({
    shop: input.shop,
    decision: input.decision,
    excludedProductIds: input.settings.blockedProductIds,
  });
  collect(guarded.payload);
  const sourceId = input.sourceProductId
    ? productGid(input.sourceProductId)
    : undefined;
  const [denied, products, source, rows, affinities] = await Promise.all([
    getPairingDenials({ ...input, targetProductIds: [...ids] }),
    getCatalogProductsByIds(input.shop, [...ids]),
    sourceId
      ? prisma.product.findFirst({ where: { shop: input.shop, id: sourceId } })
      : Promise.resolve(null),
    sourceId
      ? prisma.productRelationship.findMany({
          where: {
            shop: input.shop,
            sourceProductId: sourceId,
            targetProductId: { in: [...ids] },
            kind: "complement",
            status: { in: ["approved", "auto_approved"] },
          },
          select: {
            targetProductId: true,
            status: true,
            reasonCode: true,
            confidence: true,
            origin: true,
          },
          take: ids.size,
        })
      : Promise.resolve([]),
    sourceId
      ? prisma.productAffinity.findMany({
          where: {
            shop: input.shop,
            sourceId,
            targetId: { in: [...ids] },
            orderCount: { gt: 0 },
            score: { gt: 0 },
          },
          select: { targetId: true, orderCount: true },
          take: ids.size,
        })
      : Promise.resolve([]),
  ]);
  for (const row of rows)
    if (row.status === "auto_approved" && source) {
      const target = products.find(
        (product) => product.id === row.targetProductId,
      );
      if (
        !target ||
        !currentAutoPair(
          source,
          { ...target, collectionIds: target.collectionIds || [] },
          row,
          input.settings,
          affinities.find((pair) => pair.targetId === row.targetProductId)
            ?.orderCount,
        )
      )
        denied.add(row.targetProductId);
    }
  for (const product of products)
    if (
      (product.collectionIds || []).some((id) =>
        input.settings.excludedCollectionIds.includes(id),
      ) ||
      (sourceId &&
        (!source ||
          (rows.find((row) => row.targetProductId === product.id)?.status !==
            "approved" &&
            (isSensitivePair(
              source,
              { ...product, collectionIds: product.collectionIds || [] },
              input.settings.pairingSensitiveKeywords,
            ) ||
              nearDuplicate(source, {
                ...product,
                collectionIds: product.collectionIds || [],
              }) ||
              !inPriceBand(source, {
                ...product,
                collectionIds: product.collectionIds || [],
              })))))
    )
      denied.add(product.id);
  if (
    guarded.widgetType === "bundle" &&
    [...ids].some((id) => denied.has(id))
  ) {
    return {
      widgetType: null,
      payload: {},
      reasoning: "A bundle item is excluded for this product.",
      confidence: 0,
      aiProvider: guarded.aiProvider,
    };
  }
  const safe = denied.size
    ? await enforceCatalogBackedDecision({
        shop: input.shop,
        decision: guarded,
        excludedProductIds: [...input.settings.blockedProductIds, ...denied],
      })
    : guarded;
  if (
    ["upsell_drawer", "upsell", "rec_strip", "social_proof"].includes(
      safe.widgetType || "",
    )
  ) {
    const byId = new Map(products.map((product) => [product.id, product]));
    const rewrite = (value: unknown): any => {
      if (Array.isArray(value)) return value.map(rewrite);
      if (!value || typeof value !== "object") return value;
      const object = value as Record<string, any>;
      const id = productGid(
        String(object.productId || object.product?.id || object.id || ""),
      );
      const pair = rows.find((row) => row.targetProductId === id);
      const code =
        pair?.status === "approved"
          ? "merchant_selected"
          : pair?.reasonCode ||
            (affinities.some((row) => row.targetId === id)
              ? "frequently_bought_together"
              : "catalog_selected");
      return {
        ...object,
        ...(byId.has(id)
          ? { reason: pairingReason(code, source?.title, byId.get(id)?.title) }
          : {}),
      };
    };
    const firstCard: any = Array.isArray(safe.payload.products)
      ? safe.payload.products[0]
      : null;
    const firstId = productGid(
      String(firstCard?.productId || firstCard?.product?.id || ""),
    );
    const firstPair = rows.find((row) => row.targetProductId === firstId);
    const firstCode =
      firstPair?.status === "approved"
        ? "merchant_selected"
        : firstPair?.reasonCode ||
          (affinities.some((row) => row.targetId === firstId)
            ? "frequently_bought_together"
            : "catalog_selected");
    const metadata = Object.fromEntries(
      Object.entries(safe.payload).filter(([key]) =>
        [
          "triggerType",
          "mutationId",
          "maxProductRecommendations",
          "offerId",
          "abVariant",
          "presentation",
          "cartDrawer",
        ].includes(key),
      ),
    );
    safe.payload = {
      ...metadata,
      ...(Array.isArray(safe.payload.products)
        ? { products: rewrite(safe.payload.products) }
        : {}),
      copy: {
        headline: pairingReason(
          firstCode,
          source?.title,
          byId.get(firstId)?.title,
        ),
        ctaAccept: "Add to cart",
        ctaDecline: "Not now",
      },
    };
  }
  return stripPrivateSignals(safe);
}
