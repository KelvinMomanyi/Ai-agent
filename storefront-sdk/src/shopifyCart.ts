import { discoverCartSections, refreshCartSections } from "./cartSections";
import { agentCoreEnabled, type AgentCartSource } from "./agent/flag";
import { newMutationId } from "./cartState";

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
  source: AgentCartSource = "aov_postadd",
  metadata?: { undo?: boolean },
) {
  const tagged = agentCoreEnabled();
  const mutationId = tagged ? newMutationId() : "";
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
  const dawnSections = [
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
  // Dawn's controller owns these surfaces. Other themes expose their actual
  // template/section-group IDs through Shopify's section wrappers.
  const dynamicSections = discoverCartSections().filter(
    ({ target }) =>
      !dawnSections.some((id) => {
        const element = document.getElementById(id);
        return element && target.contains(element);
      }) && !target.contains(nativeDrawer),
  );
  const sections = [
    ...new Set([
      ...dawnSections,
      ...dynamicSections.map((section) => section.id),
    ]),
  ].slice(0, 5);
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
        ...(tagged ? { "X-AOVBoost-Source": source } : {}),
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
      const dynamic = dynamicSections.filter((section) =>
        sections.includes(section.id),
      );
      const missing = dynamic.filter(
        (section) => typeof result.sections?.[section.id] !== "string",
      );
      if (missing.length) {
        // Section rendering can fail independently of a successful cart write.
        // Retry only the read, never the accepted POST.
        try {
          const url = new URL(window.location.pathname, window.location.origin);
          url.searchParams.set(
            "sections",
            missing.map((section) => section.id).join(","),
          );
          const refreshed = await fetch(url.href, {
            credentials: "same-origin",
            cache: "no-store",
            signal: controller.signal,
          });
          if (refreshed.ok)
            result.sections = {
              ...result.sections,
              ...(await refreshed.json()),
            };
        } catch {
          /* Shopify already accepted the cart mutation. */
        }
      }
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
        if (!dawnSections.includes(id)) continue;
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
      refreshCartSections(dynamic, result.sections || {});
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
    if (tagged) {
      // Publish only after section refresh (including its read-only retry).
      // The fetch observer skips these writes so one acceptance has one ID.
      const item = (
        Array.isArray(payload.items) ? payload.items[0] : payload
      ) as Record<string, unknown>;
      document.dispatchEvent(
        new CustomEvent("aovboost:cart-mutation", {
          detail: {
            type:
              resource === "add"
                ? "add_to_cart"
                : Number(payload.quantity) === 0
                  ? "remove_from_cart"
                  : "quantity_changed",
            variantId: String(item?.id || ""),
            quantity: Number(item?.quantity ?? 1),
            confirmed: true,
            mutationId,
            recommendationOrigin: true,
            source: "verified_fetch_response",
            cartSource: source,
            offerId:
              typeof (item?.properties as Record<string, unknown>)
                ?._aovboost_offer_id === "string"
                ? (item.properties as Record<string, unknown>)
                    ._aovboost_offer_id
                : undefined,
            ...(metadata?.undo ? { undo: true } : {}),
          },
        }),
      );
    }
    return result;
  } finally {
    window.clearTimeout(timeout);
  }
}
