import { AGENT_LIMITS as L } from "./constants";

const EXCLUDED =
  "product-recommendations,.related-products,.recommendations,.product-card,[data-product-card],[data-product-recommendations],quick-add-modal,[data-quick-add],[data-aovboost-widget],header,footer,nav,[hidden],[inert],[aria-hidden='true']";
const INFO =
  "product-info,[data-product-info],[data-product-details],.product__info-container,.product-single__meta,[id^='MainProduct-'],[data-main-product]";

/** Read only the primary purchase area; recommendation prices are not PDP prices. */
export function productDom() {
  const main = document.querySelector<HTMLElement>(
    "main,#MainContent,[role='main']",
  );
  const title =
    main?.querySelector("h1")?.textContent?.trim().slice(0, 160) || "";
  const forms = [
    ...(main?.querySelectorAll<HTMLFormElement>(
      "form[action*='/cart/add']:not([id*='installment'])",
    ) || []),
  ].filter((form) => !form.closest(EXCLUDED));
  const scoped = forms.filter((form) => form.closest(INFO));
  const primary = scoped.length ? scoped : forms;
  const form = primary[0];
  const variants = new Set(
    primary
      .map((form) => form.querySelector<HTMLInputElement>("[name='id']")?.value)
      .filter((value) => /^\d+$/.test(value || "")),
  );
  const scope = form?.closest<HTMLElement>(INFO) || main;
  const prices = [
    ...(scope?.querySelectorAll<HTMLElement>(
      "[data-product-price],[data-price],[itemprop='price'],[class*='price' i],[id*='price' i]",
    ) || []),
  ]
    .filter(
      (price) =>
        !price.closest(EXCLUDED) &&
        (!form ||
          scope !== main ||
          form.contains(price) ||
          Boolean(
            price.compareDocumentPosition(form) &
            Node.DOCUMENT_POSITION_FOLLOWING,
          )),
    )
    .slice(0, 40);
  return {
    title,
    variantId: variants.size === 1 ? [...variants][0] : undefined,
    prices,
  };
}

/** Accumulate visible-price time, including prices inserted/replaced by the theme. */
export class ProductHesitation {
  private elapsed = 0;
  private since?: number;
  private done = true;
  private threshold: number = L.HESITATION_DWELL_MS;
  private timer?: ReturnType<typeof setTimeout>;
  private listeners = new AbortController();
  private observer = new MutationObserver(() => this.refresh());
  constructor(
    private allowed: () => boolean,
    private fire: (elapsed: number) => void,
  ) {
    const options = { signal: this.listeners.signal, passive: true };
    window.addEventListener("scroll", this.refresh, {
      ...options,
      capture: true,
    });
    window.addEventListener("resize", this.refresh, options);
    document.addEventListener("visibilitychange", this.refresh, options);
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "aria-hidden"],
    });
  }
  reset(returning = false) {
    this.stop();
    this.done = false;
    this.threshold = returning ? 0 : L.HESITATION_DWELL_MS;
    this.refresh();
  }
  stop() {
    clearTimeout(this.timer);
    this.elapsed = 0;
    this.since = undefined;
    this.done = true;
  }
  refresh = () => {
    clearTimeout(this.timer);
    if (this.done) return;
    const now = Date.now();
    if (this.since !== undefined) this.elapsed += Math.max(0, now - this.since);
    this.since = undefined;
    if (document.visibilityState === "hidden" || !this.allowed()) return;
    const visible = productDom().prices.some((price) => {
      const rect = price.getBoundingClientRect(),
        style = getComputedStyle(price);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.top < innerHeight &&
        style.display !== "none" &&
        style.visibility !== "hidden"
      );
    });
    if (!visible) return;
    if (this.elapsed >= this.threshold) {
      this.done = true;
      this.fire(this.elapsed);
    } else {
      this.since = now;
      this.timer = setTimeout(this.refresh, this.threshold - this.elapsed);
    }
  };
  destroy() {
    this.stop();
    this.listeners.abort();
    this.observer.disconnect();
  }
}
