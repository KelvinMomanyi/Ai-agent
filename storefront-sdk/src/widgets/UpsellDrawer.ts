import {
  BaseWidget,
  addVariantToCart,
  getProducts,
  money,
  renderVariantPicker,
  resolveProductVariant,
  text,
} from "./BaseWidget";
import { recommendationLimit } from "../../../shared/cartRecommendations";
import { isElementVisible } from "./visibility";

export class UpsellDrawer extends BaseWidget {
  private keyboard = new AbortController();
  private returnTo: HTMLElement | null = null;
  private shiftTab = false;
  getWidgetType(): string {
    return "upsell_drawer";
  }

  render(): void {
    const products = getProducts(this.payload).slice(
      0,
      recommendationLimit(this.payload.maxProductRecommendations),
    );
    const copy = (this.payload.copy || {}) as Record<string, unknown>;
    const inline = this.payload.presentation === "inline";
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
        ${inline ? `.drawer { position: static; inset: auto; z-index: auto; width: 100%; height: auto; margin: 18px 0; transform: none; animation: none; overflow: visible; }` : ""}
      </style>
      ${inline ? "" : '<div class="backdrop" data-dismiss></div>'}
      <aside class="drawer" role="region" aria-label="Recommended cart additions">
        <div class="head">
          <div>
            <h3 class="title">${text(copy.headline || "Great choice. Complete the set")}</h3>
            <p class="body">Verified complementary products from this store:</p>
          </div>
          <button type="button" class="icon" data-dismiss aria-label="Close">x</button>
        </div>
        ${inline ? "" : '<div class="added-note">Your selected item was added to the cart.</div>'}
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
                        ? `<button type="button" class="primary" data-add data-product-index="${index}" ${this.payload.previewMode ? "disabled" : ""}>Add to cart</button>`
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
        ${inline ? "" : '<div class="actions"><a class="secondary" href="/cart">Continue to cart</a></div>'}
      </aside>
    `);

    this.returnTo =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    this.root.addEventListener(
      "keydown",
      (event) => {
        const key = event as KeyboardEvent;
        if (key.key === "Escape") {
          key.preventDefault();
          key.stopPropagation();
          // The native drawer handles keyup; consume the matching release even
          // after focus returns out of this removed card.
          const release = (event: KeyboardEvent) => {
            if (event.key === "Escape") event.stopPropagation();
            document.removeEventListener("keyup", release, true);
            window.clearTimeout(timer);
          };
          const timer = window.setTimeout(
            () => document.removeEventListener("keyup", release, true),
            1000,
          );
          document.addEventListener("keyup", release, true);
          this.dismiss();
        }
        if (key.key === "Tab" && this.payload.cartDrawer) this.bridgeTab(key);
      },
      { signal: this.keyboard.signal },
    );
    this.root.addEventListener(
      "keyup",
      (event) => {
        if ((event as KeyboardEvent).key === "Escape") event.stopPropagation();
      },
      { signal: this.keyboard.signal },
    );
    if (this.payload.cartDrawer) {
      // Native theme focus traps enumerate light-DOM controls. Expose one stop
      // and bridge into/out of the shadow controls without trapping the whole cart.
      this.container.tabIndex = 0;
      this.container.setAttribute("aria-label", "Recommended cart additions");
      document.addEventListener(
        "keydown",
        (event) => {
          if (event.key === "Tab") this.shiftTab = event.shiftKey;
        },
        { capture: true, signal: this.keyboard.signal },
      );
      this.container.addEventListener(
        "focus",
        (event) => {
          if (event.composedPath()[0] !== this.container) return;
          const controls = this.controls();
          (this.shiftTab ? controls.at(-1) : controls[0])?.focus();
        },
        { signal: this.keyboard.signal },
      );
    }

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
            "aov_upsell",
          );
          if (!added) throw new Error("Cart add failed");
          this.track("recommendation_added", {
            productId: product.id,
            variantId: variant.id,
          });
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

  private controls() {
    return Array.from(
      this.root.querySelectorAll<HTMLElement>(
        "button:not(:disabled), select:not(:disabled), a[href]",
      ),
    ).filter((element) => !element.hasAttribute("hidden"));
  }

  private bridgeTab(event: KeyboardEvent) {
    const controls = this.controls();
    const active = this.root.activeElement;
    if (
      (!event.shiftKey && active !== controls.at(-1)) ||
      (event.shiftKey && active !== controls[0])
    )
      return;
    const drawer = this.container.closest<HTMLElement>(
      "[data-aovboost-cart-drawer], [role='dialog'], [aria-modal='true'], [data-cart-drawer]",
    );
    if (!drawer) return;
    const native = Array.from(
      drawer.querySelectorAll<HTMLElement>(
        "button:not(:disabled), select:not(:disabled), input:not([type='hidden']):not(:disabled), a[href], [tabindex='0']",
      ),
    ).filter((element) => isElementVisible(element));
    const index = native.indexOf(this.container);
    if (index < 0) return;
    const next =
      native[
        (index + (event.shiftKey ? native.length - 1 : 1)) % native.length
      ];
    if (next && next !== this.container) {
      event.preventDefault();
      event.stopPropagation();
      next.focus();
    }
  }

  destroy(): void {
    const hadFocus = document.activeElement === this.container;
    const drawer = this.container.closest<HTMLElement>(
      "[data-aovboost-cart-drawer], [role='dialog'], [aria-modal='true'], [data-cart-drawer]",
    );
    const returnTo =
      this.returnTo &&
      this.returnTo !== this.container &&
      this.returnTo.isConnected &&
      (!drawer || drawer.contains(this.returnTo))
        ? this.returnTo
        : drawer?.querySelector<HTMLElement>(
            ".drawer__close, [data-cart-close], button",
          );
    this.keyboard.abort();
    super.destroy();
    if (hadFocus && returnTo && isElementVisible(returnTo)) returnTo.focus();
  }

  private dismiss() {
    this.trackDismiss();
    if (this.payload.presentation === "inline") {
      this.destroy();
      return;
    }
    this.container.animate(
      [{ transform: "translateX(0)" }, { transform: "translateX(100%)" }],
      { duration: 180, easing: "ease-in", fill: "forwards" },
    );
    window.setTimeout(() => this.destroy(), 190);
  }
  dismissFromKeyboard() {
    this.dismiss();
  }
}
