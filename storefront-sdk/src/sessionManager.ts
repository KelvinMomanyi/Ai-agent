export type JourneyStage = "discovering" | "comparing" | "deciding" | "buying";

export type SessionSnapshot = {
  anonymousId: string;
  journeyStage: JourneyStage;
  intentScore: number;
  hesitationScore: number;
  viewedProductIds: string[];
  cartProductIds: string[];
  totalPageViews: number;
  sessionDuration: number;
  cartValue: number;
  context: Record<string, unknown>;
};

type StorefrontEvent = {
  type: string;
  ts?: number;
  productId?: string;
  depth?: number;
  cartProductIds?: string[];
  cartVariantIds?: string[];
  cartItemCount?: number;
  cartValue?: number;
  [key: string]: unknown;
};

const STORAGE_KEY = "aovboost_anonymous_id";
const SIGNED_SESSION_STORAGE_KEY = "aovboost_storefront_session";

type StoredStorefrontSession = {
  shop: string;
  sessionId: string;
  sessionToken: string;
  expiresAt: number;
};

export class SessionManager {
  anonymousId = "";
  private sessionToken = "";
  private journeyStage: JourneyStage = "discovering";
  private viewedProductIds = new Set<string>();
  private productViewCounts = new Map<string, number>();
  private cartProductIds = new Set<string>();
  private cartVariantIds = new Set<string>();
  private cartItemCount = 0;
  private pageViews = 0;
  private maxScrollDepth = 0;
  private cartActionCount = 0;
  private cartValue = 0;
  private startedAt = Date.now();
  private lastCartActionAt = 0;
  private lastEventType = "";
  private syncTimer: number | undefined;
  private authRefreshPromise: Promise<void> | undefined;

  constructor(
    private shop: string,
    private apiBase = "/apps/aovboost",
  ) {}

  async init(): Promise<void> {
    const authenticated = await this.ensureAuthenticated();
    if (!authenticated) {
      this.bootstrapLocalSession();
    }
    this.syncTimer = window.setInterval(() => this.sync(), 30000);
    window.addEventListener("pagehide", () => this.sync());
  }

  destroy(): void {
    if (this.syncTimer) window.clearInterval(this.syncTimer);
  }

  recordEvent(event: StorefrontEvent): void {
    this.lastEventType = event.type;

    if (event.type === "page_view") this.pageViews += 1;

    if (event.type === "product_view") {
      const productId = getProductId(event);
      if (productId) {
        this.viewedProductIds.add(productId);
        this.productViewCounts.set(
          productId,
          (this.productViewCounts.get(productId) || 0) + 1,
        );
      }
    }

    if (event.type === "scroll_depth") {
      this.maxScrollDepth = Math.max(
        this.maxScrollDepth,
        Number(event.depth || 0),
      );
    }

    if (event.type === "add_to_cart") {
      this.cartActionCount += 1;
      this.lastCartActionAt = Date.now();
      const productId = getProductId(event);
      if (productId) this.cartProductIds.add(productId);
      if (Array.isArray(event.cartProductIds)) {
        event.cartProductIds.forEach((id) =>
          this.cartProductIds.add(String(id)),
        );
      }
      if (Array.isArray(event.cartVariantIds)) {
        event.cartVariantIds.forEach((id) =>
          this.cartVariantIds.add(String(id)),
        );
      }
      this.cartItemCount = Math.max(
        this.cartItemCount,
        Number(event.cartItemCount || this.cartItemCount),
      );
      this.cartValue = Math.max(this.cartValue, Number(event.cartValue || 0));
      this.journeyStage = "buying";
    }

    if (event.type === "cart_update") {
      this.lastCartActionAt = Date.now();
      if (Array.isArray(event.cartProductIds)) {
        this.cartProductIds = new Set(event.cartProductIds.map(String));
      }
      if (Array.isArray(event.cartVariantIds)) {
        this.cartVariantIds = new Set(event.cartVariantIds.map(String));
      }
      this.cartItemCount = Number(
        event.cartItemCount || this.cartProductIds.size,
      );
      this.cartValue = Number(event.cartValue || 0);
      if (this.cartProductIds.size > 0 || this.cartItemCount > 0) {
        this.journeyStage = "buying";
      }
    }

    if (event.type === "remove_from_cart") {
      this.cartActionCount += 1;
      this.lastCartActionAt = Date.now();
      const productId = getProductId(event);
      if (productId) this.cartProductIds.delete(productId);
    }

    this.updateJourneyStage();
  }

