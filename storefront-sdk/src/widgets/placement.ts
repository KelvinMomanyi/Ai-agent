import { getProducts, type WidgetPayload } from "./BaseWidget";

export type StorefrontPage =
  | "home"
  | "collection"
  | "product"
  | "cart"
  | "checkout"
  | "thankyou"
  | "other";
export type WidgetPlacement = {
  target: HTMLElement | null;
  zone: "assistant" | "merchandising" | "notice" | "campaign" | "overlay";
  reason: string;
  inline?: boolean;
};

const EXCLUDED =
  "[hidden], [inert], [aria-hidden='true'], header, footer, nav, dialog, [role='dialog'], quick-add-modal, quick-add-drawer, [data-quick-add], .quick-add, .quick-add-modal, cart-drawer, [data-cart-drawer], .cart-drawer, [data-sticky-add-to-cart], .sticky-add-to-cart, product-recommendations, product-card, .product-card, .card-wrapper, [data-product-card], [data-aovboost-widget]";
const INFO =
  "product-info, .product__info-container, [data-product-info], [data-product-details], .product-single__meta";
const PRIMARY_PRODUCT = "[id^='MainProduct-'], [data-main-product]";
const INVALID_PARENT =
  "form, button, a, ul, ol, table, thead, tbody, tr, select, .product-grid, [data-product-grid]";

export function getStorefrontPage(): StorefrontPage {
  const path = window.location.pathname;
  const context = window as Window & {
    ShopifyAnalytics?: { meta?: { page?: { pageType?: string } } };
  };
  const template = String(
    document.body?.dataset.template ||
      context.ShopifyAnalytics?.meta?.page?.pageType ||
      "",
  ).toLowerCase();
  if (/\/(?:thank_you|thank-you|orders)(?:\/|$)/.test(path)) return "thankyou";
  if (/\/checkouts?(?:\/|$)/.test(path)) return "checkout";
  // Theme metadata can briefly retain the previous template during navigation.
  if (
    /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:account|accounts|pages|policies|blogs|search|password)(?:\/|$)/i.test(
      path,
    )
  )
    return "other";
  // A collection-scoped product URL is still a product detail page.
  if (/\/products\/[^/]+/.test(path)) return "product";
  if (/\/cart(?:\/|$)/.test(path)) return "cart";
  if (/\/collections(?:\/|$)/.test(path)) return "collection";
  if (path === "/" || /^\/[a-z]{2}(?:-[a-z]{2})?\/?$/i.test(path))
    return "home";
  if (template.startsWith("product")) return "product";
  if (template.startsWith("collection")) return "collection";
  if (template === "index" || template === "home") return "home";
  if (template === "cart") return "cart";
  return "other";
}

function isVisible(element: HTMLElement) {
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
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      style.opacity === "0" ||
      style.contentVisibility === "hidden"
    )
      return false;
  }
  return true;
}

export function isUsableAnchor(element: HTMLElement) {
  if (!isVisible(element) || element.closest(EXCLUDED)) return false;
  for (
    let current: HTMLElement | null = element;
    current;
    current = current.parentElement
  ) {
    if (getComputedStyle(current).position === "fixed") return false;
  }
  return true;
}

function firstSafe(root: ParentNode, selectors: string) {
  return (
    Array.from(root.querySelectorAll<HTMLElement>(selectors)).find(
      isUsableAnchor,
    ) || null
  );
}

function productPurchaseArea(main: HTMLElement) {
  // Require one unambiguous primary purchase area. Never target a collection card.
  const forms = Array.from(
    main.querySelectorAll<HTMLElement>("form[action*='/cart/add']"),
  )
    .filter(isUsableAnchor)
    .filter((form) => !form.id.includes("installment"));
  const primary = forms.filter((form) => form.closest(PRIMARY_PRODUCT));
  const scoped = forms.filter((form) => form.closest(INFO));
  const candidates = primary.length ? primary : scoped.length ? scoped : forms;
  if (candidates.length !== 1) return null;
  const form = candidates[0];
  // Keep dynamic checkout/express pay with Add to cart, inside the original form.
  let purchase =
    form.closest<HTMLElement>(
      "product-form, .product-form, [data-product-form]",
    ) || form;
  const info = purchase.closest<HTMLElement>(INFO);
  // A theme often wraps quantity, Add to cart and express pay in a flex/grid row.
  // Place after that complete block, never between its controls.
  if (info) {
    while (purchase.parentElement && purchase.parentElement !== info)
      purchase = purchase.parentElement;
  }
  if (info) {
    for (const payment of info.querySelectorAll<HTMLElement>(
      ".shopify-payment-button, [data-shopify='payment-button']",
    )) {
      if (!isUsableAnchor(payment) || purchase.contains(payment)) continue;
      let block = payment;
      while (block.parentElement && block.parentElement !== info)
        block = block.parentElement;
      if (
        purchase.compareDocumentPosition(block) &
        Node.DOCUMENT_POSITION_FOLLOWING
      )
        purchase = block;
    }
  }
  return { anchor: purchase, info };
}

