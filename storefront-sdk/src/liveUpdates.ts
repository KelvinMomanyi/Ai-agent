import type { SessionManager } from "./sessionManager";

const DEFAULT_POLL_INTERVAL_MS = 10 * 1000;
const INITIAL_POLL_DELAY_MS = 2500;
const REQUEST_TIMEOUT_MS = 8000;

type LiveUpdate = {
  id: string;
  type: "price_drop_webhook" | "low_inventory_alert";
  productId: string;
  occurredAt: string;
  title?: string;
  oldPrice?: number;
  newPrice?: number;
  inventoryQuantity?: number;
};

type LiveResponse = {
  enabled?: boolean;
  events?: LiveUpdate[];
  pollAfterMs?: number;
};

type LiveUpdatesOptions = {
  apiBase: string;
  sessionManager: SessionManager;
};

/**
 * Uses short, completed requests instead of a permanent SSE connection. This
 * keeps the live channel compatible with Vercel's bounded function lifecycle.
 */
export class LiveUpdates {
  private pollTimer: number | undefined;
  private requestController: AbortController | undefined;
  private running = false;
  private destroyed = false;
  private enabled = true;
  private seenEventIds = new Set<string>();

  constructor(private options: LiveUpdatesOptions) {}

  init(): void {
    if (this.running || this.destroyed || !this.enabled) return;
    window.addEventListener("pagehide", this.handlePageHide);
    window.addEventListener("pageshow", this.handlePageShow);
    this.running = true;
    this.schedule(INITIAL_POLL_DELAY_MS);
  }

  destroy(): void {
    this.destroyed = true;
    this.pause();
    window.removeEventListener("pagehide", this.handlePageHide);
    window.removeEventListener("pageshow", this.handlePageShow);
    this.seenEventIds.clear();
  }

  private handlePageHide = () => this.pause();

  private handlePageShow = () => {
    if (this.destroyed || !this.enabled || this.running) return;
    this.running = true;
    this.schedule(INITIAL_POLL_DELAY_MS);
  };

  private pause(): void {
    this.running = false;
    if (this.pollTimer) window.clearTimeout(this.pollTimer);
    this.pollTimer = undefined;
    this.requestController?.abort();
    this.requestController = undefined;
  }

  private schedule(delayMs: number): void {
    if (!this.running || this.destroyed || !this.enabled) return;
    if (this.pollTimer) window.clearTimeout(this.pollTimer);
    this.pollTimer = window.setTimeout(() => {
      this.pollTimer = undefined;
      void this.poll();
    }, delayMs);
  }

  private async poll(): Promise<void> {
    let nextDelay = DEFAULT_POLL_INTERVAL_MS;
    try {
      const result = await this.requestUpdates();
      nextDelay = result.pollAfterMs;
      if (!result.enabled) {
        this.enabled = false;
        this.pause();
        return;
      }
      result.events.forEach((event) => this.dispatch(event));
    } catch {
      // A transient network failure leaves the next bounded poll available.
    } finally {
      this.requestController = undefined;
      this.schedule(nextDelay);
    }
  }

  private async requestUpdates(retriedAuth = false): Promise<{
    enabled: boolean;
    events: LiveUpdate[];
    pollAfterMs: number;
  }> {
    const auth = await this.options.sessionManager.getSignedAuthPayload();
    if (!auth) {
      return { enabled: true, events: [], pollAfterMs: DEFAULT_POLL_INTERVAL_MS };
    }

    const controller = new AbortController();
    this.requestController = controller;
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(this.endpoint("/live"), {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-AOVBoost-Shop": auth.shop,
        },
        body: JSON.stringify(auth),
        cache: "no-store",
        signal: controller.signal,
      });
    } finally {
      window.clearTimeout(timeout);
    }

    if (response.status === 401 && !retriedAuth) {
      const recovered =
        await this.options.sessionManager.applySessionFromResponse(response);
      if (!recovered) await this.options.sessionManager.refreshAuth();
      return this.requestUpdates(true);
    }

    if (response.status === 429) {
      const retrySeconds = Number(response.headers.get("Retry-After") || 60);
      return {
        enabled: true,
        events: [],
        pollAfterMs: clampPollInterval(retrySeconds * 1000),
      };
    }

    if (!response.ok) {
      throw new Error(`Live update request failed: ${response.status}`);
    }

    const body = (await response.json()) as LiveResponse;
    return {
      enabled: body.enabled !== false,
      events: Array.isArray(body.events) ? body.events.filter(isLiveUpdate) : [],
      pollAfterMs: clampPollInterval(body.pollAfterMs),
    };
  }

  private dispatch(event: LiveUpdate): void {
    if (this.seenEventIds.has(event.id)) return;
    this.seenEventIds.add(event.id);
    document.dispatchEvent(
      new CustomEvent("aovboost:system-event", { detail: event }),
    );
  }

  private endpoint(path: string) {
    return `${this.options.apiBase.replace(/\/$/, "")}${path}`;
  }
}

function isLiveUpdate(value: unknown): value is LiveUpdate {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return (
    typeof event.id === "string" &&
    typeof event.productId === "string" &&
    (event.type === "price_drop_webhook" || event.type === "low_inventory_alert")
  );
}

function clampPollInterval(value: unknown) {
  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds)) return DEFAULT_POLL_INTERVAL_MS;
  return Math.min(Math.max(milliseconds, 5000), 60 * 1000);
}
