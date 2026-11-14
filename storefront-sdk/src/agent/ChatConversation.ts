import type { ConversationFactory } from "./experienceTypes";
import type { ChatHandoff } from "./AgentVoice";
import type { Message } from "../widgets/ChatWidget";
import { CartUndo } from "./CartUndo";
import { trapDialog } from "./dialog";

export const createConversation: ConversationFactory = (
  deps,
  payload,
  experience,
  onClose,
) => {
  return new (class extends deps.ChatWidget {
    private handoff?: ChatHandoff;
    private release?: () => void;
    private retryValue = "";
    private undoAvailable = false;
    private undo: CartUndo;
    private status = "";
    constructor() {
      super({ ...payload, agentIdentity: undefined });
      this.expanded = true;
      this.container.dataset.aovboostWidget = "chat_window";
      this.container.hidden = true;
      this.undo = new CartUndo(deps, (available) => {
        this.undoAvailable = available;
        this.updateActions();
      });
    }
    open(handoff: ChatHandoff) {
      this.handoff = handoff;
      const key = JSON.stringify([
        handoff.productId,
        handoff.variantId,
        handoff.cartSnapshot,
      ]);
      if (experience.memory.handoffKey !== key) {
        experience.memory.handoffKey = key;
        this.messages.push({
          role: "assistant",
          content: handoff.suggestedOpeningLine,
        });
        this.persistConversation();
      }
      this.container.hidden = false;
      // Avoid replacing an active stream or losing an unsent draft on a second doorway.
      if (!this.sending) this.render();
      this.root.querySelector<HTMLInputElement>("[data-input]")?.focus();
    }
    close() {
      this.container.hidden = true;
      this.release?.();
    }
    protected dismiss() {
      onClose();
    }
    render() {
      const draft =
        this.root.querySelector<HTMLInputElement>("[data-input]")?.value || "";
      super.render();
      const ui = experience.voice.ui;
      const box = this.root.querySelector<HTMLElement>("aside")!;
      box.setAttribute("role", "dialog");
      box.setAttribute("aria-modal", "true");
      box.setAttribute("aria-label", experience.voice.identity.name);
      box.setAttribute("data-agent-identity", "");
      const title = this.root.querySelector<HTMLElement>(".title")!;
      title.textContent = `${experience.voice.identity.avatar} · ${experience.voice.identity.name}`;
      this.root
        .querySelector("[data-close]")
        ?.setAttribute("aria-label", ui.close);
      const input = this.root.querySelector<HTMLInputElement>("[data-input]");
      if (input) {
        input.value = draft;
        input.placeholder = ui.placeholder;
        input.setAttribute("aria-label", ui.input);
      }
      const style = document.createElement("style");
      style.textContent = `.wrap{left:auto;right:18px;bottom:18px;width:min(410px,calc(100vw - 36px));max-height:calc(100dvh - 36px);display:flex;flex-direction:column;transform:none;animation:none;box-sizing:border-box;z-index:10001}.messages{min-height:80px;max-height:min(440px,55dvh);overflow:auto}.head{flex-shrink:0}.chips{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}.chips button{font:inherit;font-size:11px;padding:6px}.agent-status{font-size:12px}.shade{position:fixed;inset:0;background:#0005;z-index:10000}@media(max-width:899px){.wrap{right:0;bottom:0;width:100vw;max-height:90dvh;border-radius:16px 16px 0 0;padding-bottom:max(18px,env(safe-area-inset-bottom))}}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}`;
      box.before(style);
      const shade = document.createElement("div");
      shade.className = "shade";
      shade.addEventListener("click", () => onClose());
      box.before(shade);
      const chips = document.createElement("div");
      chips.className = "chips";
      for (const label of experience.voice.quickReplies(
        this.handoff || experience.handoff("launcher"),
      )) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "secondary";
        button.textContent = label;
        button.addEventListener("click", () => {
          if (input && !this.sending) {
            input.value = label;
            void this.sendMessage();
          }
        });
        chips.appendChild(button);
      }
      box.querySelector(".compose")?.before(chips);
      const actions = document.createElement("div");
      actions.setAttribute("data-agent-actions", "");
      box.appendChild(actions);
      this.updateActions();
      this.release?.();
      this.release = trapDialog(this.root, () => onClose());
    }
    private updateActions() {
      const actions = this.root.querySelector<HTMLElement>(
        "[data-agent-actions]",
      );
      if (!actions) return;
      const ui = experience.voice.ui;
      actions.innerHTML = `<p class="agent-status" role="status">${deps.text(this.status)}</p>${this.retryValue ? `<button class="secondary" data-retry>${deps.text(ui.retryMessage)}</button>` : ""}${this.undoAvailable ? `<button class="secondary" data-undo>${deps.text(ui.undo)}</button>` : ""}`;
      actions
        .querySelector<HTMLButtonElement>("[data-retry]")
        ?.addEventListener("click", async (event) => {
          const button = event.currentTarget as HTMLButtonElement;
          button.disabled = true;
          if (!(await experience.retry())) {
            this.status = ui.unavailable;
            this.updateActions();
            return;
          }
          const input =
            this.root.querySelector<HTMLInputElement>("[data-input]");
          if (!input || this.isDestroyed()) return;
          input.value = this.retryValue;
          this.retryValue = "";
          this.status = "";
          this.updateActions();
          void this.sendMessage();
        });
      actions
        .querySelector<HTMLButtonElement>("[data-undo]")
        ?.addEventListener("click", async () => {
          const variantId = this.undo.variantId;
          const result = await this.cartInteraction(() => this.undo.undo());
          if (this.isDestroyed()) return;
          if (result === "ok")
            for (const button of this.root.querySelectorAll<HTMLButtonElement>(
              "[data-chat-add]",
            )) {
              if (
                button.dataset.chatAdd?.split("/").pop() === String(variantId)
              ) {
                button.disabled = false;
                button.textContent = ui.addToCart;
              }
            }
          this.status =
            result === "ok"
              ? ui.undone
              : result === "changed"
                ? ui.changed
                : ui.cartError;
          this.track("widget_click", { action: "undo", result });
          this.updateActions();
        });
    }
    protected onChatRequestFinished(
      value: string,
      ok: boolean,
      cartActionHandled: boolean,
    ) {
      this.retryValue = !ok && !cartActionHandled ? value : "";
      this.status = ok
        ? ""
        : cartActionHandled
          ? experience.voice.ui.actionError
          : experience.voice.ui.partialError;
      this.updateActions();
    }
    protected getStorefrontContext() {
      const current = super.getStorefrontContext();
      return {
        ...current,
        ...(this.handoff?.productId
          ? { pageType: "product", productId: this.handoff.productId }
          : {}),
        ...(this.handoff?.variantId
          ? { variantId: this.handoff.variantId }
          : {}),
      };
    }
    protected renderMessageContent(message: Message) {
      return super.renderMessageContent(message).trim();
    }
    protected showTyping() {
      super.showTyping();
      const indicator = this.root.querySelector("[data-typing]");
      indicator?.setAttribute("aria-label", experience.voice.ui.typing);
      indicator?.setAttribute("role", "status");
    }
    protected renderMessage(message: Message) {
      return `<div class="bubble ${message.role}">${this.renderMessageContent(message)}</div>`;
    }
    private async cartInteraction<T>(operation: () => Promise<T>): Promise<T> {
      const drawer = document.querySelector<HTMLElement>("cart-drawer") as
        (HTMLElement & { close?: () => void }) | null;
      const wasOpen = drawer?.matches(".active,[open]");
      try {
        return await operation();
      } finally {
        // Use the theme's public close method if its refresh opened a second
        // focus trap over this conversation. The refresh itself stays intact.
        if (
          !wasOpen &&
          !this.container.hidden &&
          drawer?.matches(".active,[open]")
        ) {
          try {
            drawer.close?.();
          } catch {
            /* Theme adapters are best effort. */
          }
        }
        if (!this.container.hidden && !this.isDestroyed())
          this.root.querySelector<HTMLInputElement>("[data-input]")?.focus();
      }
    }
    protected async addChatVariant(
      ...args: Parameters<
        InstanceType<typeof deps.ChatWidget>["addChatVariant"]
      >
    ) {
      return this.cartInteraction(() =>
        this.undo.perform(() => super.addChatVariant(...args)),
      );
    }
    protected async changeChatLine(
      ...args: Parameters<typeof deps.mutateShopifyCart>
    ) {
      return this.cartInteraction(() =>
        this.undo.perform(() => super.changeChatLine(...args)),
      );
    }
    protected persistConversation() {
      experience.memory.messages = this.messages.slice(-20).map((message) => ({
        ...message,
        productCards: message.productCards?.slice(0, 4),
      }));
    }
    protected restoreConversation(): Message[] {
      return experience.memory.messages.map((message) => ({ ...message }));
    }
    destroy() {
      this.release?.();
      this.undo.destroy();
      super.destroy();
    }
  })();
};
