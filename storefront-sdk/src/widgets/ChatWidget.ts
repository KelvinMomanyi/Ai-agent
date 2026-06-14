import {
  BaseWidget,
  addVariantToCart,
  getStorefrontCurrency,
  text,
  type WidgetPayload,
} from "./BaseWidget";

type ProductCard = {
  productId?: string;
  title?: string;
  handle?: string;
  variantId?: string;
  imageUrl?: string | null;
  price?: string;
};

type CartAction = {
  type?: string;
  productTitle?: string;
  variantId?: string;
  quantity?: number;
};

type Message = {
  role: "user" | "assistant";
  content: string;
  productCards?: ProductCard[];
};

export class ChatWidget extends BaseWidget {
  private messages: Message[] = [];
  private expanded = false;
  private sending = false;

  constructor(payload: WidgetPayload) {
    super(payload);
    this.root.addEventListener("click", this.handleProductCardClick);
    const copy = payload.copy as Record<string, unknown> | undefined;
    this.messages.push({
      role: "assistant",
      content: String(
        copy?.greeting ||
          payload.greeting ||
          "Hi. Can I help you find the perfect product today?",
      ),
    });
  }

  getWidgetType(): string {
    return "chat";
  }

  destroy(): void {
    this.root.removeEventListener("click", this.handleProductCardClick);
    super.destroy();
  }

  render(): void {
    const copy = (this.payload.copy || {}) as Record<string, unknown>;

    this.html(`
      <style>
        .wrap {
          position: fixed;
          left: 18px;
          bottom: 18px;
          z-index: 9999;
          width: min(320px, calc(100vw - 36px));
          transform: translateY(100%);
          animation: in 200ms ease-out forwards;
        }
        @keyframes in { to { transform: translateY(0); } }
        @keyframes dots { 0%, 80%, 100% { opacity: .25; } 40% { opacity: 1; } }
        .head { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
        .messages { display: grid; gap: 8px; max-height: 330px; overflow: auto; padding: 12px 0; }
        .bubble { max-width: 88%; border-radius: 8px; padding: 9px 10px; font-size: 13px; line-height: 1.4; white-space: pre-wrap; }
        .assistant { background: #f3f4f6; justify-self: start; }
        .user { background: #111827; color: #fff; justify-self: end; }
        .compose { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; }
        input { min-width: 0; border: 1px solid var(--aovboost-line); border-radius: 8px; padding: 9px 10px; }
        .dots span { animation: dots 1.2s infinite; }
        .dots span:nth-child(2) { animation-delay: .15s; }
        .dots span:nth-child(3) { animation-delay: .3s; }
        .inline-products { display: grid; gap: 8px; margin-top: 8px; }
        .inline-product {
          display: grid;
          grid-template-columns: 48px minmax(0, 1fr);
          align-items: center;
          gap: 8px;
          margin-top: 6px;
          border: 1px solid var(--aovboost-line);
          border-radius: 8px;
          padding: 8px;
          color: inherit;
          text-decoration: none;
          background: #fff;
        }
        .inline-product a { color: var(--aovboost-ink); font-size: 12px; font-weight: 700; text-decoration: underline; text-underline-offset: 2px; }
        .inline-product button {
          width: fit-content;
          border: 0;
          border-radius: 6px;
          background: var(--aovboost-action);
          color: var(--aovboost-action-text);
          cursor: pointer;
          font-size: 12px;
          font-weight: 700;
          min-height: 28px;
          padding: 5px 8px;
        }
        .inline-product button:disabled { cursor: default; opacity: .65; }
        .inline-product img, .image-placeholder {
          width: 48px;
          height: 48px;
          border-radius: 6px;
          object-fit: cover;
          background: #f8fafc;
        }
        .product-copy { display: grid; gap: 3px; min-width: 0; }
        .product-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .price { color: var(--aovboost-muted); font-size: 12px; font-weight: 700; }
      </style>
      <aside class="wrap card" aria-label="AOVBoost Assistant">
        <div class="head">
          <h3 class="title">AOVBoost Assistant</h3>
          <button type="button" class="icon" data-close aria-label="Close">x</button>
        </div>
        ${
          this.expanded
            ? this.renderChatUi()
            : `<p class="body">${text(copy.greeting || this.messages[0].content)}</p>
              <div class="actions">
                <button type="button" class="primary" data-expand>${text(copy.ctaAccept || "Chat with AI")}</button>
                <button type="button" class="secondary" data-dismiss>${text(copy.ctaDecline || "Browse myself")}</button>
              </div>`
        }
      </aside>
    `);

    this.root
      .querySelector("[data-close]")
      ?.addEventListener("click", () => this.dismiss());
    this.root
      .querySelector("[data-dismiss]")
      ?.addEventListener("click", () => this.dismiss());
    this.root.querySelector("[data-expand]")?.addEventListener("click", () => {
      this.expanded = true;
      this.trackClick("open_chat");
      this.render();
    });
    this.root
      .querySelector("[data-send]")
      ?.addEventListener("click", () => this.sendMessage());
    this.root.querySelector("input")?.addEventListener("keydown", (event) => {
      if ((event as KeyboardEvent).key === "Enter") {
        event.preventDefault();
        this.sendMessage();
      }
    });
    this.hydrateProductCards(this.root);
    this.scrollToBottom();
  }

