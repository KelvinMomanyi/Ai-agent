import WIDGET_CSS from '../styles/discount-nudge.css?inline';
import INLINE_CSS0 from '../styles/discount-nudge-inline.css?inline';
import { BaseWidget, money, text } from "./BaseWidget";

export class DiscountNudge extends BaseWidget {
  private handleCartChange = () => {
    void this.refreshCartValue();
  };

  getWidgetType(): string {
    return "discount_nudge";
  }

  render(): void {
    this.draw();
    document.addEventListener("add-to-cart", this.handleCartChange);
  }

  destroy(): void {
    document.removeEventListener("add-to-cart", this.handleCartChange);
    super.destroy();
  }

  private draw(): void {
    const copy = (this.payload.copy || {}) as Record<string, unknown>;
    const threshold = Number(this.payload.threshold || 50);
    const cartValue = Number(this.payload.cartValue || 0);
    const remaining = Math.max(threshold - cartValue, 0);
    const progress = threshold > 0 ? Math.min(cartValue / threshold, 1) : 0;

    this.html(`
      <style>${WIDGET_CSS}${this.payload.presentation === "inline" ? INLINE_CSS0 : ""}</style>
      <div class="bar">
        <div class="label">
          <span>${
            remaining > 0
              ? `${text(copy.progressLabel || "Cart goal")}: ${text(money(remaining))} to go`
              : text(copy.rewardDescription || "Cart goal reached")
          }</span>
          <button type="button" class="secondary" data-cta>${text(copy.ctaText || "View picks")}</button>
          <button type="button" class="icon" data-dismiss aria-label="Close">x</button>
        </div>
        <div class="track" aria-hidden="true"><span style="--aovboost-progress:${progress * 100}%"></span></div>
      </div>
    `);

    this.root.querySelector("[data-dismiss]")?.addEventListener("click", () => {
      this.trackDismiss();
      this.destroy();
    });
    this.root.querySelector("[data-cta]")?.addEventListener("click", () => {
      this.trackClick("view_cart_goal_picks");
      document.dispatchEvent(
        new CustomEvent("aovboost:open-chat", {
          detail: { source: "discount_nudge" },
        }),
      );
    });

    if (remaining <= 0) {
      window.setTimeout(() => this.destroy(), 3000);
    }
  }

  private async refreshCartValue() {
    try {
      const response = await fetch("/cart.js", {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) return;
      const cart = await response.json();
      const value = Number(cart.total_price);
      if (!Number.isFinite(value) || value < 0) return;
      this.payload.cartValue = value / 100;
      this.draw();
    } catch {
      // Keep the last verified progress if Shopify's cart is briefly unavailable.
    }
  }
}
