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
      <style>
        .alert {
          margin: 10px 0;
          box-shadow: none;
          border-color: rgba(15, 118, 110, .32);
          background: #f0fdfa;
        }
        .head { display: flex; justify-content: space-between; gap: 10px; align-items: start; }
      </style>
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
