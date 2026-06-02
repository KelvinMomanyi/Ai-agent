import { callAi, parseAiJson } from "./client.server";
import { OFFER_RANKER_SYSTEM } from "./prompts";
import type { OfferCandidate, ShopperSessionSnapshot } from "./types";

type RankedOffer = string | { id?: string; offerId?: string; reason?: string };

export async function rankOffers(
  candidates: OfferCandidate[],
  session: ShopperSessionSnapshot,
): Promise<OfferCandidate[]> {
  if (candidates.length === 0) return [];

  const fallback = candidates
    .slice()
    .sort((left, right) => scoreOf(right) - scoreOf(left));

  const raw = await callAi(
    OFFER_RANKER_SYSTEM,
    JSON.stringify({
      session,
      candidates: candidates.map((candidate) => ({
        id: candidate.id,
        widgetType: candidate.widgetType,
        productId: candidate.productId,
        title: candidate.title,
        affinityScore: scoreOf(candidate),
        payload: candidate.payload,
      })),
    }),
  );
  const parsed = parseAiJson<RankedOffer[]>(raw);
  if (!Array.isArray(parsed)) return fallback;

  const ids = parsed.map((entry) =>
    typeof entry === "string" ? entry : entry.id || entry.offerId || "",
  );
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const ranked = ids
    .map((id) => byId.get(id))
    .filter((candidate): candidate is OfferCandidate => Boolean(candidate));

  if (ranked.length === 0) return fallback;

  const seen = new Set(ranked.map((candidate) => candidate.id));
  return [
    ...ranked,
    ...fallback.filter((candidate) => !seen.has(candidate.id)),
  ];
}

function scoreOf(candidate: OfferCandidate) {
  return candidate.affinityScore ?? candidate.score ?? 0;
}
