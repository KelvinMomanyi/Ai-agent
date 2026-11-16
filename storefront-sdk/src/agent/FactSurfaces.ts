import FACT_CSS from '../styles/fact-surfaces.css?inline';
import type { WidgetPayload } from "../widgets/BaseWidget";
import type { AgentVoice } from "./AgentVoice";
import type { FactView } from "./OfferFacts";
import type { WidgetDependencies } from "./experienceTypes";
import { AGENT_LIMITS as L } from "./constants";

type Options = {
  view: () => FactView | undefined;
  subscribe: (listener: () => void) => () => void;
  voice: AgentVoice;
  locale: () => string | undefined;
  failed: () => void;
};
// All four surfaces stay inside an already reserved app slot. Their fixed host
// geometry cannot push theme content when an offer arrives, expires or changes.
export function createFactSurface(
  deps: WidgetDependencies,
  payload: WidgetPayload,
  type: string,
  options: Options,
) {
  return new (class extends deps.BaseWidget {
    private unsubscribe?: () => void;
    private timer?: ReturnType<typeof setTimeout>;
    private resize?: ResizeObserver;
    private slot?: HTMLElement;
    private originalPosition = "";
    private positioned = false;
    getWidgetType() {
      return type;
    }
    mount(target = document.body) {
      this.slot = target;
      this.originalPosition = target.style.position;
      if (getComputedStyle(target).position === "static") {
        target.style.position = "relative";
        this.positioned = true;
      }
      this.container.style.cssText =
        "position:absolute;inset:0;width:100%;height:100%;contain:layout paint";
      super.mount(target);
      if (this.isDestroyed()) return;
      this.unsubscribe = options.subscribe(() => this.update());
      document.addEventListener("visibilitychange", this.update);
      if (typeof ResizeObserver !== "undefined") {
        this.resize = new ResizeObserver(() => {
          try {
            const view = options.view(),
              rect = target.getBoundingClientRect();
            if (
              !view ||
              rect.height < view.minHeight ||
              rect.width < L.FACT_SLOT_MIN_WIDTH
            )
              this.destroy();
          } catch {
            options.failed();
            this.destroy();
          }
        });
        this.resize.observe(target);
      }
      this.schedule();
    }
    render() {
      const view = options.view();
      if (!view) {
        this.destroy();
        return;
      }
      const copy = options.voice.fact(view, options.locale()),
        text = deps.text;
      const cartPath = deps.cartUrl("read").replace(/\.js$/, "");
      const applyCode =
        view.type === "discount_nudge" && view.code && view.remaining === 0
          ? view.code
          : "";
      const cartLink = applyCode
        ? `/discount/${encodeURIComponent(applyCode)}?redirect=${encodeURIComponent(cartPath)}`
        : cartPath;
      this.html(`<style>${FACT_CSS}</style><aside class="fact card" tabindex="0" aria-label="${text(copy.headline)}"><div class="head"><strong>${text(copy.headline)}</strong><button type="button" class="icon" data-dismiss aria-label="${text(options.voice.ui.dismissNotification)}">×</button></div>
        <p class="body" role="status" tabindex="0" data-body>${text(copy.body)}</p><p class="detail" data-detail ${copy.detail ? "" : "hidden"}>${text(copy.detail)}</p>
        ${view.type === "countdown_banner" ? `<span class="timer" role="timer" aria-live="off" data-timer></span>` : ""}
        ${view.type === "discount_nudge" ? `<div class="track" role="progressbar" aria-label="${text(copy.headline)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${view.progress}" data-progress><div class="fill" style="width:${view.progress}%" data-fill></div></div><a href="${text(cartLink)}" data-cart>${text(applyCode ? "Apply code" : options.voice.ui.reviewCart)}</a>` : ""}
      </aside>`);
      this.root
        .querySelector("[data-dismiss]")
        ?.addEventListener("click", () => {
          this.trackDismiss();
          this.destroy();
        });
      this.root
        .querySelector("[data-cart]")
        ?.addEventListener("click", () =>
          this.trackClick("view_cart_goal_picks"),
        );
      this.update();
    }
    private update = () => {
      if (this.isDestroyed()) return;
      try {
        const view = options.view();
        if (!view) {
          this.destroy();
          return;
        }
        const copy = options.voice.fact(view, options.locale());
        const body = this.root.querySelector("[data-body]"),
          detail = this.root.querySelector<HTMLElement>("[data-detail]");
        if (body && body.textContent !== copy.body)
          body.textContent = copy.body;
        if (detail) {
          if (detail.textContent !== copy.detail)
            detail.textContent = copy.detail;
          detail.hidden = !copy.detail;
        }
        if (view.type === "discount_nudge") {
          this.root
            .querySelector("[data-progress]")
            ?.setAttribute("aria-valuenow", String(view.progress));
          const fill = this.root.querySelector<HTMLElement>("[data-fill]");
          if (fill) fill.style.width = `${view.progress}%`;
          const link =
            this.root.querySelector<HTMLAnchorElement>("[data-cart]");
          if (link) {
            const code = view.code && view.remaining === 0 ? view.code : "";
            link.href = code
              ? `/discount/${encodeURIComponent(code)}?redirect=${encodeURIComponent(deps.cartUrl("read").replace(/\.js$/, ""))}`
              : deps.cartUrl("read").replace(/\.js$/, "");
            link.textContent = code
              ? "Apply code"
              : options.voice.ui.reviewCart;
          }
        }
        if (view.type === "countdown_banner") {
          const remaining = Math.max(
              0,
              Math.ceil((view.endsAt - Date.now()) / 1000),
            ),
            hours = Math.floor(remaining / 3600),
            minutes = Math.floor((remaining % 3600) / 60),
            seconds = remaining % 60;
          const timer = this.root.querySelector("[data-timer]");
          if (timer)
            timer.textContent = `${hours}h ${minutes}m ${String(seconds).padStart(2, "0")}s`;
        }
      } catch {
        options.failed();
        this.destroy();
      }
    };
    private schedule() {
      if (this.isDestroyed()) return;
      try {
        const view = options.view();
        if (!view) {
          this.destroy();
          return;
        }
        if (view.type === "countdown_banner" || view.expiresAt !== undefined)
          this.timer = setTimeout(
            () => {
              this.update();
              this.schedule();
            },
            Math.min(
              L.FACT_TICK_MS,
              Math.max(0, (view.expiresAt || Infinity) - Date.now()),
            ),
          );
      } catch {
        options.failed();
        this.destroy();
      }
    }
    destroy() {
      clearTimeout(this.timer);
      this.unsubscribe?.();
      this.resize?.disconnect();
      document.removeEventListener("visibilitychange", this.update);
      if (this.positioned && this.slot?.style.position === "relative")
        this.slot.style.position = this.originalPosition;
      super.destroy();
    }
  })(payload);
}
