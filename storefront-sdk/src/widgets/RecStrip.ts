import {
  BaseWidget,
  addVariantToCart,
  getProducts,
  money,
  text,
} from "./BaseWidget";

export class RecStrip extends BaseWidget {
  getWidgetType(): string {
    return "rec_strip";
  }

  render(): void {
    const products = getProducts(this.payload);

    this.html(`
      <style>
        .strip { margin: 20px 0; box-shadow: none; }
        .rail {
          display: grid;
          grid-auto-flow: column;
          grid-auto-columns: minmax(150px, 180px);
          gap: 10px;
          overflow-x: auto;
          scroll-snap-type: x mandatory;
          padding: 4px 0 2px;
        }
        .tile { scroll-snap-align: start; border: 1px solid var(--aovboost-line); border-radius: 8px; padding: 9px; display: grid; gap: 7px; }
        .badge { width: fit-content; border-radius: 999px; background: #ecfdf5; color: #047857; font-size: 11px; padding: 4px 7px; }
      </style>
      <section class="strip card">
        <h3 class="title">You might also like</h3>
        <div class="rail">
          ${products
            .map(
              (product) => `
                <article class="tile">
                  ${product.reason ? `<span class="badge">${text(product.reason)}</span>` : ""}
                  ${product.imageUrl ? `<img data-src="${text(product.imageUrl)}" alt="${text(product.title)}">` : ""}
                  <p class="product-name">${text(product.title)}</p>
                  <span class="price">${text(product.price ? money(product.price) : "")}</span>
                  ${
                    product.variantId
                      ? `<button type="button" class="primary" data-add="${text(product.variantId)}">Add to cart</button>`
                      : product.handle
                        ? `<a class="primary" href="/products/${text(product.handle)}">View product</a>`
                        : ""
                  }
                </article>
              `,
            )
            .join("")}
        </div>
      </section>
    `);

    this.lazyLoadImages();
    this.root.querySelectorAll("[data-add]").forEach((button) => {
      button.addEventListener("click", async () => {
        this.trackClick("add_recommendation");
        await addVariantToCart((button as HTMLElement).dataset.add);
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
