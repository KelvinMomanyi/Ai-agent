import {
  DISPLAY_RATIO,
  DISPLAY_DURATION_MS,
  DISPLAY_TIMEOUT_MS,
  MAX_HOST_LAYOUT_SHIFT,
} from "../../../shared/themeCompatibility";
import { isElementVisible } from "../widgets/visibility";
export type DisplayResult = { verified: boolean; reason: string };
export function displayCheck(host: HTMLElement): DisplayResult {
  if (
    !host.isConnected ||
    document.visibilityState === "hidden" ||
    !isElementVisible(host)
  )
    return { verified: false, reason: "hidden" };
  const r = host.getBoundingClientRect();
  let left = Math.max(0, r.left),
    top = Math.max(0, r.top),
    right = Math.min(innerWidth, r.right),
    bottom = Math.min(innerHeight, r.bottom);
  for (let p = host.parentElement; p; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (
      /auto|scroll|hidden|clip/.test(
        `${s.overflow} ${s.overflowX} ${s.overflowY}`,
      )
    ) {
      const b = p.getBoundingClientRect();
      left = Math.max(left, b.left);
      right = Math.min(right, b.right);
      top = Math.max(top, b.top);
      bottom = Math.min(bottom, b.bottom);
    }
  }
  const ratio =
    r.width * r.height > 0
      ? (Math.max(0, right - left) * Math.max(0, bottom - top)) /
        (r.width * r.height)
      : 0;
  if (ratio < DISPLAY_RATIO)
    return { verified: false, reason: "outside_viewport" };
  if (typeof document.elementFromPoint !== "function")
    return { verified: false, reason: "hit_test_unavailable" };
  const hit = document.elementFromPoint(
    r.left + r.width / 2,
    r.top + r.height / 2,
  );
  return hit === host || (hit && host.contains(hit))
    ? { verified: true, reason: "display_verified" }
    : { verified: false, reason: "obscured" };
}
export async function verifyDisplay(
  host: HTMLElement,
  signal: AbortSignal,
): Promise<DisplayResult> {
  const started = performance.now();
  let visibleSince: number | null = null,
    last = host.getBoundingClientRect(),
    shift = 0;
  let reason = "verification_timeout";
  while (!signal.aborted && performance.now() - started < DISPLAY_TIMEOUT_MS) {
    const next = host.getBoundingClientRect();
    shift +=
      Math.abs(next.top - last.top) / Math.max(1, innerHeight) +
      Math.abs(next.left - last.left) / Math.max(1, innerWidth);
    last = next;
    if (shift > MAX_HOST_LAYOUT_SHIFT)
      return { verified: false, reason: "layout_shift" };
    const check = displayCheck(host);
    reason = check.reason;
    if (check.verified) {
      visibleSince ??= performance.now();
      if (performance.now() - visibleSince >= DISPLAY_DURATION_MS) return check;
    } else visibleSince = null;
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", finish);
        resolve();
      };
      const timer = setTimeout(finish, 100);
      signal.addEventListener("abort", finish, { once: true });
    });
  }
  return { verified: false, reason: signal.aborted ? "cancelled" : reason };
}
