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
  compareAtPrice?: string | null;
  availableForSale?: boolean;
  matchReasons?: string[];
  recommendationType?: "primary" | "value" | "premium" | "upsell" | null;
  rank?: number | null;
  variants?: Array<{
    id?: string;
    title?: string;
    price?: string;
    selectedOptions?: Array<{ name?: string; value?: string }>;
  }>;
  variantsTruncated?: boolean;
};

type CartAction = {
  type?: string;
  productId?: string;
  productTitle?: string;
  variantId?: string;
  quantity?: number;
};

type Message = {
  role: "user" | "assistant";
  content: string;
  productCards?: ProductCard[];
  checkoutCta?: boolean;
  restoredTextOnly?: boolean;
};

type LiveCartContext = {
  status: "loaded" | "unavailable";
  currency?: string;
  itemCount?: number;
  subtotalPrice?: number | null;
  totalPrice?: number | null;
  totalDiscount?: number | null;
  discounts?: Array<{ title: string; amount: number | null }>;
  capturedAt: number;
  items: Array<{
    lineId?: string;
    productId: string;
    variantId: string;
    quantity: number;
    title: string;
    variantTitle: string;
    handle: string;
    finalUnitPrice: number | null;
    originalUnitPrice: number | null;
    finalLinePrice: number | null;
    originalLinePrice: number | null;
  }>;
};

export class ChatWidget extends BaseWidget {
  private messages: Message[] = [];
  private expanded = false;
  private sending = false;
  private initialMessageTracked = false;

  constructor(payload: WidgetPayload) {
    super(payload);
    this.root.addEventListener("click", this.handleProductCardClick);
    document.addEventListener("aovboost:open-chat", this.handleOpenChat);
    const copy = payload.copy as Record<string, unknown> | undefined;
    const greeting = String(
      copy?.greeting ||
        payload.greeting ||
        "Welcome! I’m here to help you discover the best products in our store.",
    ).trim();
    const assistantIntro = String(
      copy?.assistantIntro || payload.assistantIntro || "",
    ).trim();
    const restored = this.restoreConversation();
    if (restored.length > 0) {
      this.messages = restored;
    } else {
      this.messages.push({
        role: "assistant",
        content: greeting,
      });
      if (assistantIntro && assistantIntro !== greeting) {
        this.messages.push({ role: "assistant", content: assistantIntro });
      }
      this.persistConversation();
    }
  }

  getWidgetType(): string {
    return "chat";
  }

  destroy(): void {
    this.root.removeEventListener("click", this.handleProductCardClick);
    document.removeEventListener("aovboost:open-chat", this.handleOpenChat);
    super.destroy();
  }

