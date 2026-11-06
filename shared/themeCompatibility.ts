export const THEME_STRATEGIES = [
  "native_drawer",
  "cart_page",
  "floating_card",
  "none",
] as const;
export type ThemeStrategy = (typeof THEME_STRATEGIES)[number];
export const CART_UI_TYPES = [
  "drawer",
  "popup_notification",
  "page_redirect",
  "no_feedback",
  "unknown",
] as const;
export type CartUi = (typeof CART_UI_TYPES)[number];
export const THEME_QUORUM = 5;
export const THEME_MIN_ATTEMPTS = 20;
export const THEME_MIN_SUCCESS_RATE = 0.2;
export const THEME_WINDOW = 100;
export const THEME_REPORT_DAYS = 7;
export const CART_OBSERVATION_MS = 1200;
export const CART_SURFACE_WAIT_MS = 15000;
export const DISPLAY_RATIO = 0.5;
export const DISPLAY_DURATION_MS = 750;
export const DISPLAY_TIMEOUT_MS = 3500;
export const MAX_HOST_LAYOUT_SHIFT = 0.1;
export const MIN_TEXT_CONTRAST = 4.5;
export type ThemeIdentity = {
  themeId: string;
  themeName: string;
  schemaName?: string;
  themeStoreId?: string;
  role?: string;
};
export type PlacementPreference =
  "auto" | "cart_drawer" | "cart_page" | "floating_card" | "off";
export type ThemeAppearance = {
  accentColor: string | null;
  radius: number | null;
  font: "inherit" | "system";
};
export type ThemeRuntimeConfig = {
  themeId: string;
  strategy: ThemeStrategy;
  status: "learning" | "verified" | "degraded" | "disabled";
  genericDrawer: boolean;
  drawerSelector?: string;
  preference: PlacementPreference;
  appearance: ThemeAppearance;
};
export type ThemeDisplayReport = {
  identity: ThemeIdentity;
  attemptId: string;
  offerId?: string;
  strategy: ThemeStrategy;
  cartUi: CartUi;
  verified: boolean;
  reason: string;
  selector?: string;
};
export function safeThemeIdentity(value: unknown): ThemeIdentity {
  const v =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const clean = (s: unknown, max: number) =>
    typeof s === "string" ? s.replace(/\p{Cc}/gu, "").slice(0, max) : "";
  return {
    themeId: /^\d{1,20}$/.test(String(v.themeId))
      ? String(v.themeId)
      : "unknown",
    themeName: clean(v.themeName, 100) || "Unknown theme",
    ...(clean(v.schemaName, 80) ? { schemaName: clean(v.schemaName, 80) } : {}),
    ...(/^\d{1,12}$/.test(String(v.themeStoreId))
      ? { themeStoreId: String(v.themeStoreId) }
      : {}),
    ...(["main", "unpublished", "demo", "development"].includes(String(v.role))
      ? { role: String(v.role) }
      : {}),
  };
}
export function defaultThemeConfig(themeId: string): ThemeRuntimeConfig {
  return {
    themeId,
    status: "learning",
    strategy: "native_drawer",
    genericDrawer: false,
    preference: "auto",
    appearance: { accentColor: null, radius: null, font: "inherit" },
  };
}
/** Simple ID/class/custom-element descendants only. No attributes, pseudos, HTML or combinators. */
export function safeThemeSelector(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 160 &&
    value.split(" ").length <= 3 &&
    /^(?:[.#][a-zA-Z][\w-]{0,63}|[a-z][a-z0-9]*-[a-z0-9-]+)(?: (?:[.#][a-zA-Z][\w-]{0,63}|[a-z][a-z0-9]*-[a-z0-9-]+)){0,2}$/.test(
      value,
    )
  );
}
export function themeEvidence(
  reports: Array<{
    sessionHash: string;
    verified: boolean;
    strategy: string;
    selector: string | null;
    offerId?: string | null;
  }>,
) {
  const displays = reports.slice(0, THEME_WINDOW);
  const sessions = new Set(displays.map((row) => row.sessionHash));
  const successes = displays.filter((row) => row.verified);
  const successfulSessions = new Set(successes.map((row) => row.sessionHash));
  const votes = new Map<string, Set<string>>();
  for (const row of successes)
    if (safeThemeSelector(row.selector)) {
      const set = votes.get(row.selector) || new Set<string>();
      set.add(row.sessionHash);
      votes.set(row.selector, set);
    }
  const selector = [...votes].find(
    ([, voters]) => voters.size >= THEME_QUORUM,
  )?.[0];
  const offers = new Map<string, { verified: boolean; sessionHash: string }>();
  displays.forEach((row, i) => {
    const key = row.offerId || `sample:${i}`;
    const previous = offers.get(key);
    offers.set(key, {
      verified: row.verified || previous?.verified || false,
      sessionHash: row.sessionHash,
    });
  });
  const attempts = [...offers.values()];
  const rate = attempts.length
    ? attempts.filter((row) => row.verified).length / attempts.length
    : null;
  const overallDegrade =
    attempts.length >= THEME_MIN_ATTEMPTS &&
    sessions.size >= THEME_QUORUM &&
    new Set(
      attempts.filter((row) => !row.verified).map((row) => row.sessionHash),
    ).size >= THEME_QUORUM &&
    rate! < THEME_MIN_SUCCESS_RATE;
  const failedStrategies = THEME_STRATEGIES.filter(
    (strategy) =>
      strategy !== "none" &&
      displays.filter((row) => row.strategy === strategy).length >=
        THEME_MIN_ATTEMPTS &&
      displays.filter((row) => row.strategy === strategy && row.verified)
        .length /
        Math.max(
          1,
          displays.filter((row) => row.strategy === strategy).length,
        ) <
        THEME_MIN_SUCCESS_RATE &&
      new Set(
        displays
          .filter((row) => row.strategy === strategy && !row.verified)
          .map((row) => row.sessionHash),
      ).size >= THEME_QUORUM,
  );
  return {
    rate,
    selector,
    verified: successfulSessions.size >= THEME_QUORUM,
    degrade: overallDegrade || failedStrategies.length > 0,
    disabled: overallDegrade && failedStrategies.length === 3,
    failedStrategies,
  };
}
