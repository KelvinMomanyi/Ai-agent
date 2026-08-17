import {
  BaseWidget,
  addManyToCart,
  getProducts,
  money,
  renderVariantPicker,
  resolveProductVariant,
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
      products.length > 0 &&
      products.every((product) =>
        product.variants.some((variant) => variant.availableForSale),
      );
    const firstProductHandle = products.find(
      (product) => product.handle,
    )?.handle;
    const total = products.reduce(
      (sum, product) =>
        sum + Number(product.price || 0) * Number(product.quantity || 1),
      0,
    );
    const pricing = getBundlePricing(total, bundle);

    this.html(`
      <style>
        .bundle { margin: 18px 0; box-shadow: none; }
        .tiles { display: flex; gap: 10px; overflow-x: auto; padding: 4px 0; }
        .tile { flex: 0 0 128px; border: 1px solid var(--aovboost-line); border-radius: 8px; padding: 8px; }
        .totals { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .original { color: var(--aovboost-muted); text-decoration: line-through; }
        .discounted { color: var(--aovboost-accent); font-size: 1.08em; }
        .savings { color: var(--aovboost-accent); font-size: 13px; font-weight: 700; }
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
                (product, index) => `
                  <article class="tile">
                    ${product.imageUrl ? `<img src="${text(product.imageUrl)}" alt="${text(product.title)}" loading="lazy">` : ""}
                    <p class="product-name">${text(product.title)}</p>
                    <span class="price" data-variant-price="bundle-${index}">${text(product.price ? money(product.price) : "")}</span>
                    ${renderVariantPicker(product, `bundle-${index}`)}
                  </article>
                `,
              )
              .join("")}
          </div>
          <div class="totals" data-bundle-totals>${renderBundleTotals(pricing)}</div>
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

    this.root.querySelectorAll("[data-variant-picker]").forEach((picker) => {
      picker.addEventListener("change", () => {
        products.forEach((product, index) => {
          const key = `bundle-${index}`;
          const variant = resolveProductVariant(this.root, product, key);
          const price = this.root.querySelector(
            `[data-variant-price="${key}"]`,
          );
          if (price && variant) price.textContent = money(variant.price);
        });
        const selectedTotal = products.reduce((sum, product, index) => {
          const variant = resolveProductVariant(
            this.root,
            product,
            `bundle-${index}`,
          );
          return (
            sum +
            Number(variant?.price || product.price || 0) *
              Number(product.quantity || 1)
          );
        }, 0);
        const totals = this.root.querySelector("[data-bundle-totals]");
        if (totals) {
          totals.innerHTML = renderBundleTotals(
            getBundlePricing(selectedTotal, bundle),
          );
        }
      });
    });

    this.root
      .querySelector("[data-add]")
      ?.addEventListener("click", async () => {
        const button = this.root.querySelector(
          "[data-add]",
        ) as HTMLButtonElement | null;
        if (button) {
          button.disabled = true;
          button.textContent = "Adding bundle…";
        }
        this.trackClick("add_bundle");
        const added = await addManyToCart(
          products.map((product, index) => ({
            variantId: resolveProductVariant(
              this.root,
              product,
              `bundle-${index}`,
            )?.id,
            quantity: Number(product.quantity || 1),
          })),
          this.payload.offerId,
          pricing.active
            ? {
                _aovboost_bundle_id: String(bundle.id),
                _aovboost_bundle_version: String(bundle.discountVersion),
              }
            : undefined,
        );
        if (!added) {
          if (button) {
            button.disabled = false;
            button.textContent = "Try again";
          }
          return;
        }
        if (button) button.textContent = "Bundle added ✓";
        document.dispatchEvent(
          new CustomEvent("add-to-cart", {
            detail: { source: "bundle_widget" },
          }),
        );
      });
  }
}

function renderBundleTotals(pricing: ReturnType<typeof getBundlePricing>) {
  return pricing.active
    ? `<span class="original">${money(pricing.original)}</span>
       <strong class="discounted">${money(pricing.discounted)}</strong>
       <span class="savings">Save ${money(pricing.savings)}</span>`
    : `<strong>${money(pricing.original)}</strong>`;
}

export function getBundlePricing(total: number, bundle: Record<string, any>) {
  const original = roundCurrency(Math.max(0, total));
  const discountValue = Number(bundle.discountValue);
  const hasNativeDiscount = Boolean(bundle.id && bundle.discountVersion);
  let savings = 0;

  if (
    hasNativeDiscount &&
    bundle.discountType === "percentage" &&
    Number.isFinite(discountValue) &&
    discountValue >= 1 &&
    discountValue <= 50
  ) {
    savings = roundCurrency(original * (discountValue / 100));
  } else if (
    hasNativeDiscount &&
    bundle.discountType === "fixed_amount" &&
    Number.isFinite(discountValue) &&
    discountValue > 0 &&
    discountValue < original
  ) {
    savings = roundCurrency(discountValue);
  }

  return {
    active: savings > 0,
    original,
    discounted: roundCurrency(Math.max(original - savings, 0)),
    savings,
  };
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