function currentProductMatches(payload: WidgetPayload) {
  const products = getProducts(payload);
  const handle = /\/products\/([^/?#]+)/.exec(window.location.pathname)?.[1];
  if (handle && products.some((product) => product.handle)) {
    let decodedHandle = handle;
    try {
      decodedHandle = decodeURIComponent(handle);
    } catch {
      /* Keep malformed URLs unmodified. */
    }
    return products.some((product) => product.handle === decodedHandle);
  }
  const context = window as Window & {
    AOVBoost?: { currentProductId?: string };
    ShopifyAnalytics?: { meta?: { product?: { id?: string } } };
  };
  const id = String(
    context.AOVBoost?.currentProductId ||
      context.ShopifyAnalytics?.meta?.product?.id ||
      "",
  )
    .split("/")
    .pop();
  return Boolean(
    id &&
    products.some(
      (product) =>
        String(product.id || "")
          .split("/")
          .pop() === id,
    ),
  );
}

export function hasBlockingSurface() {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      "dialog[open], [role='dialog'][aria-modal='true'], cart-drawer.active, cart-drawer[open], #CartDrawer[aria-hidden='false'], [data-cookie-banner], #shopify-pc__banner",
    ),
  ).some(isVisible);
}

export function resolveWidgetPlacement(
  type: string,
  payload: WidgetPayload,
): WidgetPlacement {
  const page = getStorefrontPage();
  const deny = (reason: string): WidgetPlacement => ({
    target: null,
    zone: "merchandising",
    reason,
  });
  const main = document.querySelector<HTMLElement>(
    "main, #MainContent, [role='main']",
  );
  if (!/^[a-z_]+$/.test(type)) return deny("unknown_widget");
  if (type === "post_purchase" && page === "thankyou" && main) {
    const slot = findSlot(main, "post_purchase");
    return slot
      ? {
          target: slot,
          zone: "merchandising",
          reason: "merchant_post_purchase_slot",
          inline: true,
        }
      : deny("post_purchase_requires_explicit_slot");
  }
  if (page === "checkout" || page === "thankyou" || page === "other")
    return deny("protected_or_nonshopping_page");
  if (type === "chat")
    return {
      target: document.body,
      zone: "assistant",
      reason: "single_assistant_dock",
    };
  if (!main) return deny("no_main_content");
  const slot = findSlot(main, type);
  const place = (
    anchor: HTMLElement,
    key: string,
    zone: WidgetPlacement["zone"],
    position: "afterend" | "beforebegin" = "afterend",
  ): WidgetPlacement => {
    const parent = anchor.parentElement;
    if (
      !parent ||
      !main.contains(parent) ||
      !isUsableAnchor(anchor) ||
      parent.closest(INVALID_PARENT)
    )
      return deny("unsafe_layout_boundary");
    const layout = getComputedStyle(parent);
    if (
      layout.display.includes("grid") ||
      (layout.display.includes("flex") &&
        !layout.flexDirection.startsWith("column"))
    )
      return deny("unsafe_layout_boundary");
    return {
      target: createPlacementMount(anchor, key, position),
      zone,
      reason: key,
      inline: true,
    };
  };

  if (type === "bundle") {
    if (page !== "product") return deny("bundle_requires_product_page");
    if (getProducts(payload).length < 2 || !currentProductMatches(payload))
      return deny("bundle_not_relevant_to_current_product");
    if (slot && !slot.closest("form"))
      return {
        target: slot,
        zone: "merchandising",
        reason: "merchant_bundle_slot",
        inline: true,
      };
    const purchase = productPurchaseArea(main);
    if (!purchase) return deny("no_unambiguous_purchase_area");
    return place(purchase.anchor, "product-bundle", "merchandising");
  }
  if (type === "upsell_drawer") {
    // Complements belong to the cart, never a second modal over the theme's cart.
    if (page !== "cart") return deny("upsell_waits_for_cart_page");
    if (slot && !slot.closest("form"))
      return {
        target: slot,
        zone: "merchandising",
        reason: "merchant_cart_offer_slot",
        inline: true,
      };
    const items = firstSafe(
      main,
      "#main-cart-items, cart-items, [data-cart-items]",
    );
    return items
      ? place(items, "cart-complements", "merchandising")
      : deny("no_safe_cart_items_anchor");
  }
  if (type === "rec_strip") {
    if (slot && !slot.closest("form"))
      return {
        target: slot,
        zone: "merchandising",
        reason: "merchant_recommendations_slot",
        inline: true,
      };
    if (
      Array.from(
        main.querySelectorAll<HTMLElement>(
          "product-recommendations, [data-product-recommendations]",
        ),
      ).some(
        (element) =>
          isVisible(element) &&
          Boolean(element.querySelector("a[href*='/products/']")),
      )
    )
      return deny("theme_recommendations_already_present");
    if (page === "collection") {
      const grid =
        firstSafe(
          main,
          "#ProductGridContainer, [data-product-grid-container]",
        ) ||
        firstSafe(
          main,
          "#product-grid, [data-product-grid], .collection__product-grid",
        );
      return grid
        ? place(grid, "collection-recommendations", "merchandising")
        : deny("no_collection_grid");
    }
    if (page === "product") {
      const purchase = productPurchaseArea(main);
      const description =
        purchase?.info &&
        firstSafe(
          purchase.info,
          ".product__description, [data-product-description]",
        );
      // Never insert a competing grid into the primary purchase controls.
      const section =
        purchase?.anchor.closest<HTMLElement>(".shopify-section") ||
        purchase?.anchor.closest<HTMLElement>(PRIMARY_PRODUCT);
      const anchor =
        section ||
        (description && !description.closest("form") ? description : null);
      return anchor
        ? place(anchor, "product-recommendations", "merchandising")
        : deny("no_safe_product_recommendations_anchor");
    }
    return deny("recommendations_require_explicit_slot");
  }
  if (type === "inline_alert" || type === "social_proof") {
    if (page !== "product") return deny("notice_requires_product_page");
    if (type === "social_proof" && !currentProductMatches(payload))
      return deny("notice_not_about_current_product");
    if (slot)
      return {
        target: slot,
        zone: "notice",
        reason: "merchant_notice_slot",
        inline: true,
      };
    const purchase = productPurchaseArea(main);
    if (!purchase) return deny("no_product_notice_anchor");
    return place(purchase.anchor, "product-notice", "notice");
  }
  if (type === "discount_nudge") {
    if (page !== "cart") return deny("cart_goal_requires_cart_page");
    if (slot)
      return {
        target: slot,
        zone: "notice",
        reason: "merchant_cart_goal_slot",
        inline: true,
      };
    const summary = firstSafe(
      main,
      "#main-cart-footer, [data-cart-summary], .cart__footer",
    );
    return summary
      ? place(summary, "cart-goal", "notice", "beforebegin")
      : deny("no_cart_summary_anchor");
  }
  if (type === "countdown_banner") {
    // Campaigns require a deliberately placed merchant slot and real end time.
    if (
      !slot ||
      Date.parse(String(payload.endsAt || "")) <= Date.now() ||
      !Number.isFinite(Date.parse(String(payload.endsAt || "")))
    )
      return deny("campaign_requires_slot_and_end_time");
    return {
      target: slot,
      zone: "campaign",
      reason: "merchant_campaign_slot",
      inline: true,
    };
  }
  if (type === "toast" || type === "exit_intent") {
    if (window.innerWidth < 900 || hasBlockingSurface())
      return deny("avoid_competing_overlay");
    return {
      target: document.body,
      zone: "overlay",
      reason: "desktop_attention_slot",
    };
  }
  return deny("no_safe_placement_rule");
}

