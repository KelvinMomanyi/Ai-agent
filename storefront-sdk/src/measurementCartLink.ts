import type { SessionManager } from "./sessionManager";
import type { EventBus } from "./eventBus";
import { cartUrl } from "./shopifyCart";
import { MEASUREMENT_ATTRIBUTE } from "../../shared/holdout";

/** Same metadata-only, background linkage for both randomized arms. No cart lines change. */
export class MeasurementCartLink {
  private listeners = new AbortController();
  private linked = "";
  private pending = false;
  private attempts = 0;
  private attemptedLink = "";
  private hasCart = false;
  constructor(
    private session: SessionManager,
    private events: EventBus,
  ) {}
  init() {
    document.addEventListener("aovboost:event", this.handleCart, {
      signal: this.listeners.signal,
    });
    document.addEventListener("aovboost:measurement-updated", this.linkCart, {
      signal: this.listeners.signal,
    });
  }
  destroy() {
    this.listeners.abort();
  }
  private handleCart = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    if (!["cart_update", "cart_restored"].includes(detail?.type)) return;
    this.hasCart = Number(detail.cartItemCount) > 0;
    if (this.hasCart) void this.linkCart();
  };
  private linkCart = async () => {
    const measurement = this.session.getMeasurement();
    if (
      measurement &&
      !this.pending &&
      this.attemptedLink !== measurement.link
    ) {
      this.attemptedLink = measurement.link;
      this.attempts = 0;
    }
    if (
      !measurement ||
      !this.hasCart ||
      this.pending ||
      this.linked === measurement.link ||
      this.attempts >= 3 ||
      this.listeners.signal.aborted
    )
      return;
    this.pending = true;
    this.attempts += 1;
    const controller = new AbortController();
    const abort = () => controller.abort();
    this.listeners.signal.addEventListener("abort", abort, { once: true });
    const timer = window.setTimeout(abort, 2000);
    try {
      const response = await fetch(cartUrl("update"), {
        method: "POST",
        credentials: "same-origin",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "X-AOVBoost-Measurement": "1",
        },
        body: JSON.stringify({
          attributes: { [MEASUREMENT_ATTRIBUTE]: measurement.link },
        }),
      });
      if (response.ok && !this.listeners.signal.aborted) {
        this.linked = measurement.link;
        this.events.track("measurement_cart_linked", {
          measurementLink: measurement.link,
        });
      }
    } catch {
      /* Metadata failure leaves the cart usable and blocks strong measurement claims. */
    } finally {
      this.pending = false;
      window.clearTimeout(timer);
      this.listeners.signal.removeEventListener("abort", abort);
    }
  };
}
