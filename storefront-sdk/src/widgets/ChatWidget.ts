import { BaseWidget, text, type WidgetPayload } from "./BaseWidget";

type Message = { role: "user" | "assistant"; content: string };

export class ChatWidget extends BaseWidget {
  private messages: Message[] = [];
  private expanded = false;

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
      if ((event as KeyboardEvent).key === "Enter") this.sendMessage();
    });
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

  private async sendMessage() {
    const input = this.root.querySelector("[data-input]") as HTMLInputElement | null;
    const value = input?.value.trim();
    if (!value) return;

    input!.value = "";
    this.messages.push({ role: "user", content: value });
    const assistantIndex = this.messages.push({ role: "assistant", content: "" }) - 1;
    this.render();
    this.showTyping();
    this.trackClick("send_message");

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
          messageHistory: this.messages.slice(0, -1),
        }),
      });

      if (!response.body) throw new Error("Missing stream body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

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
              this.messages[assistantIndex].content += parsed.delta;
              this.render();
            }
          } catch {
            // Skip malformed SSE chunks.
          }
        }
      }
    } catch {
      this.messages[assistantIndex].content =
        this.messages[assistantIndex].content ||
        "I had trouble connecting. Please try again in a moment.";
      this.render();
    }
  }

  private showTyping() {
    const messages = this.root.querySelector("[data-messages]");
    if (!messages) return;
    const typing = document.createElement("div");
    typing.className = "bubble assistant dots";
    typing.innerHTML = "<span>.</span><span>.</span><span>.</span>";
    messages.appendChild(typing);
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
