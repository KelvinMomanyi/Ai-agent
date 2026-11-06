/** Shopify Ajax cart mutations, using locale-aware URLs and bundled sections.
 * https://shopify.dev/docs/api/ajax/reference/cart#bundled-section-rendering
 */
export function cartUrl(resource: "add" | "change" | "read" | "update") {
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
  const nativeDrawer = (Array.from(
    document.querySelectorAll<HTMLElement>("cart-drawer"),
  ).find((drawer) =>
    drawer.querySelector("#CartDrawer .drawer__inner[role='dialog']"),
  ) || null) as
    | (HTMLElement & {
        renderContents?: (result: any) => void;
        getSectionsToRender?: () => Array<{ id: string }>;
        close?: () => void;
      })
    | null;
  const focusedInDrawer = Boolean(
    nativeDrawer?.contains(document.activeElement),
  );
  const drawerWasOpen = Boolean(nativeDrawer?.matches(".active, [open]"));
  const focusedCheckout = document.activeElement?.matches(
    "button[name='checkout']",
  );
  const sections = [
    "cart-icon-bubble",
    "cart-drawer",
    "main-cart-items",
    "main-cart-footer",
  ].filter(
    (id) =>
      document.getElementById(id) ||
      document.getElementById(`shopify-section-${id}`) ||
      (id === "cart-drawer" && nativeDrawer),
  );
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(cartUrl(resource), {
      method: "POST",
      credentials: "same-origin",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "X-AOVBoost-Recommendation": "1",
      },
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
      let nativeRendered = false;
      if (
        nativeDrawer?.renderContents &&
        (nativeDrawer.getSectionsToRender?.() || [{ id: "cart-drawer" }]).every(
          ({ id }) => typeof result.sections?.[id] === "string",
        )
      ) {
        try {
          nativeDrawer.renderContents(result);
          nativeRendered = true;
        } catch {
          /* Fall back to bounded section replacement below. */
        }
      }
      for (const id of sections) {
        if (id === "cart-drawer" && nativeRendered) continue;
        const html = result.sections?.[id];
        if (typeof html !== "string") continue;
        const parsed = new DOMParser().parseFromString(html, "text/html");
        const target =
          (id === "cart-drawer"
            ? nativeDrawer?.querySelector<HTMLElement>("#CartDrawer")
            : null) ||
          document.getElementById(id) ||
          document.getElementById(`shopify-section-${id}`);
        const replacement = target && parsed.getElementById(target.id);
        if (target && replacement) target.innerHTML = replacement.innerHTML;
        if (id === "cart-drawer" && nativeDrawer?.close)
          nativeDrawer
            .querySelector("#CartDrawer-Overlay")
            ?.addEventListener("click", () => nativeDrawer.close?.());
      }
      if (
        focusedInDrawer &&
        drawerWasOpen &&
        nativeDrawer?.isConnected &&
        (document.activeElement === document.body ||
          nativeDrawer.contains(document.activeElement))
      ) {
        const focusTarget =
          nativeDrawer.querySelector<HTMLElement>(
            focusedCheckout ? "button[name='checkout']" : ".drawer__close",
          ) || nativeDrawer.querySelector<HTMLElement>("button");
        const focusRoot =
          nativeDrawer.querySelector<HTMLElement>("#CartDrawer");
        const trapFocus = (
          window as Window & {
            trapFocus?: (root: HTMLElement, target: HTMLElement) => void;
          }
        ).trapFocus;
        if (focusTarget && focusRoot) {
          if (typeof trapFocus === "function")
            trapFocus(focusRoot, focusTarget);
          else focusTarget.focus();
        }
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
