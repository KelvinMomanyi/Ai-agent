import { BundleWidget } from "./BundleWidget";
import { ChatWidget } from "./ChatWidget";
import { DiscountNudge } from "./DiscountNudge";
import { ExitIntent } from "./ExitIntent";
import { PostPurchase } from "./PostPurchase";
import { RecStrip } from "./RecStrip";
import { SocialProof } from "./SocialProof";
import { UpsellDrawer } from "./UpsellDrawer";
import { BaseWidget, type WidgetPayload } from "./BaseWidget";

export type OfferDecision = {
  widgetType: string | null;
  payload?: WidgetPayload;
  reasoning?: string;
  confidence?: number;
  aiProvider?: "gemini" | "groq" | "heuristic";
};

const DISMISSED_KEY = "aovboost_dismissed_widgets";

export class WidgetManager {
  private activeWidget: BaseWidget | null = null;
  private activeKey = "";

  mountDecision(decision: OfferDecision): void {
    if (!decision.widgetType) return;
    if (this.getDismissedWidgets().includes(decision.widgetType)) return;

    const payload = decision.payload || {};
    const offerId = String(payload.offerId || "");
    const nextKey = `${decision.widgetType}:${offerId}`;
    if (nextKey === this.activeKey) return;

    this.destroyActive();

    const widget = createWidget(decision.widgetType, payload);
    if (!widget) return;

    const target = this.resolveTarget(decision.widgetType);
    widget.mount(target);
    this.activeWidget = widget;
    this.activeKey = nextKey;
  }

  destroyActive(): void {
    this.activeWidget?.destroy();
    this.activeWidget = null;
    this.activeKey = "";
  }

  getDismissedWidgets(): string[] {
    try {
      const parsed = JSON.parse(localStorage.getItem(DISMISSED_KEY) || "[]");
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }

  private resolveTarget(widgetType: string): HTMLElement {
    if (widgetType === "bundle") {
      return createMountAfter(".product-form, [data-product-form]");
    }

    if (widgetType === "rec_strip") {
      return createMountAfter(".product__description, [data-product-description]");
    }

    if (widgetType === "social_proof") {
      return createMountAfter(".product-form__submit, [data-add-to-cart]");
    }

    return document.body;
  }
}

function createWidget(widgetType: string, payload: WidgetPayload) {
  switch (widgetType) {
    case "chat":
      return new ChatWidget(payload);
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

function createMountAfter(selector: string): HTMLElement {
  const anchor = document.querySelector(selector);
  const target = document.createElement("div");
  target.setAttribute("data-aovboost-mount", selector);

  if (anchor?.parentElement) {
    anchor.insertAdjacentElement("afterend", target);
    return target;
  }

  document.body.appendChild(target);
  return target;
}