  render(): void {
    const copy = (this.payload.copy || {}) as Record<string, unknown>;
    const configuredShopName = String(
      (window as any).AOVBoost?.shopName || "",
    ).trim();
    const assistantLabel = configuredShopName
      ? `${configuredShopName} sales assistant`
      : "Personal shopping assistant";

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
        .compare-price { color: var(--aovboost-muted); font-size: 11px; text-decoration: line-through; }
        .recommendation-label { color: var(--aovboost-action); font-size: 10px; font-weight: 800; letter-spacing: .02em; text-transform: uppercase; }
        .availability { color: #166534; font-size: 10px; font-weight: 700; }
        .availability.unavailable { color: #b91c1c; }
        .match-reasons { display: grid; gap: 2px; margin: 2px 0; padding: 0; list-style: none; color: var(--aovboost-muted); font-size: 11px; }
        .match-reasons li::before { content: "\\2713"; color: #15803d; margin-right: 4px; }
        .variant-groups { display: grid; gap: 6px; margin: 4px 0; }
        .variant-group { display: grid; gap: 4px; }
        .variant-label { color: var(--aovboost-muted); font-size: 11px; font-weight: 700; }
        .variant-chips { display: flex; flex-wrap: wrap; gap: 4px; }
        .variant-chip {
          border: 1px solid var(--aovboost-line) !important;
          background: #fff !important;
          color: var(--aovboost-ink) !important;
          min-height: 26px !important;
          padding: 4px 7px !important;
        }
        .variant-chip[aria-pressed="true"] {
          border-color: var(--aovboost-action) !important;
          box-shadow: 0 0 0 1px var(--aovboost-action);
        }
        .variant-note { color: var(--aovboost-muted); font-size: 10px; }
        .cart-confirmation { color: #166534; font-size: 11px; font-weight: 700; }
        .cart-confirmation.error { color: #b91c1c; }
        .checkout-link { display: inline-flex; justify-content: center; margin-top: 8px; border-radius: 7px; background: var(--aovboost-action); color: var(--aovboost-action-text); font-size: 12px; font-weight: 750; padding: 8px 10px; text-decoration: none; }
      </style>
      <aside class="wrap card" aria-label="${text(assistantLabel)}">
        <div class="head">
          <h3 class="title">${text(assistantLabel)}</h3>
          <button type="button" class="icon" data-close aria-label="Close">×</button>
        </div>
        ${
          this.expanded
            ? this.renderChatUi()
            : `<p class="body">${text(copy.greeting || this.messages[0].content)}</p>
              <div class="actions">
                <button type="button" class="primary" data-expand>${text(copy.ctaAccept || "Explore with me")}</button>
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
      this.track("chat_opened", { source: "proactive_bubble" });
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
    if (!this.initialMessageTracked) {
      this.initialMessageTracked = true;
      this.track("agent_message_shown", { kind: "welcome" });
    }
  }

  private renderChatUi() {
    return `
      <div class="messages" role="log" aria-live="polite" aria-relevant="additions text" data-messages>
        ${this.messages.map((message) => this.renderMessage(message)).join("")}
      </div>
      <div class="compose">
        <input type="text" placeholder="Ask about any product" aria-label="Chat message" autocomplete="off" data-input>
        <button type="button" class="primary" data-send>Send</button>
      </div>
    `;
  }

  private handleOpenChat = () => {
    if (!this.isMounted()) return;
    this.expanded = true;
    this.track("chat_opened", { source: "storefront_event" });
    this.render();
    window.setTimeout(() => {
      this.root.querySelector<HTMLInputElement>("[data-input]")?.focus();
    }, 0);
  };

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
          : message.restoredTextOnly
            ? ""
            : this.renderProductLinks(message.content)
      }
      ${message.checkoutCta ? `<a class="checkout-link" href="/checkout" data-checkout-cta>Ready to check out</a>` : ""}
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
    const productId = String(product.productId || "");
    const title = String(
      product.title || handle.replace(/-/g, " ") || "Recommended product",
    );
    const href = handle ? `/products/${text(handle)}` : "";
    const variants = normalizeProductCardVariants(product);
    const selectedVariant = variants.find(
      (variant) => variant.id === product.variantId,
    );
    const optionGroups = getProductCardOptionGroups(variants);
    const needsOptionSelection = optionGroups.length > 0 && variants.length > 1;
    const selectedVariantId =
      selectedVariant?.id ||
      (!needsOptionSelection
        ? String(product.variantId || variants[0]?.id || "")
        : "");
    return `
      <article class="inline-product" data-product-card data-product-id="${text(productId)}" data-handle="${text(handle)}" data-recommendation-type="${text(product.recommendationType || "")}">
        ${
          product.imageUrl
            ? `<img data-product-image src="${text(product.imageUrl)}" alt="${text(title)}" loading="lazy">`
            : `<span class="image-placeholder" aria-hidden="true"></span>`
        }
        <span class="product-copy">
          ${product.recommendationType ? `<span class="recommendation-label">${text(recommendationLabel(product.recommendationType))}</span>` : ""}
          <span class="product-name">${text(title)}</span>
          ${product.price ? `<span class="price" data-product-price>${text(selectedVariant?.price || product.price)}</span>` : ""}
          ${product.compareAtPrice ? `<span class="compare-price">${text(product.compareAtPrice)}</span>` : ""}
          <span class="availability${product.availableForSale === false ? " unavailable" : ""}">${product.availableForSale === false ? "Currently unavailable" : "Available"}</span>
          ${
            product.matchReasons?.length
              ? `<ul class="match-reasons">${product.matchReasons
                  .slice(0, 4)
                  .map((reason) => `<li>${text(reason)}</li>`)
                  .join("")}</ul>`
              : ""
          }
          ${this.renderVariantGroups(optionGroups, selectedVariant)}
          ${product.variantsTruncated ? `<span class="variant-note">More options are available on the product page.</span>` : ""}
          <span class="product-actions">
            ${href ? `<a href="${href}" data-chat-view>View product</a>` : ""}
            ${
              variants.length > 0 || product.variantId
                ? `<button type="button" data-chat-add="${text(selectedVariantId)}" ${selectedVariantId ? "" : "disabled"}>${selectedVariantId ? "Add to cart" : "Choose options"}</button>`
                : ""
            }
          </span>
          <span data-cart-confirmation aria-live="polite"></span>
        </span>
      </article>
    `;
  }

  private renderVariantGroups(
    groups: Array<{ name: string; values: string[] }>,
    selectedVariant?: NormalizedProductCardVariant,
  ) {
    if (groups.length === 0) return "";
    const selectedOptions = new Map(
      selectedVariant?.options.map((option) => [option.name, option.value]) ||
        [],
    );
    return `
      <div class="variant-groups">
        ${groups
          .map(
            (group) => `
              <div class="variant-group" role="group" aria-label="${text(group.name)}">
                <span class="variant-label">${text(group.name)}</span>
                <span class="variant-chips">
                  ${group.values
                    .map((value) => {
                      const selected =
                        selectedOptions.get(group.name) === value;
                      return `<button type="button" class="variant-chip" data-chat-option data-option-name="${text(group.name)}" data-option-value="${text(value)}" aria-pressed="${selected ? "true" : "false"}">${text(value)}</button>`;
                    })
                    .join("")}
                </span>
              </div>`,
          )
          .join("")}
      </div>
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
    const viewLink = target?.closest?.(
      "[data-chat-view]",
    ) as HTMLAnchorElement | null;
    if (viewLink) {
      const card = viewLink.closest(
        "[data-product-card]",
      ) as HTMLElement | null;
      this.track("recommendation_clicked", {
        productId: card?.dataset.productId || "",
        recommendationType: card?.dataset.recommendationType || "primary",
      });
      return;
    }
    const checkoutLink = target?.closest?.(
      "[data-checkout-cta]",
    ) as HTMLAnchorElement | null;
    if (checkoutLink) {
      this.track("checkout_clicked", { source: "chat_widget" });
      return;
    }
    const optionButton = target?.closest?.(
      "[data-chat-option]",
    ) as HTMLButtonElement | null;
    if (optionButton) {
      event.preventDefault();
      this.selectProductOption(optionButton);
      const card = optionButton.closest(
        "[data-product-card]",
      ) as HTMLElement | null;
      this.track("variant_selected", {
        productId: card?.dataset.productId || "",
        optionName: optionButton.dataset.optionName || "",
        optionValue: optionButton.dataset.optionValue || "",
      });
      return;
    }
    const button = target?.closest?.(
      "[data-chat-add]",
    ) as HTMLButtonElement | null;
    if (!button) return;

    event.preventDefault();
    const variantId = button.dataset.chatAdd;
    if (!variantId || button.disabled) return;
    const card = button.closest("[data-product-card]") as HTMLElement | null;

    button.disabled = true;
    button.textContent = "Adding";
    try {
      const result = await addVariantToCart(variantId, 1, this.payload.offerId);
      if (!result) throw new Error("Cart add failed");
      button.textContent = "Added";
      this.showCartConfirmation(card, "Added to your cart.");
      const recommendationType = card?.dataset.recommendationType || "primary";
      this.track(
        recommendationType === "upsell"
          ? "upsell_added"
          : "recommendation_added",
        {
          productId: card?.dataset.productId || "",
          variantId,
          recommendationType,
        },
      );
      document.dispatchEvent(
        new CustomEvent("add-to-cart", {
          detail: {
            source: "chat_widget",
            productId: card?.dataset.productId || "",
            variantId,
          },
        }),
      );
    } catch {
      button.disabled = false;
      button.textContent = "Try again";
      this.showCartConfirmation(
        card,
        "Could not add this item. Try again.",
        true,
      );
    }
  };

  private selectProductOption(button: HTMLButtonElement) {
    const card = button.closest("[data-product-card]") as HTMLElement | null;
    const name = button.dataset.optionName || "";
    if (!card || !name) return;
    card.querySelectorAll("[data-chat-option]").forEach((candidate) => {
      if ((candidate as HTMLElement).dataset.optionName === name) {
        candidate.setAttribute("aria-pressed", "false");
      }
    });
    button.setAttribute("aria-pressed", "true");

    const product = this.findRenderedProductCard(card.dataset.productId || "");
    if (!product) return;
    const variants = normalizeProductCardVariants(product);
    const selectedOptions = new Map(
      Array.from(
        card.querySelectorAll("[data-chat-option][aria-pressed='true']"),
      ).map((candidate) => {
        const element = candidate as HTMLElement;
        return [
          element.dataset.optionName || "",
          element.dataset.optionValue || "",
        ];
      }),
    );
    const groups = getProductCardOptionGroups(variants);
    const variant =
      selectedOptions.size === groups.length
        ? variants.find((candidate) =>
            candidate.options.every(
              (option) => selectedOptions.get(option.name) === option.value,
            ),
          )
        : undefined;
    const addButton = card.querySelector(
      "[data-chat-add]",
    ) as HTMLButtonElement | null;
    if (addButton) {
      addButton.dataset.chatAdd = variant?.id || "";
      addButton.disabled = !variant;
      addButton.textContent = variant ? "Add to cart" : "Choose options";
    }
    const price = card.querySelector("[data-product-price]");
    if (price && variant?.price) price.textContent = variant.price;
    this.showCartConfirmation(card, "");
  }

  private findRenderedProductCard(productId: string) {
    return this.messages
      .flatMap((message) => message.productCards || [])
      .slice()
      .reverse()
      .find((product) => String(product.productId || "") === productId);
  }

  private showCartConfirmation(
    card: HTMLElement | null,
    message: string,
    isError = false,
  ) {
    const status = card?.querySelector(
      "[data-cart-confirmation]",
    ) as HTMLElement | null;
    if (!status) return;
    status.className = `cart-confirmation${isError ? " error" : ""}`;
    status.textContent = message;
  }

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
    this.persistConversation();
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

      for (;;) {
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
                this.trackShownRecommendations(parsed.productCards);
              }
              if (parsed.checkoutCta === true) {
                this.messages[assistantIndex].checkoutCta = true;
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
      this.persistConversation();
      this.track("agent_message_shown", {
        hasRecommendations: Boolean(
          this.messages[assistantIndex].productCards?.length,
        ),
      });
    } catch {
      this.removeTyping();
      this.messages[assistantIndex].content =
        this.messages[assistantIndex].content ||
        "I had trouble connecting. Please try again in a moment.";
      assistantEl.innerHTML = this.renderMessageContent(
        this.messages[assistantIndex],
      );
      this.persistConversation();
    } finally {
      this.sending = false;
      if (button) button.disabled = false;
    }
  }

  private async requestChat(value: string) {
    const config = (window as any).AOVBoost || {};
    const sdk = (window as any).AOVBoostSDK;
    const apiBase = normalizeProxyApiBase(config.apiBase).replace(/\/$/, "");
    const [auth, cartContext] = await Promise.all([
      typeof sdk?.getSignedAuthPayload === "function"
        ? sdk.getSignedAuthPayload()
        : Promise.resolve(null),
      readLiveCartContext(),
    ]);
    if (!auth) throw new Error("Missing signed storefront auth");
    const currency = getStorefrontCurrency();
    const cartCurrency = normalizeCurrencyCode(cartContext.currency);
    const cartUsesDifferentCurrency =
      Boolean(cartCurrency) && cartCurrency !== currency.code;

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
        currency: cartCurrency || currency.code,
        currencySource: cartCurrency ? "shopify_cart" : currency.source,
        moneyFormat: cartUsesDifferentCurrency
          ? undefined
          : currency.moneyFormat,
        moneyWithCurrencyFormat: cartUsesDifferentCurrency
          ? undefined
          : currency.moneyWithCurrencyFormat,
        locale: currency.locale,
        storefrontContext: getCurrentStorefrontContext(),
        cartContext,
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
        this.payload.offerId,
      );
      if (!result) throw new Error("Cart add failed");
      this.messages[assistantIndex].content =
        `Added ${action.productTitle || "that product"} to your cart.`;
      assistantEl.innerHTML = this.renderMessageContent(
        this.messages[assistantIndex],
      );
      this.hydrateProductCards(assistantEl);
      const addedButton = Array.from(
        assistantEl.querySelectorAll("[data-chat-add]"),
      ).find(
        (candidate) =>
          (candidate as HTMLElement).dataset.chatAdd === action.variantId,
      ) as HTMLButtonElement | undefined;
      if (addedButton) {
        addedButton.disabled = true;
        addedButton.textContent = "Added";
      }
      this.showCartConfirmation(
        addedButton?.closest("[data-product-card]") as HTMLElement | null,
        "Added to your cart.",
      );
      document.dispatchEvent(
        new CustomEvent("add-to-cart", {
          detail: {
            source: "chat_widget",
            productId: action.productId || "",
            variantId: action.variantId,
            quantity: Number(action.quantity || 1),
          },
        }),
      );
      this.track("recommendation_added", {
        productId: action.productId || "",
        variantId: action.variantId,
        source: "conversational_action",
      });
    } catch {
      this.messages[assistantIndex].content =
        `I couldn't add ${action.productTitle || "that product"} to your cart. Please use the product card button or open the product page.`;
      assistantEl.innerHTML = this.renderMessageContent(
        this.messages[assistantIndex],
      );
      this.hydrateProductCards(assistantEl);
      const failedCard = assistantEl.querySelector(
        "[data-product-card]",
      ) as HTMLElement | null;
      this.showCartConfirmation(
        failedCard,
        "Could not add this item. Choose an option or try again.",
        true,
      );
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
    this.track("chat_closed", { dismissed: true });
    const latestUpsell = this.messages
      .flatMap((message) => message.productCards || [])
      .slice()
      .reverse()
      .find((product) => product.recommendationType === "upsell");
    if (latestUpsell?.productId) {
      this.track("upsell_rejected", {
        productId: latestUpsell.productId,
        reason: "chat_dismissed",
      });
    }
    this.trackDismiss();
    this.container.animate(
      [{ transform: "translateY(0)" }, { transform: "translateY(120%)" }],
      { duration: 180, easing: "ease-in", fill: "forwards" },
    );
    window.setTimeout(() => this.destroy(), 190);
  }

  private trackShownRecommendations(products: ProductCard[]) {
    products.slice(0, 4).forEach((product) => {
      if (!product.productId) return;
      const type = product.recommendationType || "primary";
      this.track(type === "upsell" ? "upsell_shown" : "recommendation_shown", {
        productId: product.productId,
        variantId: product.variantId || "",
        recommendationType: type,
        rank: product.rank || 0,
      });
    });
  }

  private persistConversation() {
    try {
      window.sessionStorage.setItem(
        this.conversationStorageKey(),
        JSON.stringify(
          this.messages.slice(-20).map((message) => ({
            role: message.role,
            content: message.content,
          })),
        ),
      );
    } catch {
      // The server remains the source of truth when browser storage is blocked.
    }
  }

  private restoreConversation(): Message[] {
    try {
      const value = JSON.parse(
        window.sessionStorage.getItem(this.conversationStorageKey()) || "[]",
      );
      if (!Array.isArray(value)) return [];
      return value
        .filter(
          (message) =>
            message &&
            (message.role === "user" || message.role === "assistant") &&
            typeof message.content === "string",
        )
        .slice(-20)
        .map((message) => ({
          ...message,
          restoredTextOnly: true,
        })) as Message[];
    } catch {
      return [];
    }
  }

  private conversationStorageKey() {
    const sdk = (window as any).AOVBoostSDK;
    const shop = String((window as any).AOVBoost?.shop || "store");
    return `aovboost_chat:${shop}:${String(sdk?.sessionId || "session")}`;
  }
}

function recommendationLabel(type: ProductCard["recommendationType"]) {
  if (type === "value") return "Best value";
  if (type === "premium") return "Premium option";
  if (type === "upsell") return "Completes the setup";
  return "Best match";
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

function getCurrentStorefrontContext() {
  const win = window as any;
  const product = win.Shopify?.product || win.ShopifyAnalytics?.meta?.product;
  const rawProductId = String(product?.gid || product?.id || "");
  const productId = rawProductId
    ? rawProductId.startsWith("gid://shopify/Product/")
      ? rawProductId
      : `gid://shopify/Product/${rawProductId}`
    : "";
  const pageType = String(
    win.ShopifyAnalytics?.meta?.page?.pageType ||
      document.body?.dataset?.template ||
      (window.location.pathname === "/" ? "home" : "other"),
  );

  return {
    pageType: pageType.slice(0, 50),
    path: window.location.pathname.slice(0, 300),
    productId,
    productHandle: String(product?.handle || "").slice(0, 255),
  };
}

type NormalizedProductCardVariant = {
  id: string;
  title: string;
  price: string;
  options: Array<{ name: string; value: string }>;
};

function normalizeProductCardVariants(
  product: ProductCard,
): NormalizedProductCardVariant[] {
  const variants = Array.isArray(product.variants) ? product.variants : [];
  return variants
    .map((variant) => {
      const id = String(variant.id || "");
      const title = String(variant.title || "");
      const selectedOptions = Array.isArray(variant.selectedOptions)
        ? variant.selectedOptions
            .map((option) => ({
              name: String(option.name || ""),
              value: String(option.value || ""),
            }))
            .filter((option) => option.name && option.value)
        : [];
      const options =
        selectedOptions.length > 0
          ? selectedOptions
          : variants.length > 1 && title && !/^default(?: title)?$/i.test(title)
            ? [{ name: "Option", value: title }]
            : [];
      return {
        id,
        title,
        price: String(variant.price || ""),
        options,
      };
    })
    .filter((variant) => variant.id);
}

function getProductCardOptionGroups(variants: NormalizedProductCardVariant[]) {
  const groups = new Map<string, Set<string>>();
  for (const variant of variants) {
    for (const option of variant.options) {
      const values = groups.get(option.name) || new Set<string>();
      values.add(option.value);
      groups.set(option.name, values);
    }
  }
  return Array.from(groups.entries()).map(([name, values]) => ({
    name,
    values: Array.from(values),
  }));
}

async function readLiveCartContext(): Promise<LiveCartContext> {
  const capturedAt = Date.now();
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 1_500);
  try {
    const response = await fetch("/cart.js", {
      headers: { Accept: "application/json", "Cache-Control": "no-cache" },
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Cart read failed: ${response.status}`);
    const cart = await response.json();
    if (!cart || !Array.isArray(cart.items)) {
      throw new Error("Invalid cart response");
    }

    return {
      status: "loaded",
      currency: normalizeCurrencyCode(cart.currency),
      itemCount: normalizeCartInteger(cart.item_count),
      subtotalPrice: fromCartMinorUnits(
        cart.items_subtotal_price ?? cart.original_total_price,
      ),
      totalPrice: fromCartMinorUnits(cart.total_price),
      totalDiscount: fromCartMinorUnits(cart.total_discount),
      discounts: readCartDiscounts(cart),
      capturedAt,
      items: cart.items.slice(0, 100).flatMap((item: any) => {
        const quantity = normalizeCartInteger(item?.quantity);
        if (!quantity || quantity < 1) return [];
        return [
          {
            lineId: String(item.key || "").slice(0, 160),
            productId: toShopifyGid("Product", item.product_id),
            variantId: toShopifyGid(
              "ProductVariant",
              item.variant_id || item.id,
            ),
            quantity,
            title: String(item.product_title || item.title || "").slice(0, 200),
            variantTitle: String(item.variant_title || "").slice(0, 160),
            handle: String(item.handle || "").slice(0, 255),
            finalUnitPrice: fromCartMinorUnits(item.final_price),
            originalUnitPrice: fromCartMinorUnits(item.original_price),
            finalLinePrice: fromCartMinorUnits(item.final_line_price),
            originalLinePrice: fromCartMinorUnits(item.original_line_price),
          },
        ];
      }),
    };
  } catch {
    return { status: "unavailable", capturedAt, items: [] };
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function readCartDiscounts(cart: any) {
  const discounts = new Map<string, number>();
  const addDiscount = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const discount = value as Record<string, unknown>;
    const title = String(discount.title || discount.code || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160);
    if (!title) return;
    const minorAmount = Number(
      discount.total_allocated_amount || discount.amount || 0,
    );
    const amount =
      Number.isFinite(minorAmount) && minorAmount >= 0
        ? Math.round(minorAmount) / 100
        : 0;
    discounts.set(title, (discounts.get(title) || 0) + amount);
  };
  (Array.isArray(cart.cart_level_discount_applications)
    ? cart.cart_level_discount_applications
    : []
  ).forEach(addDiscount);
  for (const item of Array.isArray(cart.items) ? cart.items : []) {
    (Array.isArray(item.discounts) ? item.discounts : []).forEach(addDiscount);
  }
  return Array.from(discounts.entries()).map(([title, amount]) => ({
    title,
    amount,
  }));
}

function fromCartMinorUnits(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0
    ? Math.round(amount) / 100
    : null;
}

function normalizeCartInteger(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

function toShopifyGid(type: "Product" | "ProductVariant", value: unknown) {
  const id = String(value || "").trim();
  if (!id) return "";
  return id.startsWith(`gid://shopify/${type}/`)
    ? id
    : `gid://shopify/${type}/${id}`;
}

function normalizeCurrencyCode(value: unknown) {
  const code = String(value || "")
    .trim()
    .toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : "";
}
