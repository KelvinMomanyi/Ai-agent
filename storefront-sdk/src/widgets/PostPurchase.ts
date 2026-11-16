import WIDGET_CSS from '../styles/post-purchase.css?inline';
import {
  BaseWidget,
  addVariantToCart,
  getProducts,
  money,
  text,
} from "./BaseWidget";

export class PostPurchase extends BaseWidget {
  getWidgetType(): string {
    return "post_purchase";
  }

  mount(target = document.body): void {
    if (!this.isThankYouPage()) return;
    super.mount(target);
  }

  render(): void {
    const copy = (this.payload.copy || {}) as Record<string, unknown>;
    const product = getProducts(this.payload)[0] || this.payload.product || {};

    this.html(`
      <style>${WIDGET_CSS}</style>
      <section class="post card">
        <h3 class="title">${text(copy.headline || "For your next cart")}</h3>
        <article class="product-card">
          ${(product as any).imageUrl ? `<img src="${text((product as any).imageUrl)}" alt="${text((product as any).title)}" loading="lazy">` : "<span></span>"}
          <div class="stack">
            <div>
              <p class="product-name">${text(copy.productName || (product as any).title || "Recommended product")}</p>
              <span class="price">${text((product as any).price ? money((product as any).price) : "")}</span>
            </div>
            <p class="reason">${text(copy.oneLineReason || "A useful add-on for what you just bought.")}</p>
            <button type="button" class="primary" data-add>${text(copy.ctaText || "Add to cart")}</button>
          </div>
        </article>
      </section>
    `);

    this.root
      .querySelector("[data-add]")
      ?.addEventListener("click", async () => {
        this.trackClick("add_post_purchase");
        const variantId = (product as any).variantId;
        if (variantId) {
          await addVariantToCart(variantId, 1, this.payload.offerId);
          return;
        }
        const handle = (product as any).handle;
        if (handle) window.location.href = `/products/${handle}`;
      });
  }

  private isThankYouPage() {
    return (
      /\/thank_you(?:\/|$)/.test(window.location.pathname) ||
      Boolean((window as any).Shopify?.checkout)
    );
  }
}