  getSnapshot(): SessionSnapshot {
    const sessionDuration = Math.round((Date.now() - this.startedAt) / 1000);
    const productViews = Array.from(this.productViewCounts.values()).reduce(
      (sum, count) => sum + count,
      0,
    );
    const intentScore = clamp(
      this.pageViews * 2 +
        productViews * 5 +
        (this.maxScrollDepth >= 90
          ? 10
          : this.maxScrollDepth >= 75
            ? 8
            : this.maxScrollDepth >= 50
              ? 5
              : this.maxScrollDepth >= 25
                ? 3
                : 0) +
        Math.min(sessionDuration / 120, 1) * 30 +
        (this.cartProductIds.size > 0 ? 30 : 0),
      0,
      100,
    );
    const repeatedProductWithoutCart = Array.from(
      this.productViewCounts.entries(),
    ).some(
      ([productId, count]) => count >= 2 && !this.cartProductIds.has(productId),
    );
    const secondsSinceCartAction = this.lastCartActionAt
      ? (Date.now() - this.lastCartActionAt) / 1000
      : sessionDuration;
    const hesitationScore = clamp(
      (intentScore > 40 &&
      this.cartActionCount === 0 &&
      secondsSinceCartAction >= 90
        ? 55
        : 0) + (repeatedProductWithoutCart ? 35 : 0),
      0,
      100,
    );

    return {
      anonymousId: this.anonymousId,
      journeyStage: this.journeyStage,
      intentScore,
      hesitationScore,
      viewedProductIds: Array.from(this.viewedProductIds),
      cartProductIds: Array.from(this.cartProductIds),
      totalPageViews: this.pageViews,
      sessionDuration,
      cartValue: this.cartValue,
      context: {
        maxScrollDepth: this.maxScrollDepth,
        productViewCounts: Object.fromEntries(this.productViewCounts),
        cartActionCount: this.cartActionCount,
        cartItemCount: this.cartItemCount,
        cartVariantIds: Array.from(this.cartVariantIds),
        cartValue: this.cartValue,
        lastEventType: this.lastEventType,
      },
    };
  }

  getAuthPayload() {
    return {
      sessionId: this.anonymousId,
      sessionToken: this.sessionToken,
      shop: this.shop,
    };
  }

  async getSignedAuthPayload(): Promise<{
    sessionId: string;
    sessionToken: string;
    shop: string;
  } | null> {
    if (!(await this.ensureAuthenticated())) return null;
    if (!this.anonymousId || !this.sessionToken) return null;
    return this.getAuthPayload();
  }

  async ensureAuthenticated(): Promise<boolean> {
    if (this.sessionToken) return true;
    try {
      await this.ensureStorefrontSession();
    } catch {
      await this.refreshAuth();
    }
    return Boolean(this.sessionToken);
  }

  async refreshAuth(): Promise<void> {
    if (this.authRefreshPromise) return this.authRefreshPromise;

    this.authRefreshPromise = this.refreshAuthInternal().finally(() => {
      this.authRefreshPromise = undefined;
    });
    return this.authRefreshPromise;
  }

  private async refreshAuthInternal(): Promise<void> {
    const previousAnonymousId = this.anonymousId;
    const previousSessionToken = this.sessionToken;

    try {
      window.localStorage.removeItem(SIGNED_SESSION_STORAGE_KEY);
    } catch {
      // Ignore storage failures; fetching a new in-memory token is enough.
    }

    try {
      await this.ensureStorefrontSession({ forceRefresh: true });
    } catch {
      if (previousSessionToken) {
        this.anonymousId = previousAnonymousId;
        this.sessionToken = previousSessionToken;
      } else {
        this.bootstrapLocalSession();
      }
    }
    this.syncGlobalSdkAuth();
  }

  applyStorefrontSession(value: unknown): boolean {
    const session = asStorefrontSession(value);
    if (
      !session ||
      session.shop !== this.shop ||
      !session.sessionId ||
      !session.sessionToken ||
      Number(session.expiresAt || 0) <= Math.floor(Date.now() / 1000) + 60
    ) {
      return false;
    }

    this.anonymousId = session.sessionId;
    this.sessionToken = session.sessionToken;
    this.storeStorefrontSession(session);
    this.syncGlobalSdkAuth();
    return true;
  }

