export function isElementVisible(element: HTMLElement) {
  if (
    !element.isConnected ||
    element.closest(
      "[hidden], [inert], [aria-hidden='true'], details:not([open])",
    )
  )
    return false;
  for (
    let current: HTMLElement | null = element;
    current;
    current = current.parentElement
  ) {
    const style = getComputedStyle(current);
    if (
      style.display === "none" ||
      ["hidden", "collapse"].includes(style.visibility) ||
      style.opacity === "0" ||
      style.contentVisibility === "hidden"
    )
      return false;
    if (current.matches("cart-drawer") && !current.matches(".active, [open]"))
      return false;
  }
  return true;
}
