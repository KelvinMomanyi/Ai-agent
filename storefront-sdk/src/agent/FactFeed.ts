import { AGENT_LIMITS as L } from "./constants";
import type { AgentContext } from "./types";
import type { OfferDecision } from "../widgets/widgetManager";
import type { AgentFactsConfig } from "./OfferFacts";

export type FactSnapshot = {
  agentFacts: AgentFactsConfig;
  campaign: Record<string, unknown> | null;
  automaticPlacements: boolean;
  offers: OfferDecision[];
};
const empty = (): FactSnapshot => ({
  agentFacts: { version: 1 },
  campaign: null,
  automaticPlacements: false,
  offers: [],
});
export class FactFeed {
  data = empty();
  private timer?: ReturnType<typeof setTimeout>;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private request?: AbortController;
  private key = "";
  private destroyed = false;
  private root?: HTMLElement;
  constructor(
    private apiBase: string,
    private auth: () => Promise<Record<string, unknown> | null>,
    private context: () => AgentContext,
    private changed: (value: FactSnapshot) => void,
  ) {
    document.addEventListener("visibilitychange", this.visible);
  }
  refresh = () => {
    if (this.destroyed || document.visibilityState === "hidden") return;
    const ctx = this.context(),
      key = JSON.stringify([
        ctx.page.type,
        ctx.page.productId,
        ctx.cart.currency || window.AOVBoost?.currency,
      ]);
    if (key === this.key) return;
    this.key = key;
    this.request?.abort();
    clearTimeout(this.timer);
    clearTimeout(this.refreshTimer);
    this.timer = setTimeout(() => {
      void this.load(key);
    }, L.FACT_REQUEST_DEBOUNCE_MS);
  };
  private visible = () => {
    if (document.visibilityState !== "hidden") {
      this.key = "";
      this.refresh();
    }
  };
  private async load(key: string) {
    const controller = new AbortController();
    this.request = controller;
    const timeout = setTimeout(
      () => controller.abort(),
      L.FACT_FETCH_TIMEOUT_MS,
    );
    try {
      const auth = await this.auth();
      if (!auth || controller.signal.aborted)
        throw new Error("Authentication unavailable");
      const ctx = this.context();
      const response = await fetch(
        `${this.apiBase.replace(/\/$/, "")}/experience`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...auth,
            pageType: ctx.page.type,
            productId: ctx.page.productId,
            currency: ctx.cart.currency || window.AOVBoost?.currency,
          }),
          signal: controller.signal,
        },
      );
      if (!response.ok) throw new Error("Facts unavailable");
      const value = await response.json();
      if (this.destroyed || controller.signal.aborted || this.key !== key)
        return;
      this.data = {
        agentFacts:
          value.agentFacts?.version === 1 ? value.agentFacts : { version: 1 },
        campaign:
          value.campaign && typeof value.campaign === "object"
            ? value.campaign
            : null,
        automaticPlacements: value.automaticPlacements === true,
        offers: Array.isArray(value.offers) ? value.offers.slice(0, 4) : [],
      };
      this.slots();
      this.changed(this.data);
    } catch {
      if (this.destroyed || this.key !== key) return;
      this.data = empty();
      this.changed(this.data);
      this.root?.remove();
      this.root = undefined;
    } finally {
      clearTimeout(timeout);
      if (!this.destroyed && this.key === key)
        this.refreshTimer = setTimeout(() => {
          this.key = "";
          this.refresh();
        }, L.FACT_REFRESH_MS);
    }
  }
  private slots() {
    if (!this.data.automaticPlacements) {
      this.root?.remove();
      this.root = undefined;
      return;
    }
    if (!this.root) {
      this.root = document.createElement("div");
      this.root.dataset.aovboostFactSlots = "";
      const css = document.createElement("style");
      css.textContent =
        "[data-aovboost-auto-slot]>[data-aovboost-widget]{pointer-events:auto}";
      this.root.append(css);
      document.body.append(this.root);
    }
    const sizes: Record<string, number> = {
      countdown_banner: L.CAMPAIGN_SLOT_MIN_HEIGHT,
      inline_alert: L.ALERT_SLOT_MIN_HEIGHT,
      social_proof: L.PROOF_SLOT_MIN_HEIGHT,
      discount_nudge: L.REWARD_SLOT_MIN_HEIGHT,
    };
    const wanted = new Set(this.data.offers.map((o) => o.widgetType));
    for (const child of this.root.querySelectorAll<HTMLElement>(
      "[data-aovboost-auto-slot]",
    ))
      if (!wanted.has(child.dataset.aovboostAutoSlot!)) child.remove();
    for (const type of wanted) {
      if (
        !type ||
        !sizes[type] ||
        document.querySelector(
          `[data-aovboost-slot='${type}'],[data-aovboost-auto-slot='${type}']`,
        )
      )
        continue;
      const slot = document.createElement("div");
      slot.dataset.aovboostAutoSlot = type;
      slot.style.cssText = `position:fixed;z-index:99990;pointer-events:none;height:${sizes[type]}px;${type === "countdown_banner" ? "top:16px;left:50%;transform:translateX(-50%);width:min(640px,calc(100vw - 32px))" : "bottom:calc(88px + env(safe-area-inset-bottom));right:16px;width:min(360px,calc(100vw - 32px))"}`;
      this.root.append(slot);
    }
  }
  destroy() {
    this.destroyed = true;
    this.request?.abort();
    clearTimeout(this.timer);
    clearTimeout(this.refreshTimer);
    document.removeEventListener("visibilitychange", this.visible);
    this.root?.remove();
  }
}
