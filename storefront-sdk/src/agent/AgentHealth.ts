import { AGENT_LIMITS as L } from "./constants";

export class AgentHealth {
  private failures: number[] = [];
  private openUntil = 0;
  private healthy = false;
  private destroyed = false;
  private pending?: Promise<boolean>;
  private controller?: AbortController;
  private retry?: ReturnType<typeof setTimeout>;
  constructor(
    private probeRequest: (signal: AbortSignal) => Promise<boolean>,
    private changed: (healthy: boolean) => void,
  ) {}
  get isHealthy(): boolean {
    return this.healthy;
  }
  get isOpen(): boolean {
    return this.openUntil > Date.now();
  }
  record(ok: boolean): void {
    if (this.destroyed) return;
    const now = Date.now();
    if (ok && this.isOpen) return;
    if (ok) {
      this.failures = [];
      this.openUntil = 0;
    } else {
      this.failures = this.failures.filter(
        (at) => now - at < L.BREAKER_WINDOW_MS,
      );
      this.failures.push(now);
      if (this.failures.length >= L.BREAKER_FAILS)
        this.openUntil = now + L.BREAKER_OPEN_MS;
    }
    if (this.healthy !== ok) {
      this.healthy = ok;
      this.changed(ok);
    }
    clearTimeout(this.retry);
    if (!ok)
      this.retry = setTimeout(
        () => {
          void this.probe();
        },
        this.isOpen ? this.openUntil - now : L.HEALTH_RETRY_MS,
      );
  }
  probe(): Promise<boolean> {
    if (this.destroyed || this.isOpen) return Promise.resolve(false);
    if (this.pending) return this.pending;
    const controller = new AbortController();
    this.controller = controller;
    this.pending = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          Promise.resolve().then(() => this.probeRequest(controller.signal)),
          new Promise<boolean>((resolve) => {
            timer = setTimeout(() => {
              controller.abort();
              resolve(false);
            }, L.HEALTH_TIMEOUT_MS);
          }),
        ]);
        this.record(result);
        return result;
      } catch {
        this.record(false);
        return false;
      } finally {
        clearTimeout(timer);
        this.pending = undefined;
        this.controller = undefined;
      }
    })();
    return this.pending;
  }
  destroy(): void {
    this.destroyed = true;
    this.controller?.abort();
    clearTimeout(this.retry);
  }
}