  private renderChatUi() {
    return `
      <div class="messages" data-messages>
        ${this.messages.map((message) => this.renderMessage(message)).join("")}
      </div>
      <div class="compose">
        <input type="text" placeholder="Ask me anything" data-input>
        <button type="button" class="primary" data-send>Send</button>
      </div>
    `;
  }

  private renderMessage(message: Message) {
    return `
      <div class="bubble ${message.role}">
        ${this.renderMessageContent(message)}
      </div>
    `;
  }

  private renderMessageContent(message: Message) {
    return `
      ${text(message.content)}
      ${
        message.productCards?.length
          ? this.renderProductCards(message.productCards)
          : this.renderProductLinks(message.content)
      }
    `;
  }

  private renderProductCards(products: ProductCard[]) {
    const cards = products
      .filter((product) => product.handle || product.title)
      .slice(0, 4);
    if (cards.length === 0) return "";

    return `
      <div class="inline-products">
        ${cards.map((product) => this.renderProductCard(product)).join("")}
      </div>
    `;
  }

  private renderProductCard(product: ProductCard) {
    const handle = String(product.handle || "");
    const title = String(
      product.title || handle.replace(/-/g, " ") || "Recommended product",
    );
    const href = handle ? `/products/${text(handle)}` : "";
    return `
      <article class="inline-product" data-product-card data-handle="${text(handle)}">
        ${
          product.imageUrl
            ? `<img data-product-image src="${text(product.imageUrl)}" alt="${text(title)}" loading="lazy">`
            : `<span class="image-placeholder" aria-hidden="true"></span>`
        }
        <span class="product-copy">
          <span class="product-name">${text(title)}</span>
          ${product.price ? `<span class="price">${text(product.price)}</span>` : ""}
          <span class="product-actions">
            ${href ? `<a href="${href}">View product</a>` : ""}
            ${
              product.variantId
                ? `<button type="button" data-chat-add="${text(product.variantId)}">Add to cart</button>`
                : ""
            }
          </span>
        </span>
      </article>
    `;
  }

  private renderProductLinks(content: string) {
    const match = content.match(/\/products\/([a-z0-9-]+)/i);
    if (!match) return "";
    const handle = match[1];
    return this.renderProductCards([
      { handle, title: handle.replace(/-/g, " ") },
    ]);
  }

  private appendMessage(message: Message): HTMLDivElement {
    const container = this.root.querySelector("[data-messages]");
    if (!container) throw new Error("Messages container not found");
    const el = document.createElement("div");
    el.className = `bubble ${message.role}`;
    el.innerHTML = this.renderMessageContent(message);
    container.appendChild(el);
    this.hydrateProductCards(el);
    this.scrollToBottom();
    return el;
  }

  private handleProductCardClick = async (event: Event) => {
    const target = event.target as Element | null;
    const button = target?.closest?.(
      "[data-chat-add]",
    ) as HTMLButtonElement | null;
    if (!button) return;

    event.preventDefault();
    const variantId = button.dataset.chatAdd;
    if (!variantId || button.disabled) return;

    button.disabled = true;
    button.textContent = "Adding";
    try {
      const result = await addVariantToCart(variantId);
      if (!result) throw new Error("Cart add failed");
      button.textContent = "Added";
      document.dispatchEvent(
        new CustomEvent("add-to-cart", {
          detail: { source: "chat_widget", variantId },
        }),
      );
    } catch {
      button.disabled = false;
      button.textContent = "Try again";
    }
  };

