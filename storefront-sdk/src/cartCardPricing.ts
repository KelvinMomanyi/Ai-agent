import { cartUrl } from "./shopifyCart";
import type { OfferDecision } from "./widgets/widgetManager";
import { getProducts } from "./widgets/BaseWidget";

/** Shopify's active storefront market owns the displayed variant price and sale status. */
export async function hydrateCartCardPrices(
  decision: OfferDecision,
): Promise<OfferDecision> {
  const products = getProducts(decision.payload || {}).slice(0, 4);
  const cards = await Promise.all(
    products.map(async (product) => {
      if (!product.handle) return null;
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 1500);
      try {
        const root = cartUrl("read").replace(/cart\.js$/, "");
        const response = await fetch(
          `${root}products/${encodeURIComponent(product.handle)}.js`,
          {
            headers: { Accept: "application/json" },
            cache: "no-store",
            signal: controller.signal,
          },
        );
        if (!response.ok) return null;
        const live = await response.json();
        if (
          `gid://shopify/Product/${live.id}` !== product.id ||
          !Array.isArray(live.variants)
        )
          return null;
        const variants = product.variants.flatMap((variant) => {
          const match = live.variants.find(
            (item: Record<string, unknown>) =>
              `gid://shopify/ProductVariant/${item.id}` === variant.id,
          );
          if (
            !match ||
            match.available !== true ||
            typeof match.price !== "number" ||
            !Number.isFinite(match.price) ||
            match.price < 0
          )
            return [];
          return [
            {
              id: variant.id,
              title: variant.title,
              sku: variant.sku,
              selectedOptions: variant.selectedOptions,
              availableForSale: true,
              price: (match.price / 100).toFixed(2),
              compareAtPrice:
                typeof match.compare_at_price === "number"
                  ? (match.compare_at_price / 100).toFixed(2)
                  : null,
            },
          ];
        });
        if (!variants.length) return null;
        const selected = variants.find(({ id }) => id === product.variantId);
        return {
          productId: product.id,
          reason: product.reason,
          product: {
            id: product.id,
            handle: product.handle,
            title: product.title,
            imageUrl: product.imageUrl,
            price: (selected || variants[0]).price,
            variants,
            variantId:
              selected?.id || (variants.length === 1 ? variants[0].id : ""),
            defaultVariantId:
              selected?.id || (variants.length === 1 ? variants[0].id : ""),
          },
        };
      } catch {
        return null;
      } finally {
        window.clearTimeout(timer);
      }
    }),
  );
  const eligible = cards.filter(Boolean);
  return {
    ...decision,
    widgetType: eligible.length ? "upsell_drawer" : null,
    payload: { ...decision.payload, products: eligible },
  };
}
