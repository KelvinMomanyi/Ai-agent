import type { GroundedCartContext } from "../models/chatResponse";

export type CartLineAction = {
  type: "remove_from_cart" | "update_cart_line";
  lineId: string;
  variantId: string;
  productTitle: string;
  expectedQuantity: number;
  quantity: number;
};

export function resolveCartLineIntent(
  message: string,
  cart: GroundedCartContext,
): { action?: CartLineAction; question?: string } | null {
  if (/\b(?:don't|do not|never|cancel|not now)\b/i.test(message)) return null;
  const remove = /\b(?:remove|delete|take out)\b/i.test(message);
  const update =
    /\b(?:change|set|update|make)\b.+\b(?:quantity(?: to)?|to)\s+(\d+)\b/i.exec(
      message,
    );
  if (!remove && !update) return null;
  if (cart.status !== "loaded")
    return {
      question:
        "I can't verify your cart right now. Please open your cart to make that change.",
    };
  const quantity = remove ? 0 : Number(update?.[1]);
  if (!remove && (!Number.isInteger(quantity) || quantity < 1 || quantity > 10))
    return { question: "What quantity would you like, between 1 and 10?" };
  const named = cart.items.filter(
    (item) =>
      item.title && message.toLowerCase().includes(item.title.toLowerCase()),
  );
  const candidates = named.length
    ? named
    : /\b(?:it|this|that|item)\b/i.test(message) && cart.items.length === 1
      ? cart.items
      : [];
  if (candidates.length !== 1 || !candidates[0].lineId)
    return {
      question: "Which cart item and variant would you like me to change?",
    };
  const item = candidates[0];
  return {
    action: {
      type: remove ? "remove_from_cart" : "update_cart_line",
      lineId: item.lineId!,
      variantId: item.variantId,
      productTitle: item.title,
      expectedQuantity: item.quantity,
      quantity,
    },
  };
}
