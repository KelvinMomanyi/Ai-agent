import WIDGET_CSS from '../styles/rec-strip.css?inline';
import {
  BaseWidget,
  addVariantToCart,
  getProducts,
  money,
  renderVariantPicker,
  resolveProductVariant,
  text,
} from "./BaseWidget";

export class RecStrip extends BaseWidget {
  getWidgetType(): string {
    return "rec_strip";
  }

  render(): void {
    const products = getProducts(this.payload);
    if (products.length === 0) {
      this.destroy();
      return;
    }
    const copy = (this.payload.copy || {}) as Record<string, unknown>;

    this.html(`
      <style>${WIDGET_CSS}</style>
      <section class="strip card">
        <div class="heading">
          <div>
            <span class="eyebrow">From this store</span>
            <h3 class="title">${text(copy.headline, "Recommended for you")}</h3>
          </div>
          <span class="body">${products.length} verified ${products.length === 1 ? "item" : "items"}</span>
        </div>
        <div class="rail">
          ${products
            .map(
              (product, index) => `
                <article class="tile">
                  ${product.reason ? `<span class="badge">${text(product.reason)}</span>` : ""}
                  ${
                    product.imageUrl
                      ? product.handle
                        ? `<a class="product-link" href="/products/${text(product.handle)}"><img data-src="${text(product.imageUrl)}" alt="${text(product.title)}"></a>`
                        : `<img data-src="${text(product.imageUrl)}" alt="${text(product.title)}">`
                      : ""
                  }
                  ${
                    product.handle
                      ? `<a class="product-link product-name" href="/products/${text(product.handle)}">${text(product.title)}</a>`
                      : `<p class="product-name">${text(product.title)}</p>`
                  }
                  <span class="price" data-variant-price="rec-${index}">${text(product.price ? money(product.price) : "")}</span>
                  ${renderVariantPicker(product, `rec-${index}`)}
                  ${
                    product.variants.some((variant) => variant.availableForSale)
                      ? `<button type="button" class="primary" data-add data-product-index="${index}">Add to cart</button>`
                      : product.handle
                        ? `<a class="primary" href="/products/${text(product.handle)}">View product</a>`
                        : ""
                  }
                  <span class="status" data-status="${index}" aria-live="polite"></span>
                </article>
              `,
            )
            .join("")}
        </div>
      </section>
    `);

    this.lazyLoadImages();
    this.root.querySelectorAll("[data-variant-picker]").forEach((picker) => {
      picker.addEventListener("change", () => {
        products.forEach((product, index) => {
          const key = `rec-${index}`;
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
          ? resolveProductVariant(this.root, product, `rec-${index}`)
          : null;
        if (!variant) return;
        const status = this.root.querySelector(`[data-status="${index}"]`);
        element.disabled = true;
        element.textContent = "Adding…";
        this.trackClick("add_recommendation");
        try {
          const added = await addVariantToCart(
            variant.id,
            1,
            this.payload.offerId,
            "aov_strip",
          );
          if (!added) throw new Error("Cart add failed");
          this.track("recommendation_added", {
            productId: product.id,
            variantId: variant.id,
          });
          element.textContent = "Added ✓";
          if (status) status.textContent = "Added to your cart";
          document.dispatchEvent(
            new CustomEvent("add-to-cart", {
              detail: {
                source: "recommendation_strip",
                productId: product.id,
                variantId: variant.id,
              },
            }),
          );
        } catch {
          element.disabled = false;
          element.textContent = "Try again";
          if (status) status.textContent = "Could not add this item";
        }
      });
    });
  }

  private lazyLoadImages() {
    const images = Array.from(
      this.root.querySelectorAll("img[data-src]"),
    ) as HTMLImageElement[];
    if (!("IntersectionObserver" in window)) {
      images.forEach((image) => {
        image.src = image.dataset.src || "";
      });
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const image = entry.target as HTMLImageElement;
        image.src = image.dataset.src || "";
        observer.unobserve(image);
      });
    });
    images.forEach((image) => observer.observe(image));
  }
}
