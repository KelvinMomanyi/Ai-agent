import { isElementVisible } from "./visibility";

/** Only a recognized open Dawn drawer, or an explicit merchant-owned drawer slot. */
export function cartDrawerSlot(): HTMLElement | null {
  const explicit = Array.from(
    document.querySelectorAll<HTMLElement>(
      "[data-aovboost-cart-drawer] [data-aovboost-slot='upsell_drawer']",
    ),
  ).filter(
    (slot) =>
      isElementVisible(slot) &&
      !slot.closest(
        "form, button, a, table, ul, ol, quick-add-modal, [data-quick-add], [data-aovboost-widget]",
      ),
  );
  const dawn = Array.from(
    document.querySelectorAll<HTMLElement>(
      "cart-drawer.active #CartDrawer .drawer__inner[role='dialog'], cart-drawer[open] #CartDrawer .drawer__inner[role='dialog']",
    ),
  ).filter(
    (inner) =>
      isElementVisible(inner) &&
      !inner.closest("[data-aovboost-cart-drawer]") &&
      inner.querySelector("cart-drawer-items #CartDrawer-CartItems") &&
      inner.querySelector("button[name='checkout'], [data-cart-checkout]"),
  );
  if (explicit.length + dawn.length !== 1) return null;
  const root =
    explicit[0]?.closest<HTMLElement>("[data-aovboost-cart-drawer]") || dawn[0];
  if (
    !root ||
    root.closest(
      "quick-add-modal, quick-add-drawer, [data-quick-add], [data-aovboost-widget]",
    )
  )
    return null;
  // A separate active dialog, cookie banner or ambiguous cart remains protected.
  if (
    Array.from(
      document.querySelectorAll<HTMLElement>(
        "dialog[open], [role='dialog'][aria-modal='true'], [data-cookie-banner], #shopify-pc__banner",
      ),
    ).some(
      (element) =>
        isElementVisible(element) &&
        !element.contains(root) &&
        !root.contains(element),
    )
  )
    return null;
  if (explicit.length) return explicit[0];
  const inner = dawn[0];
  const items = inner.querySelector<HTMLElement>("cart-drawer-items");
  if (!items || items.parentElement !== inner || items.closest("form"))
    return null;
  const existing = inner.querySelector<HTMLElement>(
    ":scope > [data-aovboost-mount='cart-drawer-complements']",
  );
  if (existing) return existing;
  const slot = document.createElement("section");
  slot.dataset.aovboostMount = "cart-drawer-complements";
  slot.style.cssText =
    "display:block;min-width:0;max-width:100%;flex:0 0 auto;max-height:45dvh;overflow:auto;";
  items.insertAdjacentElement("afterend", slot);
  return slot;
}
