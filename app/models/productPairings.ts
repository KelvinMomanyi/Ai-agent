export const PAIRING_BATCH_SIZE = 3;
export const PAIRING_CANDIDATE_LIMIT = 8;
export const PAIRING_SUGGESTION_LIMIT = 5;
export const HIGH_CONFIDENCE_PAIRING = 0.85;
export type VerticalPreset = "generic" | "beauty_haircare";
export type RoutineStage =
  "cleanse" | "condition" | "treat" | "style" | "protect" | "tools";
export type PairingProduct = {
  id: string;
  title: string;
  vendor: string | null;
  productType: string | null;
  tags: string[];
  collectionIds: string[];
};
export type PairingCandidate = {
  sourceProductId: string;
  targetProductId: string;
  title: string;
  reasons: string[];
  confidence: number;
  score: number;
};

// English catalog keywords only, not ingredient, skin/hair-type or health advice.
export const ROUTINE_KEYWORDS: Record<RoutineStage, string[]> = {
  cleanse: [
    "shampoo",
    "cleanser",
    "cleansing",
    "face wash",
    "body wash",
    "co-wash",
    "cowash",
  ],
  condition: [
    "conditioner",
    "conditioning",
    "moisturizer",
    "moisturiser",
    "body lotion",
  ],
  treat: [
    "serum",
    "hair mask",
    "face mask",
    "treatment",
    "scalp treatment",
    "exfoliant",
    "exfoliator",
  ],
  style: [
    "styling gel",
    "styling cream",
    "curl cream",
    "mousse",
    "pomade",
    "hairspray",
    "hair spray",
    "edge control",
  ],
  protect: [
    "sunscreen",
    "spf",
    "sun protection",
    "heat protectant",
    "heat protection",
  ],
  tools: [
    "brush",
    "comb",
    "bonnet",
    "hair clip",
    "scrunchie",
    "applicator",
    "shower cap",
  ],
};
export const ROUTINE_COMPLEMENTS: Record<RoutineStage, RoutineStage[]> = {
  cleanse: ["condition", "treat", "protect", "tools"],
  condition: ["treat", "style", "protect", "tools"],
  treat: ["style", "protect", "tools"],
  style: ["protect", "tools"],
  protect: ["tools"],
  tools: ["cleanse", "condition", "treat", "style", "protect"],
};

export function normalizeVerticalPreset(value: unknown): VerticalPreset {
  return value === "beauty_haircare" ? value : "generic";
}
export function productGid(value: string) {
  return /^\d+$/.test(value) ? `gid://shopify/Product/${value}` : value;
}
function normalized(value: string) {
  return value
    .toLowerCase()
    .replace(/\bspf\d+\b/g, "spf")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
export function inferRoutineStage(
  product: PairingProduct,
): RoutineStage | null {
  for (const value of [
    product.productType || "",
    product.tags.join(" "),
    product.title,
  ]) {
    const text = ` ${normalized(value)} `;
    const matches = (Object.keys(ROUTINE_KEYWORDS) as RoutineStage[]).filter(
      (stage) =>
        ROUTINE_KEYWORDS[stage].some((keyword) =>
          text.includes(` ${normalized(keyword)} `),
        ),
    );
    if (matches.length > 1) return null;
    if (matches.length === 1) return matches[0];
  }
  return null;
}

export function deterministicPairingCandidates(input: {
  source: PairingProduct;
  targets: PairingProduct[];
  preset: VerticalPreset;
  affinities: Array<{ targetId: string; score: number; orderCount: number }>;
}): PairingCandidate[] {
  const sourceStage =
    input.preset === "beauty_haircare" ? inferRoutineStage(input.source) : null;
  const affinityById = new Map(
    input.affinities
      .filter((a) => a.orderCount > 0 && a.score > 0)
      .map((a) => [a.targetId, a]),
  );
  return input.targets
    .filter((target) => target.id !== input.source.id)
    .map((target) => {
      const reasons: string[] = [];
      const vendor = Boolean(
        input.source.vendor?.trim() &&
        normalized(input.source.vendor) === normalized(target.vendor || ""),
      );
      const collection = input.source.collectionIds.some((id) =>
        target.collectionIds.includes(id),
      );
      const targetStage = sourceStage ? inferRoutineStage(target) : null;
      const routine = Boolean(
        sourceStage &&
        targetStage &&
        ROUTINE_COMPLEMENTS[sourceStage].includes(targetStage),
      );
      const affinity = affinityById.get(target.id);
      if (routine)
        reasons.push(
          `Pairs the ${sourceStage} stage with the ${targetStage} stage of a routine.`,
        );
      if (affinity) reasons.push("Recorded together in your store's orders.");
      if (vendor)
        reasons.push(
          `From the same brand: ${input.source.vendor!.trim().slice(0, 100)}.`,
        );
      if (collection) reasons.push("From a shared collection in your catalog.");
      const confidence =
        affinity && affinity.orderCount >= 3
          ? 0.92
          : routine && (vendor || collection)
            ? 0.9
            : vendor && collection
              ? 0.8
              : routine
                ? 0.72
                : affinity
                  ? 0.65
                  : collection
                    ? 0.6
                    : 0.55;
      return {
        sourceProductId: input.source.id,
        targetProductId: target.id,
        title: target.title,
        reasons,
        confidence,
        score:
          confidence +
          (affinity ? Math.min(affinity.score, 1) * 0.05 : 0) +
          (routine ? 0.03 : 0),
      };
    })
    .filter((candidate) => candidate.reasons.length > 0)
    .sort(
      (a, b) =>
        b.score - a.score || a.targetProductId.localeCompare(b.targetProductId),
    )
    .slice(0, PAIRING_CANDIDATE_LIMIT);
}

export function validatePairingRanking(
  raw: unknown,
  candidates: PairingCandidate[],
) {
  const byPair = new Map(
    candidates.map((candidate) => [
      `${candidate.sourceProductId}:${candidate.targetProductId}`,
      candidate,
    ]),
  );
  const entries =
    raw &&
    typeof raw === "object" &&
    Array.isArray((raw as { pairings?: unknown }).pairings)
      ? (raw as { pairings: unknown[] }).pairings.slice(
          0,
          PAIRING_BATCH_SIZE * PAIRING_CANDIDATE_LIMIT,
        )
      : [];
  const selected: Array<
    PairingCandidate & { reason: string; aiRanked: boolean }
  > = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const key = `${String(record.sourceProductId)}:${String(record.targetProductId)}`;
    const candidate = byPair.get(key);
    if (!candidate || seen.has(key)) continue;
    seen.add(key);
    selected.push({
      ...candidate,
      reason: candidate.reasons.includes(String(record.reason))
        ? String(record.reason)
        : candidate.reasons[0],
      aiRanked: true,
    });
  }
  for (const candidate of candidates) {
    if (!seen.has(`${candidate.sourceProductId}:${candidate.targetProductId}`))
      selected.push({
        ...candidate,
        reason: candidate.reasons[0],
        aiRanked: false,
      });
  }
  return selected;
}
