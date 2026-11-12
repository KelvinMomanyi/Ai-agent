import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// Synthetic, in-memory Shopify/app-proxy stand-ins. No .env, DB or external API.
const origin = "http://127.0.0.1:4179";
const shop = "aovboost-browser-fixture.myshopify.com";
const assets = resolve("extensions/aovboost-storefront/assets");
let state;
const product = (id) => ({
  id,
  handle: id === 1 ? "shampoo" : "conditioner",
  title: id === 1 ? "Shampoo" : "Conditioner",
  price: id === 1 ? 2000 : 1200,
  variant: id === 1 ? 101 : 102,
});
function reset(options = {}) {
  state = {
    mode: ["drawer", "popup", "floating", "redirect", "velour"].includes(
      options.mode,
    )
      ? options.mode
      : "drawer",
    holdout: options.holdout === true,
    failOffer: options.failOffer === true,
    soldOut: options.soldOut === true,
    lines: options.restored ? [{ id: 101, quantity: 1 }] : [],
    attributes: {},
    offers: [],
    events: [],
    reports: [],
  };
}
reset();
function cart() {
  const items = state.lines.map((line) => {
    const p = product(line.id === 101 ? 1 : 2);
    return {
      id: p.variant,
      key: `line-${p.variant}`,
      variant_id: p.variant,
      product_id: p.id,
      title: p.title,
      handle: p.handle,
      quantity: line.quantity,
      price: p.price,
    };
  });
  return {
    token: "synthetic-cart",
    currency: "USD",
    items,
    item_count: items.reduce((sum, item) => sum + item.quantity, 0),
    total_price: items.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0,
    ),
    attributes: state.attributes,
  };
}
const theme = () => ({
  themeId: "123",
  status: "learning",
  strategy: "native_drawer",
  genericDrawer: false,
  preference: "auto",
  appearance: { accentColor: null, radius: null, font: "inherit" },
});
const measurement = () => ({
  arm: state.holdout ? "holdout" : "exposed",
  version: 1,
  percent: 10,
  link: "synthetic-measurement-link",
});
const settings = () => ({
  focusedMode: true,
  upsellEnabled: true,
  chatEnabled: false,
  analyticsEnabled: true,
  liveEventsEnabled: false,
  holdout: state.holdout,
  themeCompatibility: theme(),
});
const json = (res, value, status = 200) => {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(value));
};
// Minimal Velour-shaped sections: dynamic cart wrapper, native quantity
// controls, editable notes and a header badge. No production theme code/data.
function velourSection(id) {
  const value = cart();
  if (id === "sections--88__header")
    return `<div id="shopify-section-${id}"><header><button type="button" aria-label="Cart">Cart <span data-cart-count>${value.item_count}</span></button></header></div>`;
  if (id !== "template--77__cart") return null;
  return `<div id="shopify-section-${id}"><div class="cart-container"><h2>Shopping Cart</h2><form action="/cart" method="post"><table><tbody>${value.items.map((item, index) => `<tr class="cart-item" data-line="${index + 1}"><td>${item.title}</td><td><input name="updates[]" type="number" min="0" aria-label="Quantity for ${item.title}" value="${item.quantity}"></td></tr>`).join("")}</tbody></table><label>Order notes<textarea name="note"></textarea></label><p>Subtotal: <strong class="cart-subtotal__value">$${(value.total_price / 100).toFixed(2)}</strong></p><button name="checkout">Checkout</button></form></div></div>`;
}
async function body(req) {
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 65_536) throw new Error("Fixture request too large");
  }
  return req.headers["content-type"]?.includes(
    "application/x-www-form-urlencoded",
  )
    ? Object.fromEntries(new URLSearchParams(text))
    : text
      ? JSON.parse(text)
      : {};
}
async function page(path) {
  const isCart = path === "/cart";
  let markup = await readFile(
    resolve(
      "storefront-sdk/test/fixtures/themes",
      isCart ? "cart-page.html" : "redirect-product.html",
    ),
    "utf8",
  );
  if (!isCart && state.mode === "drawer") {
    markup = (
      await readFile(
        resolve("storefront-sdk/test/fixtures/themes/dawn-drawer.html"),
        "utf8",
      )
    ).replace('class="drawer active"', 'class="drawer"');
  }
  if (isCart && state.mode === "velour")
    markup = `${velourSection("sections--88__header")}<main>${velourSection("template--77__cart")}</main>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>AOVBoost local browser simulation</title>
    <style>
      body{font:16px Arial,sans-serif;color:#171717;background:#fff;margin:0;padding:20px}
      main{max-width:720px} button{padding:10px;background:#173b33;color:#fff;border-radius:6px}
      cart-drawer:not(.active){display:none} cart-drawer.active{display:block;position:fixed;inset:0 0 0 auto;width:min(400px,100vw);background:white;z-index:50;box-shadow:0 0 20px #999}
      .drawer__inner{display:block;padding:16px;box-sizing:border-box;height:100%;overflow:auto}
      cart-drawer-items{display:block;min-height:50px}
      #fixture-popup{position:fixed;inset:10px 10px auto auto;background:white;padding:20px;z-index:60}
      #main-cart-items,cart-items{display:block;min-height:60px}
    </style></head><body>
    <h1>Local simulated store</h1>${markup}
    <output id="cart-count">${cart().item_count}</output>
    <script>
      window.Shopify={shop:${JSON.stringify(shop)},routes:{root:'/'},currency:{active:'USD'},theme:{id:123,name:'Dawn',schema_name:'Dawn'}};
      window.AOVBoost={shop:${JSON.stringify(shop)},apiBase:'/apps/aovboost',currency:'USD'};
      const mode=${JSON.stringify(state.mode)};
      const form=document.querySelector('form[action*="/cart/add"]');
      if(form){
        form.action='/cart/add'; form.method='post';
        form.querySelector('button').textContent='Add Shampoo';
        if(!['redirect','velour'].includes(mode))form.addEventListener('submit',async(event)=>{
          event.preventDefault();
          const response=await fetch('/cart/add.js',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:101,quantity:1})});
          if(!response.ok)return;
          const cart=await(await fetch('/cart.js')).json();
          document.querySelector('#cart-count').textContent=cart.item_count;
          if(mode==='drawer')document.querySelector('cart-drawer').classList.add('active');
          if(mode==='popup'){
            const popup=document.createElement('section');popup.id='fixture-popup';popup.setAttribute('role','dialog');popup.setAttribute('aria-modal','true');
            popup.innerHTML='<p>Added to your cart</p><button type="button">Close cart notification</button>';
            popup.querySelector('button').onclick=()=>popup.remove();document.body.appendChild(popup);
          }
        });
      }
      document.querySelector('.drawer__close')?.addEventListener('click',()=>document.querySelector('cart-drawer').classList.remove('active'));
      document.addEventListener('aovboost:cart-updated',async()=>{
        const cart=await(await fetch('/cart.js')).json();document.querySelector('#cart-count').textContent=cart.item_count;
      });
      if(mode==='velour') {
        function bindNativeCart() {
          const form=document.querySelector('.cart-container form');
          if(!form || form.dataset.liveCartBound==='true')return;
          form.dataset.liveCartBound='true';
          form.querySelectorAll('input[name="updates[]"]').forEach(input=>input.addEventListener('change',async()=>{
            const response=await fetch('/cart/change.js',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({line:Number(input.closest('[data-line]').dataset.line),quantity:Number(input.value)})});
            const cart=await response.json();document.querySelector('#cart-count').textContent=cart.item_count;
          }));
        }
        document.addEventListener('shopify:section:load',bindNativeCart);bindNativeCart();
      }
    </script>
    <script src="/assets/aovboost-sdk.js" defer></script></body></html>`;
}
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    const path = url.pathname;
    if (req.headers.host !== "127.0.0.1:4179")
      return json(res, { error: "Loopback fixture only" }, 403);
    if (path === "/__qa/health") return json(res, { simulation: true });
    if (path === "/__qa/reset" && req.method === "POST") {
      reset(await body(req));
      return json(res, { simulation: true });
    }
    if (path === "/__qa/state")
      return json(res, { ...state, cart: cart(), simulation: true });
    if (path.startsWith("/assets/")) {
      const name = path.slice("/assets/".length);
      if (!/^aovboost-(?:sdk|theme-engine-[\w-]+)\.js$/.test(name))
        return json(res, { error: "Unknown asset" }, 404);
      res.writeHead(200, { "Content-Type": "application/javascript" });
      return res.end(await readFile(resolve(assets, name)));
    }
    if (path === "/favicon.ico") {
      res.writeHead(204);
      return res.end();
    }
    if (path === "/cart.js") return json(res, cart());
    if (path === "/cart" && url.searchParams.has("sections"))
      return json(
        res,
        Object.fromEntries(
          url.searchParams
            .get("sections")
            .split(",")
            .map((id) => [id, velourSection(id)]),
        ),
      );
    if (["/cart/add.js", "/cart/add"].includes(path) && req.method === "POST") {
      const data = await body(req);
      const inputs = data.items || [data];
      for (const input of inputs) {
        const id = Number(input.id);
        if (![101, 102].includes(id))
          return json(res, { error: "Unknown fixture variant" }, 422);
        const old = state.lines.find((line) => line.id === id);
        if (old) old.quantity += Number(input.quantity || 1);
        else state.lines.push({ id, quantity: Number(input.quantity || 1) });
      }
      if (path === "/cart/add") {
        res.writeHead(303, { Location: "/cart" });
        return res.end();
      }
      return json(res, {
        ...cart().items.at(-1),
        items: cart().items,
        ...(state.mode === "velour"
          ? {
              sections: Object.fromEntries(
                (data.sections || []).map((id) => [id, velourSection(id)]),
              ),
            }
          : {}),
      });
    }
    if (path === "/cart/change.js" && req.method === "POST") {
      const data = await body(req);
      const line = state.lines[Number(data.line) - 1];
      if (!line || !Number.isInteger(data.quantity) || data.quantity < 0)
        return json(res, { error: "Invalid synthetic line" }, 422);
      line.quantity = data.quantity;
      state.lines = state.lines.filter((item) => item.quantity > 0);
      return json(res, cart());
    }
    if (path === "/cart/update.js") {
      Object.assign(state.attributes, (await body(req)).attributes || {});
      return json(res, cart());
    }
    if (
      path === "/products/shampoo.js" ||
      path === "/products/conditioner.js"
    ) {
      const p = product(path.includes("conditioner") ? 2 : 1);
      return json(res, {
        id: p.id,
        variants: [
          {
            id: p.variant,
            price: p.price,
            available: !state.soldOut || p.id === 1,
          },
        ],
      });
    }
    if (path === "/apps/aovboost/session")
      return json(res, {
        shop,
        sessionId: "synthetic-session",
        sessionToken: "synthetic-not-a-real-token",
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        settings: settings(),
        measurement: measurement(),
      });
    if (path === "/apps/aovboost/config")
      return json(res, {
        settings: settings(),
        theme: theme(),
        measurement: measurement(),
      });
    if (path === "/apps/aovboost/offer") {
      const data = await body(req);
      state.offers.push({
        trigger: data.trigger,
        mutationId: data.triggerPayload?.mutationId,
        cartProductIds: data.cartProductIds,
      });
      if (state.failOffer)
        return json(res, { error: "Simulated offer outage" }, 503);
      if (state.holdout)
        return json(res, {
          widgetType: null,
          reasoning: "holdout_assigned",
          measurement: measurement(),
        });
      const p = product(2);
      return json(res, {
        widgetType: "upsell_drawer",
        aiProvider: "heuristic",
        payload: {
          offerId: `synthetic-offer-${state.offers.length}`,
          triggerType: "cart_item_added",
          mutationId: data.triggerPayload.mutationId,
          products: [
            {
              productId: "gid://shopify/Product/2",
              reason: "Selected from the fixture catalog.",
              product: {
                id: "gid://shopify/Product/2",
                handle: p.handle,
                title: p.title,
                price: "12.00",
                variantId: "gid://shopify/ProductVariant/102",
                variants: [
                  {
                    id: "gid://shopify/ProductVariant/102",
                    title: "Default",
                    price: "12.00",
                    availableForSale: true,
                  },
                ],
              },
            },
          ],
        },
      });
    }
    if (path === "/apps/aovboost/events") {
      const data = await body(req);
      for (const event of data.events || [])
        state.events.push({
          type: event.type,
          verified: event.verified,
          strategy: event.strategy,
          recommendationOrigin: event.recommendationOrigin,
        });
      return json(res, { ok: true });
    }
    if (path === "/apps/aovboost/theme-report") {
      const data = await body(req);
      state.reports.push({
        strategy: data.strategy,
        verified: data.verified,
        reason: data.reason,
      });
      return json(res, { ok: true });
    }
    if (["/products/shampoo", "/cart"].includes(path)) {
      res.writeHead(200, {
        "Content-Type": "text/html",
        "Cache-Control": "no-store",
      });
      return res.end(await page(path));
    }
    return json(res, { error: "Unknown fixture route" }, 404);
  } catch {
    json(res, { error: "Fixture request failed" }, 500);
  }
});
server.listen(4179, "127.0.0.1", () =>
  console.log(`AOVBoost simulation fixture: ${origin}`),
);
