import {
  CART_OBSERVATION_MS,
  safeThemeSelector,
  type CartUi,
  type ThemeIdentity,
  type ThemeRuntimeConfig,
  type ThemeStrategy,
} from "../../../shared/themeCompatibility";
import { isElementVisible } from "../widgets/visibility";
import { getStorefrontPage } from "../widgets/placement";
export type CartObservation = { cartUi: CartUi; selector?: string };
const BLOCKERS =
  "dialog[open], [aria-modal='true'], [role='dialog'], cart-drawer.active, cart-drawer[open], [data-cart-drawer], [data-cookie-banner], #shopify-pc__banner";
const FORBIDDEN =
  "form,button,a,table,ul,ol,quick-add-modal,quick-add-drawer,[data-quick-add],[data-aovboost-widget]";
export function blockers() {
  return [...document.querySelectorAll<HTMLElement>(BLOCKERS)].filter(
    isElementVisible,
  );
}
function otherDialog(root: HTMLElement) {
  return blockers().some(
    (node) => node !== root && !node.contains(root) && !root.contains(node),
  );
}
function cartContents(root: HTMLElement) {
  return (
    Boolean(
      root.querySelector(
        "a[href*='/products/'],[data-cart-line],cart-drawer-items,.cart-item",
      ),
    ) &&
    Boolean(
      root.querySelector(
        "button[name='checkout'],a[href*='/checkout'],[data-cart-checkout]",
      ),
    )
  );
}
export function structuralDrawer(): HTMLElement | null {
  const candidates = new Set<HTMLElement>();
  for (const checkout of [
    ...document.querySelectorAll<HTMLElement>(
      "button[name='checkout'], a[href*='/checkout'], [data-cart-checkout]",
    ),
  ].slice(0, 20)) {
    for (
      let p = checkout.parentElement, depth = 0;
      p && depth < 5;
      p = p.parentElement, depth++
    )
      if (
        (p.matches("[role='dialog'],[aria-modal='true'],[data-cart-drawer]") ||
          p.tagName.includes("-")) &&
        cartContents(p) &&
        isElementVisible(p) &&
        !p.closest(FORBIDDEN)
      ) {
        candidates.add(p);
        break;
      }
  }
  const roots = [...candidates];
  return roots.length === 1 && !otherDialog(roots[0]) ? roots[0] : null;
}
export function selectorFor(root: HTMLElement): string | undefined {
  if (root.id && safeThemeSelector(`#${root.id}`)) return `#${root.id}`;
  const tag = root.tagName.toLowerCase();
  if (safeThemeSelector(tag) && document.querySelectorAll(tag).length === 1)
    return tag;
  for (const name of [...root.classList]) {
    const selector = `.${name}`;
    if (
      safeThemeSelector(selector) &&
      document.querySelectorAll(selector).length === 1
    )
      return selector;
  }
  return undefined;
}
export function classifyCartUi(
  initialPath = location.pathname,
): CartObservation {
  if (getStorefrontPage() === "cart")
    return {
      cartUi: initialPath === location.pathname ? "unknown" : "page_redirect",
    };
  const drawer = structuralDrawer();
  if (
    drawer &&
    !drawer.closest("cart-notification") &&
    !/notification/i.test(drawer.id)
  )
    return { cartUi: "drawer", selector: selectorFor(drawer) };
  const popup = blockers().find(
    (node) =>
      node.closest("cart-notification") ||
      /cart.*notification/i.test(node.id) ||
      (node.querySelector("a[href*='/cart']") &&
        !node.querySelector("[data-cart-line],cart-drawer-items,.cart-item")),
  );
  if (popup) return { cartUi: "popup_notification" };
  return { cartUi: blockers().length ? "unknown" : "no_feedback" };
}
export function observeCartUi(signal: AbortSignal): Promise<CartObservation> {
  const path = location.pathname;
  let observation = classifyCartUi(path);
  const counter = () =>
    document.querySelector("[data-cart-count],.cart-count-bubble")?.textContent;
  const before = counter();
  return new Promise((resolve) => {
    const inspect = () => {
      const next = classifyCartUi(path);
      if (next.cartUi !== "no_feedback") observation = next;
      else if (counter() !== before) observation = { cartUi: "unknown" };
    };
    const observer = new MutationObserver(inspect);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        "class",
        "open",
        "hidden",
        "aria-hidden",
        "aria-modal",
        "style",
      ],
    });
    const finish = () => {
      clearTimeout(timer);
      observer.disconnect();
      signal.removeEventListener("abort", finish);
      resolve(observation);
    };
    const timer = setTimeout(finish, CART_OBSERVATION_MS);
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) finish();
  });
}
export type AdapterContext = {
  identity: ThemeIdentity;
  config: ThemeRuntimeConfig;
};
export type PlacementAdapter = {
  id: ThemeStrategy;
  canHandle(ctx: AdapterContext): boolean;
  mount(host: HTMLElement, ctx: AdapterContext): void;
  unmount(): void;
  verify(): boolean;
};
export function createAdapters(): PlacementAdapter[] {
  let mounted: HTMLElement | null = null,
    slot: HTMLElement | null = null;
  const cleanup = () => {
    mounted?.remove();
    if (slot?.dataset.aovboostMount && !slot.childElementCount) slot.remove();
    slot = null;
    mounted = null;
  };
  const drawerRoot = (ctx: AdapterContext) => {
    const known = ctx.identity.schemaName?.toLowerCase() === "dawn";
    const dawn = known
      ? document.querySelector<HTMLElement>(
          "cart-drawer.active #CartDrawer .drawer__inner[role='dialog'],cart-drawer[open] #CartDrawer .drawer__inner[role='dialog']",
        )
      : null;
    if (
      dawn &&
      isElementVisible(dawn) &&
      dawn.querySelector("cart-drawer-items #CartDrawer-CartItems") &&
      cartContents(dawn) &&
      !otherDialog(dawn)
    )
      return dawn;
    const generic =
      ctx.config.genericDrawer && safeThemeSelector(ctx.config.drawerSelector)
        ? document.querySelector<HTMLElement>(ctx.config.drawerSelector)
        : null;
    return generic &&
      generic === structuralDrawer() &&
      !generic.closest(FORBIDDEN)
      ? generic
      : null;
  };
  const mountSlot = (
    root: HTMLElement,
    after: HTMLElement,
    host: HTMLElement,
  ) => {
    slot = document.createElement("section");
    slot.dataset.aovboostMount = "adaptive-cart";
    slot.style.cssText =
      "display:block;min-width:0;flex:0 0 auto;max-width:100%;";
    after.insertAdjacentElement("afterend", slot);
    slot.appendChild(host);
    mounted = host;
  };
  const pageAnchor = () => {
    if (getStorefrontPage() !== "cart" || blockers().length) return null;
    const main = document.querySelector<HTMLElement>("main,[role='main']");
    const explicit = main?.querySelector<HTMLElement>(
      "[data-aovboost-slot='upsell_drawer']",
    );
    if (explicit && !explicit.closest(FORBIDDEN)) return explicit;
    const items = main?.querySelector<HTMLElement>(
      "#main-cart-items,cart-items,[data-cart-items]",
    );
    if (
      !items ||
      items.closest(
        "form,table,ul,ol,header,footer,nav,dialog,[role='dialog'],quick-add-modal,[data-aovboost-widget]",
      )
    )
      return null;
    const layout = items.parentElement
      ? getComputedStyle(items.parentElement)
      : null;
    return layout &&
      (layout.display.includes("grid") ||
        (layout.display.includes("flex") &&
          !layout.flexDirection.startsWith("column")))
      ? null
      : items;
  };
  return [
    {
      id: "native_drawer",
      canHandle: (ctx) => Boolean(drawerRoot(ctx)),
      mount: (host, ctx) => {
        const root = drawerRoot(ctx);
        if (!root) throw new Error("drawer_unavailable");
        const items = root.querySelector<HTMLElement>(
          "cart-drawer-items,[data-cart-items],.cart-items",
        );
        let anchor = items;
        while (anchor?.parentElement && anchor.parentElement !== root)
          anchor = anchor.parentElement;
        if (!anchor || anchor.parentElement !== root || root.closest("form"))
          throw new Error("unsafe_drawer_boundary");
        mountSlot(root, anchor, host);
      },
      unmount: cleanup,
      verify: () =>
        Boolean(
          mounted?.isConnected &&
          slot &&
          isElementVisible(slot) &&
          slot.closest(
            "[role='dialog'],[aria-modal='true'],cart-drawer,[data-cart-drawer]",
          ),
        ),
    },
    {
      id: "cart_page",
      canHandle: () => Boolean(pageAnchor()),
      mount: (host) => {
        const anchor = pageAnchor();
        if (!anchor) throw new Error("cart_page_unavailable");
        if (anchor.dataset.aovboostSlot) {
          slot = anchor;
          slot.appendChild(host);
          mounted = host;
        } else mountSlot(anchor.parentElement!, anchor, host);
      },
      unmount: cleanup,
      verify: () =>
        Boolean(
          mounted?.isConnected &&
          getStorefrontPage() === "cart" &&
          !blockers().length,
        ),
    },
    {
      id: "floating_card",
      canHandle: () =>
        !blockers().length &&
        ["product", "collection", "cart", "home"].includes(getStorefrontPage()),
      mount: (host) => {
        if (blockers().length) throw new Error("competing_dialog");
        host.style.cssText +=
          ";position:fixed;inset-inline-end:max(16px,env(safe-area-inset-left),env(safe-area-inset-right));bottom:max(16px,env(safe-area-inset-bottom));width:380px;max-width:calc(100vw - 32px - env(safe-area-inset-left) - env(safe-area-inset-right));max-height:50dvh;overflow:auto;z-index:9990;";
        document.body.appendChild(host);
        mounted = host;
      },
      unmount: cleanup,
      verify: () => Boolean(mounted?.isConnected && !blockers().length),
    },
  ];
}
