import {
  BaseWidget,
  addVariantToCart,
  getProducts,
  money,
  text,
} from "./BaseWidget";

export class UpsellDrawer extends BaseWidget {
  private timer: number | undefined;
  private deadline = Date.now() + 8000;

  getWidgetType(): string {
    return "upsell_drawer";
  }

  render(): void {
    const products = getProducts(this.payload).slice(0, 3);
    const copy = (this.payload.copy || {}) as Record<string, unknown>;

    this.html(`
      <style>
        .backdrop { position: fixed; inset: 0; z-index: 9998; background: rgba(17, 24, 39, .28); }
        .drawer {
          position: fixed;
          top: 0;
          right: 0;
          z-index: 9999;
          width: min(400px, 100vw);
          height: 100dvh;
          padding: 18px;
          transform: translateX(100%);
          animation: drawer-in 200ms ease-out forwards;
          overflow: auto;
        }
        @keyframes drawer-in { to { transform: translateX(0); } }
        .head { display: flex; justify-content: space-between; align-items: start; gap: 12px; }
        .timer { height: 4px; border-radius: 999px; overflow: hidden; background: #e5e7eb; margin: 12px 0; }
        .timer span { display: block; height: 100%; width: 100%; background: var(--aovboost-accent); transform-origin: left; }
      </style>
      <div class="backdrop" data-dismiss></div>
      <aside class="drawer" aria-label="Add-to-cart upsell">
        <div class="head">
          <div>
            <h3 class="title">${text(copy.headline || "Great choice. Complete the set")}</h3>
            <p class="body">People who bought this also love:</p>
          </div>
          <button type="button" class="icon" data-dismiss aria-label="Close">x</button>
        </div>
        <div class="timer"><span data-timer></span></div>
        <div class="product-grid">
          ${products
            .map(
              (product) => `
                <article class="product-card">
                  ${product.imageUrl ? `<img src="${text(product.imageUrl)}" alt="${text(product.title)}" loading="lazy">` : "<span></span>"}
                  <div class="stack">
                    <div>
                      <p class="product-name">${text(product.title)}</p>
                      <span class="price">${text(product.price ? money(product.price) : "")}</span>
                    </div>
                    <p class="reason">${text(product.reason || copy.whyThisGoes || "It pairs well with your cart.")}</p>
                    ${
                      product.variantId
                        ? `<button type="button" class="primary" data-add="${text(product.variantId)}">Add to cart</button>`
                        : product.handle
                          ? `<a class="primary" href="/products/${text(product.handle)}">View product</a>`
                          : ""
                    }
                  </div>
                </article>
              `,
            )
            .join("")}
        </div>
        <div class="actions">
          <a class="secondary" href="/cart">Continue to cart</a>
        </div>
      </aside>
    `);

    this.root.querySelectorAll("[data-dismiss]").forEach((element) => {
      element.addEventListener("click", () => this.dismiss());
    });
    this.root.querySelectorAll("[data-add]").forEach((button) => {
      button.addEventListener("click", async () => {
        this.trackClick("add_upsell");
        await addVariantToCart((button as HTMLElement).dataset.add);
      });
    });

    this.startCountdown();
  }

  destroy(): void {
    if (this.timer) window.clearInterval(this.timer);
    super.destroy();
  }

  private startCountdown() {
    if (this.timer) window.clearInterval(this.timer);
    this.deadline = Date.now() + 8000;
    this.timer = window.setInterval(() => {
      const remaining = Math.max(this.deadline - Date.now(), 0);
      const bar = this.root.querySelector("[data-timer]") as HTMLElement | null;
      if (bar) bar.style.transform = `scaleX(${remaining / 8000})`;
      if (remaining <= 0) this.dismiss();
    }, 120);
  }

  private dismiss() {
    this.trackDismiss();
    this.container.animate(
      [{ transform: "translateX(0)" }, { transform: "translateX(100%)" }],
      { duration: 180, easing: "ease-in", fill: "forwards" },
    );
    window.setTimeout(() => this.destroy(), 190);
  }
}
