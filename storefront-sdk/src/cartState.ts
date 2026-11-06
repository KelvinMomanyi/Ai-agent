import { cartUrl } from "./shopifyCart";

export type CartSnapshot = {
  cartToken: string;
  cartProductIds: string[];
  cartVariantIds: string[];
  cartItems: Array<{
    key: string;
    productId: string;
    variantId: string;
    quantity: number;
    title: string;
    handle: string;
  }>;
  cartItemCount: number;
  cartValue: number;
  currency: string;
};
let sequence = 0;
export const newMutationId = () =>
  globalThis.crypto?.randomUUID?.() || `${Date.now()}-${++sequence}`;
const gid = (kind: string, value: unknown) =>
  /^\d+$/.test(String(value || ""))
    ? `gid://shopify/${kind}/${value}`
    : String(value || "");

/** null means unavailable; an empty successful read is a real, authoritative cart. */
export async function readShopifyCart(): Promise<CartSnapshot | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(cartUrl("read"), {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const cart = await response.json();
    if (!Array.isArray(cart.items) || !Number.isFinite(Number(cart.item_count)))
      return null;
    const items = cart.items.slice(0, 100).map((item: Record<string, any>) => ({
      key: String(item.key || ""),
      productId: gid("Product", item.product_id || item.productId),
      variantId: gid(
        "ProductVariant",
        item.variant_id || item.variantId || item.id,
      ),
      quantity: Math.max(0, Number(item.quantity) || 0),
      title: String(item.product_title || item.title || ""),
      handle:
        String(item.handle || item.url || "")
          .split("/products/")
          .pop()
          ?.split(/[?#/]/)[0] || "",
    }));
    // Oversized carts cannot be represented safely by a truncated eligibility set.
    if (cart.items.length > 100) return null;
    return {
      cartToken: String(cart.token || ""),
      cartProductIds: [
        ...new Set(
          items
            .map((item: { productId: string }) => item.productId)
            .filter(Boolean),
        ),
      ] as string[],
      cartVariantIds: [
        ...new Set(
          items
            .map((item: { variantId: string }) => item.variantId)
            .filter(Boolean),
        ),
      ] as string[],
      cartItems: items,
      cartItemCount: Math.max(0, Number(cart.item_count)),
      cartValue: Number(cart.total_price || 0) / 100,
      currency: String(cart.currency || ""),
    };
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}