  private async hydrateProductCards(root: ParentNode) {
    const cards = Array.from(
      root.querySelectorAll("[data-product-card][data-handle]"),
    ) as HTMLElement[];
    await Promise.all(
      cards.map(async (card) => {
        if (card.dataset.hydrated === "true") return;
        const handle = card.dataset.handle;
        if (!handle) return;
        const hasImage = Boolean(card.querySelector("img[data-product-image]"));
        if (hasImage) {
          card.dataset.hydrated = "true";
          return;
        }

        try {
          const response = await fetch(`/products/${handle}.js`, {
            headers: { Accept: "application/json" },
          });
          if (!response.ok)
            throw new Error(`Product read failed: ${response.status}`);
          const product = await response.json();
          const imageUrl =
            product.featured_image ||
            product.images?.[0] ||
            product.media?.[0]?.src ||
            "";
          if (!imageUrl) return;

          const image = document.createElement("img");
          image.dataset.productImage = "true";
          image.src = imageUrl;
          image.alt = String(product.title || handle.replace(/-/g, " "));
          image.loading = "lazy";
          card.querySelector(".image-placeholder")?.replaceWith(image);
          card.dataset.hydrated = "true";
        } catch {
          card.dataset.hydrated = "true";
        }
      }),
    );
  }

  private async sendMessage() {
    if (this.sending) return;

    const input = this.root.querySelector(
      "[data-input]",
    ) as HTMLInputElement | null;
    const button = this.root.querySelector(
      "[data-send]",
    ) as HTMLButtonElement | null;
    const value = input?.value.trim();
    if (!value) return;

    this.sending = true;
    if (button) button.disabled = true;
    input!.value = "";
    this.messages.push({ role: "user", content: value });
    this.appendMessage({ role: "user", content: value });
    this.trackClick("send_message");
    if (isPriceSensitiveMessage(value)) {
      this.track("chat_intent", { intent: "price_sensitive" });
      document.dispatchEvent(
        new CustomEvent("aovboost:trigger", {
          detail: {
            type: "price_sensitive_chat",
            message: value,
          },
        }),
      );
    }

    const assistantIndex =
      this.messages.push({ role: "assistant", content: "" }) - 1;
    const assistantEl = this.appendMessage({ role: "assistant", content: "" });
    this.showTyping();

    try {
      let response = await this.requestChat(value);
      if (response.status === 401) {
        const recovered = await this.applyRecoverySession(response);
        if (!recovered) await (window as any).AOVBoostSDK?.refreshSession?.();
        response = await this.requestChat(value);
      }

      if (!response.ok) throw new Error(`Server returned ${response.status}`);
      if (!response.body) throw new Error("Missing stream body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let started = false;
      let cartActionHandled = false;

      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.delta) {
              if (!started) {
                this.removeTyping();
                started = true;
              }
              this.messages[assistantIndex].content += parsed.delta;
              if (Array.isArray(parsed.productCards)) {
                this.messages[assistantIndex].productCards =
                  parsed.productCards;
              }
              assistantEl.innerHTML = this.renderMessageContent(
                this.messages[assistantIndex],
              );
              this.hydrateProductCards(assistantEl);
              if (parsed.cartAction && !cartActionHandled) {
                cartActionHandled = true;
                await this.handleCartAction(
                  parsed.cartAction,
                  assistantIndex,
                  assistantEl,
                );
              }
              this.scrollToBottom();
            }
          } catch {
            // Skip malformed SSE chunks.
          }
        }
      }

      if (!started) {
        this.removeTyping();
        if (!this.messages[assistantIndex].content) {
          this.messages[assistantIndex].content =
            "I can help you compare products and find the right add-ons.";
          assistantEl.innerHTML = this.renderMessageContent(
            this.messages[assistantIndex],
          );
        }
      }
    } catch {
      this.removeTyping();
      this.messages[assistantIndex].content =
        this.messages[assistantIndex].content ||
        "I had trouble connecting. Please try again in a moment.";
      assistantEl.innerHTML = this.renderMessageContent(
        this.messages[assistantIndex],
      );
    } finally {
      this.sending = false;
      if (button) button.disabled = false;
    }
  }

  private async requestChat(value: string) {
    const config = (window as any).AOVBoost || {};
    const sdk = (window as any).AOVBoostSDK;
    const apiBase = normalizeProxyApiBase(config.apiBase).replace(/\/$/, "");
    const auth =
      typeof sdk?.getSignedAuthPayload === "function"
        ? await sdk.getSignedAuthPayload()
        : null;
    if (!auth) throw new Error("Missing signed storefront auth");
    const currency = getStorefrontCurrency();

    return fetch(`${apiBase}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AOVBoost-Shop": auth.shop || config.shop || "",
      },
      body: JSON.stringify({
        ...auth,
        message: value,
        messageHistory: this.messages.slice(0, -2),
        currency: currency.code,
        currencySource: currency.source,
        moneyFormat: currency.moneyFormat,
        moneyWithCurrencyFormat: currency.moneyWithCurrencyFormat,
        locale: currency.locale,
      }),
    });
  }

  private async handleCartAction(
    action: CartAction,
    assistantIndex: number,
    assistantEl: HTMLElement,
  ) {
    if (action.type !== "add_to_cart" || !action.variantId) return;

    try {
      const result = await addVariantToCart(
        action.variantId,
        Number(action.quantity || 1),
      );
      if (!result) throw new Error("Cart add failed");
      this.messages[assistantIndex].content =
        `Added **${action.productTitle || "that product"}** to your cart.`;
      assistantEl.innerHTML = this.renderMessageContent(
        this.messages[assistantIndex],
      );
      this.hydrateProductCards(assistantEl);
      document.dispatchEvent(
        new CustomEvent("add-to-cart", {
          detail: {
            source: "chat_widget",
            variantId: action.variantId,
            quantity: Number(action.quantity || 1),
          },
        }),
      );
    } catch {
      this.messages[assistantIndex].content =
        `I couldn't add **${action.productTitle || "that product"}** to your cart. Please use the product card button or open the product page.`;
      assistantEl.innerHTML = this.renderMessageContent(
        this.messages[assistantIndex],
      );
      this.hydrateProductCards(assistantEl);
    }
  }

  private async applyRecoverySession(response: Response) {
    try {
      const data = await response.clone().json();
      const session = data?.storefrontSession || data?.session;
      const applySession = (window as any).AOVBoostSDK?.applySession;
      return typeof applySession === "function"
        ? Boolean(applySession(session))
        : false;
    } catch {
      return false;
    }
  }

  private showTyping() {
    const container = this.root.querySelector("[data-messages]");
    if (!container) return;
    const el = document.createElement("div");
    el.className = "bubble assistant dots";
    el.dataset.typing = "true";
    el.innerHTML = "<span>.</span><span>.</span><span>.</span>";
    container.appendChild(el);
    this.scrollToBottom();
  }

  private removeTyping() {
    const el = this.root.querySelector("[data-typing]");
    if (el) el.remove();
  }

  private scrollToBottom() {
    const container = this.root.querySelector("[data-messages]");
    if (container) container.scrollTop = container.scrollHeight;
  }

  private dismiss() {
    this.trackDismiss();
    this.container.animate(
      [{ transform: "translateY(0)" }, { transform: "translateY(120%)" }],
      { duration: 180, easing: "ease-in", fill: "forwards" },
    );
    window.setTimeout(() => this.destroy(), 190);
  }
}

function isPriceSensitiveMessage(value: string) {
  return /\b(expensive|cheaper|cheap|discount|coupon|promo|deal|sale|price|afford|budget|cost)\b/i.test(
    value,
  );
}

function normalizeProxyApiBase(value?: string) {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (!candidate || candidate === "/api" || candidate.startsWith("/api/")) {
    return "/apps/aovboost";
  }
  if (candidate.includes("/apps/aovboost")) return candidate;
  if (candidate.startsWith("/apps/")) return candidate;
  return "/apps/aovboost";
}
