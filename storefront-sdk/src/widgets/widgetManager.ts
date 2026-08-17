import { BundleWidget } from "./BundleWidget";
import { ChatWidget } from "./ChatWidget";
import { CountdownBanner } from "./CountdownBanner";
import { DiscountNudge } from "./DiscountNudge";
import { ExitIntent } from "./ExitIntent";
import { InlineAlert } from "./InlineAlert";
import { PostPurchase } from "./PostPurchase";
import { RecStrip } from "./RecStrip";
import { SocialProof } from "./SocialProof";
import { ToastNudge } from "./ToastNudge";
import { UpsellDrawer } from "./UpsellDrawer";
import type { BaseWidget, WidgetPayload } from "./BaseWidget";
import type { StorefrontSettings } from "../sessionManager";

export type OfferDecision = {
  widgetType: string | null;
  payload?: WidgetPayload;
  reasoning?: string;
  confidence?: number;
  aiProvider?: "gemini" | "groq" | "heuristic";
};

const DISMISSED_KEY = "aovboost_dismissed_widgets";
const DISMISS_TTL_MS = 30 * 60 * 1000;
const INLINE_WIDGET_TYPES = new Set([
  "bundle",
  "rec_strip",
  "inline_alert",
  "social_proof",
  "post_purchase",
]);
const BANNER_WIDGET_TYPES = new Set(["countdown_banner", "discount_nudge"]);

type MountedWidget = {
  key: string;
  widget: BaseWidget;
};

export class WidgetManager {
  private chatWidget: MountedWidget | null = null;
  private bannerWidget: MountedWidget | null = null;
  private overlayWidget: MountedWidget | null = null;
  private inlineWidgets = new Map<string, MountedWidget>();

  constructor(private settings: StorefrontSettings = {}) {}

  mountDecision(decision: OfferDecision): void {
    if (!decision.widgetType) return;
    if (!isWidgetEnabled(decision.widgetType, this.settings)) return;
    if (this.getDismissedWidgets().includes(decision.widgetType)) return;

    const payload = decision.payload || {};
    const offerId = String(payload.offerId || "");
    const nextKey = `${decision.widgetType}:${getWidgetIdentity(
      decision.widgetType,
      payload,
      offerId,
    )}`;

    if (INLINE_WIDGET_TYPES.has(decision.widgetType)) {
      const mounted = this.inlineWidgets.get(decision.widgetType);
      if (mounted?.key === nextKey) return;

      const widget = createWidget(decision.widgetType, payload);
      if (!widget) return;

      mounted?.widget.destroy();
      const target = this.resolveTarget(decision.widgetType);
      widget.mount(target);
      this.inlineWidgets.set(decision.widgetType, { key: nextKey, widget });
      return;
    }

    const widget = createWidget(decision.widgetType, payload);
    if (!widget) return;

    if (decision.widgetType === "chat") {
      if (this.chatWidget?.widget.isMounted()) return;
      this.chatWidget?.widget.destroy();
      widget.mount(this.resolveTarget(decision.widgetType));
      this.chatWidget = { key: nextKey, widget };
      return;
    }

    if (BANNER_WIDGET_TYPES.has(decision.widgetType)) {
      if (
        this.bannerWidget?.key === nextKey &&
        this.bannerWidget.widget.isMounted()
      ) {
        return;
      }
      this.bannerWidget?.widget.destroy();
      widget.mount(this.resolveTarget(decision.widgetType));
      this.bannerWidget = { key: nextKey, widget };
      return;
    }

    if (
      this.overlayWidget?.widget.getWidgetType() === decision.widgetType &&
      this.overlayWidget.widget.isMounted()
    ) {
      return;
    }
    this.overlayWidget?.widget.destroy();
    widget.mount(this.resolveTarget(decision.widgetType));
    this.overlayWidget = { key: nextKey, widget };
  }

  destroyActive(): void {
    this.chatWidget?.widget.destroy();
    this.chatWidget = null;
    this.bannerWidget?.widget.destroy();
    this.bannerWidget = null;
    this.overlayWidget?.widget.destroy();
    this.overlayWidget = null;
    this.inlineWidgets.forEach((mounted) => mounted.widget.destroy());
    this.inlineWidgets.clear();
  }

  resetPageContext(): void {
    this.overlayWidget?.widget.destroy();
    this.overlayWidget = null;
    this.inlineWidgets.forEach((mounted) => mounted.widget.destroy());
    this.inlineWidgets.clear();
  }

