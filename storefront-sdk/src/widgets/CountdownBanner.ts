import { BaseWidget, text } from "./BaseWidget";

export class CountdownBanner extends BaseWidget {
  private timer: number | undefined;

  getWidgetType(): string {
    return "countdown_banner";
  }

  render(): void {
    const copy = (this.payload.copy || {}) as Record<string, unknown>;
    const headline = copy.headline || this.payload.headline || "Limited-time offer";
    const body =
      copy.subheadline ||
      copy.offerLine ||
      this.payload.body ||
      "Relevant bundles and add-ons are available for this session.";

    this.html(`
      <style>
        .banner {
          position: sticky;
          top: 0;
          z-index: 9998;
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto auto;
          align-items: center;
          gap: 12px;
          min-height: 48px;
          border-left: 0;
          border-right: 0;
          border-top: 0;
          border-radius: 0;
          padding: 9px 14px;
        }
        .copy { min-width: 0; }
        .timer { font-size: 13px; font-weight: 800; white-space: nowrap; }
        @media (max-width: 520px) {
          .banner { grid-template-columns: minmax(0, 1fr) auto; }
          .timer { grid-column: 1 / -1; }
        }
      </style>
      <aside class="banner card" role="status">
        <div class="copy">
          <h3 class="title">${text(headline)}</h3>
          <p class="body">${text(body)}</p>
        </div>
        <strong class="timer" data-countdown></strong>
        <button type="button" class="icon" data-dismiss aria-label="Close">x</button>
      </aside>
    `);

    this.root.querySelector("[data-dismiss]")?.addEventListener("click", () => {
      this.trackDismiss();
      this.destroy();
    });
    this.tick();
    this.timer = window.setInterval(() => this.tick(), 1000);
  }

  destroy(): void {
    if (this.timer) window.clearInterval(this.timer);
    super.destroy();
  }

  private tick(): void {
    const target = this.root.querySelector("[data-countdown]");
    if (!target) return;

    const endsAt = Date.parse(String(this.payload.endsAt || ""));
    if (!Number.isFinite(endsAt)) {
      target.textContent = "Today";
      return;
    }

    const remaining = Math.max(endsAt - Date.now(), 0);
    if (remaining <= 0) {
      this.destroy();
      return;
    }

    const hours = Math.floor(remaining / 3600000);
    const minutes = Math.floor((remaining % 3600000) / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    target.textContent =
      hours > 0
        ? `${hours}h ${minutes}m`
        : `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
  }
}
