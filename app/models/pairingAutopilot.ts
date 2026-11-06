import { z } from "zod";
import { createHash } from "node:crypto";
import {
  inferRoutineStage,
  ROUTINE_COMPLEMENTS,
  type PairingProduct,
  type PairingCandidate,
  type VerticalPreset,
} from "./productPairings";
export const PAIRING_THRESHOLDS = {
  cautious: 0.95,
  balanced: 0.9,
  broad: 0.85,
} as const;
export const FALLBACK_APPROVAL_THRESHOLD = 0.96;
export const NEAR_DUPLICATE_SIMILARITY = 0.8;
export const TARGET_PRICE_RATIO = { minimum: 0.15, maximum: 2 } as const;
export const DESCRIPTION_LIMIT = 800;
export const SENSITIVE_PAIRING_KEYWORDS = [
  "bleach",
  "peroxide",
  "relaxer",
  "chemical",
  "treatment",
  "supplement",
  "vitamin",
  "retinol",
  "retinoid",
  "acid",
  "scalp",
  "hair loss",
  "dandruff",
  "eczema",
  "psoriasis",
  "allergy",
  "allergic",
  "clinically",
  "medical",
  "cure",
  "heal",
  "antifungal",
  "antibacterial",
  "pregnancy",
  "repair",
  "repairing",
  "repairs",
  "healing",
  "heals",
  "cures",
  "health",
  "healthy",
  "treatments",
  "supplements",
  "vitamins",
  "chemically",
  "bleaching",
  "keratin",
  "medicated",
  "regrowth",
  "acne",
];
export const REASON_CODES = [
  "completes_routine",
  "same_use_case",
  "replenishes_with",
  "tool_for_product",
  "same_collection_set",
  "same_brand",
  "frequently_bought_together",
  "merchant_selected",
  "catalog_selected",
] as const;
export type PairingReasonCode = (typeof REASON_CODES)[number];
export type PairingMode = "autopilot" | "review_first" | "off";
export type PairingStrictness = keyof typeof PAIRING_THRESHOLDS;
export const normalizePairingMode = (value: unknown): PairingMode =>
  value === "autopilot" || value === "off" ? value : "review_first";
export const normalizeStrictness = (value: unknown): PairingStrictness =>
  value === "cautious" || value === "broad" ? value : "balanced";