function findSlot(main: HTMLElement, type: string) {
  return (
    Array.from(
      main.querySelectorAll<HTMLElement>(`[data-aovboost-slot='${type}']`),
    ).find(
      (element) => isUsableAnchor(element) && !element.closest(INVALID_PARENT),
    ) || null
  );
}

function createPlacementMount(
  anchor: HTMLElement,
  key: string,
  position: "afterend" | "beforebegin",
) {
  const adjacent =
    position === "afterend"
      ? anchor.nextElementSibling
      : anchor.previousElementSibling;
  if (adjacent instanceof HTMLElement && adjacent.dataset.aovboostMount === key)
    return adjacent;
  const target = document.createElement("div");
  target.dataset.aovboostMount = key;
  target.style.cssText =
    "display:block;min-width:0;width:100%;max-width:100%;clear:both;";
  // Reuse the theme's responsive page gutters for offers after full sections.
  const pageWidth = anchor.matches(".page-width")
    ? anchor
    : firstSafe(anchor, ".page-width");
  if (pageWidth && !anchor.parentElement?.closest(".page-width")) {
    target.classList.add("page-width");
    if (pageWidth.classList.contains("page-width--narrow"))
      target.classList.add("page-width--narrow");
    target.style.removeProperty("max-width");
  }
  anchor.insertAdjacentElement(position, target);
  return target;
}
