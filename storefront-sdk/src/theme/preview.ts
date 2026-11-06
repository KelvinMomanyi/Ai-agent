import { PREVIEW_STORAGE_KEY, readThemeIdentity } from "./identity";
import { createThemeEngine } from "./engine";
import { readShopifyCart as readCart } from "../cartState";
import { cartUrl } from "../shopifyCart";
type PreviewOptions = { shop: string; apiBase: string; token: string };
export async function runThemePreview(options: PreviewOptions) {
  const identity = readThemeIdentity();
  const url = new URL(location.href);
  url.searchParams.delete("aovboost_preview");
  history.replaceState(history.state, "", url);
  const panel = document.createElement("aside");
  panel.setAttribute("aria-label", "AOVBoost theme test");
  panel.style.cssText =
    "position:fixed;bottom:16px;left:16px;z-index:9991;max-width:320px;background:white;color:#171717;border:1px solid #777;border-radius:8px;padding:16px;font:16px system-ui";
  const message = document.createElement("p");
  message.setAttribute("role", "status");
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Run one test add";
  panel.append(message, button);
  document.body.append(panel);
  const api = async (intent: string, data: Record<string, unknown>) => {
    const response = await fetch(`${options.apiBase}/theme-preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: options.token, intent, ...data }),
    });
    if (!response.ok) throw new Error("Preview unavailable");
    return response.json();
  };
  let saved: any;
  try {
    saved = JSON.parse(sessionStorage.getItem(PREVIEW_STORAGE_KEY) || "null");
  } catch {
    /* Start a fresh explicitly signed preview. */
  }
  const store = () =>
    sessionStorage.setItem(PREVIEW_STORAGE_KEY, JSON.stringify(saved));
  const finish = async () => {
    const variant = String(saved.variantId || "");
    let confirmed = false;
    for (let count = 0; count < 5; count++) {
      const cart = await readCart();
      const qty =
        cart?.cartItems
          .filter((item) => String(item.variantId).split("/").pop() === variant)
          .reduce((sum, item) => sum + item.quantity, 0) || 0;
      if (qty > saved.before) {
        confirmed = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    const engine = createThemeEngine({
      identity,
      config: saved.data.config,
      report: () => {},
    });
    let outcome: Awaited<ReturnType<typeof engine.mount>> = {
      strategy: "none",
      verified: false,
      reason: "test_add_unconfirmed",
    };
    if (
      confirmed &&
      saved.data.config.preference === "cart_page" &&
      !/\/cart\/?$/.test(location.pathname)
    ) {
      location.assign(cartUrl("read").replace(/\.js$/, ""));
      return;
    }
    if (confirmed)
      outcome = await engine.mount({
        ...saved.data.payload,
        previewMode: true,
        mutationId: "preview",
      });
    await api("report", {
      report: {
        identity,
        attemptId: "preview",
        ...outcome,
        cartUi:
          outcome.cartUi ||
          (location.pathname.includes("/cart") ? "page_redirect" : "unknown"),
      },
    });
    sessionStorage.removeItem(PREVIEW_STORAGE_KEY);
    button.remove();
    message.textContent = outcome.verified
      ? "Test complete: a recommendation card was verified. Return to AOVBoost for the result."
      : "The test could not verify a display. Return to AOVBoost for guidance.";
    window.addEventListener("pagehide", () => engine.destroy(), { once: true });
  };
  try {
    if (
      saved?.token === options.token &&
      saved?.started &&
      saved.expires > Date.now()
    ) {
      button.remove();
      message.textContent = "Checking the test add…";
      await finish();
      return;
    }
    const data = await api("bootstrap", { identity });
    saved = {
      token: options.token,
      expires: Date.now() + 300000,
      data,
      started: false,
    };
    store();
    message.textContent =
      "This test adds one item using your store's own product form. The item stays in your cart. No shopper analytics are recorded.";
    button.addEventListener(
      "click",
      async () => {
        button.disabled = true;
        try {
          const forms = [
            ...document.querySelectorAll<HTMLFormElement>(
              "form[action*='/cart/add']",
            ),
          ].filter((form) => {
            const field = form.elements.namedItem(
              "id",
            ) as HTMLInputElement | null;
            return data.source.variantIds.some(
              (id: string) => id.split("/").pop() === String(field?.value),
            );
          });
          if (forms.length !== 1)
            throw new Error("No unambiguous native product form");
          const form = forms[0],
            field = form.elements.namedItem("id") as HTMLInputElement;
          const quantity = form.elements.namedItem(
            "quantity",
          ) as HTMLInputElement | null;
          if (quantity && Number(quantity.value) !== 1)
            throw new Error(
              "Set the native product quantity to one, then create a new test link",
            );
          const cart = await readCart();
          if (!cart) throw new Error("Cart could not be read");
          saved.before = cart.cartItems
            .filter(
              (item) => String(item.variantId).split("/").pop() === field.value,
            )
            .reduce((sum, item) => sum + item.quantity, 0);
          saved.variantId = field.value;
          saved.started = true;
          store();
          message.textContent =
            "Running the native add and checking placement…";
          const submitter = form.querySelector<HTMLButtonElement>(
            "button[name='add'],button[type='submit']",
          );
          form.requestSubmit(submitter || undefined);
          await finish();
        } catch {
          sessionStorage.removeItem(PREVIEW_STORAGE_KEY);
          message.textContent =
            "The native add or display could not be verified. Check the product form and create a new test link in AOVBoost.";
        }
      },
      { once: true },
    );
  } catch {
    sessionStorage.removeItem(PREVIEW_STORAGE_KEY);
    button.remove();
    message.textContent =
      "Preview expired or unavailable. Create a new test link in AOVBoost.";
  }
}
