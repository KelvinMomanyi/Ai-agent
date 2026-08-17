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
      <style>
        :host { display: block; width: 100%; }
        .strip { margin: 20px auto; box-shadow: none; max-width: 1200px; }
        .heading { display: flex; align-items: end; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
        .eyebrow { color: var(--aovboost-accent); font-size: 11px; font-weight: 750; letter-spacing: .04em; text-transform: uppercase; }
        .rail {
          display: grid;
          grid-auto-flow: column;
          grid-auto-columns: minmax(170px, 210px);
          gap: 12px;
          overflow-x: auto;
          scroll-snap-type: x mandatory;
          overscroll-behavior-inline: contain;
          padding: 4px 2px 8px;
        }
        .tile { scroll-snap-align: start; border: 1px solid var(--aovboost-line); border-radius: 10px; padding: 10px; display: grid; align-content: start; gap: 8px; }
        .product-link { color: inherit; text-decoration: none; }
        .badge { width: fit-content; border-radius: 999px; background: #ecfdf5; color: #047857; font-size: 11px; padding: 4px 7px; }
        .status { min-height: 16px; color: var(--aovboost-accent); font-size: 11px; font-weight: 650; }
        .primary { text-align: center; text-decoration: none; }
        @media (max-width: 640px) {
          .strip { margin: 14px 0; padding: 14px; }
          .rail { grid-auto-columns: minmax(155px, 72vw); }
        }
      </style>
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
          );
          if (!added) throw new Error("Cart add failed");
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