  getDismissedWidgets(): string[] {
    try {
      const parsed = JSON.parse(localStorage.getItem(DISMISSED_KEY) || "[]");
      if (!Array.isArray(parsed)) return [];

      const now = Date.now();
      const active = parsed
        .filter((entry) => entry && typeof entry === "object")
        .filter(
          (entry: any) => now - Number(entry.dismissedAt || 0) < DISMISS_TTL_MS,
        );
      if (active.length !== parsed.length) {
        localStorage.setItem(DISMISSED_KEY, JSON.stringify(active));
      }
      return active
        .map((entry: any) => String(entry.widgetType || ""))
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  getStatus() {
    const mountedWidgetTypes = [
      this.chatWidget?.widget,
      this.bannerWidget?.widget,
      this.overlayWidget?.widget,
      ...Array.from(this.inlineWidgets.values()).map((entry) => entry.widget),
    ]
      .filter((widget): widget is BaseWidget => Boolean(widget?.isMounted()))
      .map((widget) => widget.getWidgetType())
      .sort();

    return {
      mountedWidgetTypes,
      dismissedWidgetTypes: this.getDismissedWidgets(),
      settings: { ...this.settings },
    };
  }

  private resolveTarget(widgetType: string): HTMLElement {
    if (widgetType === "bundle") {
      return createMountAfter(
        "product-form, .product-form, [data-product-form], form[action*='/cart/add']",
        "product-bundle",
      );
    }

    if (widgetType === "rec_strip") {
      const pageType = getCurrentPageType();
      if (pageType === "product") {
        return createMountAfter(
          ".product__description, [data-product-description], product-info, .product__info-container, product-form, .product-form, form[action*='/cart/add']",
          "product-recommendations",
        );
      }
      if (pageType === "collection") {
        return createMountBefore(
          "#product-grid, #ProductGridContainer, [data-product-grid], .collection__product-grid, .product-grid",
          "collection-recommendations",
        );
      }
      return createVisibleMainMount(
        ".featured-collection, [data-section-type='featured-collection'], main section, #MainContent > *",
        "home-recommendations",
      );
    }

    if (widgetType === "social_proof") {
      return createMountAfter(
        ".product-form__submit, [data-add-to-cart], button[name='add']",
        "product-social-proof",
      );
    }

    if (widgetType === "inline_alert") {
      return createMountAfter(
        "[data-price], .product__price, .price, product-form, .product-form, [data-product-form]",
        "product-alert",
      );
    }

    return document.body;
  }
}

export function isWidgetEnabled(
  widgetType: string,
  settings: StorefrontSettings,
) {
  if (widgetType === "chat") return settings.chatEnabled !== false;
  if (widgetType === "bundle") return settings.bundlesEnabled !== false;
  if (
    widgetType === "upsell_drawer" ||
    widgetType === "rec_strip" ||
    widgetType === "social_proof"
  ) {
    return settings.upsellEnabled !== false;
  }
  if (widgetType === "discount_nudge" || widgetType === "countdown_banner") {
    return settings.discountNudgeEnabled !== false;
  }
  if (widgetType === "exit_intent") return settings.exitIntentEnabled !== false;
  if (widgetType === "post_purchase")
    return settings.postPurchaseEnabled !== false;
  return true;
}

function getWidgetIdentity(
  widgetType: string,
  payload: WidgetPayload,
  offerId: string,
) {
  if (widgetType === "bundle") {
    const bundle = payload.bundle as Record<string, unknown> | undefined;
    return String(
      bundle?.id || payload.currentProductId || offerId || "product-bundle",
    );
  }

  return offerId || widgetType;
}

function createWidget(widgetType: string, payload: WidgetPayload) {
  switch (widgetType) {
    case "chat":
      return new ChatWidget(payload);
    case "toast":
      return new ToastNudge(payload);
    case "countdown_banner":
      return new CountdownBanner(payload);
    case "inline_alert":
      return new InlineAlert(payload);
    case "bundle":
      return new BundleWidget(payload);
    case "upsell_drawer":
      return new UpsellDrawer(payload);
    case "discount_nudge":
      return new DiscountNudge(payload);
    case "rec_strip":
      return new RecStrip(payload);
    case "social_proof":
      return new SocialProof(payload);
    case "exit_intent":
      return new ExitIntent(payload);
    case "post_purchase":
      return new PostPurchase(payload);
    default:
      return null;
  }
}

function createMountAfter(selector: string, key: string): HTMLElement {
  return createAdjacentMount(selector, key, "afterend");
}

function createMountBefore(selector: string, key: string): HTMLElement {
  return createAdjacentMount(selector, key, "beforebegin");
}

function createAdjacentMount(
  selector: string,
  key: string,
  position: "beforebegin" | "afterend",
): HTMLElement {
  const existing = findMount(key);
  if (existing) return existing;
  const anchor = document.querySelector(selector);
  const target = createMount(key);

  if (anchor?.parentElement) {
    anchor.insertAdjacentElement(position, target);
    return target;
  }

  return prependToMain(target);
}

function createVisibleMainMount(selector: string, key: string) {
  const existing = findMount(key);
  if (existing) return existing;
  const target = createMount(key);
  const anchor = document.querySelector(selector);
  if (anchor?.parentElement) {
    anchor.insertAdjacentElement("beforebegin", target);
    return target;
  }
  return prependToMain(target);
}

function prependToMain(target: HTMLElement) {
  const main = document.querySelector("main, #MainContent, [role='main']");
  if (main) {
    main.prepend(target);
  } else {
    document.body.prepend(target);
  }
  return target;
}

function createMount(key: string) {
  const target = document.createElement("div");
  target.setAttribute("data-aovboost-mount", key);
  return target;
}

function findMount(key: string) {
  const mount = document.querySelector<HTMLElement>(
    `[data-aovboost-mount='${key}']`,
  );
  return mount?.isConnected ? mount : null;
}

function getCurrentPageType() {
  const pathname = window.location.pathname;
  const template = String(
    (window as any).ShopifyAnalytics?.meta?.page?.pageType ||
      document.body?.dataset?.template ||
      "",
  ).toLowerCase();
  if (pathname === "/") return "home";
  if (/\/collections(?:\/|$)/.test(pathname) || template.includes("collection")) {
    return "collection";
  }
  if (/\/products(?:\/|$)/.test(pathname) || template.includes("product")) {
    return "product";
  }
  return "other";
}
