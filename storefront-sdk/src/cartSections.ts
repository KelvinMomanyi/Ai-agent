/** Refresh server-rendered cart sections without replacing a theme's header. */
export type CartSection = { id: string; target: HTMLElement; full: boolean };
const COUNTERS = "[data-cart-count], .cart-count-bubble";

export function discoverCartSections(): CartSection[] {
  const result = new Map<string, CartSection>();
  const add = (element: Element, full: boolean) => {
    const target = element.closest<HTMLElement>('[id^="shopify-section-"]');
    const id = target?.id.slice("shopify-section-".length);
    if (!target || !id || !/^[\w-]+$/.test(id)) return;
    const previous = result.get(id);
    result.set(id, { id, target, full: previous?.full || full });
  };
  // Dynamic cart templates have IDs such as template--123__cart, not Dawn's
  // main-cart-items. A header must retain its own navigation and modal handlers.
  for (const form of document.querySelectorAll<HTMLFormElement>(
    "form[action]",
  )) {
    const url = new URL(form.action, location.href);
    if (url.origin !== location.origin || !/\/cart\/?$/.test(url.pathname))
      continue;
    const section = form.closest('[id^="shopify-section-"]');
    if (
      section &&
      !section.querySelector("header, nav") &&
      !section.closest("header, nav")
    )
      add(form, true);
  }
  for (const element of document.querySelectorAll(COUNTERS))
    add(element, false);
  return [...result.values()].slice(0, 5);
}

export function refreshCartSections(
  sections: CartSection[],
  rendered: Record<string, unknown>,
) {
  for (const { id, target, full } of sections) {
    const html = rendered[id];
    if (!target.isConnected || typeof html !== "string") continue;
    const replacement = new DOMParser()
      .parseFromString(html, "text/html")
      .getElementById(target.id);
    if (!replacement) continue;
    if (!full) {
      const incoming = [...replacement.querySelectorAll<HTMLElement>(COUNTERS)];
      [...target.querySelectorAll<HTMLElement>(COUNTERS)].forEach(
        (counter, index) => {
          const next = incoming[index];
          if (!next) return;
          counter.innerHTML = next.innerHTML;
          counter.className = next.className;
          if (next.hasAttribute("aria-hidden"))
            counter.setAttribute(
              "aria-hidden",
              next.getAttribute("aria-hidden")!,
            );
          else counter.removeAttribute("aria-hidden");
        },
      );
      continue;
    }
    // Keep app-owned shadow roots, listeners and acceptance state. The native
    // theme observer sees the same connected host at the end of this task.
    const selector = "[data-aovboost-mount], [data-aovboost-widget]";
    const preserved = [
      ...target.querySelectorAll<HTMLElement>(selector),
    ].filter((node) => !node.parentElement?.closest(selector));
    const inputs = [
      ...target.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        'input[name="note"], textarea[name="note"], input[name^="attributes["], textarea[name^="attributes["]',
      ),
    ].map((input) => ({ name: input.name, value: input.value }));
    const hadFocus = target.contains(document.activeElement);
    let active = document.activeElement as HTMLElement | null;
    while (active?.shadowRoot?.activeElement)
      active = active.shadowRoot.activeElement as HTMLElement;
    const focusId = hadFocus ? active?.id : "";
    preserved.forEach((node) => node.remove());
    target.innerHTML = replacement.innerHTML;
    for (const input of target.querySelectorAll<
      HTMLInputElement | HTMLTextAreaElement
    >("input, textarea")) {
      const index = inputs.findIndex((value) => value.name === input.name);
      if (index >= 0) input.value = inputs.splice(index, 1)[0].value;
    }
    // App cards remain outside native forms and tables, where Enter or a
    // surrounding form submit could otherwise repeat a purchase action.
    preserved.forEach((node) => target.appendChild(node));
    // Velour binds new quantity inputs here. Inserted script tags are not
    // executed, and existing document-level theme listeners are retained.
    target.dispatchEvent(
      new CustomEvent("shopify:section:load", {
        bubbles: true,
        detail: { sectionId: id },
      }),
    );
    if (hadFocus && active?.isConnected) active.focus();
    else if (focusId) document.getElementById(focusId)?.focus();
  }
}