  async applySessionFromResponse(response: Response): Promise<boolean> {
    try {
      const data = await response.clone().json();
      const record = asRecord(data);
      return this.applyStorefrontSession(
        record?.storefrontSession || record?.session || data,
      );
    } catch {
      return false;
    }
  }

  syncGlobalSdkAuth(): void {
    const sdk = (window as any).AOVBoostSDK;
    if (!sdk || typeof sdk !== "object") return;
    sdk.sessionId = this.anonymousId;
    sdk.sessionToken = this.sessionToken;
  }

  private sync(): void {
    if (!this.anonymousId || !this.sessionToken) {
      void this.ensureAuthenticated();
      return;
    }

    const snapshot = this.getSnapshot();
    const body = JSON.stringify({
      ...this.getAuthPayload(),
      events: [
        {
          type: "session_sync",
          ts: Date.now(),
          sessionId: this.anonymousId,
          shop: this.shop,
          url: window.location.href,
          referrer: document.referrer,
          snapshot,
          ...snapshot,
        },
      ],
    });

    fetch(this.endpoint("/events"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AOVBoost-Shop": this.shop,
      },
      body,
      keepalive: true,
    })
      .then((response) => {
        if (response.status === 401) void this.refreshAuth();
      })
      .catch(() => {});
  }

  private updateJourneyStage(): void {
    if (this.cartProductIds.size > 0) {
      this.journeyStage = "buying";
      return;
    }
    if (this.cartItemCount > 0) {
      this.journeyStage = "buying";
      return;
    }

    if (
      this.getSnapshotDuration() >= 60 ||
      Array.from(this.productViewCounts.values()).some((count) => count >= 2)
    ) {
      this.journeyStage = "deciding";
      return;
    }

    if (this.viewedProductIds.size >= 3) {
      this.journeyStage = "comparing";
      return;
    }

    this.journeyStage = "discovering";
  }

  private endpoint(path: string): string {
    return `${this.apiBase.replace(/\/$/, "")}${path}`;
  }

  private async ensureStorefrontSession(
    options: { forceRefresh?: boolean } = {},
  ): Promise<void> {
    const stored = options.forceRefresh
      ? null
      : this.getStoredStorefrontSession();
    if (stored) {
      this.anonymousId = stored.sessionId;
      this.sessionToken = stored.sessionToken;
      return;
    }

    const response = await fetch(this.endpoint("/session"), {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!response.ok)
      throw new Error(`Session bootstrap failed: ${response.status}`);

    const next = (await response.json()) as StoredStorefrontSession;
    if (!this.applyStorefrontSession(next)) {
      throw new Error("Invalid storefront session bootstrap response");
    }
  }

  private getStoredStorefrontSession(): StoredStorefrontSession | null {
    try {
      const parsed = JSON.parse(
        window.localStorage.getItem(SIGNED_SESSION_STORAGE_KEY) || "null",
      ) as StoredStorefrontSession | null;
      if (
        !parsed ||
        parsed.shop !== this.shop ||
        !parsed.sessionId ||
        !parsed.sessionToken ||
        Number(parsed.expiresAt || 0) <= Math.floor(Date.now() / 1000) + 60
      ) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private storeStorefrontSession(session: StoredStorefrontSession) {
    try {
      window.localStorage.setItem(
        SIGNED_SESSION_STORAGE_KEY,
        JSON.stringify(session),
      );
      window.localStorage.setItem(STORAGE_KEY, session.sessionId);
    } catch {
      // Storage failures leave the current in-memory session usable for this page.
    }
  }

  private bootstrapLocalSession(): void {
    let sessionId = "";
    try {
      sessionId = window.localStorage.getItem(STORAGE_KEY) || "";
      if (!sessionId) {
        sessionId =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        window.localStorage.setItem(STORAGE_KEY, sessionId);
      }
    } catch {
      sessionId = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    this.anonymousId = sessionId;
    this.sessionToken = "";
  }

  private getSnapshotDuration(): number {
    return Math.round((Date.now() - this.startedAt) / 1000);
  }
}

function asStorefrontSession(value: unknown): StoredStorefrontSession | null {
  const record = asRecord(value);
  if (!record) return null;

  return {
    shop: String(record.shop || ""),
    sessionId: String(record.sessionId || ""),
    sessionToken: String(record.sessionToken || ""),
    expiresAt: Number(record.expiresAt || 0),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getProductId(event: StorefrontEvent) {
  const product = event.product as Record<string, unknown> | undefined;
  return String(event.productId || event.product_id || product?.id || "");
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
