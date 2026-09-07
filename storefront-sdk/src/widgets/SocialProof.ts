import { BaseWidget, getProducts, text } from "./BaseWidget";

export class SocialProof extends BaseWidget {
  private interval: number | undefined;

  getWidgetType(): string {
    return "social_proof";
  }

  render(): void {
    const products = getProducts(this.payload);
    const messages = products
      .filter((product) => Number(product.orderCount || 0) > 0)
      .map(
        (product) =>
          `${Number(product.orderCount)} verified orders include ${product.title}`,
      );

    if (messages.length === 0) {
      this.destroy();
      return;
    }

    this.html(`
      <style>
        .pill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          border-radius: 999px;
          box-shadow: none;
          padding: 8px 10px;
          font-size: 12px;
          font-weight: 700;
          color: var(--aovboost-ink);
          background: var(--aovboost-surface);
          margin: 10px 0;
          max-width: 100%;
        }
        .dot { width: 8px; height: 8px; flex-shrink: 0; border-radius: 999px; background: var(--aovboost-accent); }
      </style>
      <div class="pill" role="status"><span class="dot"></span><span data-message>${text(messages[0])}</span></div>
    `);

    let index = 0;
    this.interval = window.setInterval(() => {
      index = (index + 1) % messages.length;
      const node = this.root.querySelector("[data-message]");
      if (node) node.textContent = messages[index];
    }, 5000);
  }

  destroy(): void {
    if (this.interval) window.clearInterval(this.interval);
    super.destroy();
  }
}
