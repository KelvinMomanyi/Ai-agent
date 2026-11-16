import WIDGET_CSS from '../styles/countdown-banner.css?inline';
import INLINE_CSS0 from '../styles/countdown-banner-inline.css?inline';
import { BaseWidget, text } from "./BaseWidget";

export class CountdownBanner extends BaseWidget {
  private timer: number | undefined;

  getWidgetType(): string {
    return "countdown_banner";
  }

  render(): void {
    const copy = (this.payload.copy || {}) as Record<string, unknown>;
    const headline =
      copy.headline || this.payload.headline || "Limited-time offer";
    const body =
      copy.subheadline ||
      copy.offerLine ||
      this.payload.body ||
      "Relevant bundles and add-ons are available for this session.";

    this.html(`
      <style>${WIDGET_CSS}${this.payload.presentation === "inline" ? INLINE_CSS0 : ""}</style>
      <aside class="banner card" role="status">
        <div class="copy">
          <h3 class="title">${text(headline)}</h3>
          <p class="body">${text(body)}</p>
        </div>
        <strong class="timer" data-countdown></strong>
        <button type="button" class="secondary" data-cta>${text(copy.ctaText || "View picks")}</button>
        <button type="button" class="icon" data-dismiss aria-label="Close">x</button>
      </aside>
    `);

    this.root.querySelector("[data-dismiss]")?.addEventListener("click", () => {
      this.trackDismiss();
      this.destroy();
    });
    this.root.querySelector("[data-cta]")?.addEventListener("click", () => {
      this.trackClick("view_campaign_picks");
      document.dispatchEvent(
        new CustomEvent("aovboost:open-chat", {
          detail: { source: "countdown_banner" },
        }),
      );
    });
    this.tick();
    if (this.container.isConnected)
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
