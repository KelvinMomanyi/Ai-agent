import type { WidgetPayload } from "../widgets/BaseWidget";
import type { AgentContext } from "./types";
import type {
  Conversation,
  Experience,
  WidgetDependencies,
} from "./experienceTypes";
import { AGENT_LIMITS as L } from "./constants";
import { activeControl, trapDialog } from "./dialog";

const style = `
  .agent-id{display:flex;align-items:center;gap:8px;font-size:12px;margin-bottom:10px}
  .avatar{display:inline-grid;place-items:center;border-radius:50%;width:28px;height:28px;background:var(--aovboost-action);color:var(--aovboost-action-text)}
  .attention{width:100%;box-sizing:border-box}
  .dismiss{float:right}.backdrop{position:fixed;inset:0;background:#0006;z-index:10000;display:grid;place-items:center;padding:18px}
  .offer{max-width:420px;width:100%;box-sizing:border-box}.offer h3{margin-top:0}.actions{display:flex;flex-wrap:wrap;gap:8px}
  @media(max-width:899px){.backdrop{align-items:end;padding:0}.offer{max-width:none;border-radius:16px 16px 0 0;padding-bottom:max(24px,env(safe-area-inset-bottom))}}
  @media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
`;
function identity(deps: WidgetDependencies, experience: Experience) {
  const { name, avatar } = experience.voice.identity;
  return `<div class="agent-id" data-agent-identity><span class="avatar" aria-hidden="true">${deps.text(avatar)}</span><span>${deps.text(name)}</span></div>`;
}
export function createDock(
  deps: WidgetDependencies,
  payload: WidgetPayload,
  experience: Experience,
) {
  return new (class extends deps.BaseWidget {
    private conversation?: Conversation;
    private loading = false;
    private openState = false;
    private generation = 0;
    private error = "";
    private loadFailed = false;
    private source = "launcher";
    private gestures = new AbortController();
    private userGesture = false;
    private gestureTimer?: ReturnType<typeof setTimeout>;
    constructor() {
      super(payload);
      this.container.style.cssText =
        "position:fixed;right:18px;bottom:18px;z-index:9999;max-width:calc(100vw - 36px)";
      document.addEventListener("aovboost:open-chat", this.onIntent);
      for (const name of ["click", "keydown"])
        document.addEventListener(
          name,
          (event) => {
            if (!event.isTrusted) return;
            this.userGesture = true;
            clearTimeout(this.gestureTimer);
            this.gestureTimer = setTimeout(() => {
              this.userGesture = false;
            }, 0);
          },
          { capture: true, signal: this.gestures.signal },
        );
    }
    getWidgetType() {
      return "chat";
    }
    render() {
      const ui = experience.voice.ui;
      this
        .html(`<style>${style}.status{max-width:300px;margin:8px 0;background:var(--aovboost-paper,#fff);padding:8px;border-radius:8px}</style>
        <div class="dock" data-agent-identity ${this.openState && this.conversation ? "hidden" : ""}>
        ${this.error || this.loading ? `<p class="status" role="status">${deps.text(this.error || ui.loading)}</p>` : ""}
        <button type="button" class="primary" data-launcher aria-haspopup="dialog" aria-expanded="${this.openState}" ${this.loading ? "disabled" : ""} aria-label="${deps.text(this.loadFailed ? ui.reload : this.error ? ui.retry : ui.open)}">${deps.text(experience.voice.identity.avatar)} · ${deps.text(experience.voice.identity.name)}${this.error ? ` — ${deps.text(this.loadFailed ? ui.reload : ui.retry)}` : ""}</button></div>`);
      this.root
        .querySelector("[data-launcher]")
        ?.addEventListener("click", (event) => {
          if (event.isTrusted)
            this.loadFailed ? location.reload() : void this.open(this.source);
        });
    }
    private onIntent = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      // Public legacy events remain supported during an actual shopper gesture.
      if (!this.userGesture) return;
      void this.open(
        typeof detail?.trigger === "string" ? detail.trigger : "storefront_cta",
      );
    };
    private async open(trigger: string) {
      if (this.loading || this.isDestroyed()) return;
      this.source = trigger;
      if (!experience.healthy() && !(await experience.retry())) {
        this.error = experience.voice.ui.unavailable;
        this.render();
        return;
      }
      if (this.isDestroyed()) return;
      const nativeDrawer = document.querySelector(
        "cart-drawer.active,cart-drawer[open]",
      ) as (HTMLElement & { close?: () => void }) | null;
      try {
        nativeDrawer?.close?.();
      } catch {
        /* Theme public APIs are best effort. */
      }
      const handoff = experience.handoff(trigger);
      this.openState = true;
      this.track("chat_opened", { source: trigger });
      if (this.conversation) {
        this.conversation.open(handoff);
        this.render();
        return;
      }
      const generation = ++this.generation;
      this.loading = true;
      this.error = "";
      this.render();
      try {
        const { createConversation } = await import("./ChatConversation");
        if (this.isDestroyed() || generation !== this.generation) return;
        this.conversation = createConversation(
          deps,
          {
            ...payload,
            agentOnDestroy: undefined,
            verifiedDisplayManaged: true,
            greeting: experience.voice.greeting(),
            copy: { greeting: experience.voice.greeting() },
          },
          experience,
          () => this.close(),
        );
        this.conversation.mount(
          this.root.querySelector("[data-aovboost-content]") as HTMLElement,
        );
        // Keep the lazy conversation beside the dock's replaceable content.
        this.root.appendChild(this.conversation.getElement());
        this.conversation.open(handoff);
      } catch {
        this.conversation?.destroy();
        this.conversation = undefined;
        this.error = experience.voice.ui.loadError;
        this.loadFailed = true;
        this.openState = false;
        this.track("chat_closed", { source: "load_failed" });
      } finally {
        this.loading = false;
        if (!this.isDestroyed()) this.render();
      }
    }
    private close() {
      this.openState = false;
      this.conversation?.close();
      this.track("chat_closed", { source: "shopper" });
      this.render();
      this.root.querySelector<HTMLButtonElement>("[data-launcher]")?.focus();
    }
    destroy() {
      this.gestures.abort();
      clearTimeout(this.gestureTimer);
      ++this.generation;
      document.removeEventListener("aovboost:open-chat", this.onIntent);
      this.conversation?.destroy();
      super.destroy();
    }
  })();
}
export function createToast(
  deps: WidgetDependencies,
  payload: WidgetPayload,
  experience: Experience,
  ctx: AgentContext,
) {
  return new (class extends deps.BaseWidget {
    private remaining: number = L.TOAST_AUTODISMISS_MS;
    private started = 0;
    private timer?: ReturnType<typeof setTimeout>;
    private hover = false;
    private focus = false;
    constructor(payload: WidgetPayload) {
      super(payload);
      this.container.style.cssText =
        "position:fixed;left:18px;bottom:18px;width:min(340px,calc(100vw - 36px));z-index:9999";
    }
    getWidgetType() {
      return "toast";
    }
    render() {
      const copy = experience.voice.toast(ctx),
        ui = experience.voice.ui;
      this.html(
        `<style>${style}</style><aside class="attention card" aria-label="${deps.text(experience.voice.identity.name)}"><button class="icon dismiss" aria-label="${deps.text(ui.dismissNotification)}" data-dismiss>×</button>${identity(deps, experience)}<p>${deps.text(copy.headline)}</p><button class="primary" data-chat>${deps.text(copy.ctaText)}</button></aside>`,
      );
      const box = this.root.querySelector<HTMLElement>("aside")!;
      box.addEventListener("mouseenter", () => {
        this.hover = true;
        this.pause();
      });
      box.addEventListener("mouseleave", () => {
        this.hover = false;
        this.resume();
      });
      box.addEventListener("focusin", () => {
        this.focus = true;
        this.pause();
      });
      box.addEventListener("focusout", () =>
        queueMicrotask(() => {
          this.focus = box.contains(this.root.activeElement);
          this.resume();
        }),
      );
      this.root
        .querySelector("[data-dismiss]")
        ?.addEventListener("click", () => {
          this.trackDismiss();
          this.destroy();
        });
      this.root.querySelector("[data-chat]")?.addEventListener("click", () => {
        if (!experience.healthy()) {
          this.destroy();
          return;
        }
        this.trackClick("open_chat");
        document.dispatchEvent(
          new CustomEvent("aovboost:open-chat", {
            detail: {
              trigger: "price_hesitation",
              userInitiated: true,
              handoff: experience.handoff("price_hesitation"),
            },
          }),
        );
        this.destroy();
      });
      this.resume();
    }
    private pause() {
      if (this.timer !== undefined) {
        clearTimeout(this.timer);
        this.remaining = Math.max(
          0,
          this.remaining - (Date.now() - this.started),
        );
        this.timer = undefined;
      }
    }
    private resume() {
      if (
        this.hover ||
        this.focus ||
        this.timer !== undefined ||
        this.isDestroyed()
      )
        return;
      this.started = Date.now();
      this.timer = setTimeout(() => this.destroy(), this.remaining);
    }
    destroy() {
      clearTimeout(this.timer);
      super.destroy();
    }
  })(payload);
}
export function createExit(
  deps: WidgetDependencies,
  payload: WidgetPayload,
  experience: Experience,
  ctx: AgentContext,
) {
  return new (class extends deps.BaseWidget {
    private restore = activeControl();
    private release?: () => void;
    constructor(payload: WidgetPayload) {
      super(payload);
      this.container.style.cssText = "position:fixed;inset:0;z-index:10000";
    }
    getWidgetType() {
      return "exit_intent";
    }
    render() {
      const copy = experience.voice.exit(ctx),
        ui = experience.voice.ui,
        cart = ctx.cart.items.length > 0;
      this.html(
        `<style>${style}</style><div class="backdrop" data-backdrop><section class="offer card" role="dialog" aria-modal="true" aria-labelledby="exit-title">${identity(deps, experience)}<h3 id="exit-title">${deps.text(copy.headline)}</h3><p>${deps.text(copy.offerLine)}</p><div class="actions">${cart ? `<a class="primary" href="${deps.text(deps.cartUrl("read").replace(/\.js$/, ""))}">${deps.text(ui.reviewCart)}</a>` : ""}${experience.healthy() ? `<button class="${cart ? "secondary" : "primary"}" data-chat>${deps.text(ui.ask)}</button>` : ""}<button class="secondary" data-dismiss>${deps.text(ui.dismiss)}</button></div></section></div>`,
      );
      this.release = trapDialog(this.root, () => this.dismiss());
      this.root
        .querySelector("[data-dismiss]")
        ?.addEventListener("click", () => this.dismiss());
      this.root
        .querySelector("[data-backdrop]")
        ?.addEventListener("click", (event) => {
          if (event.target === event.currentTarget) this.dismiss();
        });
      this.root.querySelector("[data-chat]")?.addEventListener("click", () => {
        if (!experience.healthy()) return;
        this.trackClick("open_chat");
        document.dispatchEvent(
          new CustomEvent("aovboost:open-chat", {
            detail: {
              trigger: "exit_intent",
              userInitiated: true,
              handoff: experience.handoff("exit_intent"),
            },
          }),
        );
        this.destroy();
      });
      this.root.querySelector<HTMLElement>("a,button")?.focus();
    }
    private dismiss() {
      this.trackDismiss();
      this.destroy();
    }
    destroy() {
      this.release?.();
      super.destroy();
      if (this.restore?.isConnected) this.restore.focus();
    }
  })(payload);
}