export type AutopilotProduct = PairingProduct & {
  price?: unknown;
  metafields?: unknown;
};
export function pairingPolicySettings(settings: Record<string, any> = {}) {
  return {
    verticalPreset: settings.verticalPreset || "generic",
    pairingMode: normalizePairingMode(settings.pairingMode),
    pairingStrictness: normalizeStrictness(settings.pairingStrictness),
    pairingSensitiveKeywords: [
      ...(settings.pairingSensitiveKeywords || []),
    ].sort(),
    blockedProductIds: [...(settings.blockedProductIds || [])].sort(),
    excludedCollectionIds: [...(settings.excludedCollectionIds || [])].sort(),
  };
}
const words = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
function descriptionText(product: AutopilotProduct) {
  const meta = product.metafields as Record<string, any> | undefined;
  const value = meta?.["aovboost.description"];
  return String(value?.value || (typeof value === "string" ? value : ""))
    .replace(/<[^>]*>/g, " ")
    .slice(0, 10_000);
}
export function plainDescription(product: AutopilotProduct) {
  return descriptionText(product)
    .split(/[\r\n]+/)
    .filter(
      (line) => !/\b(cost|margin|stock|inventory|units? left)\b/i.test(line),
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .slice(0, DESCRIPTION_LIMIT);
}
export function catalogHash(
  product: AutopilotProduct,
  settings: Record<string, unknown> = {},
) {
  const meta = product.metafields as Record<string, any> | undefined;
  return createHash("sha256")
    .update(
      JSON.stringify({
        id: product.id,
        title: product.title,
        vendor: product.vendor,
        productType: product.productType,
        tags: product.tags,
        collections: product.collectionIds,
        price: String(product.price || ""),
        description: descriptionText(product),
        available: meta?.["aovboost.availableForSale"],
        settings: pairingPolicySettings(settings),
      }),
    )
    .digest("hex");
}
export function isSensitivePair(
  source: AutopilotProduct,
  target: AutopilotProduct,
  additions: string[] = [],
) {
  const text = ` ${words([source, target].map((p) => [p.title, p.productType, p.vendor, (p.tags || []).join(" "), descriptionText(p)].join(" ")).join(" ")).join(" ")} `;
  return [...SENSITIVE_PAIRING_KEYWORDS, ...additions.slice(0, 30)].some(
    (keyword) => {
      const normalized = words(keyword.slice(0, 80)).join(" ");
      return normalized && text.includes(` ${normalized} `);
    },
  );
}
export function nearDuplicate(
  source: AutopilotProduct,
  target: AutopilotProduct,
) {
  if (
    !source.vendor ||
    !source.productType ||
    words(source.vendor).join(" ") !== words(target.vendor || "").join(" ") ||
    words(source.productType).join(" ") !==
      words(target.productType || "").join(" ")
  )
    return false;
  const a = new Set(words(source.title)),
    b = new Set(words(target.title));
  const intersection = [...a].filter((word) => b.has(word)).length;
  return (
    intersection / Math.max(1, new Set([...a, ...b]).size) >=
    NEAR_DUPLICATE_SIMILARITY
  );
}
export function inPriceBand(
  source: AutopilotProduct,
  target: AutopilotProduct,
) {
  const a = Number(source.price),
    b = Number(target.price);
  return (
    Number.isFinite(a) &&
    a > 0 &&
    Number.isFinite(b) &&
    b > 0 &&
    b / a >= TARGET_PRICE_RATIO.minimum &&
    b / a <= TARGET_PRICE_RATIO.maximum
  );
}
export function pairingEvidence(
  source: AutopilotProduct,
  target: AutopilotProduct,
  preset: VerticalPreset,
  orders = 0,
) {
  const codes: Array<{
    reasonCode: PairingReasonCode;
    supportingFields: string[];
  }> = [];
  const sourceStage =
    preset === "beauty_haircare" ? inferRoutineStage(source) : null;
  const targetStage =
    preset === "beauty_haircare" ? inferRoutineStage(target) : null;
  if (
    sourceStage &&
    targetStage &&
    ROUTINE_COMPLEMENTS[sourceStage].includes(targetStage)
  )
    codes.push({
      reasonCode:
        targetStage === "tools" ? "tool_for_product" : "completes_routine",
      supportingFields: [
        "source.productType",
        "source.tags",
        "source.title",
        "target.productType",
        "target.tags",
        "target.title",
      ],
    });
  if (source.productType && source.productType === target.productType)
    codes.push({
      reasonCode: "same_use_case",
      supportingFields: ["source.productType", "target.productType"],
    });
  if (source.collectionIds.some((id) => target.collectionIds.includes(id)))
    codes.push({
      reasonCode: "same_collection_set",
      supportingFields: ["source.collectionIds", "target.collectionIds"],
    });
  if (source.vendor && source.vendor === target.vendor)
    codes.push({
      reasonCode: "same_brand",
      supportingFields: ["source.vendor", "target.vendor"],
    });
  if (orders > 0)
    codes.push({
      reasonCode: "frequently_bought_together",
      supportingFields: ["affinity.orderCount"],
    });
  if (target.tags.some((tag) => /^(refill|replenish)$/i.test(tag)))
    codes.push({
      reasonCode: "replenishes_with",
      supportingFields: ["target.tags"],
    });
  return codes;
}
export const pairingReason = (
  code: unknown,
  source = "this product",
  target = "this add-on",
) => {
  const safeSource = source.slice(0, 120),
    safeTarget = target.slice(0, 120);
  switch (code) {
    case "completes_routine":
      return `Complete your routine with ${safeTarget}.`;
    case "tool_for_product":
      return `A tool to pair with ${safeSource}.`;
    case "same_use_case":
      return `Explore ${safeTarget} alongside ${safeSource}.`;
    case "replenishes_with":
      return `A refill option to consider with ${safeSource}.`;
    case "same_collection_set":
      return "From a shared collection in this store.";
    case "same_brand":
      return "From the same brand in this store.";
    case "frequently_bought_together":
      return "Recorded together in this store's orders.";
    case "merchant_selected":
      return "Selected by this store to go together.";
    default:
      return "Selected from this store's catalog.";
  }
};
const reasonSchema = z
  .object({
    sourceProductId: z.string().max(128),
    targetId: z.string().max(128),
    confidence: z.number().min(0).max(1),
    reasonCode: z.enum(REASON_CODES),
    supportingFields: z.array(z.string().max(40)).min(1).max(8),
  })
  .strict();
export const pairingReasoningSchema = z
  .object({ pairings: z.array(reasonSchema).max(24) })
  .strict();
export function reasoningContext(
  source: AutopilotProduct,
  targets: AutopilotProduct[],
  candidates: PairingCandidate[],
  collectionTitles: Record<string, string>,
  preset: VerticalPreset = "generic",
) {
  const describe = (product: AutopilotProduct) => ({
    id: product.id,
    title: product.title.slice(0, 120),
    productType: (product.productType || "").slice(0, 100),
    vendor: (product.vendor || "").slice(0, 100),
    tags: product.tags.slice(0, 15).map((tag) => tag.slice(0, 60)),
    collectionIds: product.collectionIds.slice(0, 10),
    collections: product.collectionIds
      .slice(0, 10)
      .map((id) => ({ id, title: (collectionTitles[id] || "").slice(0, 100) })),
    description: plainDescription(product),
  });
  return {
    source: { ...describe(source), priceBand: "reference" },
    candidates: targets.map((target) => {
      const candidate = candidates.find(
        (pair) => pair.targetProductId === target.id,
      );
      const ratio = Number(target.price) / Number(source.price);
      const observed = candidate?.reasons.some((reason) =>
        reason.startsWith("Recorded together"),
      );
      return {
        ...describe(target),
        priceBand: ratio < 0.5 ? "lower" : ratio > 1.5 ? "higher" : "similar",
        affinity: observed ? "observed" : "none",
        allowedReasons: pairingEvidence(
          source,
          target,
          preset,
          observed ? 1 : 0,
        ),
      };
    }),
  };
}
export function validatedReasoning(
  raw: unknown,
  candidates: PairingCandidate[],
  sources: AutopilotProduct[],
  targets: AutopilotProduct[],
  preset: VerticalPreset,
) {
  const parsed = pairingReasoningSchema.safeParse(raw);
  if (!parsed.success) return [];
  const allowed = new Map(
    candidates.map((candidate) => [
      `${candidate.sourceProductId}:${candidate.targetProductId}`,
      candidate,
    ]),
  );
  const seen = new Set<string>();
  return parsed.data.pairings.filter((pair) => {
    const key = `${pair.sourceProductId}:${pair.targetId}`;
    const candidate = allowed.get(key),
      source = sources.find((product) => product.id === pair.sourceProductId),
      target = targets.find((product) => product.id === pair.targetId);
    if (
      !candidate ||
      !source ||
      !target ||
      source.id === target.id ||
      seen.has(key) ||
      nearDuplicate(source, target) ||
      !inPriceBand(source, target)
    )
      return false;
    const evidence = pairingEvidence(
      source,
      target,
      preset,
      candidate.reasons.some((reason) => reason.startsWith("Recorded together"))
        ? 1
        : 0,
    ).find((entry) => entry.reasonCode === pair.reasonCode);
    if (
      !evidence ||
      !pair.supportingFields.every((field) =>
        evidence.supportingFields.includes(field),
      )
    )
      return false;
    seen.add(key);
    return true;
  });
}
export function approvalStatus(input: {
  mode: unknown;
  strictness: unknown;
  confidence: number;
  sensitive: boolean;
  fallback: boolean;
}) {
  return normalizePairingMode(input.mode) === "autopilot" &&
    !input.sensitive &&
    input.confidence >=
      Math.max(
        PAIRING_THRESHOLDS[normalizeStrictness(input.strictness)],
        input.fallback ? FALLBACK_APPROVAL_THRESHOLD : 0,
      )
    ? ("auto_approved" as const)
    : ("suggested" as const);
}
