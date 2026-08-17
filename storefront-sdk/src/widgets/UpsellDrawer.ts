import {
  BaseWidget,
  addVariantToCart,
  getProducts,
  money,
  renderVariantPicker,
  resolveProductVariant,
  text,
} from "./BaseWidget";

export class UpsellDrawer extends BaseWidget {
  getWidgetType(): string {
    return "upsell_drawer";
  }

  render(): void {
    const products = getProducts(this.payload).slice(0, 3);
    const copy = (this.payload.copy || {}) as Record<string, unknown>;
    if (products.length === 0) {
      this.destroy();
      return;
    }

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
        .added-note { margin: 12px 0; border-radius: 8px; background: #ecfdf5; color: #047857; font-size: 13px; font-weight: 700; padding: 9px 11px; }
        .status { min-height: 16px; color: var(--aovboost-accent); font-size: 12px; font-weight: 650; }
      </style>
      <div class="backdrop" data-dismiss></div>
      <aside class="drawer" aria-label="Add-to-cart upsell">
        <div class="head">
          <div>
            <h3 class="title">${text(copy.headline || "Great choice. Complete the set")}</h3>
            <p class="body">Verified complementary products from this store:</p>
          </div>
          <button type="button" class="icon" data-dismiss aria-label="Close">x</button>
        </div>
        <div class="added-note">Your selected item was added to the cart.</div>
        <div class="product-grid">
          ${products
            .map(
              (product, index) => `
                <article class="product-card">
                  ${product.imageUrl ? `<img src="${text(product.imageUrl)}" alt="${text(product.title)}" loading="lazy">` : "<span></span>"}
                  <div class="stack">
                    <div>
                      <p class="product-name">${text(product.title)}</p>
                      <span class="price" data-variant-price="upsell-${index}">${text(product.price ? money(product.price) : "")}</span>
                    </div>
                    <p class="reason">${text(product.reason || copy.whyThisGoes || "It pairs well with your cart.")}</p>
                    ${renderVariantPicker(product, `upsell-${index}`)}
                    ${
                      product.variants.some(
                        (variant) => variant.availableForSale,
                      )
                        ? `<button type="button" class="primary" data-add data-product-index="${index}">Add to cart</button>`
                        : product.handle
                          ? `<a class="primary" href="/products/${text(product.handle)}">View product</a>`
                          : ""
                    }
                    <span class="status" data-status="${index}" aria-live="polite"></span>
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
    this.root.querySelectorAll("[data-variant-picker]").forEach((picker) => {
      picker.addEventListener("change", () => {
        products.forEach((product, index) => {
          const key = `upsell-${index}`;
          const variant = resolveProductVariant(this.root, product, key);
          const price = this.root.querySelector(
            `[data-variant-price="${key}"]`,
          );
          if (price && variant) price.textContent = money(variant.price);
        });
      });
    });
    this.root.querySelectorAll("[data-add]").forEach((button) => {
      button.addEventListener("click", async () => {
        const element = button as HTMLButtonElement;
        const index = Number(element.dataset.productIndex);
        const product = products[index];
        const variant = product
          ? resolveProductVariant(this.root, product, `upsell-${index}`)
          : null;
        if (!variant) return;
        const status = this.root.querySelector(`[data-status="${index}"]`);
        element.disabled = true;
        element.textContent = "Adding…";
        this.trackClick("add_upsell");
        try {
          const added = await addVariantToCart(
            variant.id,
            1,
            this.payload.offerId,
          );
          if (!added) throw new Error("Cart add failed");
          element.textContent = "Added ✓";
          if (status) status.textContent = "Added to your cart";
        } catch {
          element.disabled = false;
          element.textContent = "Try again";
          if (status) status.textContent = "Could not add this item";
        }
      });
    });
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
