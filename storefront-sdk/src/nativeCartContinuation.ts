import { newMutationId, readShopifyCart, type CartSnapshot } from "./cartState";
import { hasTrackingConsent } from "./consent";

export const NATIVE_CART_INTENT_KEY = "aovboost_native_cart_add:v1";
export const NATIVE_CART_INTENT_TTL_MS = 30_000;
export const NATIVE_CART_BASELINE_TTL_MS = 60_000;
export const NATIVE_CART_REFRESH_MS = 5_000;
const MAX_INTENT_BYTES = 24_000;
type Identity = { shop: string; sessionId: string };
type CartState = {
  quantities: Array<[string, number]>;
  count: number;
  currency: string;
};
type Intent = Identity & {
  mutationId: string;
  sourcePath: string;
  createdAt: number;
  armed: boolean;
  variantId: string;
  quantity: number;
  before: CartState;
};

function cartState(cart: CartSnapshot): CartState | null {
  if (cart.cartItems.length > 100 || !/^[A-Z]{3}$/.test(cart.currency))
    return null;
  const quantities = new Map<string, number>();
  for (const item of cart.cartItems) {
    if (
      !/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(item.variantId) ||
      !Number.isSafeInteger(item.quantity) ||
      item.quantity < 0
    )
      return null;
    quantities.set(
      item.variantId,
      (quantities.get(item.variantId) || 0) + item.quantity,
    );
  }
  const count = [...quantities.values()].reduce(
    (sum, quantity) => sum + quantity,
    0,
  );
  return count === cart.cartItemCount && Number.isSafeInteger(count)
    ? { quantities: [...quantities], count, currency: cart.currency }
    : null;
}

function nativeForm(form: HTMLFormElement, submitter?: HTMLElement | null) {
  const action = new URL(
    submitter?.getAttribute("formaction") || form.action,
    document.baseURI,
  );
  const method = submitter?.getAttribute("formmethod") || form.method;
  const target =
    submitter?.getAttribute("formtarget") ??
    form.getAttribute("target") ??
    document.querySelector("base[target]")?.getAttribute("target") ??
    "";
  return (
    action.origin === location.origin &&
    /\/cart\/add\/?$/.test(action.pathname) &&
    !action.searchParams.has("id") &&
    method.toLowerCase() === "post" &&
    ["", "_self"].includes(target.toLowerCase())
  );
}

// FormData(form) fires a formdata event. Observe successful controls without
// invoking theme handlers, collecting only fields needed for confirmation.
function nativeFields(form: HTMLFormElement, submitter: HTMLElement | null) {
  if (form.elements.length > 500) return null;
  const fields = new URLSearchParams();
  const relevant = (name: string) =>
    name === "id" ||
    name === "quantity" ||
    name.startsWith("items[") ||
    name.includes("_aovboost_offer_id");
  for (const control of Array.from(form.elements)) {
    if (
      !(
        control instanceof HTMLInputElement ||
        control instanceof HTMLSelectElement ||
        control instanceof HTMLTextAreaElement
      ) ||
      !relevant(control.name) ||
      control.matches(":disabled")
    )
      continue;
    if (
      control instanceof HTMLInputElement &&
      (/^(?:submit|button|image|reset|file)$/.test(control.type) ||
        (/^(?:checkbox|radio)$/.test(control.type) && !control.checked))
    )
      continue;
    if (control instanceof HTMLSelectElement) {
      for (const option of Array.from(control.selectedOptions))
        if (!option.disabled && !option.closest("optgroup[disabled]"))
          fields.append(control.name, option.value);
    } else fields.append(control.name, control.value);
  }
  if (
    (submitter instanceof HTMLButtonElement ||
      submitter instanceof HTMLInputElement) &&
    relevant(submitter.name) &&
    !submitter.matches(":disabled")
  )
    fields.append(submitter.name, submitter.value);
  return fields;
}

/** Passive observation only: never submit, preventDefault, await or retry a cart write. */
export class NativeCartContinuation {
  private listeners = new AbortController();
  private baseline: { state: CartState; at: number } | null = null;
  private pending: Intent | null = null;
  private ownMutation = "";
  private reading = false;
  private readVersion = 0;
  private refreshedAt = -Infinity;
  constructor(private identity: () => Identity | null) {}

