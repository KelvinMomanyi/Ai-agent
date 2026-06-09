var AOVBoostSDKBundle=function(u){"use strict";var ht=Object.defineProperty;var gt=(u,p,g)=>p in u?ht(u,p,{enumerable:!0,configurable:!0,writable:!0,value:g}):u[p]=g;var r=(u,p,g)=>gt(u,typeof p!="symbol"?p+"":p,g);class p{constructor(t){r(this,"queue",[]);r(this,"flushTimer");r(this,"scrollDepths",new Set);r(this,"originalFetch",null);this.options=t}init(){this.installNavigationTracking(),this.installCartFetchTracking(),this.installScrollTracking(),this.installHoverTracking(),this.installSearchTracking(),document.addEventListener("add-to-cart",t=>{this.track("add_to_cart",g(t.detail))}),document.addEventListener("aovboost:track",t=>{const e=g(t.detail);this.track(String(e.type||"widget_event"),e)}),window.addEventListener("pagehide",()=>this.flush()),this.trackPageView()}track(t,e={}){const s={type:t,ts:Date.now(),sessionId:this.options.sessionManager.anonymousId,shop:this.options.shop,url:window.location.href,referrer:document.referrer,...e};this.options.sessionManager.recordEvent(s),this.queue.push(s),this.scheduleFlush()}flush(){if(this.flushTimer&&(window.clearTimeout(this.flushTimer),this.flushTimer=void 0),this.queue.length===0)return;const t=this.queue.splice(0),e=JSON.stringify({sessionId:this.options.sessionManager.anonymousId,shop:this.options.shop,events:t});try{if(navigator.sendBeacon&&navigator.sendBeacon(this.endpoint("/events"),new Blob([e],{type:"application/json"})))return}catch{}fetch(this.endpoint("/events"),{method:"POST",headers:{"Content-Type":"application/json","X-AOVBoost-Shop":this.options.shop},body:e,keepalive:!0}).catch(()=>{this.queue.unshift(...t)})}scheduleFlush(){this.flushTimer||(this.flushTimer=window.setTimeout(()=>this.flush(),2e3))}endpoint(t){return`${(this.options.apiBase||"/apps/aovboost").replace(/\/$/,"")}${t}`}installNavigationTracking(){const t=history.pushState,e=history.replaceState;history.pushState=(...s)=>{const o=t.apply(history,s);return window.setTimeout(()=>this.trackPageView(),0),o},history.replaceState=(...s)=>{const o=e.apply(history,s);return window.setTimeout(()=>this.trackPageView(),0),o},window.addEventListener("popstate",()=>this.trackPageView())}trackPageView(){this.track("page_view",{pageType:V()}),M()&&this.track("checkout_start",{path:window.location.pathname});const t=L();t&&this.track("product_view",{productId:F(t.gid||t.id),handle:t.handle,title:t.title});const e=O();(e||window.location.pathname.includes("/collections/"))&&this.track("collection_view",{collectionId:String(e?.id||""),handle:e?.handle||B("/collections/"),title:e?.title})}installCartFetchTracking(){this.originalFetch||(this.originalFetch=window.fetch.bind(window),window.fetch=async(...t)=>{const e=j(t[0]),s=t[1],o=await this.originalFetch(...t);try{N(e)?this.track("add_to_cart",{...T(s?.body),requestUrl:e}):U(e)?this.track("remove_from_cart",{...T(s?.body),requestUrl:e}):W(e)&&this.track("search",{query:z(e),requestUrl:e})}catch{}return o})}installScrollTracking(){let t=!1;window.addEventListener("scroll",()=>{t||(t=!0,window.setTimeout(()=>{t=!1;const e=document.documentElement.scrollHeight-window.innerHeight;if(e<=0)return;const s=Math.round(window.scrollY/e*100);[25,50,75,90].forEach(o=>{s>=o&&!this.scrollDepths.has(o)&&(this.scrollDepths.add(o),this.track("scroll_depth",{depth:o}))})},200))},{passive:!0})}installHoverTracking(){document.addEventListener("mouseenter",t=>{const s=t.target?.closest?.(".product-card");if(!s)return;const o=window.setTimeout(()=>{this.track("product_hover",{productId:s.dataset.productId||s.dataset.productGid||"",handle:s.dataset.productHandle||""})},800);s.addEventListener("mouseleave",()=>window.clearTimeout(o),{once:!0})},!0)}installSearchTracking(){document.addEventListener("input",t=>{const e=t.target;if(!e||!`${e.name||""} ${e.id||""} ${e.type||""}`.toLowerCase().includes("search"))return;const o=e.value.trim();o.length<2||this.track("search",{query:o,source:"predictive_input"})},!0)}}function g(i){return i&&typeof i=="object"&&!Array.isArray(i)?i:{}}function L(){const i=window;return i.Shopify?.product||i.ShopifyAnalytics?.meta?.product||null}function O(){const i=window;return i.Shopify?.collection||i.ShopifyAnalytics?.meta?.collection||null}function V(){return window.ShopifyAnalytics?.meta?.page?.pageType||document.body?.dataset?.template||(window.location.pathname==="/"?"home":"other")}function M(){return/\/checkout(?:\/|$)/.test(window.location.pathname)}function B(i){const t=window.location.pathname.indexOf(i);return t===-1?"":window.location.pathname.slice(t+i.length).split("/")[0]||""}function j(i){return typeof i=="string"?i:i instanceof URL?i.toString():i.url||""}function N(i){return/\/cart\/add(?:\.js)?/.test(i)}function U(i){return/\/cart\/(?:change|update)(?:\.js)?/.test(i)}function W(i){return i.includes("/search/suggest.json")}function z(i){try{return new URL(i,window.location.origin).searchParams.get("q")||""}catch{return""}}function T(i){if(!i)return{};if(typeof FormData<"u"&&i instanceof FormData)return{variantId:String(i.get("id")||i.get("items[0][id]")||""),quantity:Number(i.get("quantity")||1)};if(typeof URLSearchParams<"u"&&i instanceof URLSearchParams)return{variantId:String(i.get("id")||i.get("items[0][id]")||""),quantity:Number(i.get("quantity")||1)};try{const t=String(i);if(t.trim().startsWith("{")){const s=JSON.parse(t);return{productId:s.productId||s.product_id,variantId:s.id||s.items?.[0]?.id,quantity:s.quantity||s.items?.[0]?.quantity||1}}const e=new URLSearchParams(t);return{variantId:String(e.get("id")||e.get("items[0][id]")||""),quantity:Number(e.get("quantity")||1)}}catch{return{}}}function F(i){const t=String(i||"");return t?t.startsWith("gid://shopify/Product/")?t:`gid://shopify/Product/${t}`:""}class R{constructor(t){r(this,"timer");r(this,"inFlight",!1);r(this,"stopped",!1);this.options=t}init(){window.setTimeout(()=>this.requestOffer("initial"),1200),this.timer=window.setInterval(()=>this.requestOffer("poll"),this.options.pollMs||12e3),document.addEventListener("add-to-cart",()=>{window.setTimeout(()=>this.requestOffer("add_to_cart"),250)}),document.addEventListener("aovboost:request-offer",()=>{this.requestOffer("manual")}),window.addEventListener("popstate",()=>{window.setTimeout(()=>this.requestOffer("navigation"),300)})}destroy(){this.stopped=!0,this.timer&&window.clearInterval(this.timer)}async requestOffer(t="manual"){if(this.inFlight||this.stopped)return null;this.inFlight=!0;try{const e=this.options.sessionManager.getSnapshot(),s={sessionId:e.anonymousId,shop:this.options.shop,currentProductId:J(),currentPageType:H(),cartProductIds:e.cartProductIds,dismissedWidgets:this.options.widgetManager.getDismissedWidgets(),trigger:t},o=await fetch(this.endpoint("/offer"),{method:"POST",headers:{"Content-Type":"application/json","X-AOVBoost-Shop":this.options.shop},body:JSON.stringify(s),keepalive:!0});if(!o.ok)return null;const n=await o.json();return this.options.widgetManager.mountDecision(n),n}catch{return null}finally{this.inFlight=!1}}endpoint(t){return`${this.options.apiBase.replace(/\/$/,"")}${t}`}}function H(){const i=window.location.pathname,t=String(window.ShopifyAnalytics?.meta?.page?.pageType||document.body?.dataset?.template||"").toLowerCase();return i==="/"?"home":/\/collections(?:\/|$)/.test(i)||t.includes("collection")?"collection":/\/products(?:\/|$)/.test(i)||t.includes("product")?"product":/\/cart(?:\/|$)/.test(i)||t.includes("cart")?"cart":/\/checkout(?:\/|$)/.test(i)?"checkout":/\/thank_you(?:\/|$)/.test(i)||window.Shopify?.checkout?"thankyou":"other"}function J(){const i=window.Shopify?.product||window.ShopifyAnalytics?.meta?.product||null;if(!i)return;const t=String(i.gid||i.id||"");if(t)return t.startsWith("gid://shopify/Product/")?t:`gid://shopify/Product/${t}`}const $="aovboost_anonymous_id";class Y{constructor(t,e="/apps/aovboost"){r(this,"anonymousId");r(this,"journeyStage","discovering");r(this,"viewedProductIds",new Set);r(this,"productViewCounts",new Map);r(this,"cartProductIds",new Set);r(this,"pageViews",0);r(this,"maxScrollDepth",0);r(this,"cartActionCount",0);r(this,"cartValue",0);r(this,"startedAt",Date.now());r(this,"lastCartActionAt",0);r(this,"syncTimer");this.shop=t,this.apiBase=e,this.anonymousId=this.getOrCreateAnonymousId()}init(){this.syncTimer=window.setInterval(()=>this.sync(),3e4),window.addEventListener("pagehide",()=>this.sync())}destroy(){this.syncTimer&&window.clearInterval(this.syncTimer)}recordEvent(t){if(t.type==="page_view"&&(this.pageViews+=1),t.type==="product_view"){const e=v(t);e&&(this.viewedProductIds.add(e),this.productViewCounts.set(e,(this.productViewCounts.get(e)||0)+1))}if(t.type==="scroll_depth"&&(this.maxScrollDepth=Math.max(this.maxScrollDepth,Number(t.depth||0))),t.type==="add_to_cart"){this.cartActionCount+=1,this.lastCartActionAt=Date.now();const e=v(t);e&&this.cartProductIds.add(e),Array.isArray(t.cartProductIds)&&t.cartProductIds.forEach(s=>this.cartProductIds.add(String(s))),this.cartValue=Math.max(this.cartValue,Number(t.cartValue||0)),this.journeyStage="buying"}if(t.type==="remove_from_cart"){this.cartActionCount+=1,this.lastCartActionAt=Date.now();const e=v(t);e&&this.cartProductIds.delete(e)}this.updateJourneyStage()}getSnapshot(){const t=Math.round((Date.now()-this.startedAt)/1e3),e=Array.from(this.productViewCounts.values()).reduce((l,d)=>l+d,0),s=A(this.pageViews*2+e*5+(this.maxScrollDepth>=90?10:this.maxScrollDepth>=75?8:this.maxScrollDepth>=50?5:this.maxScrollDepth>=25?3:0)+Math.min(t/120,1)*30+(this.cartProductIds.size>0?30:0),0,100),o=Array.from(this.productViewCounts.entries()).some(([l,d])=>d>=2&&!this.cartProductIds.has(l)),n=this.lastCartActionAt?(Date.now()-this.lastCartActionAt)/1e3:t,c=A((s>40&&this.cartActionCount===0&&n>=90?55:0)+(o?35:0),0,100);return{anonymousId:this.anonymousId,journeyStage:this.journeyStage,intentScore:s,hesitationScore:c,viewedProductIds:Array.from(this.viewedProductIds),cartProductIds:Array.from(this.cartProductIds),totalPageViews:this.pageViews,sessionDuration:t,cartValue:this.cartValue,context:{maxScrollDepth:this.maxScrollDepth,productViewCounts:Object.fromEntries(this.productViewCounts),cartActionCount:this.cartActionCount}}}sync(){const t=this.getSnapshot(),e=JSON.stringify({sessionId:this.anonymousId,shop:this.shop,events:[{type:"session_sync",ts:Date.now(),sessionId:this.anonymousId,shop:this.shop,url:window.location.href,referrer:document.referrer,snapshot:t,...t}]});fetch(this.endpoint("/events"),{method:"POST",headers:{"Content-Type":"application/json","X-AOVBoost-Shop":this.shop},body:e,keepalive:!0}).catch(()=>{})}updateJourneyStage(){if(this.cartProductIds.size>0){this.journeyStage="buying";return}if(this.getSnapshotDuration()>=60||Array.from(this.productViewCounts.values()).some(t=>t>=2)){this.journeyStage="deciding";return}if(this.viewedProductIds.size>=3){this.journeyStage="comparing";return}this.journeyStage="discovering"}endpoint(t){return`${this.apiBase.replace(/\/$/,"")}${t}`}getSnapshotDuration(){return Math.round((Date.now()-this.startedAt)/1e3)}getOrCreateAnonymousId(){try{const t=window.localStorage.getItem($);if(t)return t;const e=C();return window.localStorage.setItem($,e),e}catch{return C()}}}function v(i){const t=i.product;return String(i.productId||i.product_id||t?.id||"")}function C(){return window.crypto?.randomUUID?window.crypto.randomUUID():"xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,i=>{const t=Math.random()*16|0;return(i==="x"?t:t&3|8).toString(16)})}function A(i,t,e){return Math.min(Math.max(i,t),e)}class h{constructor(t){r(this,"root");r(this,"container");this.payload=t,this.container=document.createElement("div"),this.container.setAttribute("data-aovboost-widget",this.getWidgetType()),this.root=this.container.attachShadow({mode:"open"}),this.injectStyles()}destroy(){this.container.remove()}mount(t=document.body){t.appendChild(this.container),this.render(),this.trackImpression()}injectStyles(){const t=document.createElement("style");t.textContent=G,this.root.appendChild(t)}trackImpression(){this.track("widget_impression",{})}trackClick(t){this.track("widget_click",{action:t})}trackDismiss(){this.track("widget_dismiss",{});try{const t="aovboost_dismissed_widgets",e=JSON.parse(localStorage.getItem(t)||"[]");localStorage.setItem(t,JSON.stringify(Array.from(new Set([...e,this.getWidgetType()]))))}catch{}}track(t,e){const s=window.AOVBoostSDK?.track,o={type:t,widgetType:this.getWidgetType(),offerId:this.payload.offerId,...e};if(typeof s=="function"){s(t,o);return}document.dispatchEvent(new CustomEvent("aovboost:track",{detail:o}))}html(t){const e=this.root.querySelector("[data-aovboost-content]");e&&e.remove();const s=document.createElement("div");s.setAttribute("data-aovboost-content","true"),s.innerHTML=t,this.root.appendChild(s)}}function a(i,t=""){return X(typeof i=="string"&&i.trim()?i:t)}function m(i,t="USD"){const e=Number(i||0);try{return new Intl.NumberFormat(void 0,{style:"currency",currency:t}).format(e)}catch{return`$${e.toFixed(2)}`}}function f(i){const e=[i.products,i.bundle?.items,i.items].find(s=>Array.isArray(s));return Array.isArray(e)?e.map(s=>{const o=s.product||s.target||s;return{id:o.id||s.productId||s.targetId,variantId:o.variantId||s.variantId||s.id,title:o.title||s.title||"Recommended product",handle:o.handle||s.handle||"",imageUrl:o.imageUrl||o.image||s.imageUrl||s.image,price:o.price||s.price||"",quantity:s.quantity||1,reason:s.reason||s.affinity?.reason||s.reasoning||"",orderCount:s.orderCount||s.affinity?.orderCount||0}}):[]}async function b(i,t=1){if(!i)return null;const e=String(i).split("/").pop(),s=await fetch("/cart/add.js",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:e,quantity:t})});return s.ok?s.json():null}async function K(i){const t=i.filter(s=>s.variantId).map(s=>({id:String(s.variantId).split("/").pop(),quantity:s.quantity||1}));if(t.length===0)return null;const e=await fetch("/cart/add.js",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({items:t})});return e.ok?e.json():null}function X(i){return String(i||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;")}const G=`
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
* { box-sizing: border-box; letter-spacing: 0; }
button, input { font: inherit; }
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
`;class Q extends h{getWidgetType(){return"bundle"}render(){const t=this.payload.bundle||{},e=this.payload.copy||{},s=f(this.payload),o=String(window.AOVBoost?.currency||"USD"),n=s.reduce((d,y)=>d+Number(y.price||0)*Number(y.quantity||1),0),c=Number(t.discountValue||0),l=t.discountType==="percentage"?n*(1-c/100):t.discountType==="fixed"?Math.max(n-c,0):n;this.html(`
      <style>
        .bundle { margin: 18px 0; box-shadow: none; }
        .tiles { display: flex; gap: 10px; overflow-x: auto; padding: 4px 0; }
        .tile { flex: 0 0 128px; border: 1px solid var(--aovboost-line); border-radius: 8px; padding: 8px; }
        .totals { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .strike { color: var(--aovboost-muted); text-decoration: line-through; }
      </style>
      <section class="bundle card">
        <div class="stack">
          <div>
            <h3 class="title">${a(e.headline||t.name||"Complete the set")}</h3>
            <p class="body">${a(t.description||e.totalSavings||"Bundle these products for a better cart.")}</p>
          </div>
          <div class="tiles">
            ${s.map(d=>`
                  <article class="tile">
                    ${d.imageUrl?`<img src="${a(d.imageUrl)}" alt="${a(d.title)}" loading="lazy">`:""}
                    <p class="product-name">${a(d.title)}</p>
                    <span class="price">${a(d.price?m(d.price,o):"")}</span>
                  </article>
                `).join("")}
          </div>
          <div class="totals">
            ${n>l?`<span class="strike">${m(n,o)}</span>`:""}
            <strong>${m(l,o)}</strong>
          </div>
          <div class="actions">
            <button type="button" class="primary" data-add>${a(e.ctaText||"Add bundle to cart")}</button>
          </div>
        </div>
      </section>
    `),this.root.querySelector("[data-add]")?.addEventListener("click",async()=>{this.trackClick("add_bundle"),await K(s.map(d=>({variantId:d.variantId,quantity:Number(d.quantity||1)}))),document.dispatchEvent(new CustomEvent("add-to-cart",{detail:{source:"bundle_widget"}}))})}}class Z extends h{constructor(e){super(e);r(this,"messages",[]);r(this,"expanded",!1);r(this,"sending",!1);const s=e.copy;this.messages.push({role:"assistant",content:String(s?.greeting||e.greeting||"Hi. Can I help you find the perfect product today?")})}getWidgetType(){return"chat"}render(){const e=this.payload.copy||{};this.html(`
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
        ${this.expanded?this.renderChatUi():`<p class="body">${a(e.greeting||this.messages[0].content)}</p>
              <div class="actions">
                <button type="button" class="primary" data-expand>${a(e.ctaAccept||"Chat with AI")}</button>
                <button type="button" class="secondary" data-dismiss>${a(e.ctaDecline||"Browse myself")}</button>
              </div>`}
      </aside>
    `),this.root.querySelector("[data-close]")?.addEventListener("click",()=>this.dismiss()),this.root.querySelector("[data-dismiss]")?.addEventListener("click",()=>this.dismiss()),this.root.querySelector("[data-expand]")?.addEventListener("click",()=>{this.expanded=!0,this.trackClick("open_chat"),this.render()}),this.root.querySelector("[data-send]")?.addEventListener("click",()=>this.sendMessage()),this.root.querySelector("input")?.addEventListener("keydown",s=>{s.key==="Enter"&&(s.preventDefault(),this.sendMessage())}),this.scrollToBottom()}renderChatUi(){return`
      <div class="messages" data-messages>
        ${this.messages.map(e=>this.renderMessage(e)).join("")}
      </div>
      <div class="compose">
        <input type="text" placeholder="Ask me anything" data-input>
        <button type="button" class="primary" data-send>Send</button>
      </div>
    `}renderMessage(e){return`
      <div class="bubble ${e.role}">
        ${a(e.content)}
        ${this.renderProductLinks(e.content)}
      </div>
    `}renderProductLinks(e){const s=e.match(/\/products\/([a-z0-9-]+)/i);if(!s)return"";const o=s[1];return`
      <div class="inline-product">
        <p class="product-name">${a(o.replace(/-/g," "))}</p>
        <a href="/products/${a(o)}">View product</a>
      </div>
    `}appendMessage(e){const s=this.root.querySelector("[data-messages]");if(!s)throw new Error("Messages container not found");const o=document.createElement("div");return o.className=`bubble ${e.role}`,o.textContent=e.content,s.appendChild(o),this.scrollToBottom(),o}async sendMessage(){if(this.sending)return;const e=this.root.querySelector("[data-input]"),s=this.root.querySelector("[data-send]"),o=e?.value.trim();if(!o)return;this.sending=!0,s&&(s.disabled=!0),e.value="",this.messages.push({role:"user",content:o}),this.appendMessage({role:"user",content:o}),this.trackClick("send_message");const n=this.messages.push({role:"assistant",content:""})-1,c=this.appendMessage({role:"assistant",content:""});this.showTyping();try{const l=window.AOVBoost||{},d=window.AOVBoostSDK,y=(l.apiBase||"/apps/aovboost").replace(/\/$/,""),w=await fetch(`${y}/chat`,{method:"POST",headers:{"Content-Type":"application/json","X-AOVBoost-Shop":d?.shop||l.shop||""},body:JSON.stringify({sessionId:d?.sessionId,shop:d?.shop||l.shop,message:o,messageHistory:this.messages.slice(0,-2)})});if(!w.ok)throw new Error(`Server returned ${w.status}`);if(!w.body)throw new Error("Missing stream body");const ct=w.body.getReader(),lt=new TextDecoder;let k="",I=!1;for(;;){const{done:ut,value:pt}=await ct.read();if(ut)break;k+=lt.decode(pt,{stream:!0});const E=k.split(`
`);k=E.pop()||"";for(const P of E){if(!P.startsWith("data: "))continue;const D=P.slice(6);if(D!=="[DONE]")try{const q=JSON.parse(D);q.delta&&(I||(this.removeTyping(),I=!0),this.messages[n].content+=q.delta,c.textContent=this.messages[n].content,this.updateProductLink(this.messages[n].content,c),this.scrollToBottom())}catch{}}}I||(this.removeTyping(),this.messages[n].content||(this.messages[n].content="I can help you compare products and find the right add-ons.",c.textContent=this.messages[n].content))}catch{this.removeTyping(),this.messages[n].content=this.messages[n].content||"I had trouble connecting. Please try again in a moment.",c.textContent=this.messages[n].content}finally{this.sending=!1,s&&(s.disabled=!1)}}showTyping(){const e=this.root.querySelector("[data-messages]");if(!e)return;const s=document.createElement("div");s.className="bubble assistant dots",s.dataset.typing="true",s.innerHTML="<span>.</span><span>.</span><span>.</span>",e.appendChild(s),this.scrollToBottom()}removeTyping(){const e=this.root.querySelector("[data-typing]");e&&e.remove()}updateProductLink(e,s){const o=e.match(/\/products\/([a-z0-9-]+)/i),n=s.querySelector(".inline-product");if(n&&n.remove(),!o)return;const c=o[1],l=document.createElement("div");l.className="inline-product",l.innerHTML=`
      <p class="product-name">${a(c.replace(/-/g," "))}</p>
      <a href="/products/${a(c)}">View product</a>
    `,s.appendChild(l)}scrollToBottom(){const e=this.root.querySelector("[data-messages]");e&&(e.scrollTop=e.scrollHeight)}dismiss(){this.trackDismiss(),this.container.animate([{transform:"translateY(0)"},{transform:"translateY(120%)"}],{duration:180,easing:"ease-in",fill:"forwards"}),window.setTimeout(()=>this.destroy(),190)}}class tt extends h{getWidgetType(){return"discount_nudge"}render(){this.draw(),document.addEventListener("add-to-cart",()=>this.draw())}draw(){const t=this.payload.copy||{},e=String(window.AOVBoost?.currency||"USD"),s=Number(this.payload.threshold||50),o=Number(this.payload.cartValue||0),n=Math.max(s-o,0),c=s>0?Math.min(o/s,1):0;this.html(`
      <style>
        .bar {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          z-index: 9998;
          min-height: 48px;
          border-left: 0;
          border-right: 0;
          border-top: 0;
          padding: 8px 14px;
        }
        .label { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 13px; font-weight: 700; }
        .track { height: 6px; border-radius: 999px; overflow: hidden; background: #e5e7eb; margin-top: 6px; }
        .track span { display: block; height: 100%; width: ${c*100}%; background: var(--aovboost-accent); transition: width 200ms ease; }
      </style>
      <div class="bar">
        <div class="label">
          <span>${n>0?a(t.progressLabel||`You're ${m(n,e)} away from your reward`):a(t.rewardDescription||"Reward unlocked")}</span>
          <button type="button" class="icon" data-dismiss aria-label="Close">x</button>
        </div>
        <div class="track" aria-hidden="true"><span></span></div>
      </div>
    `),this.root.querySelector("[data-dismiss]")?.addEventListener("click",()=>{this.trackDismiss(),this.destroy()}),n<=0&&window.setTimeout(()=>this.destroy(),3e3)}}class et extends h{constructor(){super(...arguments);r(this,"shown",!1);r(this,"handleMouseLeave",e=>{e.clientY<10&&this.show()});r(this,"handleVisibility",()=>{document.visibilityState==="hidden"&&this.show()})}getWidgetType(){return"exit_intent"}mount(e=document.body){e.appendChild(this.container),!this.shouldSkip()&&(document.addEventListener("mouseleave",this.handleMouseLeave),document.addEventListener("visibilitychange",this.handleVisibility))}render(){const e=this.payload.copy||{};this.html(`
      <style>
        .backdrop { position: fixed; inset: 0; z-index: 9998; background: rgba(17, 24, 39, .38); }
        .modal { position: fixed; inset: 50% auto auto 50%; z-index: 9999; width: min(420px, calc(100vw - 32px)); transform: translate(-50%, -50%); border-radius: 8px; padding: 18px; }
      </style>
      <div class="backdrop" data-dismiss></div>
      <section class="modal">
        <h3 class="title">${a(e.headline||"Wait before you go")}</h3>
        <p class="body">${a(e.offerLine||this.payload.offerLine||"Your cart has a relevant offer available.")}</p>
        ${this.payload.discountCode?`<p class="body"><strong>${a(this.payload.discountCode)}</strong></p>`:""}
        <div class="actions">
          <button type="button" class="primary" data-claim>${a(e.ctaText||"Claim offer")}</button>
          <button type="button" class="secondary" data-dismiss>${a(e.dismissText||"No thanks")}</button>
        </div>
      </section>
    `),this.root.querySelector("[data-claim]")?.addEventListener("click",()=>{this.trackClick("claim_exit_offer"),this.destroy()}),this.root.querySelectorAll("[data-dismiss]").forEach(s=>{s.addEventListener("click",()=>{this.trackDismiss(),this.destroy()})})}destroy(){document.removeEventListener("mouseleave",this.handleMouseLeave),document.removeEventListener("visibilitychange",this.handleVisibility),super.destroy()}show(){if(!(this.shown||this.hasFired())){this.shown=!0;try{sessionStorage.setItem("aovboost_exit_intent_fired","true")}catch{}this.render(),this.trackImpression()}}hasFired(){try{return sessionStorage.getItem("aovboost_exit_intent_fired")==="true"}catch{return!1}}shouldSkip(){return/\/(?:checkout|thank_you)(?:\/|$)/.test(window.location.pathname)}}class st extends h{getWidgetType(){return"post_purchase"}mount(t=document.body){this.isThankYouPage()&&super.mount(t)}render(){const t=this.payload.copy||{},e=f(this.payload)[0]||this.payload.product||{},s=String(window.AOVBoost?.currency||"USD");this.html(`
      <style>
        .post { margin: 18px 0; box-shadow: none; }
      </style>
      <section class="post card">
        <h3 class="title">${a(t.headline||"Complete your purchase")}</h3>
        <article class="product-card">
          ${e.imageUrl?`<img src="${a(e.imageUrl)}" alt="${a(e.title)}" loading="lazy">`:"<span></span>"}
          <div class="stack">
            <div>
              <p class="product-name">${a(t.productName||e.title||"Recommended product")}</p>
              <span class="price">${a(e.price?m(e.price,s):"")}</span>
            </div>
            <p class="reason">${a(t.oneLineReason||"A useful add-on for what you just bought.")}</p>
            <button type="button" class="primary" data-add>${a(t.ctaText||"Add to my order")}</button>
          </div>
        </article>
      </section>
    `),this.root.querySelector("[data-add]")?.addEventListener("click",async()=>{this.trackClick("add_post_purchase");const o=e.variantId;if(o){await b(o);return}const n=e.handle;n&&(window.location.href=`/products/${n}`)})}isThankYouPage(){return/\/thank_you(?:\/|$)/.test(window.location.pathname)||!!window.Shopify?.checkout}}class it extends h{getWidgetType(){return"rec_strip"}render(){const t=f(this.payload),e=String(window.AOVBoost?.currency||"USD");this.html(`
      <style>
        .strip { margin: 20px 0; box-shadow: none; }
        .rail {
          display: grid;
          grid-auto-flow: column;
          grid-auto-columns: minmax(150px, 180px);
          gap: 10px;
          overflow-x: auto;
          scroll-snap-type: x mandatory;
          padding: 4px 0 2px;
        }
        .tile { scroll-snap-align: start; border: 1px solid var(--aovboost-line); border-radius: 8px; padding: 9px; display: grid; gap: 7px; }
        .badge { width: fit-content; border-radius: 999px; background: #ecfdf5; color: #047857; font-size: 11px; padding: 4px 7px; }
      </style>
      <section class="strip card">
        <h3 class="title">You might also like</h3>
        <div class="rail">
          ${t.map(s=>`
                <article class="tile">
                  ${s.reason?`<span class="badge">${a(s.reason)}</span>`:""}
                  ${s.imageUrl?`<img data-src="${a(s.imageUrl)}" alt="${a(s.title)}">`:""}
                  <p class="product-name">${a(s.title)}</p>
                  <span class="price">${a(s.price?m(s.price,e):"")}</span>
                  <button type="button" class="primary" data-add="${a(s.variantId)}">Add to cart</button>
                </article>
              `).join("")}
        </div>
      </section>
    `),this.lazyLoadImages(),this.root.querySelectorAll("[data-add]").forEach(s=>{s.addEventListener("click",async()=>{this.trackClick("add_recommendation"),await b(s.dataset.add)})})}lazyLoadImages(){const t=Array.from(this.root.querySelectorAll("img[data-src]"));if(!("IntersectionObserver"in window)){t.forEach(s=>{s.src=s.dataset.src||""});return}const e=new IntersectionObserver(s=>{s.forEach(o=>{if(!o.isIntersecting)return;const n=o.target;n.src=n.dataset.src||"",e.unobserve(n)})});t.forEach(s=>e.observe(s))}}class ot extends h{constructor(){super(...arguments);r(this,"interval")}getWidgetType(){return"social_proof"}render(){const s=f(this.payload).filter(n=>Number(n.orderCount||0)>0).map(n=>`${Number(n.orderCount)} people bought this with ${n.title}`);s.length===0&&s.push("Frequently bought together"),this.html(`
      <style>
        .pill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          border-radius: 999px;
          box-shadow: none;
          padding: 8px 10px;
          font-size: 12px;
          font-weight: 700;
          color: #064e3b;
          background: #ecfdf5;
        }
        .dot { width: 8px; height: 8px; border-radius: 999px; background: #10b981; }
      </style>
      <div class="pill" role="status"><span class="dot"></span><span data-message>${a(s[0])}</span></div>
    `);let o=0;this.interval=window.setInterval(()=>{o=(o+1)%s.length;const n=this.root.querySelector("[data-message]");n&&(n.textContent=s[o])},5e3)}destroy(){this.interval&&window.clearInterval(this.interval),super.destroy()}}class nt extends h{constructor(){super(...arguments);r(this,"timer");r(this,"deadline",Date.now()+8e3)}getWidgetType(){return"upsell_drawer"}render(){const e=f(this.payload).slice(0,3),s=this.payload.copy||{},o=String(window.AOVBoost?.currency||"USD");this.html(`
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
        .timer { height: 4px; border-radius: 999px; overflow: hidden; background: #e5e7eb; margin: 12px 0; }
        .timer span { display: block; height: 100%; width: 100%; background: var(--aovboost-accent); transform-origin: left; }
      </style>
      <div class="backdrop" data-dismiss></div>
      <aside class="drawer" aria-label="Add-to-cart upsell">
        <div class="head">
          <div>
            <h3 class="title">${a(s.headline||"Great choice. Complete the set")}</h3>
            <p class="body">People who bought this also love:</p>
          </div>
          <button type="button" class="icon" data-dismiss aria-label="Close">x</button>
        </div>
        <div class="timer"><span data-timer></span></div>
        <div class="product-grid">
          ${e.map(n=>`
                <article class="product-card">
                  ${n.imageUrl?`<img src="${a(n.imageUrl)}" alt="${a(n.title)}" loading="lazy">`:"<span></span>"}
                  <div class="stack">
                    <div>
                      <p class="product-name">${a(n.title)}</p>
                      <span class="price">${a(n.price?m(n.price,o):"")}</span>
                    </div>
                    <p class="reason">${a(n.reason||s.whyThisGoes||"It pairs well with your cart.")}</p>
                    <button type="button" class="primary" data-add="${a(n.variantId)}">Add to cart</button>
                  </div>
                </article>
              `).join("")}
        </div>
        <div class="actions">
          <a class="secondary" href="/cart">Continue to cart</a>
        </div>
      </aside>
    `),this.root.querySelectorAll("[data-dismiss]").forEach(n=>{n.addEventListener("click",()=>this.dismiss())}),this.root.querySelectorAll("[data-add]").forEach(n=>{n.addEventListener("click",async()=>{this.trackClick("add_upsell"),await b(n.dataset.add)})}),this.startCountdown()}destroy(){this.timer&&window.clearInterval(this.timer),super.destroy()}startCountdown(){this.timer&&window.clearInterval(this.timer),this.deadline=Date.now()+8e3,this.timer=window.setInterval(()=>{const e=Math.max(this.deadline-Date.now(),0),s=this.root.querySelector("[data-timer]");s&&(s.style.transform=`scaleX(${e/8e3})`),e<=0&&this.dismiss()},120)}dismiss(){this.trackDismiss(),this.container.animate([{transform:"translateX(0)"},{transform:"translateX(100%)"}],{duration:180,easing:"ease-in",fill:"forwards"}),window.setTimeout(()=>this.destroy(),190)}}const at="aovboost_dismissed_widgets";class rt{constructor(){r(this,"activeWidget",null);r(this,"activeKey","");r(this,"activeWidgetType","")}mountDecision(t){if(!t.widgetType||this.getDismissedWidgets().includes(t.widgetType))return;const e=t.payload||{},s=String(e.offerId||""),o=`${t.widgetType}:${s}`;if(t.widgetType==="chat"&&this.activeWidgetType==="chat"||o===this.activeKey)return;this.destroyActive();const n=dt(t.widgetType,e);if(!n)return;const c=this.resolveTarget(t.widgetType);n.mount(c),this.activeWidget=n,this.activeKey=o,this.activeWidgetType=t.widgetType}destroyActive(){this.activeWidget?.destroy(),this.activeWidget=null,this.activeKey="",this.activeWidgetType=""}getDismissedWidgets(){try{const t=JSON.parse(localStorage.getItem(at)||"[]");return Array.isArray(t)?t.map(String):[]}catch{return[]}}resolveTarget(t){return t==="bundle"?x(".product-form, [data-product-form]"):t==="rec_strip"?x(".product__description, [data-product-description]"):t==="social_proof"?x(".product-form__submit, [data-add-to-cart]"):document.body}}function dt(i,t){switch(i){case"chat":return new Z(t);case"bundle":return new Q(t);case"upsell_drawer":return new nt(t);case"discount_nudge":return new tt(t);case"rec_strip":return new it(t);case"social_proof":return new ot(t);case"exit_intent":return new et(t);case"post_purchase":return new st(t);default:return null}}function x(i){const t=document.querySelector(i),e=document.createElement("div");return e.setAttribute("data-aovboost-mount",i),t?.parentElement?(t.insertAdjacentElement("afterend",e),e):(document.body.appendChild(e),e)}let _=!1;function S(){if(!_){_=!0;try{const i=window.AOVBoost||{},t=i.shop;if(!t)return;const e=i.apiBase||"/apps/aovboost",s=new Y(t,e),o=new p({shop:t,sessionManager:s,apiBase:e}),n=new rt,c=new R({shop:t,apiBase:e,eventBus:o,sessionManager:s,widgetManager:n});s.init(),o.init(),c.init(),window.AOVBoostSDK={shop:t,sessionId:s.anonymousId,track:(l,d={})=>o.track(l,d),requestOffer:()=>c.requestOffer("global"),destroy:()=>{c.destroy(),s.destroy(),n.destroyActive()}}}catch(i){console.log("AOVBoost SDK skipped:",i instanceof Error?i.message:String(i))}}}return document.readyState==="loading"?document.addEventListener("DOMContentLoaded",S,{once:!0}):S(),u.init=S,Object.defineProperty(u,Symbol.toStringTag,{value:"Module"}),u}({});
