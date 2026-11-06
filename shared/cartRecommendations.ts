// One policy for the SDK and server; a new mutation never overrides dismissal.
export const CART_DISMISS_TTL_MS = 30 * 60 * 1000;
export const DISMISSED_WIDGETS_KEY = "aovboost_dismissed_widgets";
export function isRecentCartDismissal(value: unknown, now = Date.now()) {
  const at = Number(value);
  return (
    Number.isFinite(at) && at > 0 && at <= now && now - at < CART_DISMISS_TTL_MS
  );
}
export function recommendationLimit(value: unknown) {
  const count = Number(value);
  return Number.isFinite(count)
    ? Math.max(1, Math.min(4, Math.floor(count)))
    : 2;
}
