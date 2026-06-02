var AOVBoostSDKBundle=function(u){"use strict";var dt=Object.defineProperty;var ct=(u,p,g)=>p in u?dt(u,p,{enumerable:!0,configurable:!0,writable:!0,value:g}):u[p]=g;var o=(u,p,g)=>ct(u,typeof p!="symbol"?p+"":p,g);class p{constructor(t){o(this,"queue",[]);o(this,"flushTimer");o(this,"scrollDepths",new Set);o(this,"originalFetch",null);this.options=t}init(){this.installNavigationTracking(),this.installCartFetchTracking(),this.installScrollTracking(),this.installHoverTracking(),this.installSearchTracking(),document.addEventListener("add-to-cart",t=>{this.track("add_to_cart",g(t.detail))}),document.addEventListener("aovboost:track",t=>{const e=g(t.detail);this.track(String(e.type||"widget_event"),e)}),window.addEventListener("pagehide",()=>this.flush()),this.trackPageView()}track(t,e={}){const s={type:t,ts:Date.now(),sessionId:this.options.sessionManager.anonymousId,shop:this.options.shop,url:window.location.href,referrer:document.referrer,...e};this.options.sessionManager.recordEvent(s),this.queue.push(s),this.scheduleFlush()}flush(){if(this.flushTimer&&(window.clearTimeout(this.flushTimer),this.flushTimer=void 0),this.queue.length===0)return;const t=this.queue.splice(0),e=JSON.stringify({sessionId:this.options.sessionManager.anonymousId,shop:this.options.shop,events:t});try{if(navigator.sendBeacon&&navigator.sendBeacon(this.endpoint("/events"),new Blob([e],{type:"application/json"})))return}catch{}fetch(this.endpoint("/events"),{method:"POST",headers:{"Content-Type":"application/json","X-AOVBoost-Shop":this.options.shop},body:e,keepalive:!0}).catch(()=>{this.queue.unshift(...t)})}scheduleFlush(){this.flushTimer||(this.flushTimer=window.setTimeout(()=>this.flush(),2e3))}endpoint(t){return`${(this.options.apiBase||"/api").replace(/\/$/,"")}${t}`}installNavigationTracking(){const t=history.pushState,e=history.replaceState;history.pushState=(...s)=>{const a=t.apply(history,s);return window.setTimeout(()=>this.trackPageView(),0),a},history.replaceState=(...s)=>{const a=e.apply(history,s);return window.setTimeout(()=>this.trackPageView(),0),a},window.addEventListener("popstate",()=>this.trackPageView())}trackPageView(){this.track("page_view",{pageType:O()}),q()&&this.track("checkout_start",{path:window.location.pathname});const t=P();t&&this.track("product_view",{productId:N(t.gid||t.id),handle:t.handle,title:t.title});const e=D();(e||window.location.pathname.includes("/collections/"))&&this.track("collection_view",{collectionId:String(e?.id||""),handle:e?.handle||V("/collections/"),title:e?.title})}installCartFetchTracking(){this.originalFetch||(this.originalFetch=window.fetch.bind(window),window.fetch=async(...t)=>{const e=L(t[0]),s=t[1],a=await this.originalFetch(...t);try{M(e)?this.track("add_to_cart",{...S(s?.body),requestUrl:e}):j(e)?this.track("remove_from_cart",{...S(s?.body),requestUrl:e}):B(e)&&this.track("search",{query:U(e),requestUrl:e})}catch{}return a})}installScrollTracking(){let t=!1;window.addEventListener("scroll",()=>{t||(t=!0,window.setTimeout(()=>{t=!1;const e=document.documentElement.scrollHeight-window.innerHeight;if(e<=0)return;const s=Math.round(window.scrollY/e*100);[25,50,75,90].forEach(a=>{s>=a&&!this.scrollDepths.has(a)&&(this.scrollDepths.add(a),this.track("scroll_depth",{depth:a}))})},200))},{passive:!0})}installHoverTracking(){document.addEventListener("mouseenter",t=>{const s=t.target?.closest?.(".product-card");if(!s)return;const a=window.setTimeout(()=>{this.track("product_hover",{productId:s.dataset.productId||s.dataset.productGid||"",handle:s.dataset.productHandle||""})},800);s.addEventListener("mouseleave",()=>window.clearTimeout(a),{once:!0})},!0)}installSearchTracking(){document.addEventListener("input",t=>{const e=t.target;if(!e||!`${e.name||""} ${e.id||""} ${e.type||""}`.toLowerCase().includes("search"))return;const a=e.value.trim();a.length<2||this.track("search",{query:a,source:"predictive_input"})},!0)}}function g(i){return i&&typeof i=="object"&&!Array.isArray(i)?i:{}}function P(){const i=window;return i.Shopify?.product||i.ShopifyAnalytics?.meta?.product||null}function D(){const i=window;return i.Shopify?.collection||i.ShopifyAnalytics?.meta?.collection||null}function O(){return window.ShopifyAnalytics?.meta?.page?.pageType||document.body?.dataset?.template||(window.location.pathname==="/"?"home":"other")}function q(){return/\/checkout(?:\/|$)/.test(window.location.pathname)}function V(i){const t=window.location.pathname.indexOf(i);return t===-1?"":window.location.pathname.slice(t+i.length).split("/")[0]||""}function L(i){return typeof i=="string"?i:i instanceof URL?i.toString():i.url||""}function M(i){return/\/cart\/add(?:\.js)?/.test(i)}function j(i){return/\/cart\/(?:change|update)(?:\.js)?/.test(i)}function B(i){return i.includes("/search/suggest.json")}function U(i){try{return new URL(i,window.location.origin).searchParams.get("q")||""}catch{return""}}function S(i){if(!i)return{};if(typeof FormData<"u"&&i instanceof FormData)return{variantId:String(i.get("id")||i.get("items[0][id]")||""),quantity:Number(i.get("quantity")||1)};if(typeof URLSearchParams<"u"&&i instanceof URLSearchParams)return{variantId:String(i.get("id")||i.get("items[0][id]")||""),quantity:Number(i.get("quantity")||1)};try{const t=String(i);if(t.trim().startsWith("{")){const s=JSON.parse(t);return{productId:s.productId||s.product_id,variantId:s.id||s.items?.[0]?.id,quantity:s.quantity||s.items?.[0]?.quantity||1}}const e=new URLSearchParams(t);return{variantId:String(e.get("id")||e.get("items[0][id]")||""),quantity:Number(e.get("quantity")||1)}}catch{return{}}}function N(i){const t=String(i||"");return t?t.startsWith("gid://shopify/Product/")?t:`gid://shopify/Product/${t}`:""}class W{constructor(t){o(this,"timer");o(this,"inFlight",!1);o(this,"stopped",!1);this.options=t}init(){window.setTimeout(()=>this.requestOffer("initial"),1200),this.timer=window.setInterval(()=>this.requestOffer("poll"),this.options.pollMs||12e3),document.addEventListener("add-to-cart",()=>{window.setTimeout(()=>this.requestOffer("add_to_cart"),250)}),document.addEventListener("aovboost:request-offer",()=>{this.requestOffer("manual")}),window.addEventListener("popstate",()=>{window.setTimeout(()=>this.requestOffer("navigation"),300)})}destroy(){this.stopped=!0,this.timer&&window.clearInterval(this.timer)}async requestOffer(t="manual"){if(this.inFlight||this.stopped)return null;this.inFlight=!0;try{const e=this.options.sessionManager.getSnapshot(),s={sessionId:e.anonymousId,shop:this.options.shop,currentProductId:F(),currentPageType:z(),cartProductIds:e.cartProductIds,dismissedWidgets:this.options.widgetManager.getDismissedWidgets(),trigger:t},a=await fetch(this.endpoint("/offer"),{method:"POST",headers:{"Content-Type":"application/json","X-AOVBoost-Shop":this.options.shop},body:JSON.stringify(s),keepalive:!0});if(!a.ok)return null;const n=await a.json();return this.options.widgetManager.mountDecision(n),n}catch{return null}finally{this.inFlight=!1}}endpoint(t){return`${this.options.apiBase.replace(/\/$/,"")}${t}`}}function z(){const i=window.location.pathname,t=String(window.ShopifyAnalytics?.meta?.page?.pageType||document.body?.dataset?.template||"").toLowerCase();return i==="/"?"home":/\/collections(?:\/|$)/.test(i)||t.includes("collection")?"collection":/\/products(?:\/|$)/.test(i)||t.includes("product")?"product":/\/cart(?:\/|$)/.test(i)||t.includes("cart")?"cart":/\/checkout(?:\/|$)/.test(i)?"checkout":/\/thank_you(?:\/|$)/.test(i)||window.Shopify?.checkout?"thankyou":"other"}function F(){const i=window.Shopify?.product||window.ShopifyAnalytics?.meta?.product||null;if(!i)return;const t=String(i.gid||i.id||"");if(t)return t.startsWith("gid://shopify/Product/")?t:`gid://shopify/Product/${t}`}const k="aovboost_anonymous_id";class R{constructor(t,e="/api"){o(this,"anonymousId");o(this,"journeyStage","discovering");o(this,"viewedProductIds",new Set);o(this,"productViewCounts",new Map);o(this,"cartProductIds",new Set);o(this,"pageViews",0);o(this,"maxScrollDepth",0);o(this,"cartActionCount",0);o(this,"cartValue",0);o(this,"startedAt",Date.now());o(this,"lastCartActionAt",0);o(this,"syncTimer");this.shop=t,this.apiBase=e,this.anonymousId=this.getOrCreateAnonymousId()}init(){this.syncTimer=window.setInterval(()=>this.sync(),3e4),window.addEventListener("pagehide",()=>this.sync())}destroy(){this.syncTimer&&window.clearInterval(this.syncTimer)}recordEvent(t){if(t.type==="page_view"&&(this.pageViews+=1),t.type==="product_view"){const e=w(t);e&&(this.viewedProductIds.add(e),this.productViewCounts.set(e,(this.productViewCounts.get(e)||0)+1))}if(t.type==="scroll_depth"&&(this.maxScrollDepth=Math.max(this.maxScrollDepth,Number(t.depth||0))),t.type==="add_to_cart"){this.cartActionCount+=1,this.lastCartActionAt=Date.now();const e=w(t);e&&this.cartProductIds.add(e),Array.isArray(t.cartProductIds)&&t.cartProductIds.forEach(s=>this.cartProductIds.add(String(s))),this.cartValue=Math.max(this.cartValue,Number(t.cartValue||0)),this.journeyStage="buying"}if(t.type==="remove_from_cart"){this.cartActionCount+=1,this.lastCartActionAt=Date.now();const e=w(t);e&&this.cartProductIds.delete(e)}this.updateJourneyStage()}getSnapshot(){const t=Math.round((Date.now()-this.startedAt)/1e3),e=Array.from(this.productViewCounts.values()).reduce((l,d)=>l+d,0),s=A(this.pageViews*2+e*5+(this.maxScrollDepth>=90?10:this.maxScrollDepth>=75?8:this.maxScrollDepth>=50?5:this.maxScrollDepth>=25?3:0)+Math.min(t/120,1)*30+(this.cartProductIds.size>0?30:0),0,100),a=Array.from(this.productViewCounts.entries()).some(([l,d])=>d>=2&&!this.cartProductIds.has(l)),n=this.lastCartActionAt?(Date.now()-this.lastCartActionAt)/1e3:t,c=A((s>40&&this.cartActionCount===0&&n>=90?55:0)+(a?35:0),0,100);return{anonymousId:this.anonymousId,journeyStage:this.journeyStage,intentScore:s,hesitationScore:c,viewedProductIds:Array.from(this.viewedProductIds),cartProductIds:Array.from(this.cartProductIds),totalPageViews:this.pageViews,sessionDuration:t,cartValue:this.cartValue,context:{maxScrollDepth:this.maxScrollDepth,productViewCounts:Object.fromEntries(this.productViewCounts),cartActionCount:this.cartActionCount}}}sync(){const t=this.getSnapshot(),e=JSON.stringify({sessionId:this.anonymousId,shop:this.shop,events:[{type:"session_sync",ts:Date.now(),sessionId:this.anonymousId,shop:this.shop,url:window.location.href,referrer:document.referrer,snapshot:t,...t}]});fetch(this.endpoint("/events"),{method:"POST",headers:{"Content-Type":"application/json","X-AOVBoost-Shop":this.shop},body:e,keepalive:!0}).catch(()=>{})}updateJourneyStage(){if(this.cartProductIds.size>0){this.journeyStage="buying";return}if(this.getSnapshotDuration()>=60||Array.from(this.productViewCounts.values()).some(t=>t>=2)){this.journeyStage="deciding";return}if(this.viewedProductIds.size>=3){this.journeyStage="comparing";return}this.journeyStage="discovering"}endpoint(t){return`${this.apiBase.replace(/\/$/,"")}${t}`}getSnapshotDuration(){return Math.round((Date.now()-this.startedAt)/1e3)}getOrCreateAnonymousId(){try{const t=window.localStorage.getItem(k);if(t)return t;const e=I();return window.localStorage.setItem(k,e),e}catch{return I()}}}function w(i){const t=i.product;return String(i.productId||i.product_id||t?.id||"")}function I(){return window.crypto?.randomUUID?window.crypto.randomUUID():"xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,i=>{const t=Math.random()*16|0;return(i==="x"?t:t&3|8).toString(16)})}function A(i,t,e){return Math.min(Math.max(i,t),e)}class h{constructor(t){o(this,"root");o(this,"container");this.payload=t,this.container=document.createElement("div"),this.container.setAttribute("data-aovboost-widget",this.getWidgetType()),this.root=this.container.attachShadow({mode:"open"}),this.injectStyles()}destroy(){this.container.remove()}mount(t=document.body){t.appendChild(this.container),this.render(),this.trackImpression()}injectStyles(){const t=document.createElement("style");t.textContent=K,this.root.appendChild(t)}trackImpression(){this.track("widget_impression",{})}trackClick(t){this.track("widget_click",{action:t})}trackDismiss(){this.track("widget_dismiss",{});try{const t="aovboost_dismissed_widgets",e=JSON.parse(localStorage.getItem(t)||"[]");localStorage.setItem(t,JSON.stringify(Array.from(new Set([...e,this.getWidgetType()]))))}catch{}}track(t,e){const s=window.AOVBoostSDK?.track,a={type:t,widgetType:this.getWidgetType(),offerId:this.payload.offerId,...e};if(typeof s=="function"){s(t,a);return}document.dispatchEvent(new CustomEvent("aovboost:track",{detail:a}))}html(t){const e=this.root.querySelector("[data-aovboost-content]");e&&e.remove();const s=document.createElement("div");s.setAttribute("data-aovboost-content","true"),s.innerHTML=t,this.root.appendChild(s)}}function r(i,t=""){return Y(typeof i=="string"&&i.trim()?i:t)}function m(i,t="USD"){const e=Number(i||0);try{return new Intl.NumberFormat(void 0,{style:"currency",currency:t}).format(e)}catch{return`$${e.toFixed(2)}`}}function f(i){const e=[i.products,i.bundle?.items,i.items].find(s=>Array.isArray(s));return Array.isArray(e)?e.map(s=>{const a=s.product||s.target||s;return{id:a.id||s.productId||s.targetId,variantId:a.variantId||s.variantId||s.id,title:a.title||s.title||"Recommended product",handle:a.handle||s.handle||"",imageUrl:a.imageUrl||a.image||s.imageUrl||s.image,price:a.price||s.price||"",quantity:s.quantity||1,reason:s.reason||s.affinity?.reason||s.reasoning||"",orderCount:s.orderCount||s.affinity?.orderCount||0}}):[]}async function v(i,t=1){if(!i)return null;const e=String(i).split("/").pop(),s=await fetch("/cart/add.js",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:e,quantity:t})});return s.ok?s.json():null}async function J(i){const t=i.filter(s=>s.variantId).map(s=>({id:String(s.variantId).split("/").pop(),quantity:s.quantity||1}));if(t.length===0)return null;const e=await fetch("/cart/add.js",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({items:t})});return e.ok?e.json():null}function Y(i){return String(i||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;")}const K=`
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
`;class H extends h{getWidgetType(){return"bundle"}render(){const t=this.payload.bundle||{},e=this.payload.copy||{},s=f(this.payload),a=String(window.AOVBoost?.currency||"USD"),n=s.reduce((d,y)=>d+Number(y.price||0)*Number(y.quantity||1),0),c=Number(t.discountValue||0),l=t.discountType==="percentage"?n*(1-c/100):t.discountType==="fixed"?Math.max(n-c,0):n;this.html(`
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
            <h3 class="title">${r(e.headline||t.name||"Complete the set")}</h3>
            <p class="body">${r(t.description||e.totalSavings||"Bundle these products for a better cart.")}</p>
          </div>
          <div class="tiles">
            ${s.map(d=>`
                  <article class="tile">
                    ${d.imageUrl?`<img src="${r(d.imageUrl)}" alt="${r(d.title)}" loading="lazy">`:""}
                    <p class="product-name">${r(d.title)}</p>
                    <span class="price">${r(d.price?m(d.price,a):"")}</span>
                  </article>
                `).join("")}
          </div>
          <div class="totals">
            ${n>l?`<span class="strike">${m(n,a)}</span>`:""}
            <strong>${m(l,a)}</strong>
          </div>
          <div class="actions">
            <button type="button" class="primary" data-add>${r(e.ctaText||"Add bundle to cart")}</button>
          </div>
        </div>
      </section>
    `),this.root.querySelector("[data-add]")?.addEventListener("click",async()=>{this.trackClick("add_bundle"),await J(s.map(d=>({variantId:d.variantId,quantity:Number(d.quantity||1)}))),document.dispatchEvent(new CustomEvent("add-to-cart",{detail:{source:"bundle_widget"}}))})}}class X extends h{constructor(e){super(e);o(this,"messages",[]);o(this,"expanded",!1);const s=e.copy;this.messages.push({role:"assistant",content:String(s?.greeting||e.greeting||"Hi. Can I help you find the perfect product today?")})}getWidgetType(){return"chat"}render(){const e=this.payload.copy||{};this.html(`
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
        ${this.expanded?this.renderChatUi():`<p class="body">${r(e.greeting||this.messages[0].content)}</p>
              <div class="actions">
                <button type="button" class="primary" data-expand>${r(e.ctaAccept||"Chat with AI")}</button>
                <button type="button" class="secondary" data-dismiss>${r(e.ctaDecline||"Browse myself")}</button>
              </div>`}
      </aside>
    `),this.root.querySelector("[data-close]")?.addEventListener("click",()=>this.dismiss()),this.root.querySelector("[data-dismiss]")?.addEventListener("click",()=>this.dismiss()),this.root.querySelector("[data-expand]")?.addEventListener("click",()=>{this.expanded=!0,this.trackClick("open_chat"),this.render()}),this.root.querySelector("[data-send]")?.addEventListener("click",()=>this.sendMessage()),this.root.querySelector("input")?.addEventListener("keydown",s=>{s.key==="Enter"&&this.sendMessage()})}renderChatUi(){return`
      <div class="messages" data-messages>
        ${this.messages.map(e=>this.renderMessage(e)).join("")}
      </div>
      <div class="compose">
        <input type="text" placeholder="Ask me anything" data-input>
        <button type="button" class="primary" data-send>Send</button>
      </div>
    `}renderMessage(e){return`
      <div class="bubble ${e.role}">
        ${r(e.content)}
        ${this.renderProductLinks(e.content)}
      </div>
    `}renderProductLinks(e){const s=e.match(/\/products\/([a-z0-9-]+)/i);if(!s)return"";const a=s[1];return`
      <div class="inline-product">
        <p class="product-name">${r(a.replace(/-/g," "))}</p>
        <a href="/products/${r(a)}">View product</a>
      </div>
    `}async sendMessage(){const e=this.root.querySelector("[data-input]"),s=e?.value.trim();if(!s)return;e.value="",this.messages.push({role:"user",content:s});const a=this.messages.push({role:"assistant",content:""})-1;this.render(),this.showTyping(),this.trackClick("send_message");try{const n=window.AOVBoostSDK,c=await fetch("/api/chat",{method:"POST",headers:{"Content-Type":"application/json","X-AOVBoost-Shop":n?.shop||window.AOVBoost?.shop||""},body:JSON.stringify({sessionId:n?.sessionId,shop:n?.shop||window.AOVBoost?.shop,message:s,messageHistory:this.messages.slice(0,-1)})});if(!c.body)throw new Error("Missing stream body");const l=c.body.getReader(),d=new TextDecoder;let y="";for(;;){const{done:rt,value:ot}=await l.read();if(rt)break;y+=d.decode(ot,{stream:!0});const $=y.split(`
`);y=$.pop()||"";for(const C of $){if(!C.startsWith("data: "))continue;const _=C.slice(6);if(_!=="[DONE]")try{const E=JSON.parse(_);E.delta&&(this.messages[a].content+=E.delta,this.render())}catch{}}}}catch{this.messages[a].content=this.messages[a].content||"I had trouble connecting. Please try again in a moment.",this.render()}}showTyping(){const e=this.root.querySelector("[data-messages]");if(!e)return;const s=document.createElement("div");s.className="bubble assistant dots",s.innerHTML="<span>.</span><span>.</span><span>.</span>",e.appendChild(s)}dismiss(){this.trackDismiss(),this.container.animate([{transform:"translateY(0)"},{transform:"translateY(120%)"}],{duration:180,easing:"ease-in",fill:"forwards"}),window.setTimeout(()=>this.destroy(),190)}}class G extends h{getWidgetType(){return"discount_nudge"}render(){this.draw(),document.addEventListener("add-to-cart",()=>this.draw())}draw(){const t=this.payload.copy||{},e=String(window.AOVBoost?.currency||"USD"),s=Number(this.payload.threshold||50),a=Number(this.payload.cartValue||0),n=Math.max(s-a,0),c=s>0?Math.min(a/s,1):0;this.html(`
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
          <span>${n>0?r(t.progressLabel||`You're ${m(n,e)} away from your reward`):r(t.rewardDescription||"Reward unlocked")}</span>
          <button type="button" class="icon" data-dismiss aria-label="Close">x</button>
        </div>
        <div class="track" aria-hidden="true"><span></span></div>
      </div>
    `),this.root.querySelector("[data-dismiss]")?.addEventListener("click",()=>{this.trackDismiss(),this.destroy()}),n<=0&&window.setTimeout(()=>this.destroy(),3e3)}}class Q extends h{constructor(){super(...arguments);o(this,"shown",!1);o(this,"handleMouseLeave",e=>{e.clientY<10&&this.show()});o(this,"handleVisibility",()=>{document.visibilityState==="hidden"&&this.show()})}getWidgetType(){return"exit_intent"}mount(e=document.body){e.appendChild(this.container),!this.shouldSkip()&&(document.addEventListener("mouseleave",this.handleMouseLeave),document.addEventListener("visibilitychange",this.handleVisibility))}render(){const e=this.payload.copy||{};this.html(`
      <style>
        .backdrop { position: fixed; inset: 0; z-index: 9998; background: rgba(17, 24, 39, .38); }
        .modal { position: fixed; inset: 50% auto auto 50%; z-index: 9999; width: min(420px, calc(100vw - 32px)); transform: translate(-50%, -50%); border-radius: 8px; padding: 18px; }
      </style>
      <div class="backdrop" data-dismiss></div>
      <section class="modal">
        <h3 class="title">${r(e.headline||"Wait before you go")}</h3>
        <p class="body">${r(e.offerLine||this.payload.offerLine||"Your cart has a relevant offer available.")}</p>
        ${this.payload.discountCode?`<p class="body"><strong>${r(this.payload.discountCode)}</strong></p>`:""}
        <div class="actions">
          <button type="button" class="primary" data-claim>${r(e.ctaText||"Claim offer")}</button>
          <button type="button" class="secondary" data-dismiss>${r(e.dismissText||"No thanks")}</button>
        </div>
      </section>
    `),this.root.querySelector("[data-claim]")?.addEventListener("click",()=>{this.trackClick("claim_exit_offer"),this.destroy()}),this.root.querySelectorAll("[data-dismiss]").forEach(s=>{s.addEventListener("click",()=>{this.trackDismiss(),this.destroy()})})}destroy(){document.removeEventListener("mouseleave",this.handleMouseLeave),document.removeEventListener("visibilitychange",this.handleVisibility),super.destroy()}show(){if(!(this.shown||this.hasFired())){this.shown=!0;try{sessionStorage.setItem("aovboost_exit_intent_fired","true")}catch{}this.render(),this.trackImpression()}}hasFired(){try{return sessionStorage.getItem("aovboost_exit_intent_fired")==="true"}catch{return!1}}shouldSkip(){return/\/(?:checkout|thank_you)(?:\/|$)/.test(window.location.pathname)}}class Z extends h{getWidgetType(){return"post_purchase"}mount(t=document.body){this.isThankYouPage()&&super.mount(t)}render(){const t=this.payload.copy||{},e=f(this.payload)[0]||this.payload.product||{},s=String(window.AOVBoost?.currency||"USD");this.html(`
      <style>
        .post { margin: 18px 0; box-shadow: none; }
      </style>
      <section class="post card">
        <h3 class="title">${r(t.headline||"Complete your purchase")}</h3>
        <article class="product-card">
          ${e.imageUrl?`<img src="${r(e.imageUrl)}" alt="${r(e.title)}" loading="lazy">`:"<span></span>"}
          <div class="stack">
            <div>
              <p class="product-name">${r(t.productName||e.title||"Recommended product")}</p>
              <span class="price">${r(e.price?m(e.price,s):"")}</span>
            </div>
            <p class="reason">${r(t.oneLineReason||"A useful add-on for what you just bought.")}</p>
            <button type="button" class="primary" data-add>${r(t.ctaText||"Add to my order")}</button>
          </div>
        </article>
      </section>
    `),this.root.querySelector("[data-add]")?.addEventListener("click",async()=>{this.trackClick("add_post_purchase");const a=e.variantId;if(a){await v(a);return}const n=e.handle;n&&(window.location.href=`/products/${n}`)})}isThankYouPage(){return/\/thank_you(?:\/|$)/.test(window.location.pathname)||!!window.Shopify?.checkout}}class tt extends h{getWidgetType(){return"rec_strip"}render(){const t=f(this.payload),e=String(window.AOVBoost?.currency||"USD");this.html(`
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
                  ${s.reason?`<span class="badge">${r(s.reason)}</span>`:""}
                  ${s.imageUrl?`<img data-src="${r(s.imageUrl)}" alt="${r(s.title)}">`:""}
                  <p class="product-name">${r(s.title)}</p>
                  <span class="price">${r(s.price?m(s.price,e):"")}</span>
                  <button type="button" class="primary" data-add="${r(s.variantId)}">Add to cart</button>
                </article>
              `).join("")}
        </div>
      </section>
    `),this.lazyLoadImages(),this.root.querySelectorAll("[data-add]").forEach(s=>{s.addEventListener("click",async()=>{this.trackClick("add_recommendation"),await v(s.dataset.add)})})}lazyLoadImages(){const t=Array.from(this.root.querySelectorAll("img[data-src]"));if(!("IntersectionObserver"in window)){t.forEach(s=>{s.src=s.dataset.src||""});return}const e=new IntersectionObserver(s=>{s.forEach(a=>{if(!a.isIntersecting)return;const n=a.target;n.src=n.dataset.src||"",e.unobserve(n)})});t.forEach(s=>e.observe(s))}}class et extends h{constructor(){super(...arguments);o(this,"interval")}getWidgetType(){return"social_proof"}render(){const s=f(this.payload).filter(n=>Number(n.orderCount||0)>0).map(n=>`${Number(n.orderCount)} people bought this with ${n.title}`);s.length===0&&s.push("Frequently bought together"),this.html(`
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
      <div class="pill" role="status"><span class="dot"></span><span data-message>${r(s[0])}</span></div>
    `);let a=0;this.interval=window.setInterval(()=>{a=(a+1)%s.length;const n=this.root.querySelector("[data-message]");n&&(n.textContent=s[a])},5e3)}destroy(){this.interval&&window.clearInterval(this.interval),super.destroy()}}class st extends h{constructor(){super(...arguments);o(this,"timer");o(this,"deadline",Date.now()+8e3)}getWidgetType(){return"upsell_drawer"}render(){const e=f(this.payload).slice(0,3),s=this.payload.copy||{},a=String(window.AOVBoost?.currency||"USD");this.html(`
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
            <h3 class="title">${r(s.headline||"Great choice. Complete the set")}</h3>
            <p class="body">People who bought this also love:</p>
          </div>
          <button type="button" class="icon" data-dismiss aria-label="Close">x</button>
        </div>
        <div class="timer"><span data-timer></span></div>
        <div class="product-grid">
          ${e.map(n=>`
                <article class="product-card">
                  ${n.imageUrl?`<img src="${r(n.imageUrl)}" alt="${r(n.title)}" loading="lazy">`:"<span></span>"}
                  <div class="stack">
                    <div>
                      <p class="product-name">${r(n.title)}</p>
                      <span class="price">${r(n.price?m(n.price,a):"")}</span>
                    </div>
                    <p class="reason">${r(n.reason||s.whyThisGoes||"It pairs well with your cart.")}</p>
                    <button type="button" class="primary" data-add="${r(n.variantId)}">Add to cart</button>
                  </div>
                </article>
              `).join("")}
        </div>
        <div class="actions">
          <a class="secondary" href="/cart">Continue to cart</a>
        </div>
      </aside>
    `),this.root.querySelectorAll("[data-dismiss]").forEach(n=>{n.addEventListener("click",()=>this.dismiss())}),this.root.querySelectorAll("[data-add]").forEach(n=>{n.addEventListener("click",async()=>{this.trackClick("add_upsell"),await v(n.dataset.add)})}),this.startCountdown()}destroy(){this.timer&&window.clearInterval(this.timer),super.destroy()}startCountdown(){this.timer&&window.clearInterval(this.timer),this.deadline=Date.now()+8e3,this.timer=window.setInterval(()=>{const e=Math.max(this.deadline-Date.now(),0),s=this.root.querySelector("[data-timer]");s&&(s.style.transform=`scaleX(${e/8e3})`),e<=0&&this.dismiss()},120)}dismiss(){this.trackDismiss(),this.container.animate([{transform:"translateX(0)"},{transform:"translateX(100%)"}],{duration:180,easing:"ease-in",fill:"forwards"}),window.setTimeout(()=>this.destroy(),190)}}const it="aovboost_dismissed_widgets";class at{constructor(){o(this,"activeWidget",null);o(this,"activeKey","")}mountDecision(t){if(!t.widgetType||this.getDismissedWidgets().includes(t.widgetType))return;const e=t.payload||{},s=String(e.offerId||""),a=`${t.widgetType}:${s}`;if(a===this.activeKey)return;this.destroyActive();const n=nt(t.widgetType,e);if(!n)return;const c=this.resolveTarget(t.widgetType);n.mount(c),this.activeWidget=n,this.activeKey=a}destroyActive(){this.activeWidget?.destroy(),this.activeWidget=null,this.activeKey=""}getDismissedWidgets(){try{const t=JSON.parse(localStorage.getItem(it)||"[]");return Array.isArray(t)?t.map(String):[]}catch{return[]}}resolveTarget(t){return t==="bundle"?b(".product-form, [data-product-form]"):t==="rec_strip"?b(".product__description, [data-product-description]"):t==="social_proof"?b(".product-form__submit, [data-add-to-cart]"):document.body}}function nt(i,t){switch(i){case"chat":return new X(t);case"bundle":return new H(t);case"upsell_drawer":return new st(t);case"discount_nudge":return new G(t);case"rec_strip":return new tt(t);case"social_proof":return new et(t);case"exit_intent":return new Q(t);case"post_purchase":return new Z(t);default:return null}}function b(i){const t=document.querySelector(i),e=document.createElement("div");return e.setAttribute("data-aovboost-mount",i),t?.parentElement?(t.insertAdjacentElement("afterend",e),e):(document.body.appendChild(e),e)}let T=!1;function x(){if(!T){T=!0;try{const i=window.AOVBoost||{},t=i.shop;if(!t)return;const e=i.apiBase||"/api",s=new R(t,e),a=new p({shop:t,sessionManager:s,apiBase:e}),n=new at,c=new W({shop:t,apiBase:e,eventBus:a,sessionManager:s,widgetManager:n});s.init(),a.init(),c.init(),window.AOVBoostSDK={shop:t,sessionId:s.anonymousId,track:(l,d={})=>a.track(l,d),requestOffer:()=>c.requestOffer("global"),destroy:()=>{c.destroy(),s.destroy(),n.destroyActive()}}}catch(i){console.log("AOVBoost SDK skipped:",i instanceof Error?i.message:String(i))}}}return document.readyState==="loading"?document.addEventListener("DOMContentLoaded",x,{once:!0}):x(),u.init=x,Object.defineProperty(u,Symbol.toStringTag,{value:"Module"}),u}({});
