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
  cartValue?: number;
  [key: string]: unknown;
};

const STORAGE_KEY = "aovboost_anonymous_id";

export class SessionManager {
  readonly anonymousId: string;
  private journeyStage: JourneyStage = "discovering";
  private viewedProductIds = new Set<string>();
  private productViewCounts = new Map<string, number>();
  private cartProductIds = new Set<string>();
  private pageViews = 0;
  private maxScrollDepth = 0;
  private cartActionCount = 0;
  private cartValue = 0;
  private startedAt = Date.now();
  private lastCartActionAt = 0;
  private syncTimer: number | undefined;

  constructor(
    private shop: string,
    private apiBase = "/apps/aovboost",
  ) {
    this.anonymousId = this.getOrCreateAnonymousId();
  }

  init(): void {
    this.syncTimer = window.setInterval(() => this.sync(), 30000);
    window.addEventListener("pagehide", () => this.sync());
  }

  destroy(): void {
    if (this.syncTimer) window.clearInterval(this.syncTimer);
  }

  recordEvent(event: StorefrontEvent): void {
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
      this.maxScrollDepth = Math.max(this.maxScrollDepth, Number(event.depth || 0));
    }

    if (event.type === "add_to_cart") {
      this.cartActionCount += 1;
      this.lastCartActionAt = Date.now();
      const productId = getProductId(event);
      if (productId) this.cartProductIds.add(productId);
      if (Array.isArray(event.cartProductIds)) {
        event.cartProductIds.forEach((id) => this.cartProductIds.add(String(id)));
      }
      this.cartValue = Math.max(this.cartValue, Number(event.cartValue || 0));
      this.journeyStage = "buying";
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
    const repeatedProductWithoutCart = Array.from(this.productViewCounts.entries()).some(
      ([productId, count]) => count >= 2 && !this.cartProductIds.has(productId),
    );
    const secondsSinceCartAction = this.lastCartActionAt
      ? (Date.now() - this.lastCartActionAt) / 1000
      : sessionDuration;
    const hesitationScore = clamp(
      (intentScore > 40 && this.cartActionCount === 0 && secondsSinceCartAction >= 90
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
      },
    };
  }

  private sync(): void {
    const snapshot = this.getSnapshot();
    const body = JSON.stringify({
      sessionId: this.anonymousId,
      shop: this.shop,
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
    }).catch(() => {});
  }

  private updateJourneyStage(): void {
    if (this.cartProductIds.size > 0) {
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

  private getSnapshotDuration(): number {
    return Math.round((Date.now() - this.startedAt) / 1000);
  }

  private getOrCreateAnonymousId(): string {
    try {
      const existing = window.localStorage.getItem(STORAGE_KEY);
      if (existing) return existing;
      const next = createUuid();
      window.localStorage.setItem(STORAGE_KEY, next);
      return next;
    } catch {
      return createUuid();
    }
  }
}

function getProductId(event: StorefrontEvent) {
  const product = event.product as Record<string, unknown> | undefined;
  return String(event.productId || event.product_id || product?.id || "");
}

function createUuid() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const value = (Math.random() * 16) | 0;
    const next = char === "x" ? value : (value & 0x3) | 0x8;
    return next.toString(16);
  });
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
