import WIDGET_CSS from '../styles/toast-nudge.css?inline';
import { BaseWidget, text } from "./BaseWidget";

export class ToastNudge extends BaseWidget {
  getWidgetType(): string {
    return "toast";
  }

  render(): void {
    const copy = (this.payload.copy || {}) as Record<string, unknown>;
    const headline =
      copy.headline || this.payload.headline || "A better option is available";
    const body =
      copy.subheadline ||
      copy.offerLine ||
      this.payload.body ||
      "I can help find a better match or a useful offer.";
    const cta = copy.ctaText || this.payload.ctaText || "Open assistant";

    this.html(`
      <style>${WIDGET_CSS}</style>
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
        new CustomEvent("aovboost:open-chat", {
          detail: { source: "toast" },
        }),
      );
      this.destroy();
    });

    window.setTimeout(() => this.destroy(), 9000);
  }
}
