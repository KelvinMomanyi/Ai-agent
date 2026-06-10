import { BaseWidget, text } from "./BaseWidget";

export class ToastNudge extends BaseWidget {
  getWidgetType(): string {
    return "toast";
  }

  render(): void {
    const copy = (this.payload.copy || {}) as Record<string, unknown>;
    const headline = copy.headline || this.payload.headline || "A better option is available";
    const body =
      copy.subheadline ||
      copy.offerLine ||
      this.payload.body ||
      "I can help find a better match or a useful offer.";
    const cta = copy.ctaText || this.payload.ctaText || "Open assistant";

    this.html(`
      <style>
        .toast {
          position: fixed;
          right: 18px;
          bottom: 18px;
          z-index: 9999;
          width: min(340px, calc(100vw - 36px));
          transform: translateY(16px);
          opacity: 0;
          animation: toast-in 180ms ease-out forwards;
        }
        @keyframes toast-in { to { transform: translateY(0); opacity: 1; } }
        .head { display: flex; justify-content: space-between; gap: 10px; align-items: start; }
      </style>
      <aside class="toast card" role="status" aria-live="polite">
        <div class="head">
          <div>
            <h3 class="title">${text(headline)}</h3>
            <p class="body">${text(body)}</p>
          </div>
          <button type="button" class="icon" data-dismiss aria-label="Close">x</button>
        </div>
        <div class="actions">
          <button type="button" class="primary" data-chat>${text(cta)}</button>
        </div>
      </aside>
    `);

    this.root.querySelector("[data-dismiss]")?.addEventListener("click", () => {
      this.trackDismiss();
      this.destroy();
    });
    this.root.querySelector("[data-chat]")?.addEventListener("click", () => {
      this.trackClick("open_assistant");
      document.dispatchEvent(
        new CustomEvent("aovboost:trigger", {
          detail: {
            type: "long_product_dwell",
            source: "toast",
          },
        }),
      );
      this.destroy();
    });

    window.setTimeout(() => this.destroy(), 9000);
  }
}
