import WIDGET_CSS from '../styles/inline-alert.css?inline';
import { BaseWidget, text } from "./BaseWidget";

export class InlineAlert extends BaseWidget {
  getWidgetType(): string {
    return "inline_alert";
  }

  render(): void {
    const copy = (this.payload.copy || {}) as Record<string, unknown>;
    const headline = copy.headline || this.payload.headline || "Store update";
    const body =
      copy.subheadline ||
      copy.offerLine ||
      this.payload.body ||
      "A relevant product update is available.";

    this.html(`
      <style>${WIDGET_CSS}</style>
      <aside class="alert card" role="status">
        <div class="head">
          <div>
            <h3 class="title">${text(headline)}</h3>
            <p class="body">${text(body)}</p>
          </div>
          <button type="button" class="icon" data-dismiss aria-label="Close">x</button>
        </div>
      </aside>
    `);

    this.root.querySelector("[data-dismiss]")?.addEventListener("click", () => {
      this.trackDismiss();
      this.destroy();
    });
  }
}