  init() {
    // Consume before any asynchronous read. Reloads and failed reads cannot replay it.
    const saved = this.read();
    this.remove();
    try {
      const referrer = new URL(document.referrer);
      if (
        saved?.armed &&
        this.owns(saved) &&
        this.fresh(saved) &&
        /\/cart\/?$/.test(location.pathname) &&
        referrer.origin === location.origin &&
        referrer.pathname === saved.sourcePath
      )
        this.pending = saved;
    } catch {
      /* Missing referrer is insufficient evidence of a native redirect. */
    }
    document.addEventListener("submit", this.onSubmit, {
      capture: true,
      passive: true,
      signal: this.listeners.signal,
    });
    for (const name of ["focusin", "pointerover"])
      document.addEventListener(name, this.onInterest, {
        passive: true,
        signal: this.listeners.signal,
      });
    window.addEventListener("pagehide", this.onPageHide, {
      signal: this.listeners.signal,
    });
    window.addEventListener("pageshow", this.onPageShow, {
      signal: this.listeners.signal,
    });
  }

  remember(cart: CartSnapshot) {
    this.readVersion++;
    const state = cartState(cart);
    this.baseline = state ? { state, at: Date.now() } : null;
  }

  cancel() {
    this.readVersion++;
    this.baseline = null;
    this.pending = null;
    if (this.ownMutation && this.read()?.mutationId === this.ownMutation)
      this.remove();
    this.ownMutation = "";
  }

  confirm(cart: CartSnapshot): Record<string, unknown> | null {
    const intent = this.pending;
    this.pending = null;
    if (
      !intent ||
      !this.owns(intent) ||
      !this.fresh(intent) ||
      !hasTrackingConsent(window.AOVBoost || {})
    )
      return null;
    const after = cartState(cart);
    if (
      !after ||
      after.currency !== intent.before.currency ||
      after.count !== intent.before.count + intent.quantity
    )
      return null;
    const expected = new Map(intent.before.quantities);
    expected.set(
      intent.variantId,
      (expected.get(intent.variantId) || 0) + intent.quantity,
    );
    if (
      expected.size !== after.quantities.length ||
      after.quantities.some(([id, quantity]) => expected.get(id) !== quantity)
    )
      return null;
    const source = cart.cartItems.find(
      (item) => item.variantId === intent.variantId,
    );
    if (!source || !/^gid:\/\/shopify\/Product\/\d+$/.test(source.productId))
      return null;
    return {
      productId: source.productId,
      variantId: intent.variantId,
      quantity: intent.quantity,
      mutationId: intent.mutationId,
      confirmed: true,
      recommendationOrigin: false,
      source: "verified_native_form_redirect",
    };
  }

  destroy() {
    this.listeners.abort();
    this.readVersion++;
    this.pending = null;
    const saved = this.read();
    if (saved?.mutationId === this.ownMutation && !saved.armed) this.remove();
  }

  private onSubmit = (event: Event) => {
    const baseline = this.lastBaseline;
    this.cancel();
    try {
      const form = event.target;
      if (
        !(form instanceof HTMLFormElement) ||
        event.defaultPrevented ||
        !nativeForm(form, (event as SubmitEvent).submitter) ||
        !hasTrackingConsent(window.AOVBoost || {})
      )
        return;
      const owner = this.identity();
      if (!owner || !baseline) return;
      const data = nativeFields(form, (event as SubmitEvent).submitter);
      if (!data) return;
      if (
        [...data.keys()].some(
          (key) =>
            key.startsWith("items[") ||
            (key.includes("_aovboost_offer_id") && data.get(key)),
        )
      )
        return;
      if (data.getAll("id").length !== 1 || data.getAll("quantity").length > 1)
        return;
      const variant = String(data.get("id")),
        quantity = Number(data.get("quantity") ?? 1);
      if (
        !/^\d{1,30}$/.test(variant) ||
        !Number.isSafeInteger(quantity) ||
        quantity < 1 ||
        quantity > 100
      )
        return;
      const intent: Intent = {
        ...owner,
        mutationId: newMutationId(),
        sourcePath: location.pathname,
        createdAt: Date.now(),
        armed: false,
        variantId: `gid://shopify/ProductVariant/${variant}`,
        quantity,
        before: baseline.state,
      };
      this.ownMutation = intent.mutationId;
      this.write(intent);
      queueMicrotask(() => {
        if (event.defaultPrevented && this.ownMutation === intent.mutationId)
          this.cancel();
      });
    } catch {
      /* Storage or unsupported forms never affect the theme submission. */
    }
  };

