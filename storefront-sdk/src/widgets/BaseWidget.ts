export type WidgetPayload = {
  offerId?: string;
  copy?: Record<string, unknown>;
  [key: string]: unknown;
};

export abstract class BaseWidget {
  protected root: ShadowRoot;
  protected container: HTMLElement;

  constructor(protected payload: WidgetPayload) {
    this.container = document.createElement("div");
    this.container.setAttribute("data-aovboost-widget", this.getWidgetType());
    this.root = this.container.attachShadow({ mode: "open" });
    this.injectStyles();
  }

  abstract getWidgetType(): string;
  abstract render(): void;

  destroy(): void {
    this.container.remove();
  }

  mount(target = document.body): void {
    target.appendChild(this.container);
    this.render();
    this.trackImpression();
  }

  protected injectStyles(): void {
    const style = document.createElement("style");
    style.textContent = BASE_WIDGET_CSS;
    this.root.appendChild(style);
  }

  protected trackImpression(): void {
    this.track("widget_impression", {});
  }

  protected trackClick(action: string): void {
    this.track("widget_click", { action });
  }

  protected trackDismiss(): void {
    this.track("widget_dismiss", {});
    try {
      const key = "aovboost_dismissed_widgets";
      const dismissed = JSON.parse(localStorage.getItem(key) || "[]") as string[];
      localStorage.setItem(
        key,
        JSON.stringify(Array.from(new Set([...dismissed, this.getWidgetType()]))),
      );
    } catch {
      // Ignore storage failures.
    }
  }

  protected track(type: string, extra: Record<string, unknown>): void {
    const globalTrack = (window as any).AOVBoostSDK?.track;
    const payload = {
      type,
      widgetType: this.getWidgetType(),
      offerId: this.payload.offerId,
      ...extra,
    };

    if (typeof globalTrack === "function") {
      globalTrack(type, payload);
      return;
    }

    document.dispatchEvent(new CustomEvent("aovboost:track", { detail: payload }));
  }

  protected html(markup: string): void {
    const existing = this.root.querySelector("[data-aovboost-content]");
    if (existing) existing.remove();

    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-aovboost-content", "true");
    wrapper.innerHTML = markup;
    this.root.appendChild(wrapper);
  }
}

export function text(value: unknown, fallback = "") {
  return escapeHtml(typeof value === "string" && value.trim() ? value : fallback);
}

export function money(value: unknown, currency = "USD") {
  const amount = Number(value || 0);
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

export function getProducts(payload: WidgetPayload): any[] {
  const productSources = [
    payload.products,
    (payload.bundle as any)?.items,
    payload.items,
  ];
  const source = productSources.find((value) => Array.isArray(value));
  if (!Array.isArray(source)) return [];

  return source.map((item) => {
    const product = item.product || item.target || item;
    return {
      id: product.id || item.productId || item.targetId,
      variantId: product.variantId || item.variantId || item.id,
      title: product.title || item.title || "Recommended product",
      handle: product.handle || item.handle || "",
      imageUrl: product.imageUrl || product.image || item.imageUrl || item.image,
      price: product.price || item.price || "",
      quantity: item.quantity || 1,
      reason: item.reason || item.affinity?.reason || item.reasoning || "",
      orderCount: item.orderCount || item.affinity?.orderCount || 0,
    };
  });
}

export async function addVariantToCart(variantId: unknown, quantity = 1) {
  if (!variantId) return null;
  const numericId = String(variantId).split("/").pop();
  const response = await fetch("/cart/add.js", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: numericId, quantity }),
  });
  return response.ok ? response.json() : null;
}

export async function addManyToCart(items: Array<{ variantId: unknown; quantity: number }>) {
  const cartItems = items
    .filter((item) => item.variantId)
    .map((item) => ({
      id: String(item.variantId).split("/").pop(),
      quantity: item.quantity || 1,
    }));
  if (cartItems.length === 0) return null;

  const response = await fetch("/cart/add.js", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: cartItems }),
  });
  return response.ok ? response.json() : null;
}

function escapeHtml(value: unknown) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const BASE_WIDGET_CSS = `
:host {
  --aovboost-surface: #ffffff;
  --aovboost-ink: #111827;
  --aovboost-muted: #5b6472;
  --aovboost-line: rgba(17, 24, 39, 0.12);
  --aovboost-action: #111827;
  --aovboost-action-text: #ffffff;
  --aovboost-accent: #0f766e;
  color: var(--aovboost-ink);
  font-family: inherit;
}
* { box-sizing: border-box; letter-spacing: 0; }
button, input { font: inherit; }
.card, .drawer, .bar, .modal, .pill {
  background: var(--aovboost-surface);
  border: 1px solid var(--aovboost-line);
  box-shadow: 0 18px 45px rgba(17, 24, 39, 0.16);
}
.card { border-radius: 8px; padding: 16px; }
.title { margin: 0; font-size: 16px; line-height: 1.25; font-weight: 750; }
.body { margin: 6px 0 0; color: var(--aovboost-muted); font-size: 14px; line-height: 1.45; }
.row { display: flex; align-items: center; gap: 10px; }
.stack { display: grid; gap: 12px; }
.actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 14px; }
.primary, .secondary, .icon {
  border: 0;
  border-radius: 8px;
  cursor: pointer;
  min-height: 38px;
  padding: 9px 12px;
}
.primary { background: var(--aovboost-action); color: var(--aovboost-action-text); font-weight: 700; }
.secondary { background: #f3f4f6; color: var(--aovboost-ink); }
.icon { display: inline-grid; place-items: center; width: 30px; min-height: 30px; padding: 0; background: transparent; color: var(--aovboost-muted); }
.product-grid { display: grid; gap: 10px; }
.product-card { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 10px; align-items: center; padding: 8px; border: 1px solid var(--aovboost-line); border-radius: 8px; }
.product-card img, .tile img { width: 100%; aspect-ratio: 1; object-fit: contain; border-radius: 6px; background: #f8fafc; }
.product-name { margin: 0; font-size: 13px; font-weight: 700; line-height: 1.25; overflow-wrap: anywhere; }
.price { color: var(--aovboost-ink); font-size: 13px; font-weight: 700; }
.reason { color: var(--aovboost-muted); font-size: 12px; line-height: 1.35; }
`;
