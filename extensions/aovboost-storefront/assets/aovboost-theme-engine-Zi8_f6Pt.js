var de = Object.defineProperty;
var le = (o, t, e) => t in o ? de(o, t, { enumerable: !0, configurable: !0, writable: !0, value: e }) : o[t] = e;
var k = (o, t, e) => le(o, typeof t != "symbol" ? t + "" : t, e);
function ue(o) {
  const t = o && typeof o == "object" ? o : {}, e = (r, a) => typeof r == "string" ? r.replace(/\p{Cc}/gu, "").slice(0, a) : "";
  return {
    themeId: /^\d{1,20}$/.test(String(t.themeId)) ? String(t.themeId) : "unknown",
    themeName: e(t.themeName, 100) || "Unknown theme",
    ...e(t.schemaName, 80) ? { schemaName: e(t.schemaName, 80) } : {},
    .../^\d{1,12}$/.test(String(t.themeStoreId)) ? { themeStoreId: String(t.themeStoreId) } : {},
    ...["main", "unpublished", "demo", "development"].includes(String(t.role)) ? { role: String(t.role) } : {}
  };
}
function R(o) {
  return typeof o == "string" && o.length <= 160 && o.split(" ").length <= 3 && /^(?:[.#][a-zA-Z][\w-]{0,63}|[a-z][a-z0-9]*-[a-z0-9-]+)(?: (?:[.#][a-zA-Z][\w-]{0,63}|[a-z][a-z0-9]*-[a-z0-9-]+)){0,2}$/.test(
    o
  );
}
const K = "aovboost_dismissed_widgets";
function pe(o) {
  const t = Number(o);
  return Number.isFinite(t) ? Math.max(1, Math.min(4, Math.floor(t))) : 2;
}
function E(o) {
  if (!o.isConnected || o.closest(
    "[hidden], [inert], [aria-hidden='true'], details:not([open])"
  ))
    return !1;
  for (let t = o; t; t = t.parentElement) {
    const e = getComputedStyle(t);
    if (e.display === "none" || ["hidden", "collapse"].includes(e.visibility) || e.opacity === "0" || e.contentVisibility === "hidden" || t.matches("cart-drawer") && !t.matches(".active, [open]"))
      return !1;
  }
  return !0;
}
const F = "[data-cart-count], .cart-count-bubble";
function fe() {
  const o = /* @__PURE__ */ new Map(), t = (e, r) => {
    const a = e.closest('[id^="shopify-section-"]'), n = a?.id.slice(16);
    if (!a || !n || !/^[\w-]+$/.test(n)) return;
    const i = o.get(n);
    o.set(n, { id: n, target: a, full: i?.full || r });
  };
  for (const e of document.querySelectorAll(
    "form[action]"
  )) {
    const r = new URL(e.action, location.href);
    if (r.origin !== location.origin || !/\/cart\/?$/.test(r.pathname))
      continue;
    const a = e.closest('[id^="shopify-section-"]');
    a && !a.querySelector("header, nav") && !a.closest("header, nav") && t(e, !0);
  }
  for (const e of document.querySelectorAll(F))
    t(e, !1);
  return [...o.values()].slice(0, 5);
}
function me(o, t) {
  for (const { id: e, target: r, full: a } of o) {
    const n = t[e];
    if (!r.isConnected || typeof n != "string") continue;
    const i = new DOMParser().parseFromString(n, "text/html").getElementById(r.id);
    if (!i) continue;
    if (!a) {
      const f = [...i.querySelectorAll(F)];
      [...r.querySelectorAll(F)].forEach(
        (b, v) => {
          const u = f[v];
          u && (b.innerHTML = u.innerHTML, b.className = u.className, u.hasAttribute("aria-hidden") ? b.setAttribute(
            "aria-hidden",
            u.getAttribute("aria-hidden")
          ) : b.removeAttribute("aria-hidden"));
        }
      );
      continue;
    }
    const s = "[data-aovboost-mount], [data-aovboost-widget]", c = [
      ...r.querySelectorAll(s)
    ].filter((f) => !f.parentElement?.closest(s)), d = [
      ...r.querySelectorAll(
        'input[name="note"], textarea[name="note"], input[name^="attributes["], textarea[name^="attributes["]'
      )
    ].map((f) => ({ name: f.name, value: f.value })), l = r.contains(document.activeElement);
    let p = document.activeElement;
    for (; p?.shadowRoot?.activeElement; )
      p = p.shadowRoot.activeElement;
    const m = l ? p?.id : "";
    c.forEach((f) => f.remove()), r.innerHTML = i.innerHTML;
    for (const f of r.querySelectorAll("input, textarea")) {
      const b = d.findIndex((v) => v.name === f.name);
      b >= 0 && (f.value = d.splice(b, 1)[0].value);
    }
    c.forEach((f) => r.appendChild(f)), r.dispatchEvent(
      new CustomEvent("shopify:section:load", {
        bubbles: !0,
        detail: { sectionId: e }
      })
    ), l && p?.isConnected ? p.focus() : m && document.getElementById(m)?.focus();
  }
}
function V(o) {
  const e = window.Shopify?.routes?.root || "/";
  return `${/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(e) ? e : "/"}cart${o === "read" ? "" : `/${o}`}.js`;
}
async function he(o, t) {
  const e = Array.from(
    document.querySelectorAll("cart-drawer")
  ).find(
    (p) => p.querySelector("#CartDrawer .drawer__inner[role='dialog']")
  ) || null, r = !!e?.contains(document.activeElement), a = !!e?.matches(".active, [open]"), n = document.activeElement?.matches(
    "button[name='checkout']"
  ), i = [
    "cart-icon-bubble",
    "cart-drawer",
    "main-cart-items",
    "main-cart-footer"
  ].filter(
    (p) => document.getElementById(p) || document.getElementById(`shopify-section-${p}`) || p === "cart-drawer" && e
  ), s = fe().filter(
    ({ target: p }) => !i.some((m) => {
      const f = document.getElementById(m);
      return f && p.contains(f);
    }) && !p.contains(e)
  ), c = [
    .../* @__PURE__ */ new Set([
      ...i,
      ...s.map((p) => p.id)
    ])
  ].slice(0, 5), d = new AbortController(), l = window.setTimeout(() => d.abort(), 15e3);
  try {
    const p = await fetch(V(o), {
      method: "POST",
      credentials: "same-origin",
      signal: d.signal,
      headers: {
        "Content-Type": "application/json",
        "X-AOVBoost-Recommendation": "1"
      },
      body: JSON.stringify({
        ...t,
        ...c.length ? { sections: c, sections_url: window.location.pathname } : {}
      })
    });
    if (!p.ok) return null;
    const m = await p.json();
    try {
      const f = s.filter(
        (u) => c.includes(u.id)
      ), b = f.filter(
        (u) => typeof m.sections?.[u.id] != "string"
      );
      if (b.length)
        try {
          const u = new URL(window.location.pathname, window.location.origin);
          u.searchParams.set(
            "sections",
            b.map((w) => w.id).join(",")
          );
          const h = await fetch(u.href, {
            credentials: "same-origin",
            cache: "no-store",
            signal: d.signal
          });
          h.ok && (m.sections = {
            ...m.sections,
            ...await h.json()
          });
        } catch {
        }
      let v = !1;
      if (e?.renderContents && (e.getSectionsToRender?.() || [{ id: "cart-drawer" }]).every(
        ({ id: u }) => typeof m.sections?.[u] == "string"
      ))
        try {
          e.renderContents(m), v = !0;
        } catch {
        }
      for (const u of c) {
        if (!i.includes(u) || u === "cart-drawer" && v) continue;
        const h = m.sections?.[u];
        if (typeof h != "string") continue;
        const w = new DOMParser().parseFromString(h, "text/html"), S = (u === "cart-drawer" ? e?.querySelector("#CartDrawer") : null) || document.getElementById(u) || document.getElementById(`shopify-section-${u}`), C = S && w.getElementById(S.id);
        S && C && (S.innerHTML = C.innerHTML), u === "cart-drawer" && e?.close && e.querySelector("#CartDrawer-Overlay")?.addEventListener("click", () => e.close?.());
      }
      if (me(f, m.sections || {}), r && a && e?.isConnected && (document.activeElement === document.body || e.contains(document.activeElement))) {
        const u = e.querySelector(
          n ? "button[name='checkout']" : ".drawer__close"
        ) || e.querySelector("button"), h = e.querySelector("#CartDrawer"), w = window.trapFocus;
        u && h && (typeof w == "function" ? w(h, u) : u.focus());
      }
      document.dispatchEvent(
        new CustomEvent("aovboost:cart-updated", { detail: m })
      );
    } catch {
    }
    return m;
  } finally {
    window.clearTimeout(l);
  }
}
const ye = "USD";
class be {
  constructor(t) {
    k(this, "payload");
    k(this, "root");
    k(this, "container");
    k(this, "disposed", !1);
    k(this, "impressionRecorded", !1);
    k(this, "impressionObserver");
    k(this, "impressionListeners");
    this.payload = t, this.container = document.createElement("div"), this.container.setAttribute("data-aovboost-widget", this.getWidgetType()), this.container.dataset.presentation = t.presentation === "inline" ? "inline" : "floating", this.root = this.container.attachShadow({ mode: "open" }), this.injectStyles();
  }
  destroy() {
    this.disposed = !0, this.impressionObserver?.disconnect(), this.impressionListeners?.abort();
    const t = this.container.parentElement;
    this.container.remove(), t?.hasAttribute("data-aovboost-mount") && t.childElementCount === 0 && t.remove();
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
  recordVerifiedImpression(t) {
    this.impressionRecorded || this.disposed || this.payload.previewMode || (this.impressionRecorded = !0, this.track("widget_impression", { strategy: t, verified: !0 }));
  }
  reattach(t) {
    this.disposed || (this.applyInlineTheme(t), t.appendChild(this.container), this.observeImpression());
  }
  mount(t = document.body) {
    this.payload.presentation === "inline" && this.applyInlineTheme(t), t.appendChild(this.container), this.render(), this.container.isConnected && this.observeImpression();
  }
  observeImpression() {
    if (this.payload.verifiedDisplayManaged || this.payload.previewMode || this.impressionRecorded || this.disposed) return;
    this.impressionObserver?.disconnect(), this.impressionListeners?.abort();
    const t = () => {
      if (this.impressionRecorded || this.disposed || document.visibilityState === "hidden" || !E(this.container))
        return;
      const r = this.container.getBoundingClientRect();
      r.width <= 0 || r.height <= 0 || r.bottom <= 0 || r.right <= 0 || r.top >= window.innerHeight || r.left >= window.innerWidth || (this.impressionRecorded = !0, this.trackImpression(), this.impressionObserver?.disconnect(), this.impressionListeners?.abort());
    };
    this.impressionListeners = new AbortController();
    const e = { signal: this.impressionListeners.signal, passive: !0 };
    document.addEventListener("visibilitychange", t, e), window.addEventListener("scroll", t, { ...e, capture: !0 }), window.addEventListener("resize", t, e), typeof IntersectionObserver < "u" ? (this.impressionObserver = new IntersectionObserver(
      (r) => {
        r.some(
          (a) => a.isIntersecting && a.intersectionRatio > 0
        ) && t();
      },
      { threshold: 0.01 }
    ), this.impressionObserver.observe(this.container)) : t();
  }
  applyInlineTheme(t) {
    const e = this.container.style, r = getComputedStyle(t);
    r.color && e.setProperty("--aovboost-ink", r.color), e.setProperty("--aovboost-muted", "var(--aovboost-ink)"), e.setProperty("--aovboost-accent", "var(--aovboost-ink)"), e.setProperty(
      "--aovboost-line",
      "color-mix(in srgb, var(--aovboost-ink) 18%, transparent)"
    );
    for (let n = t; n; n = n.parentElement) {
      const i = getComputedStyle(n).backgroundColor;
      if (i && i !== "transparent" && i !== "rgba(0, 0, 0, 0)") {
        e.setProperty("--aovboost-surface", i);
        break;
      }
    }
    e.setProperty("--aovboost-action", "var(--aovboost-ink)"), e.setProperty("--aovboost-action-text", "var(--aovboost-surface)");
    const a = t.parentElement?.querySelector(
      ".product-form__submit, button[name='add'], button[name='checkout']"
    );
    if (a) {
      const n = getComputedStyle(a);
      n.backgroundColor && n.backgroundColor !== "transparent" && n.backgroundColor !== "rgba(0, 0, 0, 0)" && (e.setProperty("--aovboost-action", n.backgroundColor), e.setProperty("--aovboost-action-text", n.color)), n.borderRadius && e.setProperty("--aovboost-radius", n.borderRadius);
    }
  }
  injectStyles() {
    const t = document.createElement("style");
    t.textContent = Ie, this.root.appendChild(t);
  }
  trackImpression() {
    this.track("widget_impression", {});
  }
  trackClick(t) {
    this.track("widget_click", { action: t });
  }
  trackDismiss() {
    if (!this.payload.previewMode) {
      if (this.track("widget_dismiss", {
        productIds: oe(this.payload).map(({ id: t }) => t)
      }), this.getWidgetType() === "chat")
        try {
          sessionStorage.setItem("aovboost_chat_dismissed_session", "true");
        } catch {
        }
      try {
        const t = JSON.parse(localStorage.getItem(K) || "[]"), r = [
          ...(Array.isArray(t) ? t.filter((a) => typeof a == "object" && a) : []).filter(
            (a) => a.widgetType !== this.getWidgetType()
          ),
          { widgetType: this.getWidgetType(), dismissedAt: Date.now() }
        ];
        localStorage.setItem(K, JSON.stringify(r));
      } catch {
      }
    }
  }
  track(t, e) {
    if (this.payload.previewMode) return;
    const r = window.AOVBoostSDK?.track, a = {
      type: t,
      widgetType: this.getWidgetType(),
      offerId: this.payload.offerId,
      ...e
    };
    if (typeof r == "function") {
      r(t, a);
      return;
    }
    document.dispatchEvent(
      new CustomEvent("aovboost:track", { detail: a })
    );
  }
  html(t) {
    const e = this.root.querySelector("[data-aovboost-content]");
    e && e.remove();
    const r = document.createElement("div");
    r.setAttribute("data-aovboost-content", "true"), r.innerHTML = t, this.root.appendChild(r);
  }
}
function x(o, t = "") {
  return Ee(
    typeof o == "string" && o.trim() ? o : t
  );
}
function B() {
  const o = window.AOVBoost || {}, t = window.Shopify || {}, e = window.ShopifyAnalytics || {}, a = [
    { value: o.currency, source: "aovboost_config" },
    { value: o.currencyCode, source: "aovboost_config" },
    { value: t.currency?.active, source: "shopify_currency" },
    { value: t.checkout?.currency, source: "shopify_checkout" },
    { value: e.meta?.currency, source: "shopify_analytics" }
  ].find(
    (i) => L(i.value, "") !== ""
  );
  return {
    code: L(a?.value),
    source: a?.source || "fallback",
    moneyFormat: P(o.moneyFormat),
    moneyWithCurrencyFormat: P(o.moneyWithCurrencyFormat),
    locale: P(o.locale) || document.documentElement.lang || navigator.language
  };
}
function J(o, t = B()) {
  const e = Number(o || 0);
  if (!Number.isFinite(e)) return "";
  const r = ge(t), a = r.moneyFormat || r.moneyWithCurrencyFormat || "";
  if (a)
    return ve(e, a, r.code);
  try {
    return new Intl.NumberFormat(r.locale || void 0, {
      style: "currency",
      currency: r.code,
      currencyDisplay: "symbol"
    }).format(e);
  } catch {
    return `${r.code} ${e.toFixed(2)}`.trim();
  }
}
function ge(o) {
  if (typeof o == "string")
    return {
      ...B(),
      code: L(o)
    };
  const t = B();
  return {
    ...t,
    ...o,
    code: o.code === void 0 ? t.code : L(o.code)
  };
}
function L(o, t = ye) {
  const e = String(o || "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(e) ? e : t;
}
function P(o) {
  return typeof o == "string" && o.trim() ? o.trim() : "";
}
function ve(o, t, e) {
  const r = Se(t), a = r.match(/\{\{\s*(amount[a-z_]*)\s*\}\}/i), n = a?.[1] || "amount", i = we(o, n);
  return (a ? r.replace(a[0], i) : `${r}${i}`).replace(/\{\{\s*currency\s*\}\}/gi, e);
}
function we(o, t) {
  switch (t) {
    case "amount_no_decimals":
      return I(o, 0, ",", ".");
    case "amount_with_comma_separator":
      return I(o, 2, ".", ",");
    case "amount_no_decimals_with_comma_separator":
      return I(o, 0, ".", ",");
    case "amount_with_apostrophe_separator":
      return I(o, 2, "'", ".");
    case "amount_no_decimals_with_space_separator":
      return I(o, 0, " ", ".");
    case "amount_with_space_separator":
      return I(o, 2, " ", ".");
    default:
      return I(o, 2, ",", ".");
  }
}
function I(o, t, e, r) {
  const a = t > 0 ? o.toFixed(t) : String(Math.round(o)), [n, i] = a.split("."), s = n.replace(
    /\B(?=(\d{3})+(?!\d))/g,
    e
  );
  return i ? `${s}${r}${i}` : s;
}
function Se(o) {
  return o.replace(/<[^>]*>/g, "").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/g, "'");
}
function oe(o) {
  const e = [
    o.products,
    o.bundle?.items,
    o.items
  ].find((r) => Array.isArray(r));
  return Array.isArray(e) ? e.map((r) => {
    const a = r.product || r.target || r, n = String(
      a.variantId || r.variantId || ""
    ), i = xe(a.variants || r.variants);
    i.length === 0 && n && i.push({
      id: n,
      title: "Default",
      sku: "",
      price: String(a.price || r.price || "0"),
      compareAtPrice: null,
      quantityAvailable: null,
      availableForSale: !0,
      selectedOptions: []
    });
    const s = i.find(
      (c) => c.id === n && c.availableForSale
    ) || i.find((c) => c.availableForSale);
    return {
      id: a.id || r.productId || r.targetId,
      variantId: s?.id || "",
      title: a.title || r.title || "Recommended product",
      handle: a.handle || r.handle || "",
      imageUrl: a.imageUrl || a.image || r.imageUrl || r.image || "",
      price: String(s?.price || a.price || r.price || ""),
      quantity: Number(r.quantity || 1),
      reason: String(
        r.reason || r.affinity?.reason || r.reasoning || ""
      ),
      orderCount: Number(
        a.orderCount || r.orderCount || r.affinity?.orderCount || 0
      ),
      variants: i
    };
  }) : [];
}
function _e(o, t) {
  return o.variants.length <= 1 ? "" : `
    <label class="variant-picker">
      <span>Choose options</span>
      <select data-variant-picker="${x(t)}" aria-label="Choose ${x(o.title)} options">
        ${o.variants.map(
    (e) => `
              <option value="${x(e.id)}"
                ${e.id === o.variantId ? "selected" : ""}
                ${e.availableForSale ? "" : "disabled"}>
                ${x(ke(e))}${e.availableForSale ? "" : " - Sold out"}
              </option>
            `
  ).join("")}
      </select>
    </label>
  `;
}
function G(o, t, e) {
  const a = Array.from(
    o.querySelectorAll("[data-variant-picker]")
  ).find((n) => n.dataset.variantPicker === e)?.value || t.variantId;
  return t.variants.find(
    (n) => n.id === a && n.availableForSale
  ) || t.variants.find((n) => n.availableForSale) || null;
}
function ke(o) {
  return o.selectedOptions.map((e) => `${e.name}: ${e.value}`).join(" / ") || o.title || "Default";
}
function xe(o) {
  if (!Array.isArray(o)) return [];
  const t = /* @__PURE__ */ new Set();
  return o.map(
    (e) => e && typeof e == "object" && !Array.isArray(e) ? e : {}
  ).map((e) => {
    const r = String(e.id || ""), a = Number(e.price);
    if (!r.startsWith("gid://shopify/ProductVariant/") || !Number.isFinite(a))
      return null;
    const n = Array.isArray(e.selectedOptions) ? e.selectedOptions.map(
      (s) => s && typeof s == "object" && !Array.isArray(s) ? s : {}
    ).map((s) => ({
      name: String(s.name || ""),
      value: String(s.value || "")
    })).filter(
      (s) => s.name && s.value
    ) : [], i = e.quantityAvailable === null || e.quantityAvailable === void 0 ? null : Number(e.quantityAvailable);
    return {
      id: r,
      title: String(e.title || "Default"),
      sku: String(e.sku || ""),
      price: String(e.price),
      compareAtPrice: e.compareAtPrice === null || e.compareAtPrice === void 0 ? null : String(e.compareAtPrice),
      quantityAvailable: i !== null && Number.isFinite(i) ? i : null,
      availableForSale: e.availableForSale === !0,
      selectedOptions: n
    };
  }).filter((e) => !!e).filter((e) => t.has(e.id) ? !1 : (t.add(e.id), !0));
}
async function Ce(o, t = 1, e) {
  if (!o || !Number.isInteger(t) || t < 1 || t > 10)
    return null;
  const r = String(o).split("/").pop();
  return !r || !/^\d+$/.test(r) ? null : he("add", {
    id: r,
    quantity: t,
    properties: Te(e)
  });
}
function Te(o, t = {}) {
  const e = String(o || "").trim(), r = Object.entries(t).filter(
    ([i, s]) => i.startsWith("_aovboost_") && s
  ), a = Object.fromEntries(r), n = window.AOVBoostSDK?.sessionId;
  return n && /^[a-zA-Z0-9_-]{1,128}$/.test(n) && (a._aovboost_session_id = n), e && (a._aovboost_offer_id = e), Object.keys(a).length > 0 ? a : void 0;
}
function Ee(o) {
  return String(o || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
const Ie = `
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
class Ae extends be {
  constructor() {
    super(...arguments);
    k(this, "keyboard", new AbortController());
    k(this, "returnTo", null);
    k(this, "shiftTab", !1);
  }
  getWidgetType() {
    return "upsell_drawer";
  }
  render() {
    const e = oe(this.payload).slice(
      0,
      pe(this.payload.maxProductRecommendations)
    ), r = this.payload.copy || {}, a = this.payload.presentation === "inline";
    if (e.length === 0) {
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
            <h3 class="title">${x(r.headline || "Great choice. Complete the set")}</h3>
            <p class="body">Verified complementary products from this store:</p>
          </div>
          <button type="button" class="icon" data-dismiss aria-label="Close">x</button>
        </div>
        ${a ? "" : '<div class="added-note">Your selected item was added to the cart.</div>'}
        <div class="product-grid">
          ${e.map(
      (n, i) => `
                <article class="product-card">
                  ${n.imageUrl ? `<img src="${x(n.imageUrl)}" alt="${x(n.title)}" loading="lazy">` : "<span></span>"}
                  <div class="stack">
                    <div>
                      <p class="product-name">${x(n.title)}</p>
                      <span class="price" data-variant-price="upsell-${i}">${x(n.price ? J(n.price) : "")}</span>
                    </div>
                    <p class="reason">${x(n.reason || r.whyThisGoes || "It pairs well with your cart.")}</p>
                    ${_e(n, `upsell-${i}`)}
                    ${n.variants.some(
        (s) => s.availableForSale
      ) ? `<button type="button" class="primary" data-add data-product-index="${i}" ${this.payload.previewMode ? "disabled" : ""}>Add to cart</button>` : n.handle ? `<a class="primary" href="/products/${x(n.handle)}">View product</a>` : ""}
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
        e.forEach((i, s) => {
          const c = `upsell-${s}`, d = G(this.root, i, c), l = this.root.querySelector(
            `[data-variant-price="${c}"]`
          );
          l && d && (l.textContent = J(d.price));
        });
      });
    }), this.root.querySelectorAll("[data-add]").forEach((n) => {
      n.addEventListener("click", async () => {
        const i = n, s = Number(i.dataset.productIndex), c = e[s], d = c ? G(this.root, c, `upsell-${s}`) : null;
        if (!d) return;
        const l = this.root.querySelector(`[data-status="${s}"]`);
        i.disabled = !0, i.textContent = "Adding…", this.trackClick("add_upsell");
        try {
          if (!await Ce(
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
    ).filter((e) => !e.hasAttribute("hidden"));
  }
  bridgeTab(e) {
    const r = this.controls(), a = this.root.activeElement;
    if (!e.shiftKey && a !== r.at(-1) || e.shiftKey && a !== r[0])
      return;
    const n = this.container.closest(
      "[data-aovboost-cart-drawer], [role='dialog'], [aria-modal='true'], [data-cart-drawer]"
    );
    if (!n) return;
    const i = Array.from(
      n.querySelectorAll(
        "button:not(:disabled), select:not(:disabled), input:not([type='hidden']):not(:disabled), a[href], [tabindex='0']"
      )
    ).filter((d) => E(d)), s = i.indexOf(this.container);
    if (s < 0) return;
    const c = i[(s + (e.shiftKey ? i.length - 1 : 1)) % i.length];
    c && c !== this.container && (e.preventDefault(), e.stopPropagation(), c.focus());
  }
  destroy() {
    const e = document.activeElement === this.container, r = this.container.closest(
      "[data-aovboost-cart-drawer], [role='dialog'], [aria-modal='true'], [data-cart-drawer]"
    ), a = this.returnTo && this.returnTo !== this.container && this.returnTo.isConnected && (!r || r.contains(this.returnTo)) ? this.returnTo : r?.querySelector(
      ".drawer__close, [data-cart-close], button"
    );
    this.keyboard.abort(), super.destroy(), e && a && E(a) && a.focus();
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
  const o = window.location.pathname, t = window, e = String(
    document.body?.dataset.template || t.ShopifyAnalytics?.meta?.page?.pageType || ""
  ).toLowerCase();
  return /\/(?:thank_you|thank-you|orders)(?:\/|$)/.test(o) ? "thankyou" : /\/checkouts?(?:\/|$)/.test(o) ? "checkout" : /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:account|accounts|pages|policies|blogs|search|password)(?:\/|$)/i.test(
    o
  ) ? "other" : /\/products\/[^/]+/.test(o) ? "product" : /\/cart(?:\/|$)/.test(o) ? "cart" : /\/collections(?:\/|$)/.test(o) ? "collection" : o === "/" || /^\/[a-z]{2}(?:-[a-z]{2})?\/?$/i.test(o) ? "home" : e.startsWith("product") ? "product" : e.startsWith("collection") ? "collection" : e === "index" || e === "home" ? "home" : e === "cart" ? "cart" : "other";
}
const $e = "dialog[open], [aria-modal='true'], [role='dialog'], cart-drawer.active, cart-drawer[open], [data-cart-drawer], [data-cookie-banner], #shopify-pc__banner", U = "form,button,a,table,ul,ol,quick-add-modal,quick-add-drawer,[data-quick-add],[data-aovboost-widget]";
function T() {
  return [...document.querySelectorAll($e)].filter(
    E
  );
}
function re(o) {
  return T().some(
    (t) => t !== o && !t.contains(o) && !o.contains(t)
  );
}
function ne(o) {
  return !!o.querySelector(
    "a[href*='/products/'],[data-cart-line],cart-drawer-items,.cart-item"
  ) && !!o.querySelector(
    "button[name='checkout'],a[href*='/checkout'],[data-cart-checkout]"
  );
}
function j() {
  const o = /* @__PURE__ */ new Set();
  for (const e of [
    ...document.querySelectorAll(
      "button[name='checkout'], a[href*='/checkout'], [data-cart-checkout]"
    )
  ].slice(0, 20))
    for (let r = e.parentElement, a = 0; r && a < 5; r = r.parentElement, a++)
      if ((r.matches("[role='dialog'],[aria-modal='true'],[data-cart-drawer]") || r.tagName.includes("-")) && ne(r) && E(r) && !r.closest(U)) {
        o.add(r);
        break;
      }
  const t = [...o];
  return t.length === 1 && !re(t[0]) ? t[0] : null;
}
function ae(o) {
  if (o.id && R(`#${o.id}`)) return `#${o.id}`;
  const t = o.tagName.toLowerCase();
  if (R(t) && document.querySelectorAll(t).length === 1)
    return t;
  for (const e of [...o.classList]) {
    const r = `.${e}`;
    if (R(r) && document.querySelectorAll(r).length === 1)
      return r;
  }
}
function Z(o = location.pathname) {
  if (M() === "cart")
    return {
      cartUi: o === location.pathname ? "unknown" : "page_redirect"
    };
  const t = j();
  return t && !t.closest("cart-notification") && !/notification/i.test(t.id) ? { cartUi: "drawer", selector: ae(t) } : T().find(
    (r) => r.closest("cart-notification") || /cart.*notification/i.test(r.id) || r.querySelector("a[href*='/cart']") && !r.querySelector("[data-cart-line],cart-drawer-items,.cart-item")
  ) ? { cartUi: "popup_notification" } : { cartUi: T().length ? "unknown" : "no_feedback" };
}
function Me(o) {
  const t = location.pathname;
  let e = Z(t);
  const r = () => document.querySelector("[data-cart-count],.cart-count-bubble")?.textContent, a = r();
  return new Promise((n) => {
    const i = () => {
      const l = Z(t);
      l.cartUi !== "no_feedback" ? e = l : r() !== a && (e = { cartUi: "unknown" });
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
      clearTimeout(d), s.disconnect(), o.removeEventListener("abort", c), n(e);
    }, d = setTimeout(c, 1200);
    o.addEventListener("abort", c, { once: !0 }), o.aborted && c();
  });
}
function qe() {
  let o = null, t = null;
  const e = () => {
    o?.remove(), t?.dataset.aovboostMount && !t.childElementCount && t.remove(), t = null, o = null;
  }, r = (i) => {
    const c = i.identity.schemaName?.toLowerCase() === "dawn" ? document.querySelector(
      "cart-drawer.active #CartDrawer .drawer__inner[role='dialog'],cart-drawer[open] #CartDrawer .drawer__inner[role='dialog']"
    ) : null;
    if (c && E(c) && c.querySelector("cart-drawer-items #CartDrawer-CartItems") && ne(c) && !re(c))
      return c;
    const d = i.config.genericDrawer && R(i.config.drawerSelector) ? document.querySelector(i.config.drawerSelector) : null;
    return d && d === j() && !d.closest(U) ? d : null;
  }, a = (i, s, c) => {
    t = document.createElement("section"), t.dataset.aovboostMount = "adaptive-cart", t.style.cssText = "display:block;min-width:0;flex:0 0 auto;max-width:100%;", s.insertAdjacentElement("afterend", t), t.appendChild(c), o = c;
  }, n = () => {
    if (M() !== "cart" || T().length) return null;
    const i = document.querySelector("main,[role='main']"), s = i?.querySelector(
      "[data-aovboost-slot='upsell_drawer']"
    );
    if (s && !s.closest(U)) return s;
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
      canHandle: (i) => !!r(i),
      mount: (i, s) => {
        const c = r(s);
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
      unmount: e,
      verify: () => !!(o?.isConnected && t && E(t) && t.closest(
        "[role='dialog'],[aria-modal='true'],cart-drawer,[data-cart-drawer]"
      ))
    },
    {
      id: "cart_page",
      canHandle: () => !!n(),
      mount: (i) => {
        const s = n();
        if (!s) throw new Error("cart_page_unavailable");
        s.dataset.aovboostSlot ? (t = s, t.appendChild(i), o = i) : a(s.parentElement, s, i);
      },
      unmount: e,
      verify: () => !!(o?.isConnected && M() === "cart" && !T().length)
    },
    {
      id: "floating_card",
      canHandle: () => !T().length && ["product", "collection", "cart", "home"].includes(M()),
      mount: (i) => {
        if (T().length) throw new Error("competing_dialog");
        i.style.cssText += ";position:fixed;inset-inline-end:max(16px,env(safe-area-inset-left),env(safe-area-inset-right));bottom:max(16px,env(safe-area-inset-bottom));width:380px;max-width:calc(100vw - 32px - env(safe-area-inset-left) - env(safe-area-inset-right));max-height:50dvh;overflow:auto;z-index:9990;", document.body.appendChild(i), o = i;
      },
      unmount: e,
      verify: () => !!(o?.isConnected && !T().length)
    }
  ];
}
function Oe(o) {
  if (!o.isConnected || document.visibilityState === "hidden" || !E(o))
    return { verified: !1, reason: "hidden" };
  const t = o.getBoundingClientRect();
  let e = Math.max(0, t.left), r = Math.max(0, t.top), a = Math.min(innerWidth, t.right), n = Math.min(innerHeight, t.bottom);
  for (let c = o.parentElement; c; c = c.parentElement) {
    const d = getComputedStyle(c);
    if (/auto|scroll|hidden|clip/.test(
      `${d.overflow} ${d.overflowX} ${d.overflowY}`
    )) {
      const l = c.getBoundingClientRect();
      e = Math.max(e, l.left), a = Math.min(a, l.right), r = Math.max(r, l.top), n = Math.min(n, l.bottom);
    }
  }
  if ((t.width * t.height > 0 ? Math.max(0, a - e) * Math.max(0, n - r) / (t.width * t.height) : 0) < 0.5)
    return { verified: !1, reason: "outside_viewport" };
  if (typeof document.elementFromPoint != "function")
    return { verified: !1, reason: "hit_test_unavailable" };
  const s = document.elementFromPoint(
    t.left + t.width / 2,
    t.top + t.height / 2
  );
  return s === o || s && o.contains(s) ? { verified: !0, reason: "display_verified" } : { verified: !1, reason: "obscured" };
}
async function Ne(o, t) {
  const e = performance.now();
  let r = null, a = o.getBoundingClientRect(), n = 0, i = "verification_timeout";
  for (; !t.aborted && performance.now() - e < 3500; ) {
    const s = o.getBoundingClientRect();
    if (n += Math.abs(s.top - a.top) / Math.max(1, innerHeight) + Math.abs(s.left - a.left) / Math.max(1, innerWidth), a = s, n > 0.1)
      return { verified: !1, reason: "layout_shift" };
    const c = Oe(o);
    if (i = c.reason, c.verified) {
      if (r ?? (r = performance.now()), performance.now() - r >= 750) return c;
    } else r = null;
    await new Promise((d) => {
      const l = () => {
        clearTimeout(p), t.removeEventListener("abort", l), d();
      }, p = setTimeout(l, 100);
      t.addEventListener("abort", l, { once: !0 });
    });
  }
  return { verified: !1, reason: t.aborted ? "cancelled" : i };
}
function z(o) {
  if (/^#[\da-f]{6}$/i.test(o))
    return [1, 3, 5].map((r) => parseInt(o.slice(r, r + 2), 16));
  const t = /^rgba?\(\s*(\d+(?:\.\d+)?)[, ]+\s*(\d+(?:\.\d+)?)[, ]+\s*(\d+(?:\.\d+)?)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i.exec(
    o
  );
  if (!t || t[4] && Number(t[4]) !== 1) return null;
  const e = t.slice(1, 4).map(Number);
  return e.every((r) => r >= 0 && r <= 255) ? e : null;
}
function A(o, t) {
  const e = (s) => s.map((c) => {
    const d = c / 255;
    return d <= 0.04045 ? d / 12.92 : ((d + 0.055) / 1.055) ** 2.4;
  }).reduce((c, d, l) => c + d * [0.2126, 0.7152, 0.0722][l], 0), r = z(o), a = z(t);
  if (!r || !a) return 0;
  const n = e(r), i = e(a);
  return (Math.max(n, i) + 0.05) / (Math.min(n, i) + 0.05);
}
function Q(o, t) {
  const e = getComputedStyle(document.body), r = document.querySelector(
    "button[name='checkout'], button[name='add'], .product-form__submit"
  ), a = r ? getComputedStyle(r) : e, n = z(e.backgroundColor) ? e.backgroundColor : "#ffffff", i = A(e.color, n) >= 4.5 ? e.color : "#171717", s = A(i, n) >= 4.5 ? n : "#ffffff", c = t.accentColor || a.backgroundColor, d = A(c, a.color) >= 4.5 || A(c, "#ffffff") >= 4.5 ? c : "#171717", l = A(d, a.color) >= 4.5 ? a.color : "#ffffff", p = document.querySelector("a[href]"), m = p ? getComputedStyle(p).color : i, f = {
    "--aovboost-ink": i,
    "--aovboost-surface": s,
    "--aovboost-muted": i,
    "--aovboost-accent": A(d, s) >= 4.5 ? d : i,
    "--aovboost-action": d,
    "--aovboost-action-text": l,
    "--aovboost-radius": t.radius != null ? `${t.radius}px` : a.borderRadius || "8px",
    "--aovboost-link": A(m, s) >= 4.5 ? m : i,
    "--aovboost-font": t.font === "system" ? "system-ui, sans-serif" : e.fontFamily || "system-ui, sans-serif"
  };
  for (const [b, v] of Object.entries(f))
    o.style.setProperty(b, v);
  o.style.fontFamily = "var(--aovboost-font)", o.style.fontSize = `${Math.max(14, Math.min(20, parseFloat(e.fontSize) || 16))}px`, o.style.direction = e.direction === "rtl" ? "rtl" : "ltr", o.style.colorScheme = e.colorScheme || "normal";
}
let Re = 0;
const Le = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${++Re}`, ee = (o, t) => /^\d+$/.test(String(t || "")) ? `gid://shopify/${o}/${t}` : String(t || "");
async function te() {
  const o = new AbortController(), t = window.setTimeout(() => o.abort(), 1500);
  try {
    const e = await fetch(V("read"), {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: o.signal
    });
    if (!e.ok) return null;
    const r = await e.json();
    if (!Array.isArray(r.items) || !Number.isFinite(Number(r.item_count)))
      return null;
    const a = r.items.slice(0, 100).map((n) => ({
      key: String(n.key || ""),
      productId: ee("Product", n.product_id || n.productId),
      variantId: ee(
        "ProductVariant",
        n.variant_id || n.variantId || n.id
      ),
      quantity: Math.max(0, Number(n.quantity) || 0),
      title: String(n.product_title || n.title || ""),
      handle: String(n.handle || n.url || "").split("/products/").pop()?.split(/[?#/]/)[0] || ""
    }));
    return r.items.length > 100 ? null : {
      cartToken: String(r.token || ""),
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
      cartItemCount: Math.max(0, Number(r.item_count)),
      cartValue: Number(r.total_price || 0) / 100,
      currency: String(r.currency || "")
    };
  } catch {
    return null;
  } finally {
    window.clearTimeout(t);
  }
}
function De() {
  const o = window.Shopify?.theme || {};
  return ue({
    themeId: o.id,
    themeName: o.name,
    schemaName: o.schema_name,
    themeStoreId: o.theme_store_id,
    role: o.role
  });
}
const O = "aovboost_theme_preview_v1";
async function Be(o) {
  const t = De(), e = new URL(location.href);
  e.searchParams.delete("aovboost_preview"), history.replaceState(history.state, "", e);
  const r = document.createElement("aside");
  r.setAttribute("aria-label", "AOVBoost theme test"), r.style.cssText = "position:fixed;bottom:16px;left:16px;z-index:9991;max-width:320px;background:white;color:#171717;border:1px solid #777;border-radius:8px;padding:16px;font:16px system-ui";
  const a = document.createElement("p");
  a.setAttribute("role", "status");
  const n = document.createElement("button");
  n.type = "button", n.textContent = "Run one test add", r.append(a, n), document.body.append(r);
  const i = async (l, p) => {
    const m = await fetch(`${o.apiBase}/theme-preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: o.token, intent: l, ...p })
    });
    if (!m.ok) throw new Error("Preview unavailable");
    return m.json();
  };
  let s;
  try {
    s = JSON.parse(sessionStorage.getItem(O) || "null");
  } catch {
  }
  const c = () => sessionStorage.setItem(O, JSON.stringify(s)), d = async () => {
    const l = String(s.variantId || "");
    let p = !1;
    for (let b = 0; b < 5; b++) {
      if (((await te())?.cartItems.filter((h) => String(h.variantId).split("/").pop() === l).reduce((h, w) => h + w.quantity, 0) || 0) > s.before) {
        p = !0;
        break;
      }
      await new Promise((h) => setTimeout(h, 400));
    }
    const m = Pe({
      identity: t,
      config: s.data.config,
      report: () => {
      }
    });
    let f = {
      strategy: "none",
      verified: !1,
      reason: "test_add_unconfirmed"
    };
    if (p && s.data.config.preference === "cart_page" && !/\/cart\/?$/.test(location.pathname)) {
      location.assign(V("read").replace(/\.js$/, ""));
      return;
    }
    p && (f = await m.mount({
      ...s.data.payload,
      previewMode: !0,
      mutationId: "preview"
    })), await i("report", {
      report: {
        identity: t,
        attemptId: "preview",
        ...f,
        cartUi: f.cartUi || (location.pathname.includes("/cart") ? "page_redirect" : "unknown")
      }
    }), sessionStorage.removeItem(O), n.remove(), a.textContent = f.verified ? "Test complete: a recommendation card was verified. Return to AOVBoost for the result." : "The test could not verify a display. Return to AOVBoost for guidance.", window.addEventListener("pagehide", () => m.destroy(), { once: !0 });
  };
  try {
    if (s?.token === o.token && s?.started && s.expires > Date.now()) {
      n.remove(), a.textContent = "Checking the test add…", await d();
      return;
    }
    const l = await i("bootstrap", { identity: t });
    s = {
      token: o.token,
      expires: Date.now() + 3e5,
      data: l,
      started: !1
    }, c(), a.textContent = "This test adds one item using your store's own product form. The item stays in your cart. No shopper analytics are recorded.", n.addEventListener(
      "click",
      async () => {
        n.disabled = !0;
        try {
          const p = [
            ...document.querySelectorAll(
              "form[action*='/cart/add']"
            )
          ].filter((h) => {
            const w = h.elements.namedItem(
              "id"
            );
            return l.source.variantIds.some(
              (S) => S.split("/").pop() === String(w?.value)
            );
          });
          if (p.length !== 1)
            throw new Error("No unambiguous native product form");
          const m = p[0], f = m.elements.namedItem("id"), b = m.elements.namedItem(
            "quantity"
          );
          if (b && Number(b.value) !== 1)
            throw new Error(
              "Set the native product quantity to one, then create a new test link"
            );
          const v = await te();
          if (!v) throw new Error("Cart could not be read");
          s.before = v.cartItems.filter(
            (h) => String(h.variantId).split("/").pop() === f.value
          ).reduce((h, w) => h + w.quantity, 0), s.variantId = f.value, s.started = !0, c(), a.textContent = "Running the native add and checking placement…";
          const u = m.querySelector(
            "button[name='add'],button[type='submit']"
          );
          m.requestSubmit(u || void 0), await d();
        } catch {
          sessionStorage.removeItem(O), a.textContent = "The native add or display could not be verified. Check the product form and create a new test link in AOVBoost.";
        }
      },
      { once: !0 }
    );
  } catch {
    sessionStorage.removeItem(O), n.remove(), a.textContent = "Preview expired or unavailable. Create a new test link in AOVBoost.";
  }
}
function Pe(o) {
  let t = new AbortController(), e, r, a, n, i = "", s = 0;
  const c = qe(), d = /* @__PURE__ */ new Set(), l = /* @__PURE__ */ new Set();
  let p = !1, m = !1;
  const f = () => {
    t.abort(), a?.disconnect(), e?.destroy(), r?.unmount(), e = void 0, r = void 0, n = void 0;
  }, b = (u) => {
    m || i === u && n || (f(), t = new AbortController(), i = u, s = 0, n = Me(t.signal));
  }, v = async (u) => {
    if (m)
      return {
        strategy: "none",
        verified: !1,
        reason: "local_circuit_open"
      };
    if (!["home", "product", "collection", "cart"].includes(M()))
      return { strategy: "none", verified: !1, reason: "protected_page" };
    b(String(u.mutationId || "preview"));
    const h = t.signal, w = await n, S = u.cartUiHint === "page_redirect" && M() === "cart" ? { ...w, cartUi: "page_redirect" } : w, C = { config: o.config, identity: o.identity }, ie = o.config.preference === "off" || o.config.status === "disabled" ? "none" : o.config.strategy, H = c.findIndex((y) => y.id === ie);
    if (H < 0 || h.aborted)
      return {
        strategy: "none",
        verified: !1,
        reason: "placement_disabled"
      };
    const se = Le(), W = j(), X = W ? ae(W) : S.selector, q = (y, g, D) => {
      h.aborted || Promise.resolve(
        o.report({
          identity: o.identity,
          attemptId: `${se}-${y}`,
          offerId: String(u.offerId || ""),
          strategy: y,
          verified: g,
          reason: D,
          cartUi: S.cartUi,
          ...X ? { selector: X } : {}
        })
      ).catch(() => {
      });
    };
    for (const y of c.slice(H))
      if (!d.has(y.id)) {
        if (h.aborted)
          return { strategy: "none", verified: !1, reason: "cancelled" };
        if (!(o.config.preference === "cart_page" && y.id !== "cart_page"))
          try {
            if (y.id === "floating_card" && !y.canHandle(C) && await new Promise((_) => {
              const Y = new MutationObserver(() => {
                try {
                  y.canHandle(C) && $();
                } catch {
                  $();
                }
              }), $ = () => {
                clearTimeout(ce), Y.disconnect(), h.removeEventListener("abort", $), _();
              }, ce = setTimeout($, 15e3);
              Y.observe(document.body, {
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
              }), h.addEventListener("abort", $, { once: !0 }), h.aborted && $();
            }), !y.canHandle(C)) {
              q(y.id, !1, "adapter_unavailable");
              continue;
            }
            e = new Ae({
              ...u,
              presentation: "inline",
              cartDrawer: y.id === "native_drawer",
              verifiedDisplayManaged: !0
            });
            const g = e.getElement();
            g.style.cssText = "display:block;max-height:45dvh;overflow:auto;min-width:0;", y.mount(g, C), r = y, e.mount(g.parentElement), Q(g, o.config.appearance), g.shadowRoot?.querySelector("style")?.append(
              document.createTextNode(
                `
:host{font-family:var(--aovboost-font,system-ui)!important} .primary{border-radius:var(--aovboost-radius,8px)} a{color:var(--aovboost-link)} @media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}`
              )
            );
            const D = () => {
              try {
                const _ = !y.verify();
                g.hidden !== _ && (g.hidden = _);
              } catch {
                if (p) return;
                p = !0, d.add(y.id), q(y.id, !1, "adapter_exception"), f(), v(u).finally(() => {
                  p = !1;
                });
              }
            };
            a = new MutationObserver(() => {
              if (h.aborted || e?.isDestroyed()) {
                e?.isDestroyed() && t.abort(), a?.disconnect();
                return;
              }
              if (!g.isConnected && s++ < 3)
                try {
                  y.canHandle(C) && (y.mount(g, C), e?.reattach(g.parentElement), Q(g, o.config.appearance));
                } catch {
                  g.remove();
                }
              g.isConnected && D();
            }), a.observe(document.body, {
              subtree: !0,
              childList: !0,
              attributes: !0,
              attributeFilter: ["class", "open", "hidden", "aria-hidden", "style"]
            }), document.addEventListener(
              "keydown",
              (_) => {
                _.key === "Escape" && y.id === "floating_card" && !_.defaultPrevented && !g.hidden && y.verify() && (_.preventDefault(), e?.dismissFromKeyboard());
              },
              { signal: h }
            );
            const N = await Ne(g, h);
            if (h.aborted)
              return { strategy: "none", verified: !1, reason: "cancelled" };
            if (N.verified && y.verify()) {
              const _ = String(
                u.offerId || u.mutationId || "preview"
              );
              return l.has(_) || (e.recordVerifiedImpression(y.id), l.add(_)), q(y.id, !0, N.reason), { strategy: y.id, ...N, cartUi: S.cartUi };
            }
            q(y.id, !1, N.reason), a.disconnect(), e.destroy(), y.unmount();
          } catch {
            d.add(y.id), a?.disconnect(), e?.destroy(), y.unmount(), q(y.id, !1, "adapter_exception");
          }
      }
    return m = !0, {
      strategy: "none",
      verified: !1,
      reason: "all_strategies_failed",
      cartUi: S.cartUi
    };
  };
  return {
    prepare: b,
    mount: v,
    destroy: f,
    isMounted: () => !!(e?.isMounted() && !e.getElement().hidden)
  };
}
export {
  Pe as createThemeEngine,
  Be as runThemePreview
};