  private get lastBaseline() {
    return this.baseline &&
      Date.now() - this.baseline.at <= NATIVE_CART_BASELINE_TTL_MS
      ? this.baseline
      : null;
  }

  private onInterest = (event: Event) => {
    const form =
      event.target instanceof Element ? event.target.closest("form") : null;
    try {
      if (
        !form ||
        !nativeForm(form) ||
        this.reading ||
        Date.now() -
          Math.max(this.refreshedAt, this.baseline?.at ?? -Infinity) <
          NATIVE_CART_REFRESH_MS ||
        !hasTrackingConsent(window.AOVBoost || {})
      )
        return;
      this.reading = true;
      this.refreshedAt = Date.now();
      const version = ++this.readVersion;
      void readShopifyCart()
        .then((cart) => {
          if (version === this.readVersion && !this.listeners.signal.aborted) {
            if (cart) this.remember(cart);
            else this.baseline = null;
          }
        })
        .finally(() => {
          this.reading = false;
        });
    } catch {
      /* Interest observation is optional. */
    }
  };

  private onPageHide = () => {
    const intent = this.read();
    if (
      intent &&
      intent.mutationId === this.ownMutation &&
      this.owns(intent) &&
      this.fresh(intent)
    )
      this.write({ ...intent, armed: true });
  };
  private onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) this.cancel();
  };
  private owns(intent: Intent) {
    const owner = this.identity();
    return owner?.shop === intent.shop && owner.sessionId === intent.sessionId;
  }
  private fresh(intent: Intent) {
    return (
      Number.isFinite(intent.createdAt) &&
      intent.createdAt <= Date.now() &&
      Date.now() - intent.createdAt <= NATIVE_CART_INTENT_TTL_MS
    );
  }
  private read(): Intent | null {
    try {
      const raw = sessionStorage.getItem(NATIVE_CART_INTENT_KEY);
      if (!raw || raw.length > MAX_INTENT_BYTES) return null;
      const v = JSON.parse(raw) as Intent;
      if (
        typeof v.shop !== "string" ||
        typeof v.sessionId !== "string" ||
        !/^[\w-]{1,100}$/.test(v.mutationId) ||
        typeof v.sourcePath !== "string" ||
        typeof v.armed !== "boolean" ||
        !/^gid:\/\/shopify\/ProductVariant\/\d{1,30}$/.test(v.variantId) ||
        !Number.isSafeInteger(v.quantity) ||
        v.quantity < 1 ||
        v.quantity > 100 ||
        !v.before ||
        !Array.isArray(v.before.quantities) ||
        v.before.quantities.length > 100 ||
        !Number.isSafeInteger(v.before.count) ||
        v.before.count < 0 ||
        !/^[A-Z]{3}$/.test(v.before.currency) ||
        v.before.quantities.some(
          (entry) =>
            !Array.isArray(entry) ||
            entry.length !== 2 ||
            !/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(entry[0]) ||
            !Number.isSafeInteger(entry[1]) ||
            entry[1] < 0,
        ) ||
        new Set(v.before.quantities.map(([id]) => id)).size !==
          v.before.quantities.length ||
        v.before.quantities.reduce((sum, [, n]) => sum + n, 0) !==
          v.before.count
      )
        return null;
      return v;
    } catch {
      return null;
    }
  }
  private write(intent: Intent) {
    try {
      const raw = JSON.stringify(intent);
      if (raw.length <= MAX_INTENT_BYTES)
        sessionStorage.setItem(NATIVE_CART_INTENT_KEY, raw);
    } catch {
      /* Storage denial disables continuation only. */
    }
  }
  private remove() {
    try {
      sessionStorage.removeItem(NATIVE_CART_INTENT_KEY);
    } catch {
      /* No cart dependency on storage. */
    }
  }
}
