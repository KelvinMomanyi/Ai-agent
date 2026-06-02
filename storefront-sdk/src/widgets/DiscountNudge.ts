import { BaseWidget, money, text } from "./BaseWidget";

export class DiscountNudge extends BaseWidget {
  getWidgetType(): string {
    return "discount_nudge";
  }

  render(): void {
    this.draw();
    document.addEventListener("add-to-cart", () => this.draw());
  }

  private draw(): void {
    const copy = (this.payload.copy || {}) as Record<string, unknown>;
    const currency = String((window as any).AOVBoost?.currency || "USD");
    const threshold = Number(this.payload.threshold || 50);
    const cartValue = Number(this.payload.cartValue || 0);
    const remaining = Math.max(threshold - cartValue, 0);
    const progress = threshold > 0 ? Math.min(cartValue / threshold, 1) : 0;

    this.html(`
      <style>
        .bar {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          z-index: 9998;
          min-height: 48px;
          border-left: 0;
          border-right: 0;
          border-top: 0;
          padding: 8px 14px;
        }
        .label { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 13px; font-weight: 700; }
        .track { height: 6px; border-radius: 999px; overflow: hidden; background: #e5e7eb; margin-top: 6px; }
        .track span { display: block; height: 100%; width: ${progress * 100}%; background: var(--aovboost-accent); transition: width 200ms ease; }
      </style>
      <div class="bar">
        <div class="label">
          <span>${
            remaining > 0
              ? text(copy.progressLabel || `You're ${money(remaining, currency)} away from your reward`)
              : text(copy.rewardDescription || "Reward unlocked")
          }</span>
          <button type="button" class="icon" data-dismiss aria-label="Close">x</button>
        </div>
        <div class="track" aria-hidden="true"><span></span></div>
      </div>
    `);

    this.root.querySelector("[data-dismiss]")?.addEventListener("click", () => {
      this.trackDismiss();
      this.destroy();
    });

    if (remaining <= 0) {
      window.setTimeout(() => this.destroy(), 3000);
    }
  }
}
