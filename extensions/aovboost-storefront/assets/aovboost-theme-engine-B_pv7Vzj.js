var ce = Object.defineProperty;
var de = (r, e, t) => e in r ? ce(r, e, { enumerable: !0, configurable: !0, writable: !0, value: t }) : r[e] = t;
var S = (r, e, t) => de(r, typeof e != "symbol" ? e + "" : e, t);
function le(r) {
  const e = r && typeof r == "object" ? r : {}, t = (o, a) => typeof o == "string" ? o.replace(/\p{Cc}/gu, "").slice(0, a) : "";
  return {
    themeId: /^\d{1,20}$/.test(String(e.themeId)) ? String(e.themeId) : "unknown",
    themeName: t(e.themeName, 100) || "Unknown theme",
    ...t(e.schemaName, 80) ? { schemaName: t(e.schemaName, 80) } : {},
    .../^\d{1,12}$/.test(String(e.themeStoreId)) ? { themeStoreId: String(e.themeStoreId) } : {},
    ...["main", "unpublished", "demo", "development"].includes(String(e.role)) ? { role: String(e.role) } : {}
  };
}
function D(r) {
  return typeof r == "string" && r.length <= 160 && r.split(" ").length <= 3 && /^(?:[.#][a-zA-Z][\w-]{0,63}|[a-z][a-z0-9]*-[a-z0-9-]+)(?: (?:[.#][a-zA-Z][\w-]{0,63}|[a-z][a-z0-9]*-[a-z0-9-]+)){0,2}$/.test(
    r
  );
}
const Y = "aovboost_dismissed_widgets";
function ue(r) {
  const e = Number(r);
  return Number.isFinite(e) ? Math.max(1, Math.min(4, Math.floor(e))) : 2;
}
function C(r) {
  if (!r.isConnected || r.closest(
    "[hidden], [inert], [aria-hidden='true'], details:not([open])"
  ))
    return !1;
  for (let e = r; e; e = e.parentElement) {
    const t = getComputedStyle(e);
    if (t.display === "none" || ["hidden", "collapse"].includes(t.visibility) || t.opacity === "0" || t.contentVisibility === "hidden" || e.matches("cart-drawer") && !e.matches(".active, [open]"))
      return !1;
  }
  return !0;
}
function z(r) {
  const t = window.Shopify?.routes?.root || "/";
  return `${/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(t) ? t : "/"}cart${r === "read" ? "" : `/${r}`}.js`;
}
async function pe(r, e) {
  const t = Array.from(
    document.querySelectorAll("cart-drawer")
  ).find(
    (d) => d.querySelector("#CartDrawer .drawer__inner[role='dialog']")
  ) || null, o = !!t?.contains(document.activeElement), a = !!t?.matches(".active, [open]"), n = document.activeElement?.matches(
    "button[name='checkout']"
  ), i = [
    "cart-icon-bubble",
    "cart-drawer",
    "main-cart-items",
    "main-cart-footer"
  ].filter(
    (d) => document.getElementById(d) || document.getElementById(`shopify-section-${d}`) || d === "cart-drawer" && t
  ), s = new AbortController(), c = window.setTimeout(() => s.abort(), 15e3);
  try {
    const d = await fetch(z(r), {
      method: "POST",
      credentials: "same-origin",
      signal: s.signal,
      headers: {
        "Content-Type": "application/json",
        "X-AOVBoost-Recommendation": "1"
      },
      body: JSON.stringify({
        ...e,
        ...i.length ? { sections: i, sections_url: window.location.pathname } : {}
      })
    });
    if (!d.ok) return null;
    const l = await d.json();
    try {
      let f = !1;
      if (t?.renderContents && (t.getSectionsToRender?.() || [{ id: "cart-drawer" }]).every(
        ({ id: p }) => typeof l.sections?.[p] == "string"
      ))
        try {
          t.renderContents(l), f = !0;
        } catch {
        }
      for (const p of i) {
        if (p === "cart-drawer" && f) continue;
        const h = l.sections?.[p];
        if (typeof h != "string") continue;
        const g = new DOMParser().parseFromString(h, "text/html"), v = (p === "cart-drawer" ? t?.querySelector("#CartDrawer") : null) || document.getElementById(p) || document.getElementById(`shopify-section-${p}`), b = v && g.getElementById(v.id);
        v && b && (v.innerHTML = b.innerHTML), p === "cart-drawer" && t?.close && t.querySelector("#CartDrawer-Overlay")?.addEventListener("click", () => t.close?.());
      }
      if (o && a && t?.isConnected && (document.activeElement === document.body || t.contains(document.activeElement))) {
        const p = t.querySelector(
          n ? "button[name='checkout']" : ".drawer__close"
        ) || t.querySelector("button"), h = t.querySelector("#CartDrawer"), g = window.trapFocus;
        p && h && (typeof g == "function" ? g(h, p) : p.focus());
      }
      document.dispatchEvent(
        new CustomEvent("aovboost:cart-updated", { detail: l })
      );
    } catch {
    }
    return l;
  } finally {
    window.clearTimeout(c);
  }
}
const me = "USD";
class fe {
  constructor(e) {
    S(this, "payload");
    S(this, "root");
    S(this, "container");
    S(this, "disposed", !1);
    S(this, "impressionRecorded", !1);
    S(this, "impressionObserver");
    S(this, "impressionListeners");
    this.payload = e, this.container = document.createElement("div"), this.container.setAttribute("data-aovboost-widget", this.getWidgetType()), this.container.dataset.presentation = e.presentation === "inline" ? "inline" : "floating", this.root = this.container.attachShadow({ mode: "open" }), this.injectStyles();
  }
  destroy() {
    this.disposed = !0, this.impressionObserver?.disconnect(), this.impressionListeners?.abort();
    const e = this.container.parentElement;
    this.container.remove(), e?.hasAttribute("data-aovboost-mount") && e.childElementCount === 0 && e.remove();
  }
  isMounted() {
    return this.container.isConnected;
  }
  isDestroyed() {
    return this.disposed;
  }
  getElement() {
    return this.container;
  }
  recordVerifiedImpression(e) {
    this.impressionRecorded || this.disposed || this.payload.previewMode || (this.impressionRecorded = !0, this.track("widget_impression", { strategy: e, verified: !0 }));
  }
  reattach(e) {
    this.disposed || (this.applyInlineTheme(e), e.appendChild(this.container), this.observeImpression());
  }
  mount(e = document.body) {
    this.payload.presentation === "inline" && this.applyInlineTheme(e), e.appendChild(this.container), this.render(), this.container.isConnected && this.observeImpression();
  }
  observeImpression() {
    if (this.payload.verifiedDisplayManaged || this.payload.previewMode || this.impressionRecorded || this.disposed) return;
    this.impressionObserver?.disconnect(), this.impressionListeners?.abort();
    const e = () => {
      if (this.impressionRecorded || this.disposed || document.visibilityState === "hidden" || !C(this.container))
        return;
      const o = this.container.getBoundingClientRect();
      o.width <= 0 || o.height <= 0 || o.bottom <= 0 || o.right <= 0 || o.top >= window.innerHeight || o.left >= window.innerWidth || (this.impressionRecorded = !0, this.trackImpression(), this.impressionObserver?.disconnect(), this.impressionListeners?.abort());
    };
    this.impressionListeners = new AbortController();
    const t = { signal: this.impressionListeners.signal, passive: !0 };
    document.addEventListener("visibilitychange", e, t), window.addEventListener("scroll", e, { ...t, capture: !0 }), window.addEventListener("resize", e, t), typeof IntersectionObserver < "u" ? (this.impressionObserver = new IntersectionObserver(
      (o) => {
        o.some(
          (a) => a.isIntersecting && a.intersectionRatio > 0
        ) && e();
      },
      { threshold: 0.01 }
    ), this.impressionObserver.observe(this.container)) : e();
  }
  applyInlineTheme(e) {
    const t = this.container.style, o = getComputedStyle(e);
    o.color && t.setProperty("--aovboost-ink", o.color), t.setProperty("--aovboost-muted", "var(--aovboost-ink)"), t.setProperty("--aovboost-accent", "var(--aovboost-ink)"), t.setProperty(
      "--aovboost-line",
      "color-mix(in srgb, var(--aovboost-ink) 18%, transparent)"
    );
    for (let n = e; n; n = n.parentElement) {
      const i = getComputedStyle(n).backgroundColor;
      if (i && i !== "transparent" && i !== "rgba(0, 0, 0, 0)") {
        t.setProperty("--aovboost-surface", i);
        break;
      }
    }
    t.setProperty("--aovboost-action", "var(--aovboost-ink)"), t.setProperty("--aovboost-action-text", "var(--aovboost-surface)");
    const a = e.parentElement?.querySelector(
      ".product-form__submit, button[name='add'], button[name='checkout']"
    );
    if (a) {
      const n = getComputedStyle(a);
      n.backgroundColor && n.backgroundColor !== "transparent" && n.backgroundColor !== "rgba(0, 0, 0, 0)" && (t.setProperty("--aovboost-action", n.backgroundColor), t.setProperty("--aovboost-action-text", n.color)), n.borderRadius && t.setProperty("--aovboost-radius", n.borderRadius);
    }
  }
  injectStyles() {
    const e = document.createElement("style");
    e.textContent = Ce, this.root.appendChild(e);
  }
  trackImpression() {
    this.track("widget_impression", {});
  }
  trackClick(e) {
    this.track("widget_click", { action: e });
  }
  trackDismiss() {
    if (!this.payload.previewMode) {
      if (this.track("widget_dismiss", {
        productIds: te(this.payload).map(({ id: e }) => e)
      }), this.getWidgetType() === "chat")
        try {
          sessionStorage.setItem("aovboost_chat_dismissed_session", "true");
        } catch {
        }
      try {
        const e = JSON.parse(localStorage.getItem(Y) || "[]"), o = [
          ...(Array.isArray(e) ? e.filter((a) => typeof a == "object" && a) : []).filter(
            (a) => a.widgetType !== this.getWidgetType()
          ),
          { widgetType: this.getWidgetType(), dismissedAt: Date.now() }
        ];
        localStorage.setItem(Y, JSON.stringify(o));
      } catch {
      }
    }
  }
  track(e, t) {
    if (this.payload.previewMode) return;
    const o = window.AOVBoostSDK?.track, a = {
      type: e,
      widgetType: this.getWidgetType(),
      offerId: this.payload.offerId,
      ...t
    };
    if (typeof o == "function") {
      o(e, a);
      return;
    }
    document.dispatchEvent(
      new CustomEvent("aovboost:track", { detail: a })
    );
  }
  html(e) {
    const t = this.root.querySelector("[data-aovboost-content]");
    t && t.remove();
    const o = document.createElement("div");
    o.setAttribute("data-aovboost-content", "true"), o.innerHTML = e, this.root.appendChild(o);
  }
}
function _(r, e = "") {
  return xe(
    typeof r == "string" && r.trim() ? r : e
  );
}
function F() {
  const r = window.AOVBoost || {}, e = window.Shopify || {}, t = window.ShopifyAnalytics || {}, a = [
    { value: r.currency, source: "aovboost_config" },
    { value: r.currencyCode, source: "aovboost_config" },
    { value: e.currency?.active, source: "shopify_currency" },
    { value: e.checkout?.currency, source: "shopify_checkout" },
    { value: t.meta?.currency, source: "shopify_analytics" }
  ].find(
    (i) => R(i.value, "") !== ""
  );
  return {
    code: R(a?.value),
    source: a?.source || "fallback",
    moneyFormat: L(r.moneyFormat),
    moneyWithCurrencyFormat: L(r.moneyWithCurrencyFormat),
    locale: L(r.locale) || document.documentElement.lang || navigator.language
  };
}
function K(r, e = F()) {
  const t = Number(r || 0);
  if (!Number.isFinite(t)) return "";
  const o = he(e), a = o.moneyFormat || o.moneyWithCurrencyFormat || "";
  if (a)
    return ye(t, a, o.code);
  try {
    return new Intl.NumberFormat(o.locale || void 0, {
      style: "currency",
      currency: o.code,
      currencyDisplay: "symbol"
    }).format(t);
  } catch {
    return `${o.code} ${t.toFixed(2)}`.trim();
  }
}
function he(r) {
  if (typeof r == "string")
    return {
      ...F(),
      code: R(r)
    };
  const e = F();
  return {
    ...e,
    ...r,
    code: r.code === void 0 ? e.code : R(r.code)
  };
}
function R(r, e = me) {
  const t = String(r || "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(t) ? t : e;
}
function L(r) {
  return typeof r == "string" && r.trim() ? r.trim() : "";
}
function ye(r, e, t) {
  const o = ge(e), a = o.match(/\{\{\s*(amount[a-z_]*)\s*\}\}/i), n = a?.[1] || "amount", i = be(r, n);
  return (a ? o.replace(a[0], i) : `${o}${i}`).replace(/\{\{\s*currency\s*\}\}/gi, t);
}
function be(r, e) {
  switch (e) {
    case "amount_no_decimals":
      return T(r, 0, ",", ".");
    case "amount_with_comma_separator":
      return T(r, 2, ".", ",");
    case "amount_no_decimals_with_comma_separator":
      return T(r, 0, ".", ",");
    case "amount_with_apostrophe_separator":
      return T(r, 2, "'", ".");
    case "amount_no_decimals_with_space_separator":
      return T(r, 0, " ", ".");
    case "amount_with_space_separator":
      return T(r, 2, " ", ".");
    default:
      return T(r, 2, ",", ".");
  }
}
function T(r, e, t, o) {
  const a = e > 0 ? r.toFixed(e) : String(Math.round(r)), [n, i] = a.split("."), s = n.replace(
    /\B(?=(\d{3})+(?!\d))/g,
    t
  );
  return i ? `${s}${o}${i}` : s;
}
function ge(r) {
  return r.replace(/<[^>]*>/g, "").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/g, "'");
}
function te(r) {
  const t = [
    r.products,
    r.bundle?.items,
    r.items
  ].find((o) => Array.isArray(o));
  return Array.isArray(t) ? t.map((o) => {
    const a = o.product || o.target || o, n = String(
      a.variantId || o.variantId || ""
    ), i = Se(a.variants || o.variants);
    i.length === 0 && n && i.push({
      id: n,
      title: "Default",
      sku: "",
      price: String(a.price || o.price || "0"),
      compareAtPrice: null,
      quantityAvailable: null,
      availableForSale: !0,
      selectedOptions: []
    });
    const s = i.find(
      (c) => c.id === n && c.availableForSale
    ) || i.find((c) => c.availableForSale);
    return {
      id: a.id || o.productId || o.targetId,
      variantId: s?.id || "",
      title: a.title || o.title || "Recommended product",
      handle: a.handle || o.handle || "",
      imageUrl: a.imageUrl || a.image || o.imageUrl || o.image || "",
      price: String(s?.price || a.price || o.price || ""),
      quantity: Number(o.quantity || 1),
      reason: String(
        o.reason || o.affinity?.reason || o.reasoning || ""
      ),
      orderCount: Number(
        a.orderCount || o.orderCount || o.affinity?.orderCount || 0
      ),
      variants: i
    };
  }) : [];
}
function ve(r, e) {
  return r.variants.length <= 1 ? "" : `
    <label class="variant-picker">
      <span>Choose options</span>
      <select data-variant-picker="${_(e)}" aria-label="Choose ${_(r.title)} options">
        ${r.variants.map(
    (t) => `
              <option value="${_(t.id)}"
                ${t.id === r.variantId ? "selected" : ""}
                ${t.availableForSale ? "" : "disabled"}>
                ${_(we(t))}${t.availableForSale ? "" : " - Sold out"}
              </option>
            `
  ).join("")}
      </select>
    </label>
  `;
}
function J(r, e, t) {
  const a = Array.from(
    r.querySelectorAll("[data-variant-picker]")
  ).find((n) => n.dataset.variantPicker === t)?.value || e.variantId;
  return e.variants.find(
    (n) => n.id === a && n.availableForSale
  ) || e.variants.find((n) => n.availableForSale) || null;
}
function we(r) {
  return r.selectedOptions.map((t) => `${t.name}: ${t.value}`).join(" / ") || r.title || "Default";
}
function Se(r) {
  if (!Array.isArray(r)) return [];
  const e = /* @__PURE__ */ new Set();
  return r.map(
    (t) => t && typeof t == "object" && !Array.isArray(t) ? t : {}
  ).map((t) => {
    const o = String(t.id || ""), a = Number(t.price);
    if (!o.startsWith("gid://shopify/ProductVariant/") || !Number.isFinite(a))
      return null;
    const n = Array.isArray(t.selectedOptions) ? t.selectedOptions.map(
      (s) => s && typeof s == "object" && !Array.isArray(s) ? s : {}
    ).map((s) => ({
      name: String(s.name || ""),
      value: String(s.value || "")
    })).filter(
      (s) => s.name && s.value
    ) : [], i = t.quantityAvailable === null || t.quantityAvailable === void 0 ? null : Number(t.quantityAvailable);
    return {
      id: o,
      title: String(t.title || "Default"),
      sku: String(t.sku || ""),
      price: String(t.price),
      compareAtPrice: t.compareAtPrice === null || t.compareAtPrice === void 0 ? null : String(t.compareAtPrice),
      quantityAvailable: i !== null && Number.isFinite(i) ? i : null,
      availableForSale: t.availableForSale === !0,
      selectedOptions: n
    };
  }).filter((t) => !!t).filter((t) => e.has(t.id) ? !1 : (e.add(t.id), !0));
}
async function _e(r, e = 1, t) {
  if (!r || !Number.isInteger(e) || e < 1 || e > 10)
    return null;
  const o = String(r).split("/").pop();
  return !o || !/^\d+$/.test(o) ? null : pe("add", {
    id: o,
    quantity: e,
    properties: ke(t)
  });
}
function ke(r, e = {}) {
  const t = String(r || "").trim(), o = Object.entries(e).filter(
    ([i, s]) => i.startsWith("_aovboost_") && s
  ), a = Object.fromEntries(o), n = window.AOVBoostSDK?.sessionId;
  return n && /^[a-zA-Z0-9_-]{1,128}$/.test(n) && (a._aovboost_session_id = n), t && (a._aovboost_offer_id = t), Object.keys(a).length > 0 ? a : void 0;
}
function xe(r) {
  return String(r || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
const Ce = `
:host {
  --aovboost-surface: #ffffff;
  --aovboost-ink: #111827;
  --aovboost-muted: #5b6472;
  --aovboost-line: rgba(17, 24, 39, 0.12);
  --aovboost-action: #111827;
  --aovboost-action-text: #ffffff;
  --aovboost-accent: #0f766e;
  color: var(--aovboost-ink);
  font-family: inherit;
}
:host([data-presentation="inline"]) {
  display: block;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  contain: inline-size;
  font-size: 14px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
:host([data-presentation="inline"]) * { min-width: 0; }
:host([data-presentation="inline"]) .card,
:host([data-presentation="inline"]) .bar,
:host([data-presentation="inline"]) .drawer { box-shadow: none; border-radius: var(--aovboost-radius, 8px); }
:host([data-presentation="inline"]) .primary,
:host([data-presentation="inline"]) .secondary { border-radius: var(--aovboost-radius, 8px); }
:host([data-presentation="inline"]) .secondary { background: color-mix(in srgb, var(--aovboost-ink) 6%, var(--aovboost-surface)); }
* { box-sizing: border-box; letter-spacing: 0; }
button, input, select { font: inherit; }
.card, .drawer, .bar, .modal, .pill {
  background: var(--aovboost-surface);
  border: 1px solid var(--aovboost-line);
  box-shadow: 0 18px 45px rgba(17, 24, 39, 0.16);
}
.card { border-radius: 8px; padding: 16px; }
.title { margin: 0; font-size: 16px; line-height: 1.25; font-weight: 750; }
.body { margin: 6px 0 0; color: var(--aovboost-muted); font-size: 14px; line-height: 1.45; }
.row { display: flex; align-items: center; gap: 10px; }
.stack { display: grid; gap: 12px; }
.actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 14px; }
.primary, .secondary, .icon {
  border: 0;
  border-radius: 8px;
  cursor: pointer;
  min-height: 38px;
  padding: 9px 12px;
}
.primary { background: var(--aovboost-action); color: var(--aovboost-action-text); font-weight: 700; }
.secondary { background: #f3f4f6; color: var(--aovboost-ink); }
.icon { display: inline-grid; place-items: center; width: 30px; min-height: 30px; padding: 0; background: transparent; color: var(--aovboost-muted); }
.product-grid { display: grid; gap: 10px; }
.product-card { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 10px; align-items: center; padding: 8px; border: 1px solid var(--aovboost-line); border-radius: 8px; }
.product-card img, .tile img { width: 100%; aspect-ratio: 1; object-fit: contain; border-radius: 6px; background: #f8fafc; }
.product-name { margin: 0; font-size: 13px; font-weight: 700; line-height: 1.25; overflow-wrap: anywhere; }
.price { color: var(--aovboost-ink); font-size: 13px; font-weight: 700; }
.reason { color: var(--aovboost-muted); font-size: 12px; line-height: 1.35; }
.variant-picker { display: grid; gap: 4px; color: var(--aovboost-muted); font-size: 11px; }
.variant-picker select { width: 100%; min-height: 34px; border: 1px solid var(--aovboost-line); border-radius: 7px; background: var(--aovboost-surface); color: var(--aovboost-ink); padding: 6px 8px; }
`;
class Te extends fe {
  constructor() {
    super(...arguments);
    S(this, "keyboard", new AbortController());
    S(this, "returnTo", null);
    S(this, "shiftTab", !1);
  }
  getWidgetType() {
    return "upsell_drawer";
  }
  render() {
    const t = te(this.payload).slice(
      0,
      ue(this.payload.maxProductRecommendations)
    ), o = this.payload.copy || {}, a = this.payload.presentation === "inline";
    if (t.length === 0) {
      this.destroy();
      return;
    }
    this.html(`
      <style>
        .backdrop { position: fixed; inset: 0; z-index: 9998; background: rgba(17, 24, 39, .28); }
        .drawer {
          position: fixed;
          top: 0;
          right: 0;
          z-index: 9999;
          width: min(400px, 100vw);
          height: 100dvh;
          padding: 18px;
          transform: translateX(100%);
          animation: drawer-in 200ms ease-out forwards;
          overflow: auto;
        }
        @keyframes drawer-in { to { transform: translateX(0); } }
        .head { display: flex; justify-content: space-between; align-items: start; gap: 12px; }
        .added-note { margin: 12px 0; border-radius: 8px; background: #ecfdf5; color: #047857; font-size: 13px; font-weight: 700; padding: 9px 11px; }
        .status { min-height: 16px; color: var(--aovboost-accent); font-size: 12px; font-weight: 650; }
        ${a ? ".drawer { position: static; inset: auto; z-index: auto; width: 100%; height: auto; margin: 18px 0; transform: none; animation: none; overflow: visible; }" : ""}
      </style>
      ${a ? "" : '<div class="backdrop" data-dismiss></div>'}
      <aside class="drawer" role="region" aria-label="Recommended cart additions">
        <div class="head">
          <div>
            <h3 class="title">${_(o.headline || "Great choice. Complete the set")}</h3>
            <p class="body">Verified complementary products from this store:</p>
          </div>
          <button type="button" class="icon" data-dismiss aria-label="Close">x</button>
        </div>
        ${a ? "" : '<div class="added-note">Your selected item was added to the cart.</div>'}
        <div class="product-grid">
          ${t.map(
      (n, i) => `
                <article class="product-card">
                  ${n.imageUrl ? `<img src="${_(n.imageUrl)}" alt="${_(n.title)}" loading="lazy">` : "<span></span>"}
                  <div class="stack">
                    <div>
                      <p class="product-name">${_(n.title)}</p>
                      <span class="price" data-variant-price="upsell-${i}">${_(n.price ? K(n.price) : "")}</span>
                    </div>
                    <p class="reason">${_(n.reason || o.whyThisGoes || "It pairs well with your cart.")}</p>
                    ${ve(n, `upsell-${i}`)}
                    ${n.variants.some(
        (s) => s.availableForSale
      ) ? `<button type="button" class="primary" data-add data-product-index="${i}" ${this.payload.previewMode ? "disabled" : ""}>Add to cart</button>` : n.handle ? `<a class="primary" href="/products/${_(n.handle)}">View product</a>` : ""}
                    <span class="status" data-status="${i}" aria-live="polite"></span>
                  </div>
                </article>
              `
    ).join("")}
        </div>
        ${a ? "" : '<div class="actions"><a class="secondary" href="/cart">Continue to cart</a></div>'}
      </aside>
    `), this.returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null, this.root.addEventListener(
      "keydown",
      (n) => {
        const i = n;
        if (i.key === "Escape") {
          i.preventDefault(), i.stopPropagation();
          const s = (d) => {
            d.key === "Escape" && d.stopPropagation(), document.removeEventListener("keyup", s, !0), window.clearTimeout(c);
          }, c = window.setTimeout(
            () => document.removeEventListener("keyup", s, !0),
            1e3
          );
          document.addEventListener("keyup", s, !0), this.dismiss();
        }
        i.key === "Tab" && this.payload.cartDrawer && this.bridgeTab(i);
      },
      { signal: this.keyboard.signal }
    ), this.root.addEventListener(
      "keyup",
      (n) => {
        n.key === "Escape" && n.stopPropagation();
      },
      { signal: this.keyboard.signal }
    ), this.payload.cartDrawer && (this.container.tabIndex = 0, this.container.setAttribute("aria-label", "Recommended cart additions"), document.addEventListener(
      "keydown",
      (n) => {
        n.key === "Tab" && (this.shiftTab = n.shiftKey);
      },
      { capture: !0, signal: this.keyboard.signal }
    ), this.container.addEventListener(
      "focus",
      (n) => {
        if (n.composedPath()[0] !== this.container) return;
        const i = this.controls();
        (this.shiftTab ? i.at(-1) : i[0])?.focus();
      },
      { signal: this.keyboard.signal }
    )), this.root.querySelectorAll("[data-dismiss]").forEach((n) => {
      n.addEventListener("click", () => this.dismiss());
    }), this.root.querySelectorAll("[data-variant-picker]").forEach((n) => {
      n.addEventListener("change", () => {
        t.forEach((i, s) => {
          const c = `upsell-${s}`, d = J(this.root, i, c), l = this.root.querySelector(
            `[data-variant-price="${c}"]`
          );
          l && d && (l.textContent = K(d.price));
        });
      });
    }), this.root.querySelectorAll("[data-add]").forEach((n) => {
      n.addEventListener("click", async () => {
        const i = n, s = Number(i.dataset.productIndex), c = t[s], d = c ? J(this.root, c, `upsell-${s}`) : null;
        if (!d) return;
        const l = this.root.querySelector(`[data-status="${s}"]`);
        i.disabled = !0, i.textContent = "Adding…", this.trackClick("add_upsell");
        try {
          if (!await _e(
            d.id,
            1,
            this.payload.offerId
          )) throw new Error("Cart add failed");
          this.track("recommendation_added", {
            productId: c.id,
            variantId: d.id
          }), i.textContent = "Added ✓", l && (l.textContent = "Added to your cart");
        } catch {
          i.disabled = !1, i.textContent = "Try again", l && (l.textContent = "Could not add this item");
        }
      });
    });
  }
  controls() {
    return Array.from(
      this.root.querySelectorAll(
        "button:not(:disabled), select:not(:disabled), a[href]"
      )
    ).filter((t) => !t.hasAttribute("hidden"));
  }
  bridgeTab(t) {
    const o = this.controls(), a = this.root.activeElement;
    if (!t.shiftKey && a !== o.at(-1) || t.shiftKey && a !== o[0])
      return;
    const n = this.container.closest(
      "[data-aovboost-cart-drawer], [role='dialog'], [aria-modal='true'], [data-cart-drawer]"
    );
    if (!n) return;
    const i = Array.from(
      n.querySelectorAll(
        "button:not(:disabled), select:not(:disabled), input:not([type='hidden']):not(:disabled), a[href], [tabindex='0']"
      )
    ).filter((d) => C(d)), s = i.indexOf(this.container);
    if (s < 0) return;
    const c = i[(s + (t.shiftKey ? i.length - 1 : 1)) % i.length];
    c && c !== this.container && (t.preventDefault(), t.stopPropagation(), c.focus());
  }
  destroy() {
    const t = document.activeElement === this.container, o = this.container.closest(
      "[data-aovboost-cart-drawer], [role='dialog'], [aria-modal='true'], [data-cart-drawer]"
    ), a = this.returnTo && this.returnTo !== this.container && this.returnTo.isConnected && (!o || o.contains(this.returnTo)) ? this.returnTo : o?.querySelector(
      ".drawer__close, [data-cart-close], button"
    );
    this.keyboard.abort(), super.destroy(), t && a && C(a) && a.focus();
  }
  dismiss() {
    if (this.trackDismiss(), this.payload.presentation === "inline") {
      this.destroy();
      return;
    }
    this.container.animate(
      [{ transform: "translateX(0)" }, { transform: "translateX(100%)" }],
      { duration: 180, easing: "ease-in", fill: "forwards" }
    ), window.setTimeout(() => this.destroy(), 190);
  }
  dismissFromKeyboard() {
    this.dismiss();
  }
}
function M() {
  const r = window.location.pathname, e = window, t = String(
    document.body?.dataset.template || e.ShopifyAnalytics?.meta?.page?.pageType || ""
  ).toLowerCase();
  return /\/(?:thank_you|thank-you|orders)(?:\/|$)/.test(r) ? "thankyou" : /\/checkouts?(?:\/|$)/.test(r) ? "checkout" : /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:account|accounts|pages|policies|blogs|search|password)(?:\/|$)/i.test(
    r
  ) ? "other" : /\/products\/[^/]+/.test(r) ? "product" : /\/cart(?:\/|$)/.test(r) ? "cart" : /\/collections(?:\/|$)/.test(r) ? "collection" : r === "/" || /^\/[a-z]{2}(?:-[a-z]{2})?\/?$/i.test(r) ? "home" : t.startsWith("product") ? "product" : t.startsWith("collection") ? "collection" : t === "index" || t === "home" ? "home" : t === "cart" ? "cart" : "other";
}
const Ie = "dialog[open], [aria-modal='true'], [role='dialog'], cart-drawer.active, cart-drawer[open], [data-cart-drawer], [data-cookie-banner], #shopify-pc__banner", B = "form,button,a,table,ul,ol,quick-add-modal,quick-add-drawer,[data-quick-add],[data-aovboost-widget]";
function x() {
  return [...document.querySelectorAll(Ie)].filter(
    C
  );
}
function re(r) {
  return x().some(
    (e) => e !== r && !e.contains(r) && !r.contains(e)
  );
}
function oe(r) {
  return !!r.querySelector(
    "a[href*='/products/'],[data-cart-line],cart-drawer-items,.cart-item"
  ) && !!r.querySelector(
    "button[name='checkout'],a[href*='/checkout'],[data-cart-checkout]"
  );
}
function V() {
  const r = /* @__PURE__ */ new Set();
  for (const t of [
    ...document.querySelectorAll(
      "button[name='checkout'], a[href*='/checkout'], [data-cart-checkout]"
    )
  ].slice(0, 20))
    for (let o = t.parentElement, a = 0; o && a < 5; o = o.parentElement, a++)
      if ((o.matches("[role='dialog'],[aria-modal='true'],[data-cart-drawer]") || o.tagName.includes("-")) && oe(o) && C(o) && !o.closest(B)) {
        r.add(o);
        break;
      }
  const e = [...r];
  return e.length === 1 && !re(e[0]) ? e[0] : null;
}
function ne(r) {
  if (r.id && D(`#${r.id}`)) return `#${r.id}`;
  const e = r.tagName.toLowerCase();
  if (D(e) && document.querySelectorAll(e).length === 1)
    return e;
  for (const t of [...r.classList]) {
    const o = `.${t}`;
    if (D(o) && document.querySelectorAll(o).length === 1)
      return o;
  }
}
function G(r = location.pathname) {
  if (M() === "cart")
    return {
      cartUi: r === location.pathname ? "unknown" : "page_redirect"
    };
  const e = V();
  return e && !e.closest("cart-notification") && !/notification/i.test(e.id) ? { cartUi: "drawer", selector: ne(e) } : x().find(
    (o) => o.closest("cart-notification") || /cart.*notification/i.test(o.id) || o.querySelector("a[href*='/cart']") && !o.querySelector("[data-cart-line],cart-drawer-items,.cart-item")
  ) ? { cartUi: "popup_notification" } : { cartUi: x().length ? "unknown" : "no_feedback" };
}
function Ae(r) {
  const e = location.pathname;
  let t = G(e);
  const o = () => document.querySelector("[data-cart-count],.cart-count-bubble")?.textContent, a = o();
  return new Promise((n) => {
    const i = () => {
      const l = G(e);
      l.cartUi !== "no_feedback" ? t = l : o() !== a && (t = { cartUi: "unknown" });
    }, s = new MutationObserver(i);
    s.observe(document.body, {
      subtree: !0,
      childList: !0,
      characterData: !0,
      attributes: !0,
      attributeFilter: [
        "class",
        "open",
        "hidden",
        "aria-hidden",
        "aria-modal",
        "style"
      ]
    });
    const c = () => {
      clearTimeout(d), s.disconnect(), r.removeEventListener("abort", c), n(t);
    }, d = setTimeout(c, 1200);
    r.addEventListener("abort", c, { once: !0 }), r.aborted && c();
  });
}
function Ee() {
  let r = null, e = null;
  const t = () => {
    r?.remove(), e?.dataset.aovboostMount && !e.childElementCount && e.remove(), e = null, r = null;
  }, o = (i) => {
    const c = i.identity.schemaName?.toLowerCase() === "dawn" ? document.querySelector(
      "cart-drawer.active #CartDrawer .drawer__inner[role='dialog'],cart-drawer[open] #CartDrawer .drawer__inner[role='dialog']"
    ) : null;
    if (c && C(c) && c.querySelector("cart-drawer-items #CartDrawer-CartItems") && oe(c) && !re(c))
      return c;
    const d = i.config.genericDrawer && D(i.config.drawerSelector) ? document.querySelector(i.config.drawerSelector) : null;
    return d && d === V() && !d.closest(B) ? d : null;
  }, a = (i, s, c) => {
    e = document.createElement("section"), e.dataset.aovboostMount = "adaptive-cart", e.style.cssText = "display:block;min-width:0;flex:0 0 auto;max-width:100%;", s.insertAdjacentElement("afterend", e), e.appendChild(c), r = c;
  }, n = () => {
    if (M() !== "cart" || x().length) return null;
    const i = document.querySelector("main,[role='main']"), s = i?.querySelector(
      "[data-aovboost-slot='upsell_drawer']"
    );
    if (s && !s.closest(B)) return s;
    const c = i?.querySelector(
      "#main-cart-items,cart-items,[data-cart-items]"
    );
    if (!c || c.closest(
      "form,table,ul,ol,header,footer,nav,dialog,[role='dialog'],quick-add-modal,[data-aovboost-widget]"
    ))
      return null;
    const d = c.parentElement ? getComputedStyle(c.parentElement) : null;
    return d && (d.display.includes("grid") || d.display.includes("flex") && !d.flexDirection.startsWith("column")) ? null : c;
  };
  return [
    {
      id: "native_drawer",
      canHandle: (i) => !!o(i),
      mount: (i, s) => {
        const c = o(s);
        if (!c) throw new Error("drawer_unavailable");
        let l = c.querySelector(
          "cart-drawer-items,[data-cart-items],.cart-items"
        );
        for (; l?.parentElement && l.parentElement !== c; )
          l = l.parentElement;
        if (!l || l.parentElement !== c || c.closest("form"))
          throw new Error("unsafe_drawer_boundary");
        a(c, l, i);
      },
      unmount: t,
      verify: () => !!(r?.isConnected && e && C(e) && e.closest(
        "[role='dialog'],[aria-modal='true'],cart-drawer,[data-cart-drawer]"
      ))
    },
    {
      id: "cart_page",
      canHandle: () => !!n(),
      mount: (i) => {
        const s = n();
        if (!s) throw new Error("cart_page_unavailable");
        s.dataset.aovboostSlot ? (e = s, e.appendChild(i), r = i) : a(s.parentElement, s, i);
      },
      unmount: t,
      verify: () => !!(r?.isConnected && M() === "cart" && !x().length)
    },
    {
      id: "floating_card",
      canHandle: () => !x().length && ["product", "collection", "cart", "home"].includes(M()),
      mount: (i) => {
        if (x().length) throw new Error("competing_dialog");
        i.style.cssText += ";position:fixed;inset-inline-end:max(16px,env(safe-area-inset-left),env(safe-area-inset-right));bottom:max(16px,env(safe-area-inset-bottom));width:380px;max-width:calc(100vw - 32px - env(safe-area-inset-left) - env(safe-area-inset-right));max-height:50dvh;overflow:auto;z-index:9990;", document.body.appendChild(i), r = i;
      },
      unmount: t,
      verify: () => !!(r?.isConnected && !x().length)
    }
  ];
}
function $e(r) {
  if (!r.isConnected || document.visibilityState === "hidden" || !C(r))
    return { verified: !1, reason: "hidden" };
  const e = r.getBoundingClientRect();
  let t = Math.max(0, e.left), o = Math.max(0, e.top), a = Math.min(innerWidth, e.right), n = Math.min(innerHeight, e.bottom);
  for (let c = r.parentElement; c; c = c.parentElement) {
    const d = getComputedStyle(c);
    if (/auto|scroll|hidden|clip/.test(
      `${d.overflow} ${d.overflowX} ${d.overflowY}`
    )) {
      const l = c.getBoundingClientRect();
      t = Math.max(t, l.left), a = Math.min(a, l.right), o = Math.max(o, l.top), n = Math.min(n, l.bottom);
    }
  }
  if ((e.width * e.height > 0 ? Math.max(0, a - t) * Math.max(0, n - o) / (e.width * e.height) : 0) < 0.5)
    return { verified: !1, reason: "outside_viewport" };
  if (typeof document.elementFromPoint != "function")
    return { verified: !1, reason: "hit_test_unavailable" };
  const s = document.elementFromPoint(
    e.left + e.width / 2,
    e.top + e.height / 2
  );
  return s === r || s && r.contains(s) ? { verified: !0, reason: "display_verified" } : { verified: !1, reason: "obscured" };
}
async function Me(r, e) {
  const t = performance.now();
  let o = null, a = r.getBoundingClientRect(), n = 0, i = "verification_timeout";
  for (; !e.aborted && performance.now() - t < 3500; ) {
    const s = r.getBoundingClientRect();
    if (n += Math.abs(s.top - a.top) / Math.max(1, innerHeight) + Math.abs(s.left - a.left) / Math.max(1, innerWidth), a = s, n > 0.1)
      return { verified: !1, reason: "layout_shift" };
    const c = $e(r);
    if (i = c.reason, c.verified) {
      if (o ?? (o = performance.now()), performance.now() - o >= 750) return c;
    } else o = null;
    await new Promise((d) => {
      const l = () => {
        clearTimeout(f), e.removeEventListener("abort", l), d();
      }, f = setTimeout(l, 100);
      e.addEventListener("abort", l, { once: !0 });
    });
  }
  return { verified: !1, reason: e.aborted ? "cancelled" : i };
}
function U(r) {
  if (/^#[\da-f]{6}$/i.test(r))
    return [1, 3, 5].map((o) => parseInt(r.slice(o, o + 2), 16));
  const e = /^rgba?\(\s*(\d+(?:\.\d+)?)[, ]+\s*(\d+(?:\.\d+)?)[, ]+\s*(\d+(?:\.\d+)?)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i.exec(
    r
  );
  if (!e || e[4] && Number(e[4]) !== 1) return null;
  const t = e.slice(1, 4).map(Number);
  return t.every((o) => o >= 0 && o <= 255) ? t : null;
}
function I(r, e) {
  const t = (s) => s.map((c) => {
    const d = c / 255;
    return d <= 0.04045 ? d / 12.92 : ((d + 0.055) / 1.055) ** 2.4;
  }).reduce((c, d, l) => c + d * [0.2126, 0.7152, 0.0722][l], 0), o = U(r), a = U(e);
  if (!o || !a) return 0;
  const n = t(o), i = t(a);
  return (Math.max(n, i) + 0.05) / (Math.min(n, i) + 0.05);
}
function Z(r, e) {
  const t = getComputedStyle(document.body), o = document.querySelector(
    "button[name='checkout'], button[name='add'], .product-form__submit"
  ), a = o ? getComputedStyle(o) : t, n = U(t.backgroundColor) ? t.backgroundColor : "#ffffff", i = I(t.color, n) >= 4.5 ? t.color : "#171717", s = I(i, n) >= 4.5 ? n : "#ffffff", c = e.accentColor || a.backgroundColor, d = I(c, a.color) >= 4.5 || I(c, "#ffffff") >= 4.5 ? c : "#171717", l = I(d, a.color) >= 4.5 ? a.color : "#ffffff", f = document.querySelector("a[href]"), p = f ? getComputedStyle(f).color : i, h = {
    "--aovboost-ink": i,
    "--aovboost-surface": s,
    "--aovboost-muted": i,
    "--aovboost-accent": I(d, s) >= 4.5 ? d : i,
    "--aovboost-action": d,
    "--aovboost-action-text": l,
    "--aovboost-radius": e.radius != null ? `${e.radius}px` : a.borderRadius || "8px",
    "--aovboost-link": I(p, s) >= 4.5 ? p : i,
    "--aovboost-font": e.font === "system" ? "system-ui, sans-serif" : t.fontFamily || "system-ui, sans-serif"
  };
  for (const [g, v] of Object.entries(h))
    r.style.setProperty(g, v);
  r.style.fontFamily = "var(--aovboost-font)", r.style.fontSize = `${Math.max(14, Math.min(20, parseFloat(t.fontSize) || 16))}px`, r.style.direction = t.direction === "rtl" ? "rtl" : "ltr", r.style.colorScheme = t.colorScheme || "normal";
}
let Oe = 0;
const Ne = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${++Oe}`, Q = (r, e) => /^\d+$/.test(String(e || "")) ? `gid://shopify/${r}/${e}` : String(e || "");
async function ee() {
  const r = new AbortController(), e = window.setTimeout(() => r.abort(), 1500);
  try {
    const t = await fetch(z("read"), {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: r.signal
    });
    if (!t.ok) return null;
    const o = await t.json();
    if (!Array.isArray(o.items) || !Number.isFinite(Number(o.item_count)))
      return null;
    const a = o.items.slice(0, 100).map((n) => ({
      key: String(n.key || ""),
      productId: Q("Product", n.product_id || n.productId),
      variantId: Q(
        "ProductVariant",
        n.variant_id || n.variantId || n.id
      ),
      quantity: Math.max(0, Number(n.quantity) || 0),
      title: String(n.product_title || n.title || ""),
      handle: String(n.handle || n.url || "").split("/products/").pop()?.split(/[?#/]/)[0] || ""
    }));
    return o.items.length > 100 ? null : {
      cartToken: String(o.token || ""),
      cartProductIds: [
        ...new Set(
          a.map((n) => n.productId).filter(Boolean)
        )
      ],
      cartVariantIds: [
        ...new Set(
          a.map((n) => n.variantId).filter(Boolean)
        )
      ],
      cartItems: a,
      cartItemCount: Math.max(0, Number(o.item_count)),
      cartValue: Number(o.total_price || 0) / 100,
      currency: String(o.currency || "")
    };
  } catch {
    return null;
  } finally {
    window.clearTimeout(e);
  }
}
function qe() {
  const r = window.Shopify?.theme || {};
  return le({
    themeId: r.id,
    themeName: r.name,
    schemaName: r.schema_name,
    themeStoreId: r.theme_store_id,
    role: r.role
  });
}
const N = "aovboost_theme_preview_v1";
async function Pe(r) {
  const e = qe(), t = new URL(location.href);
  t.searchParams.delete("aovboost_preview"), history.replaceState(history.state, "", t);
  const o = document.createElement("aside");
  o.setAttribute("aria-label", "AOVBoost theme test"), o.style.cssText = "position:fixed;bottom:16px;left:16px;z-index:9991;max-width:320px;background:white;color:#171717;border:1px solid #777;border-radius:8px;padding:16px;font:16px system-ui";
  const a = document.createElement("p");
  a.setAttribute("role", "status");
  const n = document.createElement("button");
  n.type = "button", n.textContent = "Run one test add", o.append(a, n), document.body.append(o);
  const i = async (l, f) => {
    const p = await fetch(`${r.apiBase}/theme-preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: r.token, intent: l, ...f })
    });
    if (!p.ok) throw new Error("Preview unavailable");
    return p.json();
  };
  let s;
  try {
    s = JSON.parse(sessionStorage.getItem(N) || "null");
  } catch {
  }
  const c = () => sessionStorage.setItem(N, JSON.stringify(s)), d = async () => {
    const l = String(s.variantId || "");
    let f = !1;
    for (let g = 0; g < 5; g++) {
      if (((await ee())?.cartItems.filter((m) => String(m.variantId).split("/").pop() === l).reduce((m, k) => m + k.quantity, 0) || 0) > s.before) {
        f = !0;
        break;
      }
      await new Promise((m) => setTimeout(m, 400));
    }
    const p = De({
      identity: e,
      config: s.data.config,
      report: () => {
      }
    });
    let h = {
      strategy: "none",
      verified: !1,
      reason: "test_add_unconfirmed"
    };
    if (f && s.data.config.preference === "cart_page" && !/\/cart\/?$/.test(location.pathname)) {
      location.assign(z("read").replace(/\.js$/, ""));
      return;
    }
    f && (h = await p.mount({
      ...s.data.payload,
      previewMode: !0,
      mutationId: "preview"
    })), await i("report", {
      report: {
        identity: e,
        attemptId: "preview",
        ...h,
        cartUi: h.cartUi || (location.pathname.includes("/cart") ? "page_redirect" : "unknown")
      }
    }), sessionStorage.removeItem(N), n.remove(), a.textContent = h.verified ? "Test complete: a recommendation card was verified. Return to AOVBoost for the result." : "The test could not verify a display. Return to AOVBoost for guidance.", window.addEventListener("pagehide", () => p.destroy(), { once: !0 });
  };
  try {
    if (s?.token === r.token && s?.started && s.expires > Date.now()) {
      n.remove(), a.textContent = "Checking the test add…", await d();
      return;
    }
    const l = await i("bootstrap", { identity: e });
    s = {
      token: r.token,
      expires: Date.now() + 3e5,
      data: l,
      started: !1
    }, c(), a.textContent = "This test adds one item using your store's own product form. The item stays in your cart. No shopper analytics are recorded.", n.addEventListener(
      "click",
      async () => {
        n.disabled = !0;
        try {
          const f = [
            ...document.querySelectorAll(
              "form[action*='/cart/add']"
            )
          ].filter((m) => {
            const k = m.elements.namedItem(
              "id"
            );
            return l.source.variantIds.some(
              (A) => A.split("/").pop() === String(k?.value)
            );
          });
          if (f.length !== 1)
            throw new Error("No unambiguous native product form");
          const p = f[0], h = p.elements.namedItem("id"), g = p.elements.namedItem(
            "quantity"
          );
          if (g && Number(g.value) !== 1)
            throw new Error(
              "Set the native product quantity to one, then create a new test link"
            );
          const v = await ee();
          if (!v) throw new Error("Cart could not be read");
          s.before = v.cartItems.filter(
            (m) => String(m.variantId).split("/").pop() === h.value
          ).reduce((m, k) => m + k.quantity, 0), s.variantId = h.value, s.started = !0, c(), a.textContent = "Running the native add and checking placement…";
          const b = p.querySelector(
            "button[name='add'],button[type='submit']"
          );
          p.requestSubmit(b || void 0), await d();
        } catch {
          sessionStorage.removeItem(N), a.textContent = "The native add or display could not be verified. Check the product form and create a new test link in AOVBoost.";
        }
      },
      { once: !0 }
    );
  } catch {
    sessionStorage.removeItem(N), n.remove(), a.textContent = "Preview expired or unavailable. Create a new test link in AOVBoost.";
  }
}
function De(r) {
  let e = new AbortController(), t, o, a, n, i = "", s = 0;
  const c = Ee(), d = /* @__PURE__ */ new Set(), l = /* @__PURE__ */ new Set();
  let f = !1, p = !1;
  const h = () => {
    e.abort(), a?.disconnect(), t?.destroy(), o?.unmount(), t = void 0, o = void 0, n = void 0;
  }, g = (b) => {
    p || i === b && n || (h(), e = new AbortController(), i = b, s = 0, n = Ae(e.signal));
  }, v = async (b) => {
    if (p)
      return {
        strategy: "none",
        verified: !1,
        reason: "local_circuit_open"
      };
    if (!["home", "product", "collection", "cart"].includes(M()))
      return { strategy: "none", verified: !1, reason: "protected_page" };
    g(String(b.mutationId || "preview"));
    const m = e.signal, k = await n, A = b.cartUiHint === "page_redirect" && M() === "cart" ? { ...k, cartUi: "page_redirect" } : k, E = { config: r.config, identity: r.identity }, ae = r.config.preference === "off" || r.config.status === "disabled" ? "none" : r.config.strategy, W = c.findIndex((u) => u.id === ae);
    if (W < 0 || m.aborted)
      return {
        strategy: "none",
        verified: !1,
        reason: "placement_disabled"
      };
    const ie = Ne(), j = V(), H = j ? ne(j) : A.selector, O = (u, y, P) => {
      m.aborted || Promise.resolve(
        r.report({
          identity: r.identity,
          attemptId: `${ie}-${u}`,
          offerId: String(b.offerId || ""),
          strategy: u,
          verified: y,
          reason: P,
          cartUi: A.cartUi,
          ...H ? { selector: H } : {}
        })
      ).catch(() => {
      });
    };
    for (const u of c.slice(W))
      if (!d.has(u.id)) {
        if (m.aborted)
          return { strategy: "none", verified: !1, reason: "cancelled" };
        if (!(r.config.preference === "cart_page" && u.id !== "cart_page"))
          try {
            if (u.id === "floating_card" && !u.canHandle(E) && await new Promise((w) => {
              const X = new MutationObserver(() => {
                try {
                  u.canHandle(E) && $();
                } catch {
                  $();
                }
              }), $ = () => {
                clearTimeout(se), X.disconnect(), m.removeEventListener("abort", $), w();
              }, se = setTimeout($, 15e3);
              X.observe(document.body, {
                subtree: !0,
                childList: !0,
                attributes: !0,
                attributeFilter: [
                  "class",
                  "open",
                  "hidden",
                  "aria-hidden",
                  "style"
                ]
              }), m.addEventListener("abort", $, { once: !0 }), m.aborted && $();
            }), !u.canHandle(E)) {
              O(u.id, !1, "adapter_unavailable");
              continue;
            }
            t = new Te({
              ...b,
              presentation: "inline",
              cartDrawer: u.id === "native_drawer",
              verifiedDisplayManaged: !0
            });
            const y = t.getElement();
            y.style.cssText = "display:block;max-height:45dvh;overflow:auto;min-width:0;", u.mount(y, E), o = u, t.mount(y.parentElement), Z(y, r.config.appearance), y.shadowRoot?.querySelector("style")?.append(
              document.createTextNode(
                `
:host{font-family:var(--aovboost-font,system-ui)!important} .primary{border-radius:var(--aovboost-radius,8px)} a{color:var(--aovboost-link)} @media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}`
              )
            );
            const P = () => {
              try {
                const w = !u.verify();
                y.hidden !== w && (y.hidden = w);
              } catch {
                if (f) return;
                f = !0, d.add(u.id), O(u.id, !1, "adapter_exception"), h(), v(b).finally(() => {
                  f = !1;
                });
              }
            };
            a = new MutationObserver(() => {
              if (m.aborted || t?.isDestroyed()) {
                t?.isDestroyed() && e.abort(), a?.disconnect();
                return;
              }
              if (!y.isConnected && s++ < 3)
                try {
                  u.canHandle(E) && (u.mount(y, E), t?.reattach(y.parentElement), Z(y, r.config.appearance));
                } catch {
                  y.remove();
                }
              y.isConnected && P();
            }), a.observe(document.body, {
              subtree: !0,
              childList: !0,
              attributes: !0,
              attributeFilter: ["class", "open", "hidden", "aria-hidden", "style"]
            }), document.addEventListener(
              "keydown",
              (w) => {
                w.key === "Escape" && u.id === "floating_card" && !w.defaultPrevented && !y.hidden && u.verify() && (w.preventDefault(), t?.dismissFromKeyboard());
              },
              { signal: m }
            );
            const q = await Me(y, m);
            if (m.aborted)
              return { strategy: "none", verified: !1, reason: "cancelled" };
            if (q.verified && u.verify()) {
              const w = String(
                b.offerId || b.mutationId || "preview"
              );
              return l.has(w) || (t.recordVerifiedImpression(u.id), l.add(w)), O(u.id, !0, q.reason), { strategy: u.id, ...q, cartUi: A.cartUi };
            }
            O(u.id, !1, q.reason), a.disconnect(), t.destroy(), u.unmount();
          } catch {
            d.add(u.id), a?.disconnect(), t?.destroy(), u.unmount(), O(u.id, !1, "adapter_exception");
          }
      }
    return p = !0, {
      strategy: "none",
      verified: !1,
      reason: "all_strategies_failed",
      cartUi: A.cartUi
    };
  };
  return {
    prepare: g,
    mount: v,
    destroy: h,
    isMounted: () => !!(t?.isMounted() && !t.getElement().hidden)
  };
}
export {
  De as createThemeEngine,
  Pe as runThemePreview
};
