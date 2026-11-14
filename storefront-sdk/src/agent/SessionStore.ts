export type SessionState = {
  id: string;
  viewedProducts: string[];
  pageViews: number;
  dwellOnProductMs: number;
  returnsToProduct: Record<string, number>;
  shown: Record<string, number>;
  dismissed: Record<string, { count: number; lastAt: number }>;
  disabledProviders: string[];
  lastInterruptiveAt: number;
  interruptiveCount: number;
  interruptiveDismissals: number;
  chatOpen: boolean;
  chatStartedAt: number;
  checkoutStarted: boolean;
};
const VERSION = 1;
const bounded = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
const safeKey = (key: string) =>
  /^[a-zA-Z0-9_:/-]{1,128}$/.test(key) &&
  !["__proto__", "constructor", "prototype"].includes(key);
const numericMap = (value: unknown): Record<string, number> =>
  Object.fromEntries(
    Object.entries(value && typeof value === "object" ? value : {})
      .filter(([key]) => safeKey(key))
      .slice(-100)
      .map(([key, count]) => [key, bounded(count)]),
  );
function empty(): SessionState {
  return {
    id:
      globalThis.crypto?.randomUUID?.() ||
      `aov-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    viewedProducts: [],
    pageViews: 0,
    dwellOnProductMs: 0,
    returnsToProduct: {},
    shown: {},
    dismissed: {},
    disabledProviders: [],
    lastInterruptiveAt: 0,
    interruptiveCount: 0,
    interruptiveDismissals: 0,
    chatOpen: false,
    chatStartedAt: 0,
    checkoutStarted: false,
  };
}
function sanitize(
  value: Partial<SessionState>,
  fallback: SessionState,
): SessionState {
  const state = { ...fallback };
  if (typeof value.id === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value.id))
    state.id = value.id;
  for (const key of [
    "pageViews",
    "dwellOnProductMs",
    "lastInterruptiveAt",
    "interruptiveCount",
    "interruptiveDismissals",
    "chatStartedAt",
  ] as const)
    state[key] = bounded(value[key]);
  state.viewedProducts = Array.isArray(value.viewedProducts)
    ? value.viewedProducts
        .filter(
          (id) =>
            typeof id === "string" &&
            /^gid:\/\/shopify\/Product\/\d+$/.test(id),
        )
        .slice(-100)
    : [];
  state.disabledProviders = Array.isArray(value.disabledProviders)
    ? value.disabledProviders
        .filter((id) => typeof id === "string" && /^[a-z_]{1,50}$/.test(id))
        .slice(0, 20)
    : [];
  state.returnsToProduct = numericMap(value.returnsToProduct);
  state.shown = numericMap(value.shown);
  state.dismissed = Object.fromEntries(
    Object.entries(value.dismissed || {})
      .filter(([key, item]) => safeKey(key) && item && typeof item === "object")
      .slice(-100)
      .map(([key, item]) => [
        key,
        { count: bounded(item.count), lastAt: bounded(item.lastAt) },
      ]),
  );
  state.chatOpen = value.chatOpen === true;
  state.checkoutStarted = value.checkoutStarted === true;
  return state;
}
export class SessionStore {
  private state = empty();
  private key: string;
  constructor(shop: string) {
    this.key = `aovboost_agent_session_v${VERSION}:${shop}`;
    try {
      const saved = JSON.parse(sessionStorage.getItem(this.key) || "null");
      if (
        saved?.version === VERSION &&
        saved.state &&
        typeof saved.state === "object"
      )
        this.state = sanitize(saved.state, this.state);
    } catch {
      /* Empty, corrupt or blocked storage uses memory. */
    }
    // An open surface does not survive a full page load.
    this.state.chatOpen = false;
    this.state.dwellOnProductMs = 0;
  }
  snapshot(): SessionState {
    return JSON.parse(JSON.stringify(this.state));
  }
  update(change: (state: SessionState) => void): void {
    const next = this.snapshot();
    change(next);
    this.state = sanitize(next, this.state);
    try {
      sessionStorage.setItem(
        this.key,
        JSON.stringify({ version: VERSION, state: this.state }),
      );
    } catch {
      /* Keep the in-memory state authoritative. */
    }
  }
}
