import { BaseWidget, text, type WidgetPayload } from "./BaseWidget";

type Message = { role: "user" | "assistant"; content: string };

export class ChatWidget extends BaseWidget {
  private messages: Message[] = [];
  private expanded = false;
  private sending = false;

  constructor(payload: WidgetPayload) {
    super(payload);
    const copy = payload.copy as Record<string, unknown> | undefined;
    this.messages.push({
      role: "assistant",
      content: String(copy?.greeting || payload.greeting || "Hi. Can I help you find the perfect product today?"),
    });
  }

  getWidgetType(): string {
    return "chat";
  }

  render(): void {
    const copy = (this.payload.copy || {}) as Record<string, unknown>;

    this.html(`
      <style>
        .wrap {
          position: fixed;
          left: 18px;
          bottom: 18px;
          z-index: 9999;
          width: min(320px, calc(100vw - 36px));
          transform: translateY(100%);
          animation: in 200ms ease-out forwards;
        }
        @keyframes in { to { transform: translateY(0); } }
        @keyframes dots { 0%, 80%, 100% { opacity: .25; } 40% { opacity: 1; } }
        .head { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
        .messages { display: grid; gap: 8px; max-height: 330px; overflow: auto; padding: 12px 0; }
        .bubble { max-width: 88%; border-radius: 8px; padding: 9px 10px; font-size: 13px; line-height: 1.4; white-space: pre-wrap; }
        .assistant { background: #f3f4f6; justify-self: start; }
        .user { background: #111827; color: #fff; justify-self: end; }
        .compose { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; }
        input { min-width: 0; border: 1px solid var(--aovboost-line); border-radius: 8px; padding: 9px 10px; }
        .dots span { animation: dots 1.2s infinite; }
        .dots span:nth-child(2) { animation-delay: .15s; }
        .dots span:nth-child(3) { animation-delay: .3s; }
        .inline-product { margin-top: 6px; border: 1px solid var(--aovboost-line); border-radius: 8px; padding: 8px; }
      </style>
      <aside class="wrap card" aria-label="AOVBoost Assistant">
        <div class="head">
          <h3 class="title">AOVBoost Assistant</h3>
          <button type="button" class="icon" data-close aria-label="Close">x</button>
        </div>
        ${
          this.expanded
            ? this.renderChatUi()
            : `<p class="body">${text(copy.greeting || this.messages[0].content)}</p>
              <div class="actions">
                <button type="button" class="primary" data-expand>${text(copy.ctaAccept || "Chat with AI")}</button>
                <button type="button" class="secondary" data-dismiss>${text(copy.ctaDecline || "Browse myself")}</button>
              </div>`
        }
      </aside>
    `);

    this.root.querySelector("[data-close]")?.addEventListener("click", () => this.dismiss());
    this.root.querySelector("[data-dismiss]")?.addEventListener("click", () => this.dismiss());
    this.root.querySelector("[data-expand]")?.addEventListener("click", () => {
      this.expanded = true;
      this.trackClick("open_chat");
      this.render();
    });
    this.root.querySelector("[data-send]")?.addEventListener("click", () => this.sendMessage());
    this.root.querySelector("input")?.addEventListener("keydown", (event) => {
      if ((event as KeyboardEvent).key === "Enter") {
        event.preventDefault();
        this.sendMessage();
      }
    });
    this.scrollToBottom();
  }

  private renderChatUi() {
    return `
      <div class="messages" data-messages>
        ${this.messages.map((message) => this.renderMessage(message)).join("")}
      </div>
      <div class="compose">
        <input type="text" placeholder="Ask me anything" data-input>
        <button type="button" class="primary" data-send>Send</button>
      </div>
    `;
  }

  private renderMessage(message: Message) {
    return `
      <div class="bubble ${message.role}">
        ${text(message.content)}
        ${this.renderProductLinks(message.content)}
      </div>
    `;
  }

  private renderProductLinks(content: string) {
    const match = content.match(/\/products\/([a-z0-9-]+)/i);
    if (!match) return "";
    const handle = match[1];
    return `
      <div class="inline-product">
        <p class="product-name">${text(handle.replace(/-/g, " "))}</p>
        <a href="/products/${text(handle)}">View product</a>
      </div>
    `;
  }

