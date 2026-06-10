import { BaseWidget, text } from "./BaseWidget";

export class ExitIntent extends BaseWidget {
  private shown = false;

  getWidgetType(): string {
    return "exit_intent";
  }

  mount(target = document.body): void {
    target.appendChild(this.container);
    if (this.shouldSkip()) return;
    if (this.payload.immediate) {
      this.show();
      return;
    }

    document.addEventListener("mouseleave", this.handleMouseLeave);
    document.addEventListener("visibilitychange", this.handleVisibility);
  }

  render(): void {
    const copy = (this.payload.copy || {}) as Record<string, unknown>;
    this.html(`
      <style>
        .backdrop { position: fixed; inset: 0; z-index: 9998; background: rgba(17, 24, 39, .38); }
        .modal { position: fixed; inset: 50% auto auto 50%; z-index: 9999; width: min(420px, calc(100vw - 32px)); transform: translate(-50%, -50%); border-radius: 8px; padding: 18px; }
      </style>
      <div class="backdrop" data-dismiss></div>
      <section class="modal">
        <h3 class="title">${text(copy.headline || "Wait before you go")}</h3>
        <p class="body">${text(copy.offerLine || this.payload.offerLine || "Your cart has a relevant offer available.")}</p>
        ${this.payload.discountCode ? `<p class="body"><strong>${text(this.payload.discountCode)}</strong></p>` : ""}
        <div class="actions">
          <button type="button" class="primary" data-claim>${text(copy.ctaText || "Claim offer")}</button>
          <button type="button" class="secondary" data-dismiss>${text(copy.dismissText || "No thanks")}</button>
        </div>
      </section>
    `);

    this.root.querySelector("[data-claim]")?.addEventListener("click", () => {
      this.trackClick("claim_exit_offer");
      this.destroy();
    });
    this.root.querySelectorAll("[data-dismiss]").forEach((element) => {
      element.addEventListener("click", () => {
        this.trackDismiss();
        this.destroy();
      });
    });
  }

  destroy(): void {
    document.removeEventListener("mouseleave", this.handleMouseLeave);
    document.removeEventListener("visibilitychange", this.handleVisibility);
    super.destroy();
  }

  private handleMouseLeave = (event: MouseEvent) => {
    if (event.clientY < 10) this.show();
  };

  private handleVisibility = () => {
    if (document.visibilityState === "hidden") this.show();
  };

  private show() {
    if (this.shown || this.hasFired()) return;
    this.shown = true;
    try {
      sessionStorage.setItem("aovboost_exit_intent_fired", "true");
    } catch {
      // Ignore storage failures.
    }
    this.render();
    this.trackImpression();
  }

  private hasFired() {
    try {
      return sessionStorage.getItem("aovboost_exit_intent_fired") === "true";
    } catch {
      return false;
    }
  }

  private shouldSkip() {
    return /\/(?:checkout|thank_you)(?:\/|$)/.test(window.location.pathname);
  }
}
