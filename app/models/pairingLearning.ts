export const PAIRING_MIN_IMPRESSIONS = 100;
export const PAIRING_MIN_PEERS = 5;
export const PAIRING_CONFIDENCE_Z = 1.96;
export const PAIRING_UNDERPERFORMANCE_RATIO = 0.5;
export function wilsonInterval(accepted: number, shown: number) {
  if (
    !Number.isFinite(shown) ||
    !Number.isFinite(accepted) ||
    shown <= 0 ||
    accepted < 0 ||
    accepted > shown
  )
    return { lower: 0, upper: 1 };
  const z2 = PAIRING_CONFIDENCE_Z ** 2,
    p = accepted / shown;
  const center = p + z2 / (2 * shown),
    spread =
      PAIRING_CONFIDENCE_Z *
      Math.sqrt((p * (1 - p)) / shown + z2 / (4 * shown ** 2));
  return {
    lower: Math.max(0, (center - spread) / (1 + z2 / shown)),
    upper: Math.min(1, (center + spread) / (1 + z2 / shown)),
  };
}
export function underperformingPair(
  pair: { shownCount: number; acceptedCount: number },
  peers: Array<{ shownCount: number; acceptedCount: number }>,
) {
  if (pair.shownCount < PAIRING_MIN_IMPRESSIONS) return false;
  const qualified = peers.filter(
    (p) =>
      p.shownCount >= PAIRING_MIN_IMPRESSIONS &&
      p.acceptedCount >= 0 &&
      p.acceptedCount <= p.shownCount,
  );
  if (qualified.length < PAIRING_MIN_PEERS) return false;
  const lower = qualified
    .map((p) => wilsonInterval(p.acceptedCount, p.shownCount).lower)
    .sort((a, b) => a - b);
  const middle = Math.floor(lower.length / 2);
  const median =
    lower.length % 2 ? lower[middle] : (lower[middle - 1] + lower[middle]) / 2;
  return (
    wilsonInterval(pair.acceptedCount, pair.shownCount).upper <
    median * PAIRING_UNDERPERFORMANCE_RATIO
  );
}
export function underperformingBaseline(
  pair: { shownCount: number; acceptedCount: number },
  qualifiedCount: number,
  medianLower: number,
) {
  return (
    pair.shownCount >= PAIRING_MIN_IMPRESSIONS &&
    pair.acceptedCount >= 0 &&
    pair.acceptedCount <= pair.shownCount &&
    qualifiedCount >= PAIRING_MIN_PEERS + 1 &&
    Number.isFinite(medianLower) &&
    medianLower > 0 &&
    medianLower <= 1 &&
    wilsonInterval(pair.acceptedCount, pair.shownCount).upper <
      medianLower * PAIRING_UNDERPERFORMANCE_RATIO
  );
}
