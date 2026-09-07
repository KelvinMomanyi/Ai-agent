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
import {
  getStorefrontPage,
  hasBlockingSurface,
  resolveWidgetPlacement,
  type WidgetPlacement,
} from "./placement";

export type OfferDecision = {
  widgetType: string | null;
  payload?: WidgetPayload;
  reasoning?: string;
  confidence?: number;
  aiProvider?: "gemini" | "groq" | "heuristic";
};

const DISMISSED_KEY = "aovboost_dismissed_widgets";
const DISMISS_TTL_MS = 30 * 60 * 1000;
export type PlacementOutcome = {
  status: "mounted" | "unchanged" | "suppressed";
  reason: string;
};

type MountedWidget = {
  key: string;
  widget: BaseWidget;
};

export class WidgetManager {
  private chatWidget: MountedWidget | null = null;
  private bannerWidget: MountedWidget | null = null;
  private overlayWidget: MountedWidget | null = null;
  private inlineWidgets = new Map<string, MountedWidget>();
  private lastPlacement: PlacementOutcome | null = null;
  private lastOverlayAt = 0;
  private pagePath = window.location.pathname;

  constructor(private settings: StorefrontSettings = {}) {}

  mountDecision(decision: OfferDecision): PlacementOutcome {
    if (this.pagePath !== window.location.pathname) this.resetPageContext();
    const result = (status: PlacementOutcome["status"], reason: string) => {
      this.lastPlacement = { status, reason };
      return this.lastPlacement;
    };
    if (!decision.widgetType) return result("suppressed", "no_widget");
    if (!isWidgetEnabled(decision.widgetType, this.settings))
      return result("suppressed", "merchant_disabled");
    const payload = decision.payload || {};
    if (this.getDismissedWidgets().includes(decision.widgetType))
      return result("suppressed", "shopper_dismissed");

    const offerId = String(payload.offerId || "");
    const nextKey = `${decision.widgetType}:${getWidgetIdentity(
      decision.widgetType,
      payload,
      offerId,
    )}`;

    const previous = this.inlineWidgets.get(decision.widgetType);
    if (previous?.widget.isMounted()) {
      // Do not swap a visible offer, reset variant choices or shift the layout.
      return result("unchanged", "stable_offer_already_present");
    }
    previous?.widget.destroy();
    this.inlineWidgets.delete(decision.widgetType);
    if (decision.widgetType === "chat") {
      if (this.chatWidget?.widget.isMounted())
        return result("unchanged", "assistant_already_present");
      this.chatWidget?.widget.destroy();
    }
    if (
      decision.widgetType === "countdown_banner" &&
      this.bannerWidget?.widget.isMounted()
    )
      return result("unchanged", "campaign_already_present");
    if (
      ["bundle", "rec_strip", "upsell_drawer"].includes(decision.widgetType) &&
      ["bundle", "rec_strip", "upsell_drawer"].some((type) =>
        this.inlineWidgets.get(type)?.widget.isMounted(),
      )
    ) {
      return result("suppressed", "one_merchandising_block_per_page");
    }
    if (
      ["inline_alert", "social_proof", "discount_nudge"].includes(
        decision.widgetType,
      ) &&
      ["inline_alert", "social_proof", "discount_nudge"].some((type) =>
        this.inlineWidgets.get(type)?.widget.isMounted(),
      )
    ) {
      return result("suppressed", "one_contextual_notice_per_page");
    }
    if (
      ["toast", "exit_intent"].includes(decision.widgetType) &&
      (this.chatWidget?.widget.isMounted() ||
        this.overlayWidget?.widget.isMounted() ||
        hasBlockingSurface() ||
        (this.lastOverlayAt && Date.now() - this.lastOverlayAt < 120_000))
    ) {
      return result("suppressed", "attention_slot_occupied_or_cooling_down");
    }
    const placement = resolveWidgetPlacement(decision.widgetType, payload);
    if (!placement.target) return result("suppressed", placement.reason);
    const widget = createWidget(decision.widgetType, {
      ...payload,
      presentation: placement.inline ? "inline" : "floating",
    });
    if (!widget) return result("suppressed", "unknown_widget");
    if (placement.zone === "assistant") {
      this.overlayWidget?.widget.destroy();
      this.overlayWidget = null;
    }
    widget.mount(placement.target);
    if (!widget.isMounted())
      return result("suppressed", "widget_has_no_renderable_content");
    this.saveMounted(placement.zone, decision.widgetType, {
      key: nextKey,
      widget,
    });
    return result("mounted", placement.reason);
  }

  private saveMounted(
    zone: WidgetPlacement["zone"],
    type: string,
    entry: MountedWidget,
  ) {
    if (zone === "assistant") this.chatWidget = entry;
    else if (zone === "campaign") {
      this.bannerWidget?.widget.destroy();
      this.bannerWidget = entry;
    } else if (zone === "overlay") {
      this.overlayWidget?.widget.destroy();
      this.overlayWidget = entry;
      this.lastOverlayAt = Date.now();
    } else this.inlineWidgets.set(type, entry);
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
    this.pagePath = window.location.pathname;
    this.overlayWidget?.widget.destroy();
    this.overlayWidget = null;
    this.inlineWidgets.forEach((mounted) => mounted.widget.destroy());
    this.inlineWidgets.clear();
    this.bannerWidget?.widget.destroy();
    this.bannerWidget = null;
    if (["checkout", "thankyou", "other"].includes(getStorefrontPage())) {
      this.chatWidget?.widget.destroy();
      this.chatWidget = null;
    }
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
      const dismissed = active
        .map((entry: any) => String(entry.widgetType || ""))
        .filter(Boolean);
      if (
        sessionStorage.getItem("aovboost_chat_dismissed_session") === "true" &&
        !dismissed.includes("chat")
      ) {
        dismissed.push("chat");
      }
      return dismissed;
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
      lastPlacement: this.lastPlacement,
    };
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
