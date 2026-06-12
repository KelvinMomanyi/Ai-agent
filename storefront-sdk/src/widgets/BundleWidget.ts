import {
  BaseWidget,
  addManyToCart,
  getProducts,
  money,
  text,
} from "./BaseWidget";

export class BundleWidget extends BaseWidget {
  getWidgetType(): string {
    return "bundle";
  }

  render(): void {
    const bundle = (this.payload.bundle || {}) as Record<string, any>;
    const copy = (this.payload.copy || {}) as Record<string, unknown>;
    const products = getProducts(this.payload);
    const canAddBundle =
      products.length > 0 && products.every((product) => product.variantId);
    const firstProductHandle = products.find(
      (product) => product.handle,
    )?.handle;
    const total = products.reduce(
      (sum, product) =>
        sum + Number(product.price || 0) * Number(product.quantity || 1),
      0,
    );
    const discountValue = Number(bundle.discountValue || 0);
    const discounted =
      bundle.discountType === "percentage"
        ? total * (1 - discountValue / 100)
        : bundle.discountType === "fixed"
          ? Math.max(total - discountValue, 0)
          : total;

    this.html(`
      <style>
        .bundle { margin: 18px 0; box-shadow: none; }
        .tiles { display: flex; gap: 10px; overflow-x: auto; padding: 4px 0; }
        .tile { flex: 0 0 128px; border: 1px solid var(--aovboost-line); border-radius: 8px; padding: 8px; }
        .totals { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .strike { color: var(--aovboost-muted); text-decoration: line-through; }
      </style>
      <section class="bundle card">
        <div class="stack">
          <div>
            <h3 class="title">${text(copy.headline || bundle.name || "Complete the set")}</h3>
            <p class="body">${text(bundle.description || copy.totalSavings || "Bundle these products for a better cart.")}</p>
          </div>
          <div class="tiles">
            ${products
              .map(
                (product) => `
                  <article class="tile">
                    ${product.imageUrl ? `<img src="${text(product.imageUrl)}" alt="${text(product.title)}" loading="lazy">` : ""}
                    <p class="product-name">${text(product.title)}</p>
                    <span class="price">${text(product.price ? money(product.price) : "")}</span>
                  </article>
                `,
              )
              .join("")}
          </div>
          <div class="totals">
            ${total > discounted ? `<span class="strike">${money(total)}</span>` : ""}
            <strong>${money(discounted)}</strong>
          </div>
          <div class="actions">
            ${
              canAddBundle
                ? `<button type="button" class="primary" data-add>${text(copy.ctaText || "Add bundle to cart")}</button>`
                : firstProductHandle
                  ? `<a class="primary" href="/products/${text(firstProductHandle)}">${text(copy.ctaText || "View bundle products")}</a>`
                  : ""
            }
          </div>
        </div>
      </section>
    `);

    this.root
      .querySelector("[data-add]")
      ?.addEventListener("click", async () => {
        this.trackClick("add_bundle");
        await addManyToCart(
          products.map((product) => ({
            variantId: product.variantId,
            quantity: Number(product.quantity || 1),
          })),
        );
        document.dispatchEvent(
          new CustomEvent("add-to-cart", {
            detail: { source: "bundle_widget" },
          }),
        );
      });
  }
}
