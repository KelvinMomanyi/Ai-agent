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
          `${Number(product.orderCount)} people bought this with ${product.title}`,
      );

    if (messages.length === 0) {
      messages.push("Frequently bought together");
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
          color: #064e3b;
          background: #ecfdf5;
        }
        .dot { width: 8px; height: 8px; border-radius: 999px; background: #10b981; }
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
