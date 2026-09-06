/** Shopify Ajax cart mutations, using locale-aware URLs and bundled sections.
 * https://shopify.dev/docs/api/ajax/reference/cart#bundled-section-rendering
 */
export function cartUrl(resource: "add" | "change" | "read") {
  const shopify = (
    window as Window & { Shopify?: { routes?: { root?: string } } }
  ).Shopify;
  const candidate = shopify?.routes?.root || "/";
  const root = /^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(candidate) ? candidate : "/";
  return `${root}cart${resource === "read" ? "" : `/${resource}`}.js`;
}

export async function mutateShopifyCart(
  resource: "add" | "change",
  payload: Record<string, unknown>,
) {
  const sections = [
    "cart-icon-bubble",
    "cart-drawer",
    "main-cart-items",
    "main-cart-footer",
  ].filter(
    (id) =>
      document.getElementById(id) ||
      document.getElementById(`shopify-section-${id}`),
  );
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(cartUrl(resource), {
      method: "POST",
      credentials: "same-origin",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload,
        ...(sections.length
          ? { sections, sections_url: window.location.pathname }
          : {}),
      }),
    });
    if (!response.ok) return null;
    const result = await response.json();
    // A missing/broken theme section must never turn a confirmed cart write into a retry.
    try {
      for (const id of sections) {
        const html = result.sections?.[id];
        if (typeof html !== "string") continue;
        const parsed = new DOMParser().parseFromString(html, "text/html");
        const target =
          document.getElementById(id) ||
          document.getElementById(`shopify-section-${id}`);
        const replacement = target && parsed.getElementById(target.id);
        if (target && replacement) target.innerHTML = replacement.innerHTML;
      }
      document.dispatchEvent(
        new CustomEvent("aovboost:cart-updated", { detail: result }),
      );
    } catch {
      /* Theme adapters are best effort; Shopify already accepted the mutation. */
    }
    return result;
  } finally {
    window.clearTimeout(timeout);
  }
}
