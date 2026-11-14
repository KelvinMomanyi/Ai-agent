import { AGENT_LIMITS as L } from "./constants";
import type { AgentContext } from "./types";
export class MobileExitSignals {
  private listeners = new AbortController();
  private idle?: ReturnType<typeof setTimeout>;
  private back?: ReturnType<typeof setTimeout>;
  private fired = false;
  private y = window.scrollY;
  private upAt = 0;
  private upY = 0;
  constructor(
    private context: () => AgentContext,
    private emit: (reason: string) => void,
  ) {}
  private eligible() {
    const ctx = this.context();
    return (
      ctx.device.isMobile &&
      !ctx.session.chatOpen &&
      !ctx.session.checkoutStarted &&
      !["checkout", "thankyou", "other"].includes(ctx.page.type) &&
      (ctx.cart.items.length > 0 ||
        ctx.session.pageViews >= L.ENGAGED_PAGE_VIEWS)
    );
  }
  init(): void {
    for (const name of ["pointerdown", "keydown", "touchstart"])
      window.addEventListener(name, () => this.refresh(), {
        passive: true,
        signal: this.listeners.signal,
      });
    window.addEventListener(
      "scroll",
      () => {
        const y = window.scrollY,
          now = Date.now();
        if (y < this.y) {
          if (!this.upAt || now - this.upAt > L.MOBILE_EXIT_SCROLL_WINDOW_MS) {
            this.upAt = now;
            this.upY = this.y;
          }
          if (
            this.upY >= L.MOBILE_EXIT_MIN_SCROLL_Y &&
            this.upY - y >= L.MOBILE_EXIT_SCROLL_UP_PX
          )
            this.fire("scroll_up");
        } else this.upAt = 0;
        this.y = y;
        this.refresh();
      },
      { passive: true, signal: this.listeners.signal },
    );
    window.addEventListener(
      "popstate",
      () =>
        queueMicrotask(() => {
          if (!this.listeners.signal.aborted)
            this.back = setTimeout(() => this.fire("back"), 0);
        }),
      { signal: this.listeners.signal },
    );
    document.addEventListener("visibilitychange", () => this.refresh(), {
      signal: this.listeners.signal,
    });
    this.refresh();
  }
  refresh(): void {
    clearTimeout(this.idle);
    if (!this.fired && this.eligible() && document.visibilityState !== "hidden")
      this.idle = setTimeout(() => this.fire("idle"), L.MOBILE_IDLE_MS);
  }
  navigation(): void {
    this.fired = false;
    this.y = window.scrollY;
    this.upAt = 0;
    this.refresh();
  }
  private fire(reason: string) {
    if (
      this.fired ||
      this.listeners.signal.aborted ||
      !this.eligible() ||
      document.visibilityState === "hidden"
    )
      return;
    this.fired = true;
    clearTimeout(this.idle);
    this.emit(reason);
  }
  destroy(): void {
    this.listeners.abort();
    clearTimeout(this.idle);
    clearTimeout(this.back);
  }
}
