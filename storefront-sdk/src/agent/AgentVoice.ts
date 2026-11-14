import type { AgentContext } from "./types";
import type { FactView } from "./OfferFacts";

export type AgentIdentity = { name: string; avatar: string };
export type ChatHandoff = {
  trigger: string;
  productId?: string;
  variantId?: string;
  cartSnapshot: {
    status: "loaded" | "unavailable";
    items: Array<{ productId: string; variantId: string; quantity: number }>;
    subtotal: number;
    currency: string;
  };
  suggestedOpeningLine: string;
};
const clean = (value: unknown, max = 160) =>
  typeof value === "string"
    ? value
        // Strip control characters from public catalog/config copy.
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max)
    : "";
const id = (value: unknown, kind: string) =>
  new RegExp(`^gid://shopify/${kind}/[0-9]+$`).test(String(value || ""))
    ? String(value)
    : undefined;
export class AgentVoice {
  readonly identity: AgentIdentity;
  readonly ui = {
    open: "Open assistant",
    close: "Close assistant",
    send: "Send",
    input: "Chat message",
    ask: "Ask the assistant",
    dismissNotification: "Dismiss notification",
    typing: "Assistant is typing",
    placeholder: "Ask about a product or your cart",
    loading: "Opening assistant…",
    unavailable:
      "The assistant is temporarily unavailable. Your cart still works.",
    loadError: "The assistant could not load. Reload the page to try again.",
    reload: "Reload page",
    retry: "Try again",
    retryMessage: "Retry message",
    undo: "Undo",
    addToCart: "Add to cart",
    undone: "Cart action undone.",
    changed: "Your cart changed. Review it before trying to undo.",
    cartUpdated: "Your cart was updated.",
    cartError:
      "The cart change could not be confirmed. Please review your cart.",
    partialError: "The reply was interrupted. Please try again.",
    actionError:
      "The reply was interrupted after a cart action. Check your cart before asking again.",
    reviewCart: "Review cart",
    dismiss: "Keep browsing",
    compare: "Help me compare options",
    cartQuestion: "What's in my cart?",
    genericQuestion: "Help me choose a product",
  };
  constructor(shopName?: unknown) {
    const shop = clean(shopName, 60);
    this.identity = Object.freeze({
      name: shop ? `${shop} assistant` : "Shopping assistant",
      avatar: shop ? Array.from(shop)[0].toUpperCase() : "A",
    });
  }
  greeting() {
    return "Hello. I can help with products and your cart.";
  }
  fact(
    view: FactView,
    locale?: string,
  ): { headline: string; body: string; detail: string } {
    const date = (value: number) =>
      `${new Date(value)
        .toISOString()
        .replace("T", " ")
        .replace(/\.000Z$/, " UTC")}`;
    if (view.type === "countdown_banner")
      return {
        headline: view.headline || "Campaign information",
        body: view.body || `Campaign ends at ${date(view.endsAt)}.`,
        detail: "",
      };
    if (view.type === "inline_alert")
      return {
        headline: view.headline || "Store update",
        body: view.body,
        detail: "",
      };
    if (view.type === "social_proof") {
      let count = String(view.count);
      try {
        count = new Intl.NumberFormat(locale).format(view.count);
      } catch {
        /* Keep the exact integer. */
      }
      return {
        headline: "Recorded orders",
        body: `${count} verified orders included ${view.title || "this product"}.`,
        detail: `Between ${date(view.startsAt)} and ${date(view.endsAt)}.`,
      };
    }
    let amount = "";
    try {
      amount = new Intl.NumberFormat(locale, {
        style: "currency",
        currency: view.currency,
      }).format(view.remaining);
    } catch {
      amount = `${view.currency} ${view.remaining.toFixed(2)}`;
    }
    return {
      headline: "Cart target",
      body:
        view.remaining > 0
          ? `Add ${amount} to reach the cart target for ${view.description}.`
          : `Cart target reached for ${view.description}.`,
      detail: view.code ? `Use code ${view.code} at checkout.` : "",
    };
  }
  handoff(ctx: AgentContext, trigger: string): ChatHandoff {
    const title = clean(ctx.page.productTitle);
    const productId = id(ctx.page.productId, "Product");
    const variantId = id(ctx.page.variantId, "ProductVariant");
    return {
      trigger: /^[a-z_]{1,50}$/.test(trigger) ? trigger : "launcher",
      ...(productId ? { productId } : {}),
      ...(variantId ? { variantId } : {}),
      cartSnapshot: {
        status: ctx.cart.known ? "loaded" : "unavailable",
        items: ctx.cart.items.map((item) => ({ ...item })),
        subtotal: ctx.cart.subtotal,
        currency: ctx.cart.currency,
      },
      suggestedOpeningLine:
        title && productId
          ? `What would you like to know about ${title}?`
          : "What would you like help with?",
    };
  }
  toast(ctx: AgentContext) {
    const title = clean(ctx.page.productTitle);
    return {
      headline: title
        ? `Need a hand choosing ${title}?`
        : "Need a hand choosing?",
      subheadline:
        "I can help you compare options and answer product questions.",
      ctaText: this.ui.ask,
    };
  }
  exit(ctx: AgentContext) {
    return ctx.cart.items.length
      ? {
          headline: "Your cart is here when you're ready",
          offerLine:
            "Review your cart or ask about the products you've chosen.",
          ctaText: this.ui.reviewCart,
          dismissText: this.ui.dismiss,
        }
      : {
          headline: "Need a hand before you go?",
          offerLine: "I can help you compare products and choose an option.",
          ctaText: this.ui.ask,
          dismissText: this.ui.dismiss,
        };
  }
  quickReplies(handoff: ChatHandoff) {
    return [
      handoff.productId
        ? "Tell me about this product"
        : this.ui.genericQuestion,
      this.ui.compare,
      this.ui.cartQuestion,
    ];
  }
}
