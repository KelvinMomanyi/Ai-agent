export function activeControl(): HTMLElement | null {
  let active: Element | null = document.activeElement;
  while (active?.shadowRoot?.activeElement)
    active = active.shadowRoot.activeElement;
  return active instanceof HTMLElement ? active : null;
}
export function trapDialog(root: ShadowRoot, close: () => void): () => void {
  const keyboard = (event: Event) => {
    const key = event as KeyboardEvent;
    if (key.key === "Escape") {
      key.preventDefault();
      key.stopPropagation();
      close();
      return;
    }
    if (key.key !== "Tab") return;
    const controls = Array.from(
      root.querySelectorAll<HTMLElement>(
        "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex='0']",
      ),
    ).filter(
      (node) =>
        !node.closest("[hidden],[inert]") &&
        getComputedStyle(node).display !== "none",
    );
    const first = controls[0],
      last = controls.at(-1);
    if (
      first &&
      last &&
      ((!key.shiftKey && root.activeElement === last) ||
        (key.shiftKey && root.activeElement === first))
    ) {
      key.preventDefault();
      (key.shiftKey ? last : first).focus();
    }
  };
  root.addEventListener("keydown", keyboard);
  return () => root.removeEventListener("keydown", keyboard);
}