  private appendMessage(message: Message): HTMLDivElement {
    const container = this.root.querySelector("[data-messages]");
    if (!container) throw new Error("Messages container not found");
    const el = document.createElement("div");
    el.className = `bubble ${message.role}`;
    el.textContent = message.content;
    container.appendChild(el);
    this.scrollToBottom();
    return el;
  }

  private async sendMessage() {
    if (this.sending) return;

    const input = this.root.querySelector("[data-input]") as HTMLInputElement | null;
    const button = this.root.querySelector("[data-send]") as HTMLButtonElement | null;
    const value = input?.value.trim();
    if (!value) return;

    this.sending = true;
    if (button) button.disabled = true;
    input!.value = "";
    this.messages.push({ role: "user", content: value });
    this.appendMessage({ role: "user", content: value });
    this.trackClick("send_message");

    const assistantIndex = this.messages.push({ role: "assistant", content: "" }) - 1;
    const assistantEl = this.appendMessage({ role: "assistant", content: "" });
    this.showTyping();

    try {
      const config = (window as any).AOVBoost || {};
      const sdk = (window as any).AOVBoostSDK;
      const apiBase = (config.apiBase || "/apps/aovboost").replace(/\/$/, "");
      const response = await fetch(`${apiBase}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AOVBoost-Shop": sdk?.shop || config.shop || "",
        },
        body: JSON.stringify({
          sessionId: sdk?.sessionId,
          shop: sdk?.shop || config.shop,
          message: value,
          messageHistory: this.messages.slice(0, -2),
        }),
      });

      if (!response.ok) throw new Error(`Server returned ${response.status}`);
      if (!response.body) throw new Error("Missing stream body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let started = false;

      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.delta) {
              if (!started) {
                this.removeTyping();
                started = true;
              }
              this.messages[assistantIndex].content += parsed.delta;
              assistantEl.textContent = this.messages[assistantIndex].content;
              this.updateProductLink(this.messages[assistantIndex].content, assistantEl);
              this.scrollToBottom();
            }
          } catch {
            // Skip malformed SSE chunks.
          }
        }
      }

      if (!started) {
        this.removeTyping();
        if (!this.messages[assistantIndex].content) {
          this.messages[assistantIndex].content = "I can help you compare products and find the right add-ons.";
          assistantEl.textContent = this.messages[assistantIndex].content;
        }
      }
    } catch {
      this.removeTyping();
      this.messages[assistantIndex].content =
        this.messages[assistantIndex].content ||
        "I had trouble connecting. Please try again in a moment.";
      assistantEl.textContent = this.messages[assistantIndex].content;
    } finally {
      this.sending = false;
      if (button) button.disabled = false;
    }
  }

  private showTyping() {
    const container = this.root.querySelector("[data-messages]");
    if (!container) return;
    const el = document.createElement("div");
    el.className = "bubble assistant dots";
    el.dataset.typing = "true";
    el.innerHTML = "<span>.</span><span>.</span><span>.</span>";
    container.appendChild(el);
    this.scrollToBottom();
  }

  private removeTyping() {
    const el = this.root.querySelector("[data-typing]");
    if (el) el.remove();
  }

  private updateProductLink(content: string, container: HTMLElement) {
    const match = content.match(/\/products\/([a-z0-9-]+)/i);
    const existing = container.querySelector(".inline-product");
    if (existing) existing.remove();
    if (!match) return;
    const handle = match[1];
    const div = document.createElement("div");
    div.className = "inline-product";
    div.innerHTML = `
      <p class="product-name">${text(handle.replace(/-/g, " "))}</p>
      <a href="/products/${text(handle)}">View product</a>
    `;
    container.appendChild(div);
  }

  private scrollToBottom() {
    const container = this.root.querySelector("[data-messages]");
    if (container) container.scrollTop = container.scrollHeight;
  }

  private dismiss() {
    this.trackDismiss();
    this.container.animate(
      [{ transform: "translateY(0)" }, { transform: "translateY(120%)" }],
      { duration: 180, easing: "ease-in", fill: "forwards" },
    );
    window.setTimeout(() => this.destroy(), 190);
  }
}
