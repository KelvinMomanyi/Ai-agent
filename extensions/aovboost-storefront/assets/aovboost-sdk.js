var AOVBoostSDKBundle=(function(w){"use strict";var xe=Object.defineProperty;var Ie=(w,b,x)=>b in w?xe(w,b,{enumerable:!0,configurable:!0,writable:!0,value:x}):w[b]=x;var c=(w,b,x)=>Ie(w,typeof b!="symbol"?b+"":b,x);class b{constructor(t){c(this,"options");c(this,"queue",[]);c(this,"flushTimer");c(this,"scrollDepths",new Set);c(this,"originalFetch",null);c(this,"authFlushInFlight",!1);this.options=t}init(){this.installNavigationTracking(),this.installCartFetchTracking(),this.installCartDomTracking(),this.installScrollTracking(),this.installHoverTracking(),this.installSearchTracking(),document.addEventListener("add-to-cart",(t=>{this.track("add_to_cart",x(t.detail))})),document.addEventListener("aovboost:track",(t=>{const e=x(t.detail);this.track(String(e.type||"widget_event"),e)})),window.addEventListener("pagehide",()=>this.flush()),this.trackPageView()}track(t,e={}){const r={type:t,ts:Date.now(),sessionId:this.options.sessionManager.anonymousId,shop:this.options.shop,url:window.location.href,referrer:document.referrer,...e};this.options.sessionManager.recordEvent(r),this.queue.push(r),document.dispatchEvent(new CustomEvent("aovboost:event",{detail:r})),this.scheduleFlush()}flush(){if(this.flushTimer&&(window.clearTimeout(this.flushTimer),this.flushTimer=void 0),this.queue.length===0)return;if(!this.options.sessionManager.getAuthPayload().sessionToken){this.flushAfterAuth();return}const t=this.queue.splice(0);this.postEvents(t)}async flushAfterAuth(){if(!this.authFlushInFlight){this.authFlushInFlight=!0;try{await this.options.sessionManager.ensureAuthenticated()&&this.flush()}finally{this.authFlushInFlight=!1}}}scheduleFlush(){this.flushTimer||(this.flushTimer=window.setTimeout(()=>this.flush(),2e3))}endpoint(t){return`${(this.options.apiBase||"/apps/aovboost").replace(/\/$/,"")}${t}`}async postEvents(t,e=!1){const r=await this.options.sessionManager.getSignedAuthPayload();if(!r){this.queue.unshift(...t);return}try{const s=await fetch(this.endpoint("/events"),{method:"POST",headers:{"Content-Type":"application/json","X-AOVBoost-Shop":this.options.shop},body:JSON.stringify({...r,events:t}),keepalive:!0});if(s.status===401&&!e){if(await this.options.sessionManager.applySessionFromResponse(s)||await this.options.sessionManager.refreshAuth(),!this.options.sessionManager.getAuthPayload().sessionToken){this.queue.unshift(...t);return}await this.postEvents(t,!0);return}!s.ok&&s.status!==401&&this.queue.unshift(...t)}catch{this.queue.unshift(...t)}}installNavigationTracking(){const t=history.pushState,e=history.replaceState;history.pushState=(...r)=>{const s=t.apply(history,r);return window.setTimeout(()=>this.trackPageView(),0),s},history.replaceState=(...r)=>{const s=e.apply(history,r);return window.setTimeout(()=>this.trackPageView(),0),s},window.addEventListener("popstate",()=>this.trackPageView())}trackPageView(){this.track("page_view",{pageType:wt()}),bt()&&this.track("checkout_start",{path:window.location.pathname});const t=mt();t&&this.track("product_view",{productId:It(t.gid||t.id),handle:t.handle,title:t.title});const e=yt();(e||window.location.pathname.includes("/collections/"))&&this.track("collection_view",{collectionId:String(e?.id||""),handle:e?.handle||vt("/collections/"),title:e?.title})}installCartFetchTracking(){this.originalFetch||(this.originalFetch=window.fetch.bind(window),window.fetch=async(...t)=>{const e=_t(t[0]),r=t[1],s=await this.originalFetch(...t);try{D(e)?this.track("add_to_cart",{...N(r?.body),requestUrl:e}):St(e)?this.track("remove_from_cart",{...N(r?.body),requestUrl:e}):kt(e)&&this.track("search",{query:xt(e),requestUrl:e})}catch{}return s})}installCartDomTracking(){document.addEventListener("submit",t=>{const e=t.target;if(!(!e||!D(e.action||"")))try{this.track("add_to_cart",{...N(new FormData(e)),source:"cart_form_submit",requestUrl:e.action})}catch{this.track("add_to_cart",{source:"cart_form_submit",requestUrl:e.action})}},!0),document.addEventListener("click",t=>{const r=t.target?.closest?.("button[name='add'], [type='submit'][name='add'], [data-add-to-cart]");if(!r)return;const s=r.closest("form");s&&!D(s.action||"")||this.track("add_to_cart",{source:"add_button_click",requestUrl:s?.action||""})},!0)}installScrollTracking(){let t=!1;window.addEventListener("scroll",()=>{t||(t=!0,window.setTimeout(()=>{t=!1;const e=document.documentElement.scrollHeight-window.innerHeight;if(e<=0)return;const r=Math.round(window.scrollY/e*100);[25,50,75,90].forEach(s=>{r>=s&&!this.scrollDepths.has(s)&&(this.scrollDepths.add(s),this.track("scroll_depth",{depth:s}))})},200))},{passive:!0})}installHoverTracking(){document.addEventListener("mouseenter",t=>{const r=t.target?.closest?.(".product-card");if(!r)return;const s=window.setTimeout(()=>{this.track("product_hover",{productId:r.dataset.productId||r.dataset.productGid||"",handle:r.dataset.productHandle||""})},800);r.addEventListener("mouseleave",()=>window.clearTimeout(s),{once:!0})},!0)}installSearchTracking(){document.addEventListener("input",t=>{const e=t.target;if(!e||!`${e.name||""} ${e.id||""} ${e.type||""}`.toLowerCase().includes("search"))return;const s=e.value.trim();s.length<2||this.track("search",{query:s,source:"predictive_input"})},!0)}}function x(i){return i&&typeof i=="object"&&!Array.isArray(i)?i:{}}function mt(){const i=window;return i.Shopify?.product||i.ShopifyAnalytics?.meta?.product||null}function yt(){const i=window;return i.Shopify?.collection||i.ShopifyAnalytics?.meta?.collection||null}function wt(){return window.ShopifyAnalytics?.meta?.page?.pageType||document.body?.dataset?.template||(window.location.pathname==="/"?"home":"other")}function bt(){return/\/checkout(?:\/|$)/.test(window.location.pathname)}function vt(i){const t=window.location.pathname.indexOf(i);return t===-1?"":window.location.pathname.slice(t+i.length).split("/")[0]||""}function _t(i){return typeof i=="string"?i:i instanceof URL?i.toString():i.url||""}function D(i){return/\/cart\/add(?:\.js)?/.test(i)}function St(i){return/\/cart\/(?:change|update)(?:\.js)?/.test(i)}function kt(i){return i.includes("/search/suggest.json")}function xt(i){try{return new URL(i,window.location.origin).searchParams.get("q")||""}catch{return""}}function N(i){if(!i)return{};if(typeof FormData<"u"&&i instanceof FormData)return{variantId:String(i.get("id")||i.get("items[0][id]")||""),quantity:Number(i.get("quantity")||1)};if(typeof URLSearchParams<"u"&&i instanceof URLSearchParams)return{variantId:String(i.get("id")||i.get("items[0][id]")||""),quantity:Number(i.get("quantity")||1)};try{const t=String(i);if(t.trim().startsWith("{")){const r=JSON.parse(t);return{productId:r.productId||r.product_id,variantId:r.id||r.items?.[0]?.id,quantity:r.quantity||r.items?.[0]?.quantity||1}}const e=new URLSearchParams(t);return{variantId:String(e.get("id")||e.get("items[0][id]")||""),quantity:Number(e.get("quantity")||1)}}catch{return{}}}function It(i){const t=String(i||"");return t?t.startsWith("gid://shopify/Product/")?t:`gid://shopify/Product/${t}`:""}const F=10*1e3,G=2500,Tt=8e3;class At{constructor(t){c(this,"options");c(this,"pollTimer");c(this,"requestController");c(this,"running",!1);c(this,"destroyed",!1);c(this,"enabled",!0);c(this,"seenEventIds",new Set);c(this,"handlePageHide",()=>this.pause());c(this,"handlePageShow",()=>{this.destroyed||!this.enabled||this.running||(this.running=!0,this.schedule(G))});this.options=t}init(){this.running||this.destroyed||!this.enabled||(window.addEventListener("pagehide",this.handlePageHide),window.addEventListener("pageshow",this.handlePageShow),this.running=!0,this.schedule(G))}destroy(){this.destroyed=!0,this.pause(),window.removeEventListener("pagehide",this.handlePageHide),window.removeEventListener("pageshow",this.handlePageShow),this.seenEventIds.clear()}pause(){this.running=!1,this.pollTimer&&window.clearTimeout(this.pollTimer),this.pollTimer=void 0,this.requestController?.abort(),this.requestController=void 0}schedule(t){!this.running||this.destroyed||!this.enabled||(this.pollTimer&&window.clearTimeout(this.pollTimer),this.pollTimer=window.setTimeout(()=>{this.pollTimer=void 0,this.poll()},t))}async poll(){let t=F;try{const e=await this.requestUpdates();if(t=e.pollAfterMs,!e.enabled){this.enabled=!1,this.pause();return}e.events.forEach(r=>this.dispatch(r))}catch{}finally{this.requestController=void 0,this.schedule(t)}}async requestUpdates(t=!1){const e=await this.options.sessionManager.getSignedAuthPayload();if(!e)return{enabled:!0,events:[],pollAfterMs:F};const r=new AbortController;this.requestController=r;const s=window.setTimeout(()=>r.abort(),Tt);let a;try{a=await fetch(this.endpoint("/live"),{method:"POST",headers:{Accept:"application/json","Content-Type":"application/json","X-AOVBoost-Shop":e.shop},body:JSON.stringify(e),cache:"no-store",signal:r.signal})}finally{window.clearTimeout(s)}if(a.status===401&&!t)return await this.options.sessionManager.applySessionFromResponse(a)||await this.options.sessionManager.refreshAuth(),this.requestUpdates(!0);if(a.status===429){const o=Number(a.headers.get("Retry-After")||60);return{enabled:!0,events:[],pollAfterMs:Y(o*1e3)}}if(!a.ok)throw new Error(`Live update request failed: ${a.status}`);const n=await a.json();return{enabled:n.enabled!==!1,events:Array.isArray(n.events)?n.events.filter(Ct):[],pollAfterMs:Y(n.pollAfterMs)}}dispatch(t){this.seenEventIds.has(t.id)||(this.seenEventIds.add(t.id),document.dispatchEvent(new CustomEvent("aovboost:system-event",{detail:t})))}endpoint(t){return`${this.options.apiBase.replace(/\/$/,"")}${t}`}}function Ct(i){if(!i||typeof i!="object"||Array.isArray(i))return!1;const t=i;return typeof t.id=="string"&&typeof t.productId=="string"&&(t.type==="price_drop_webhook"||t.type==="low_inventory_alert")}function Y(i){const t=Number(i);return Number.isFinite(t)?Math.min(Math.max(t,5e3),6e4):F}const J="aovboost_dismissed_widgets",Pt="USD";class g{constructor(t){c(this,"payload");c(this,"root");c(this,"container");this.payload=t,this.container=document.createElement("div"),this.container.setAttribute("data-aovboost-widget",this.getWidgetType()),this.root=this.container.attachShadow({mode:"open"}),this.injectStyles()}destroy(){this.container.remove()}mount(t=document.body){t.appendChild(this.container),this.render(),this.trackImpression()}injectStyles(){const t=document.createElement("style");t.textContent=Ft,this.root.appendChild(t)}trackImpression(){this.track("widget_impression",{})}trackClick(t){this.track("widget_click",{action:t})}trackDismiss(){this.track("widget_dismiss",{});try{const t=JSON.parse(localStorage.getItem(J)||"[]"),r=[...(Array.isArray(t)?t.filter(s=>typeof s=="object"&&s):[]).filter(s=>s.widgetType!==this.getWidgetType()),{widgetType:this.getWidgetType(),dismissedAt:Date.now()}];localStorage.setItem(J,JSON.stringify(r))}catch{}}track(t,e){const r=window.AOVBoostSDK?.track,s={type:t,widgetType:this.getWidgetType(),offerId:this.payload.offerId,...e};if(typeof r=="function"){r(t,s);return}document.dispatchEvent(new CustomEvent("aovboost:track",{detail:s}))}html(t){const e=this.root.querySelector("[data-aovboost-content]");e&&e.remove();const r=document.createElement("div");r.setAttribute("data-aovboost-content","true"),r.innerHTML=t,this.root.appendChild(r)}}function d(i,t=""){return Nt(typeof i=="string"&&i.trim()?i:t)}function C(){const i=window.AOVBoost||{},t=window.Shopify||{},e=window.ShopifyAnalytics||{},s=[{value:i.currency,source:"aovboost_config"},{value:i.currencyCode,source:"aovboost_config"},{value:t.currency?.active,source:"shopify_currency"},{value:t.checkout?.currency,source:"shopify_checkout"},{value:e.meta?.currency,source:"shopify_analytics"}].find(n=>P(n.value,"")!=="");return{code:P(s?.value),source:s?.source||"fallback",moneyFormat:O(i.moneyFormat),moneyWithCurrencyFormat:O(i.moneyWithCurrencyFormat),locale:O(i.locale)||document.documentElement.lang||navigator.language}}function K(i){const t=P(i,"");if(!t)return;const e=window.AOVBoost||{};window.AOVBoost={...e,currency:t}}function f(i,t=C()){const e=Number(i||0);if(!Number.isFinite(e))return"";const r=$t(t),s=r.moneyFormat||r.moneyWithCurrencyFormat||"";if(s)return Et(e,s,r.code);try{return new Intl.NumberFormat(r.locale||void 0,{style:"currency",currency:r.code,currencyDisplay:"symbol"}).format(e)}catch{return`${r.code} ${e.toFixed(2)}`.trim()}}function $t(i){if(typeof i=="string")return{...C(),code:P(i)};const t=C();return{...t,...i,code:i.code===void 0?t.code:P(i.code)}}function P(i,t=Pt){const e=String(i||"").trim().toUpperCase();return/^[A-Z]{3}$/.test(e)?e:t}function O(i){return typeof i=="string"&&i.trim()?i.trim():""}function Et(i,t,e){const r=Mt(t),s=r.match(/\{\{\s*(amount[a-z_]*)\s*\}\}/i),a=s?.[1]||"amount",n=Lt(i,a);return(s?r.replace(s[0],n):`${r}${n}`).replace(/\{\{\s*currency\s*\}\}/gi,e)}function Lt(i,t){switch(t){case"amount_no_decimals":return I(i,0,",",".");case"amount_with_comma_separator":return I(i,2,".",",");case"amount_no_decimals_with_comma_separator":return I(i,0,".",",");case"amount_with_apostrophe_separator":return I(i,2,"'",".");case"amount_no_decimals_with_space_separator":return I(i,0," ",".");case"amount_with_space_separator":return I(i,2," ",".");default:return I(i,2,",",".")}}function I(i,t,e,r){const s=t>0?i.toFixed(t):String(Math.round(i)),[a,n]=s.split("."),o=a.replace(/\B(?=(\d{3})+(?!\d))/g,e);return n?`${o}${r}${n}`:o}function Mt(i){return i.replace(/<[^>]*>/g,"").replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/&quot;/gi,'"').replace(/&#39;/g,"'")}function $(i){const e=[i.products,i.bundle?.items,i.items].find(r=>Array.isArray(r));return Array.isArray(e)?e.map(r=>{const s=r.product||r.target||r,a=String(s.variantId||r.variantId||""),n=qt(s.variants||r.variants);n.length===0&&a&&n.push({id:a,title:"Default",sku:"",price:String(s.price||r.price||"0"),compareAtPrice:null,quantityAvailable:null,availableForSale:!0,selectedOptions:[]});const o=n.find(l=>l.id===a&&l.availableForSale)||n.find(l=>l.availableForSale);return{id:s.id||r.productId||r.targetId,variantId:o?.id||"",title:s.title||r.title||"Recommended product",handle:s.handle||r.handle||"",imageUrl:s.imageUrl||s.image||r.imageUrl||r.image||"",price:String(o?.price||s.price||r.price||""),quantity:Number(r.quantity||1),reason:String(r.reason||r.affinity?.reason||r.reasoning||""),orderCount:Number(r.orderCount||r.affinity?.orderCount||0),variants:n}}):[]}function j(i,t){return i.variants.length<=1?"":`
    <label class="variant-picker">
      <span>Choose options</span>
      <select data-variant-picker="${d(t)}" aria-label="Choose ${d(i.title)} options">
        ${i.variants.map(e=>`
              <option value="${d(e.id)}"
                ${e.id===i.variantId?"selected":""}
                ${e.availableForSale?"":"disabled"}>
                ${d(Vt(e))}${e.availableForSale?"":" - Sold out"}
              </option>
            `).join("")}
      </select>
    </label>
  `}function T(i,t,e){const s=Array.from(i.querySelectorAll("[data-variant-picker]")).find(a=>a.dataset.variantPicker===e)?.value||t.variantId;return t.variants.find(a=>a.id===s&&a.availableForSale)||t.variants.find(a=>a.availableForSale)||null}function Vt(i){return i.selectedOptions.map(e=>`${e.name}: ${e.value}`).join(" / ")||i.title||"Default"}function qt(i){if(!Array.isArray(i))return[];const t=new Set;return i.map(e=>e&&typeof e=="object"&&!Array.isArray(e)?e:{}).map(e=>{const r=String(e.id||""),s=Number(e.price);if(!r.startsWith("gid://shopify/ProductVariant/")||!Number.isFinite(s))return null;const a=Array.isArray(e.selectedOptions)?e.selectedOptions.map(o=>o&&typeof o=="object"&&!Array.isArray(o)?o:{}).map(o=>({name:String(o.name||""),value:String(o.value||"")})).filter(o=>o.name&&o.value):[],n=e.quantityAvailable===null||e.quantityAvailable===void 0?null:Number(e.quantityAvailable);return{id:r,title:String(e.title||"Default"),sku:String(e.sku||""),price:String(e.price),compareAtPrice:e.compareAtPrice===null||e.compareAtPrice===void 0?null:String(e.compareAtPrice),quantityAvailable:n!==null&&Number.isFinite(n)?n:null,availableForSale:e.availableForSale===!0,selectedOptions:a}}).filter(e=>!!e).filter(e=>t.has(e.id)?!1:(t.add(e.id),!0))}async function E(i,t=1,e){if(!i)return null;const r=String(i).split("/").pop(),s=await fetch("/cart/add.js",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:r,quantity:t,properties:X(e)})});return s.ok?s.json():null}async function Dt(i,t,e){const r=i.filter(a=>a.variantId).map(a=>({id:String(a.variantId).split("/").pop(),quantity:a.quantity||1,properties:X(t,e)}));if(r.length===0)return null;const s=await fetch("/cart/add.js",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({items:r})});return s.ok?s.json():null}function X(i,t={}){const e=String(i||"").trim(),r=Object.entries(t).filter(([a,n])=>a.startsWith("_aovboost_")&&n),s=Object.fromEntries(r);return e&&(s._aovboost_offer_id=e),Object.keys(s).length>0?s:void 0}function Nt(i){return String(i||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;")}const Ft=`
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
`;class Ot{constructor(t){c(this,"timer");c(this,"inFlight",!1);c(this,"stopped",!1);c(this,"options");this.options=t}init(){window.setTimeout(()=>this.requestOffer("initial"),1200),this.options.pollMs&&(this.timer=window.setInterval(()=>this.requestOffer("poll"),this.options.pollMs)),document.addEventListener("aovboost:request-offer",()=>{this.requestOffer("manual")}),window.addEventListener("popstate",()=>{window.setTimeout(()=>this.requestOffer("navigation"),300)})}destroy(){this.stopped=!0,this.timer&&window.clearInterval(this.timer)}async requestOffer(t="manual",e={}){if(this.inFlight||this.stopped)return null;this.inFlight=!0;try{const r=this.options.sessionManager.getSnapshot(),s=await Ht(),a=s.cartItemCount>0||s.cartValue>0,n=Array.isArray(e.cartProductIds)?e.cartProductIds.map(String):a?s.cartProductIds:r.cartProductIds,o=Array.isArray(e.cartVariantIds)?e.cartVariantIds.map(String):a?s.cartVariantIds:Array.isArray(r.context.cartVariantIds)?r.context.cartVariantIds.map(String):[],l=Array.isArray(e.cartItems)?e.cartItems:a?s.cartItems:[],u=typeof e.cartItemCount=="number"?e.cartItemCount:a?s.cartItemCount:Number(r.context.cartItemCount||0),h=typeof e.cartValue=="number"?e.cartValue:a?s.cartValue:r.cartValue,m=await this.options.sessionManager.getSignedAuthPayload();if(!m)return this.mountLocalFallback(t,e);const p=C(),v=await Wt(),_={...m,currentProductId:v,currentPageType:Bt(),cartProductIds:n,cartVariantIds:o,cartItems:l,cartItemCount:u,cartValue:h,currency:p.code,moneyFormat:p.moneyFormat,moneyWithCurrencyFormat:p.moneyWithCurrencyFormat,locale:p.locale,dismissedWidgets:this.options.widgetManager.getDismissedWidgets(),trigger:t,triggerCategory:e.triggerCategory,triggerPayload:e};let y=await fetch(this.endpoint("/offer"),{method:"POST",headers:{"Content-Type":"application/json","X-AOVBoost-Shop":this.options.shop},body:JSON.stringify({..._,...m}),keepalive:!0});if(y.status===401){await this.options.sessionManager.applySessionFromResponse(y)||await this.options.sessionManager.refreshAuth();const S=await this.options.sessionManager.getSignedAuthPayload();if(!S)return this.mountLocalFallback(t,e);y=await fetch(this.endpoint("/offer"),{method:"POST",headers:{"Content-Type":"application/json","X-AOVBoost-Shop":this.options.shop},body:JSON.stringify({..._,...S}),keepalive:!0})}if(!y.ok)return this.mountLocalFallback(t,e);const A=await y.json();return A.widgetType?(this.options.widgetManager.mountDecision(A),A):this.mountLocalFallback(t,e)}catch{return this.mountLocalFallback(t,e)}finally{this.inFlight=!1}}endpoint(t){return`${this.options.apiBase.replace(/\/$/,"")}${t}`}mountLocalFallback(t,e){const r=jt(t,e);return r?(this.options.widgetManager.mountDecision(r),r):null}}function jt(i,t){const e=Number(t.cartValue||0);switch(i){case"first_time_visitor":case"long_product_dwell":case"scroll_depth_interest":case"comparison_page_visit":case"inactivity_timeout":case"purchase_history_match":case"loyalty_tier_reached":case"crm_segment_update":return{widgetType:"chat",payload:{offerId:`local:${i}`,greeting:"Hi. I can help you compare products and find useful add-ons.",copy:{greeting:"Hi. I can help you compare products and find useful add-ons.",ctaAccept:"Chat with AI",ctaDecline:"Browse myself"}},reasoning:"Local fallback for proactive chat trigger.",confidence:.4,aiProvider:"heuristic"};case"exit_intent":return{widgetType:"exit_intent",payload:{offerId:"local:exit_intent",immediate:!0,offerLine:"Before you go, I can help find a better match or bundle.",copy:{headline:"Wait before you go",offerLine:"I can help find a better match or bundle.",ctaText:"Open assistant",dismissText:"No thanks"}},reasoning:"Local fallback for exit intent.",confidence:.4,aiProvider:"heuristic"};case"cart_value_threshold":case"cart_abandoned":return{widgetType:"discount_nudge",payload:{offerId:`local:${i}`,cartValue:e,threshold:Number(t.threshold||50),copy:{progressLabel:"You are close to a reward",rewardDescription:"Add one more item to unlock the offer.",ctaText:"View picks"}},reasoning:"Local fallback for cart value or idle cart trigger.",confidence:.4,aiProvider:"heuristic"};case"flash_sale_window":case"seasonal_calendar":return{widgetType:"countdown_banner",payload:{offerId:`local:${i}`,endsAt:t.endsAt,body:"Limited-time product picks are available right now.",copy:{headline:"Limited-time offer",subheadline:"Relevant bundles and add-ons are available now.",ctaText:"View offer"}},reasoning:"Local fallback for scheduled campaign trigger.",confidence:.4,aiProvider:"heuristic"};case"low_inventory_alert":case"price_drop_webhook":return{widgetType:"inline_alert",payload:{offerId:`local:${i}`,body:i==="price_drop_webhook"?"The price on this product has changed.":"Inventory is limited for this product.",copy:{headline:i==="price_drop_webhook"?"Price update":"Limited stock",subheadline:i==="price_drop_webhook"?"The price on this product has changed.":"Inventory is limited for this product."}},reasoning:"Local fallback for system alert trigger.",confidence:.4,aiProvider:"heuristic"};case"cart_item_added":case"cart_item_removed":case"search_query":case"repeated_product_view":case"price_hesitation":case"wishlist_save":case"coupon_field_focus":case"subscription_renewal_due":case"payment_failure":return{widgetType:"toast",payload:{offerId:`local:${i}`,headline:Q(i),body:Z(i),copy:{headline:Q(i),subheadline:Z(i),ctaText:"Open assistant",dismissText:"No thanks"}},reasoning:"Local fallback for low-disruption trigger.",confidence:.4,aiProvider:"heuristic"};default:return null}}function Q(i){return i==="cart_item_added"?"Complete the set":i==="coupon_field_focus"?"Looking for a code?":i==="price_hesitation"?"Need a better fit?":i==="wishlist_save"?"Saved for later":i==="search_query"?"Need help choosing?":"Need help deciding?"}function Z(i){return i==="cart_item_added"?"I can help find matching accessories or add-ons.":i==="cart_item_removed"?"I can help find a better alternative.":i==="coupon_field_focus"?"I can help find a relevant offer or lower-priced option.":i==="price_hesitation"?"I can help compare value and find a lower-priced alternative.":i==="wishlist_save"?"I can compare this with related products when you are ready.":"I can help find the right product or useful add-on."}function Bt(){const i=window.location.pathname,t=String(window.ShopifyAnalytics?.meta?.page?.pageType||document.body?.dataset?.template||"").toLowerCase();return i==="/"?"home":/\/collections(?:\/|$)/.test(i)||t.includes("collection")?"collection":/\/products(?:\/|$)/.test(i)||t.includes("product")?"product":/\/cart(?:\/|$)/.test(i)||t.includes("cart")?"cart":/\/checkout(?:\/|$)/.test(i)?"checkout":/\/thank_you(?:\/|$)/.test(i)||window.Shopify?.checkout?"thankyou":"other"}async function Wt(){const i=window.Shopify?.product||window.ShopifyAnalytics?.meta?.product||null,t=String(i?.gid||i?.id||"");if(t)return B(t);const e=window.location.pathname.match(/\/products\/([^/?#]+)/)?.[1];if(e)try{const r=await fetch(`/products/${e}.js`,{headers:{Accept:"application/json"},keepalive:!0});if(!r.ok)return;const s=await r.json();return B(s.id)}catch{return}}async function Ht(){try{const i=await fetch("/cart.js",{headers:{Accept:"application/json"},keepalive:!0});if(!i.ok)throw new Error(`Cart read failed: ${i.status}`);const t=await i.json();K(t.currency);const e=Array.isArray(t.items)?t.items:[],r=e.map(a=>tt(a)).filter(Boolean),s=e.map(a=>et(a)).filter(Boolean);return{cartToken:t.token||"",cartProductIds:r,cartVariantIds:s,cartItems:e.map(a=>({productId:tt(a),variantId:et(a),quantity:Number(a.quantity||1),title:String(a.product_title||a.title||""),handle:String(a.handle||a.url||"").split("/products/")[1]?.split(/[?#/]/)[0]||""})),cartItemCount:Number(t.item_count||e.length||0),cartValue:Number(t.total_price||0)/100,currency:String(t.currency||"")}}catch{return{cartToken:"",cartProductIds:[],cartVariantIds:[],cartItems:[],cartItemCount:0,cartValue:0,currency:""}}}function B(i){const t=String(i||"");return t?t.startsWith("gid://shopify/Product/")?t:`gid://shopify/Product/${t}`:""}function Rt(i){const t=String(i||"");return t?t.startsWith("gid://shopify/ProductVariant/")?t:`gid://shopify/ProductVariant/${t}`:""}function tt(i){const t=it(i.product);return B(i.product_id||i.productId||i.product_gid||i.productGid||t.id)}function et(i){const t=it(i.variant);return Rt(i.variant_id||i.variantId||i.id||i.variant_gid||i.variantGid||t.id)}function it(i){return i&&typeof i=="object"&&!Array.isArray(i)?i:{}}const W="aovboost_anonymous_id",H="aovboost_storefront_session";class Ut{constructor(t,e="/apps/aovboost"){c(this,"shop");c(this,"apiBase");c(this,"anonymousId","");c(this,"sessionToken","");c(this,"settings",{});c(this,"journeyStage","discovering");c(this,"viewedProductIds",new Set);c(this,"productViewCounts",new Map);c(this,"cartProductIds",new Set);c(this,"cartVariantIds",new Set);c(this,"cartItemCount",0);c(this,"pageViews",0);c(this,"maxScrollDepth",0);c(this,"cartActionCount",0);c(this,"cartValue",0);c(this,"startedAt",Date.now());c(this,"lastCartActionAt",0);c(this,"lastEventType","");c(this,"syncTimer");c(this,"authRefreshPromise");this.shop=t,this.apiBase=e}async init(){await this.ensureAuthenticated()?await this.loadSettings():this.bootstrapLocalSession(),this.syncTimer=window.setInterval(()=>this.sync(),3e4),window.addEventListener("pagehide",()=>this.sync())}destroy(){this.syncTimer&&window.clearInterval(this.syncTimer)}recordEvent(t){if(this.lastEventType=t.type,t.type==="page_view"&&(this.pageViews+=1),t.type==="product_view"){const e=R(t);e&&(this.viewedProductIds.add(e),this.productViewCounts.set(e,(this.productViewCounts.get(e)||0)+1))}if(t.type==="scroll_depth"&&(this.maxScrollDepth=Math.max(this.maxScrollDepth,Number(t.depth||0))),t.type==="add_to_cart"){this.cartActionCount+=1,this.lastCartActionAt=Date.now();const e=R(t);e&&this.cartProductIds.add(e),Array.isArray(t.cartProductIds)&&t.cartProductIds.forEach(r=>this.cartProductIds.add(String(r))),Array.isArray(t.cartVariantIds)&&t.cartVariantIds.forEach(r=>this.cartVariantIds.add(String(r))),this.cartItemCount=Math.max(this.cartItemCount,Number(t.cartItemCount||this.cartItemCount)),this.cartValue=Math.max(this.cartValue,Number(t.cartValue||0)),this.journeyStage="buying"}if(t.type==="cart_update"&&(this.lastCartActionAt=Date.now(),Array.isArray(t.cartProductIds)&&(this.cartProductIds=new Set(t.cartProductIds.map(String))),Array.isArray(t.cartVariantIds)&&(this.cartVariantIds=new Set(t.cartVariantIds.map(String))),this.cartItemCount=Number(t.cartItemCount||this.cartProductIds.size),this.cartValue=Number(t.cartValue||0),(this.cartProductIds.size>0||this.cartItemCount>0)&&(this.journeyStage="buying")),t.type==="remove_from_cart"){this.cartActionCount+=1,this.lastCartActionAt=Date.now();const e=R(t);e&&this.cartProductIds.delete(e)}this.updateJourneyStage()}getSnapshot(){const t=Math.round((Date.now()-this.startedAt)/1e3),e=Array.from(this.productViewCounts.values()).reduce((o,l)=>o+l,0),r=rt(this.pageViews*2+e*5+(this.maxScrollDepth>=90?10:this.maxScrollDepth>=75?8:this.maxScrollDepth>=50?5:this.maxScrollDepth>=25?3:0)+Math.min(t/120,1)*30+(this.cartProductIds.size>0?30:0),0,100),s=Array.from(this.productViewCounts.entries()).some(([o,l])=>l>=2&&!this.cartProductIds.has(o)),a=this.lastCartActionAt?(Date.now()-this.lastCartActionAt)/1e3:t,n=rt((r>40&&this.cartActionCount===0&&a>=90?55:0)+(s?35:0),0,100);return{anonymousId:this.anonymousId,journeyStage:this.journeyStage,intentScore:r,hesitationScore:n,viewedProductIds:Array.from(this.viewedProductIds),cartProductIds:Array.from(this.cartProductIds),totalPageViews:this.pageViews,sessionDuration:t,cartValue:this.cartValue,context:{maxScrollDepth:this.maxScrollDepth,productViewCounts:Object.fromEntries(this.productViewCounts),cartActionCount:this.cartActionCount,cartItemCount:this.cartItemCount,cartVariantIds:Array.from(this.cartVariantIds),cartValue:this.cartValue,lastEventType:this.lastEventType}}}getAuthPayload(){return{sessionId:this.anonymousId,sessionToken:this.sessionToken,shop:this.shop}}getSettings(){return{...this.settings}}async getSignedAuthPayload(){return!await this.ensureAuthenticated()||!this.anonymousId||!this.sessionToken?null:this.getAuthPayload()}async ensureAuthenticated(){if(this.sessionToken)return!0;try{await this.ensureStorefrontSession()}catch{await this.refreshAuth()}return!!this.sessionToken}async refreshAuth(){return this.authRefreshPromise?this.authRefreshPromise:(this.authRefreshPromise=this.refreshAuthInternal().finally(()=>{this.authRefreshPromise=void 0}),this.authRefreshPromise)}async refreshAuthInternal(){const t=this.anonymousId,e=this.sessionToken;try{window.localStorage.removeItem(H)}catch{}try{await this.ensureStorefrontSession({forceRefresh:!0})}catch{e?(this.anonymousId=t,this.sessionToken=e):this.bootstrapLocalSession()}this.syncGlobalSdkAuth()}applyStorefrontSession(t){const e=zt(t);return!e||e.shop!==this.shop||!e.sessionId||!e.sessionToken||Number(e.expiresAt||0)<=Math.floor(Date.now()/1e3)+60?!1:(this.anonymousId=e.sessionId,this.sessionToken=e.sessionToken,e.settings&&(this.settings=e.settings),this.storeStorefrontSession(e),this.syncGlobalSdkAuth(),!0)}async applySessionFromResponse(t){try{const e=await t.clone().json(),r=L(e);return this.applyStorefrontSession(r?.storefrontSession||r?.session||e)}catch{return!1}}syncGlobalSdkAuth(){const t=window.AOVBoostSDK;!t||typeof t!="object"||(t.sessionId=this.anonymousId,t.sessionToken=this.sessionToken)}sync(){if(!this.anonymousId||!this.sessionToken){this.ensureAuthenticated();return}const t=this.getSnapshot(),e=JSON.stringify({...this.getAuthPayload(),events:[{type:"session_sync",ts:Date.now(),sessionId:this.anonymousId,shop:this.shop,url:window.location.href,referrer:document.referrer,snapshot:t,...t}]});fetch(this.endpoint("/events"),{method:"POST",headers:{"Content-Type":"application/json","X-AOVBoost-Shop":this.shop},body:e,keepalive:!0}).then(r=>{r.status===401&&this.refreshAuth()}).catch(()=>{})}updateJourneyStage(){if(this.cartProductIds.size>0){this.journeyStage="buying";return}if(this.cartItemCount>0){this.journeyStage="buying";return}if(this.getSnapshotDuration()>=60||Array.from(this.productViewCounts.values()).some(t=>t>=2)){this.journeyStage="deciding";return}if(this.viewedProductIds.size>=3){this.journeyStage="comparing";return}this.journeyStage="discovering"}endpoint(t){return`${this.apiBase.replace(/\/$/,"")}${t}`}async ensureStorefrontSession(t={}){const e=t.forceRefresh?null:this.getStoredStorefrontSession();if(e){this.anonymousId=e.sessionId,this.sessionToken=e.sessionToken;return}const r=await fetch(this.endpoint("/session"),{method:"GET",headers:{Accept:"application/json"}});if(!r.ok)throw new Error(`Session bootstrap failed: ${r.status}`);const s=await r.json();if(!this.applyStorefrontSession(s))throw new Error("Invalid storefront session bootstrap response")}async loadSettings(){try{const t=await fetch(this.endpoint("/config"),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(this.getAuthPayload())});if(!t.ok)return;const e=L(await t.json()),r=L(e?.settings);r&&(this.settings=r)}catch{}}getStoredStorefrontSession(){try{const t=JSON.parse(window.localStorage.getItem(H)||"null");return!t||t.shop!==this.shop||!t.sessionId||!t.sessionToken||Number(t.expiresAt||0)<=Math.floor(Date.now()/1e3)+60?null:t}catch{return null}}storeStorefrontSession(t){try{window.localStorage.setItem(H,JSON.stringify(t)),window.localStorage.setItem(W,t.sessionId)}catch{}}bootstrapLocalSession(){let t="";try{t=window.localStorage.getItem(W)||"",t||(t=typeof crypto<"u"&&"randomUUID"in crypto?crypto.randomUUID():`local-${Date.now()}-${Math.random().toString(36).slice(2)}`,window.localStorage.setItem(W,t))}catch{t=`local-${Date.now()}-${Math.random().toString(36).slice(2)}`}this.anonymousId=t,this.sessionToken=""}getSnapshotDuration(){return Math.round((Date.now()-this.startedAt)/1e3)}}function zt(i){const t=L(i);return t?{shop:String(t.shop||""),sessionId:String(t.sessionId||""),sessionToken:String(t.sessionToken||""),expiresAt:Number(t.expiresAt||0),settings:L(t.settings)}:null}function L(i){return i&&typeof i=="object"&&!Array.isArray(i)?i:null}function R(i){const t=i.product;return String(i.productId||i.product_id||t?.id||"")}function rt(i,t,e){return Math.min(Math.max(i,t),e)}const st=600*1e3,at=300*1e3,nt=30*1e3,Gt={long_product_dwell:{category:"browsing_behavior",widgetHint:"chat",throttleMs:60*1e3},repeated_product_view:{category:"browsing_behavior",widgetHint:"bundle",throttleMs:60*1e3},scroll_depth_interest:{category:"browsing_behavior",widgetHint:"chat",oncePerSession:!0},comparison_page_visit:{category:"browsing_behavior",widgetHint:"chat",oncePerSession:!0},search_query:{category:"browsing_behavior",widgetHint:"rec_strip",throttleMs:15*1e3},exit_intent:{category:"browsing_behavior",widgetHint:"exit_intent",oncePerSession:!0},cart_item_added:{category:"cart_checkout",widgetHint:"upsell_drawer",throttleMs:2500,requestDelayMs:50},cart_abandoned:{category:"cart_checkout",widgetHint:"discount_nudge",oncePerSession:!0},cart_value_threshold:{category:"cart_checkout",widgetHint:"discount_nudge",throttleMs:30*1e3},cart_item_removed:{category:"cart_checkout",widgetHint:"rec_strip",throttleMs:5e3},checkout_started:{category:"cart_checkout",widgetHint:"upsell_drawer",oncePerSession:!0},price_hesitation:{category:"user_intent",widgetHint:"toast",throttleMs:30*1e3},price_sensitive_chat:{category:"user_intent",widgetHint:"toast",requestOffer:!1,throttleMs:30*1e3},wishlist_save:{category:"user_intent",widgetHint:"toast",throttleMs:30*1e3},coupon_field_focus:{category:"user_intent",widgetHint:"toast",oncePerSession:!0},purchase_history_match:{category:"customer_profile_loyalty",widgetHint:"chat",throttleMs:60*1e3},loyalty_tier_reached:{category:"customer_profile_loyalty",widgetHint:"chat",throttleMs:60*1e3},subscription_renewal_due:{category:"customer_profile_loyalty",widgetHint:"toast",throttleMs:60*1e3},first_time_visitor:{category:"customer_profile_loyalty",widgetHint:"chat",oncePerSession:!0},flash_sale_window:{category:"time_based",widgetHint:"countdown_banner",oncePerSession:!0},post_purchase_window:{category:"time_based",widgetHint:"post_purchase",oncePerSession:!0},inactivity_timeout:{category:"time_based",widgetHint:"chat",oncePerSession:!0},seasonal_calendar:{category:"time_based",widgetHint:"countdown_banner",oncePerSession:!0},low_inventory_alert:{category:"external_system",widgetHint:"inline_alert",throttleMs:60*1e3},price_drop_webhook:{category:"external_system",widgetHint:"inline_alert",throttleMs:60*1e3},crm_segment_update:{category:"external_system",widgetHint:"chat",throttleMs:60*1e3},payment_failure:{category:"external_system",widgetHint:"toast",throttleMs:60*1e3}};class Yt{constructor(t){c(this,"abortController",new AbortController);c(this,"firedAt",new Map);c(this,"timers",new Map);c(this,"activePriceTarget",null);c(this,"options");c(this,"handleStorefrontEvent",t=>{const e=k(t.detail);e.type&&(e.type==="product_view"&&(this.scheduleProductDwell(String(e.productId||"")),this.handleRepeatedProductView(String(e.productId||""))),e.type==="scroll_depth"&&Number(e.depth||0)>=75&&this.fire("scroll_depth_interest",{depth:Number(e.depth||0)}),e.type==="search"&&String(e.query||"").trim().length>=2&&this.fire("search_query",{query:String(e.query||"").trim()}),e.type==="add_to_cart"&&this.syncCartAndFire("cart_item_added",e),e.type==="remove_from_cart"&&this.syncCartAndFire("cart_item_removed",e),e.type==="cart_update"&&this.handleCartState(e),e.type==="checkout_start"&&this.fire("checkout_started",{path:e.path||window.location.pathname}))});c(this,"handleCustomTrigger",t=>{const e=k(t.detail),r=String(e.type||e.trigger||"").trim();r&&this.fire(r,e)});c(this,"handleProfileEvent",t=>{const e=k(t.detail),r=String(e.type||"crm_segment_update");this.fire(r,e)});c(this,"handleSystemEvent",t=>{const e=k(t.detail),r=String(e.type||"external_system_event");this.fire(r,e)});this.options=t}init(){document.addEventListener("aovboost:event",this.handleStorefrontEvent,{signal:this.abortController.signal}),document.addEventListener("aovboost:trigger",this.handleCustomTrigger,{signal:this.abortController.signal}),document.addEventListener("aovboost:profile-event",this.handleProfileEvent,{signal:this.abortController.signal}),document.addEventListener("aovboost:system-event",this.handleSystemEvent,{signal:this.abortController.signal}),this.installProductDwellTracking(),this.installComparisonTracking(),this.installExitIntentTracking(),this.installPriceHoverTracking(),this.installCouponFocusTracking(),this.installWishlistTracking(),this.installInactivityTracking(),this.installFirstTimeVisitorTracking(),this.installInitialCartTracking(),this.installPostPurchaseTracking(),this.installScheduledCampaignTracking()}destroy(){this.abortController.abort(),this.timers.forEach(t=>window.clearTimeout(t)),this.timers.clear()}trigger(t,e={}){this.fire(t,e)}installProductDwellTracking(){this.scheduleProductDwell(M())}scheduleProductDwell(t){this.clearTimer("product_dwell"),!(!t||!Qt())&&this.setTimer("product_dwell",()=>{this.fire("long_product_dwell",{productId:t,dwellSeconds:nt/1e3})},nt)}handleRepeatedProductView(t){if(!t)return;const e=k(this.options.sessionManager.getSnapshot().context.productViewCounts),r=Number(e[t]||0);r>=2&&this.fire("repeated_product_view",{productId:t,viewCount:r})}installComparisonTracking(){const t=`${window.location.pathname} ${document.title}`.toLowerCase();/\b(compare|comparison|versus|vs|alternative|competitor)\b/.test(t)&&window.setTimeout(()=>{this.fire("comparison_page_visit",{path:window.location.pathname})},800)}installExitIntentTracking(){document.addEventListener("mouseleave",t=>{t.clientY<=8&&this.fire("exit_intent",{immediate:!0,path:window.location.pathname})},{signal:this.abortController.signal})}installPriceHoverTracking(){document.addEventListener("mouseover",t=>{const e=ee(t.target);!e||e===this.activePriceTarget||(this.activePriceTarget=e,this.clearTimer("price_hover"),this.setTimer("price_hover",()=>{this.fire("price_hesitation",{productId:M(),priceText:e.textContent?.trim().slice(0,80)||""})},1200))},{signal:this.abortController.signal}),document.addEventListener("mouseout",t=>{const e=this.activePriceTarget;if(!e)return;const r=t.relatedTarget;r&&e.contains(r)||(this.activePriceTarget=null,this.clearTimer("price_hover"))},{signal:this.abortController.signal})}installCouponFocusTracking(){document.addEventListener("focusin",t=>{const e=t.target;!e||!ie(e)||this.fire("coupon_field_focus",{fieldName:e.name||e.id||""})},{signal:this.abortController.signal})}installWishlistTracking(){document.addEventListener("click",t=>{t.target?.closest?.("[data-wishlist], [data-save-product], .wishlist, .wishlist-button, [aria-label*='wishlist'], [aria-label*='Wishlist'], [aria-label*='save'], [aria-label*='Save']")&&this.fire("wishlist_save",{productId:M()})},{signal:this.abortController.signal})}installInactivityTracking(){const t=()=>{this.clearTimer("inactivity"),this.setTimer("inactivity",()=>{this.fire("inactivity_timeout",{idleSeconds:at/1e3})},at)};["click","keydown","scroll","touchstart"].forEach(e=>{window.addEventListener(e,t,{passive:!0,signal:this.abortController.signal})}),t()}installFirstTimeVisitorTracking(){try{const t="aovboost_returning_visitor";if(window.localStorage.getItem(t)==="true")return;window.localStorage.setItem(t,"true"),window.setTimeout(()=>{this.fire("first_time_visitor",{path:window.location.pathname})},1800)}catch{}}installInitialCartTracking(){/\/cart(?:\/|$)/.test(window.location.pathname)&&window.setTimeout(async()=>{const t=await this.readCart();if(t.cartItemCount<=0)return;const e={...t,source:"initial_cart_state"};this.options.eventBus.track("cart_update",e),this.fire("cart_item_added",e),this.handleCartState(e)},900)}installPostPurchaseTracking(){Zt()&&window.setTimeout(()=>{this.fire("post_purchase_window",{path:window.location.pathname})},1200)}installScheduledCampaignTracking(){const t=k(window.AOVBoost?.campaign),e=String(t.type||"");if(!e)return;const r=Date.parse(String(t.startsAt||"")),s=Date.parse(String(t.endsAt||"")),a=Date.now();(!Number.isFinite(r)||r<=a)&&(!Number.isFinite(s)||s>a)&&this.fire(e==="seasonal"?"seasonal_calendar":"flash_sale_window",{campaign:t,endsAt:t.endsAt})}syncCartAndFire(t,e){window.setTimeout(async()=>{const r=await this.readCart(),s={...e,...r};this.fire(t,s),(r.cartProductIds.length>0||r.cartValue>0)&&this.options.eventBus.track("cart_update",s),this.handleCartState(s)},350)}async readCart(){try{const t=await fetch("/cart.js",{headers:{Accept:"application/json"},keepalive:!0});if(!t.ok)throw new Error(`Cart read failed: ${t.status}`);const e=await t.json();K(e.currency);const r=Array.isArray(e.items)?e.items:[],s=r.map(n=>ct(n)).filter(Boolean),a=r.map(n=>dt(n)).filter(Boolean);return{cartToken:e.token||"",cartProductIds:s,cartVariantIds:a,cartItems:r.map(n=>({productId:ct(n),variantId:dt(n),quantity:Number(n.quantity||1),title:String(n.product_title||n.title||""),handle:String(n.handle||n.url||"").split("/products/")[1]?.split(/[?#/]/)[0]||""})),cartItemCount:Number(e.item_count||r.length||0),cartValue:Number(e.total_price||0)/100,currency:String(e.currency||"")}}catch{return{cartToken:"",cartProductIds:[],cartVariantIds:[],cartItems:[],cartItemCount:0,cartValue:0,currency:""}}}handleCartState(t){const e=Number(t.cartValue||0),r=Number(t.cartItemCount||0);e>0&&this.fire("cart_value_threshold",t),this.clearTimer("cart_idle"),r>0&&this.setTimer("cart_idle",()=>{this.fire("cart_abandoned",{...t,idleSeconds:st/1e3})},st)}fire(t,e={}){const r=Jt(t),s=Date.now(),a=r.throttleMs??10*1e3,n=this.firedAt.get(t)||0;if(s-n<a||r.oncePerSession&&Kt(t))return;r.oncePerSession&&Xt(t),this.firedAt.set(t,s);const o={...e,triggerType:t,triggerCategory:r.category,widgetHint:r.widgetHint};this.options.eventBus.track(t,o),r.requestOffer!==!1&&window.setTimeout(()=>{this.options.offerPoller.requestOffer(t,o)},r.requestDelayMs??150)}setTimer(t,e,r){this.clearTimer(t),this.timers.set(t,window.setTimeout(e,r))}clearTimer(t){const e=this.timers.get(t);e&&window.clearTimeout(e),this.timers.delete(t)}}function Jt(i){return Gt[i]||{category:"external_system",widgetHint:"chat",throttleMs:3e4}}function k(i){return i&&typeof i=="object"&&!Array.isArray(i)?i:{}}function Kt(i){try{return sessionStorage.getItem(`aovboost_trigger:${i}`)==="true"}catch{return!1}}function Xt(i){try{sessionStorage.setItem(`aovboost_trigger:${i}`,"true")}catch{}}function Qt(){return/\/products(?:\/|$)/.test(window.location.pathname)||!!M()}function Zt(){return/\/thank_you(?:\/|$)/.test(window.location.pathname)||!!window.Shopify?.checkout}function M(){const i=window.Shopify?.product||window.ShopifyAnalytics?.meta?.product||null;return i?ot(i.gid||i.id):""}function ot(i){const t=String(i||"");return t?t.startsWith("gid://shopify/Product/")?t:`gid://shopify/Product/${t}`:""}function te(i){const t=String(i||"");return t?t.startsWith("gid://shopify/ProductVariant/")?t:`gid://shopify/ProductVariant/${t}`:""}function ct(i){const t=k(i.product);return ot(i.product_id||i.productId||i.product_gid||i.productGid||t.id)}function dt(i){const t=k(i.variant);return te(i.variant_id||i.variantId||i.id||i.variant_gid||i.variantGid||t.id)}function ee(i){const t=i instanceof HTMLElement?i:null;return t?t.closest("[data-price], .price, .product-price, .product__price, [class*='price'], [class*='Price'], [id*='price'], [id*='Price']"):null}function ie(i){const t=[i.name,i.id,i.placeholder,i.getAttribute("aria-label"),i.getAttribute("autocomplete")].filter(Boolean).join(" ").toLowerCase();return/\b(coupon|discount|promo|promotion|voucher|code)\b/.test(t)}class re extends g{getWidgetType(){return"bundle"}render(){const t=this.payload.bundle||{},e=this.payload.copy||{},r=$(this.payload),s=r.length>0&&r.every(l=>l.variants.some(u=>u.availableForSale)),a=r.find(l=>l.handle)?.handle,n=r.reduce((l,u)=>l+Number(u.price||0)*Number(u.quantity||1),0),o=ut(n,t);this.html(`
      <style>
        .bundle { margin: 18px 0; box-shadow: none; }
        .tiles { display: flex; gap: 10px; overflow-x: auto; padding: 4px 0; }
        .tile { flex: 0 0 128px; border: 1px solid var(--aovboost-line); border-radius: 8px; padding: 8px; }
        .totals { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .original { color: var(--aovboost-muted); text-decoration: line-through; }
        .discounted { color: var(--aovboost-accent); font-size: 1.08em; }
        .savings { color: var(--aovboost-accent); font-size: 13px; font-weight: 700; }
      </style>
      <section class="bundle card">
        <div class="stack">
          <div>
            <h3 class="title">${d(e.headline||t.name||"Complete the set")}</h3>
            <p class="body">${d(t.description||e.totalSavings||"Bundle these products for a better cart.")}</p>
          </div>
          <div class="tiles">
            ${r.map((l,u)=>`
                  <article class="tile">
                    ${l.imageUrl?`<img src="${d(l.imageUrl)}" alt="${d(l.title)}" loading="lazy">`:""}
                    <p class="product-name">${d(l.title)}</p>
                    <span class="price" data-variant-price="bundle-${u}">${d(l.price?f(l.price):"")}</span>
                    ${j(l,`bundle-${u}`)}
                  </article>
                `).join("")}
          </div>
          <div class="totals" data-bundle-totals>${lt(o)}</div>
          <div class="actions">
            ${s?`<button type="button" class="primary" data-add>${d(e.ctaText||"Add bundle to cart")}</button>`:a?`<a class="primary" href="/products/${d(a)}">${d(e.ctaText||"View bundle products")}</a>`:""}
          </div>
        </div>
      </section>
    `),this.root.querySelectorAll("[data-variant-picker]").forEach(l=>{l.addEventListener("change",()=>{r.forEach((m,p)=>{const v=`bundle-${p}`,_=T(this.root,m,v),y=this.root.querySelector(`[data-variant-price="${v}"]`);y&&_&&(y.textContent=f(_.price))});const u=r.reduce((m,p,v)=>{const _=T(this.root,p,`bundle-${v}`);return m+Number(_?.price||p.price||0)*Number(p.quantity||1)},0),h=this.root.querySelector("[data-bundle-totals]");h&&(h.innerHTML=lt(ut(u,t)))})}),this.root.querySelector("[data-add]")?.addEventListener("click",async()=>{this.trackClick("add_bundle"),await Dt(r.map((l,u)=>({variantId:T(this.root,l,`bundle-${u}`)?.id,quantity:Number(l.quantity||1)})),this.payload.offerId,o.active?{_aovboost_bundle_id:String(t.id),_aovboost_bundle_version:String(t.discountVersion)}:void 0),document.dispatchEvent(new CustomEvent("add-to-cart",{detail:{source:"bundle_widget"}}))})}}function lt(i){return i.active?`<span class="original">${f(i.original)}</span>
       <strong class="discounted">${f(i.discounted)}</strong>
       <span class="savings">Save ${f(i.savings)}</span>`:`<strong>${f(i.original)}</strong>`}function ut(i,t){const e=V(Math.max(0,i)),r=Number(t.discountValue),s=!!(t.id&&t.discountVersion);let a=0;return s&&t.discountType==="percentage"&&Number.isFinite(r)&&r>=1&&r<=50?a=V(e*(r/100)):s&&t.discountType==="fixed_amount"&&Number.isFinite(r)&&r>0&&r<e&&(a=V(r)),{active:a>0,original:e,discounted:V(Math.max(e-a,0)),savings:a}}function V(i){return Math.round((i+Number.EPSILON)*100)/100}class se extends g{constructor(e){super(e);c(this,"messages",[]);c(this,"expanded",!1);c(this,"sending",!1);c(this,"handleProductCardClick",async e=>{const s=e.target?.closest?.("[data-chat-add]");if(!s)return;e.preventDefault();const a=s.dataset.chatAdd;if(!(!a||s.disabled)){s.disabled=!0,s.textContent="Adding";try{if(!await E(a,1,this.payload.offerId))throw new Error("Cart add failed");s.textContent="Added",document.dispatchEvent(new CustomEvent("add-to-cart",{detail:{source:"chat_widget",variantId:a}}))}catch{s.disabled=!1,s.textContent="Try again"}}});this.root.addEventListener("click",this.handleProductCardClick);const r=e.copy;this.messages.push({role:"assistant",content:String(r?.greeting||e.greeting||"Hi. Can I help you find the perfect product today?")})}getWidgetType(){return"chat"}destroy(){this.root.removeEventListener("click",this.handleProductCardClick),super.destroy()}render(){const e=this.payload.copy||{};this.html(`
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
        .inline-products { display: grid; gap: 8px; margin-top: 8px; }
        .inline-product {
          display: grid;
          grid-template-columns: 48px minmax(0, 1fr);
          align-items: center;
          gap: 8px;
          margin-top: 6px;
          border: 1px solid var(--aovboost-line);
          border-radius: 8px;
          padding: 8px;
          color: inherit;
          text-decoration: none;
          background: #fff;
        }
        .inline-product a { color: var(--aovboost-ink); font-size: 12px; font-weight: 700; text-decoration: underline; text-underline-offset: 2px; }
        .inline-product button {
          width: fit-content;
          border: 0;
          border-radius: 6px;
          background: var(--aovboost-action);
          color: var(--aovboost-action-text);
          cursor: pointer;
          font-size: 12px;
          font-weight: 700;
          min-height: 28px;
          padding: 5px 8px;
        }
        .inline-product button:disabled { cursor: default; opacity: .65; }
        .inline-product img, .image-placeholder {
          width: 48px;
          height: 48px;
          border-radius: 6px;
          object-fit: cover;
          background: #f8fafc;
        }
        .product-copy { display: grid; gap: 3px; min-width: 0; }
        .product-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .price { color: var(--aovboost-muted); font-size: 12px; font-weight: 700; }
      </style>
      <aside class="wrap card" aria-label="AOVBoost Assistant">
        <div class="head">
          <h3 class="title">AOVBoost Assistant</h3>
          <button type="button" class="icon" data-close aria-label="Close">×</button>
        </div>
        ${this.expanded?this.renderChatUi():`<p class="body">${d(e.greeting||this.messages[0].content)}</p>
              <div class="actions">
                <button type="button" class="primary" data-expand>${d(e.ctaAccept||"Chat with AI")}</button>
                <button type="button" class="secondary" data-dismiss>${d(e.ctaDecline||"Browse myself")}</button>
              </div>`}
      </aside>
    `),this.root.querySelector("[data-close]")?.addEventListener("click",()=>this.dismiss()),this.root.querySelector("[data-dismiss]")?.addEventListener("click",()=>this.dismiss()),this.root.querySelector("[data-expand]")?.addEventListener("click",()=>{this.expanded=!0,this.trackClick("open_chat"),this.render()}),this.root.querySelector("[data-send]")?.addEventListener("click",()=>this.sendMessage()),this.root.querySelector("input")?.addEventListener("keydown",r=>{r.key==="Enter"&&(r.preventDefault(),this.sendMessage())}),this.hydrateProductCards(this.root),this.scrollToBottom()}renderChatUi(){return`
      <div class="messages" data-messages>
        ${this.messages.map(e=>this.renderMessage(e)).join("")}
      </div>
      <div class="compose">
        <input type="text" placeholder="Ask me anything" aria-label="Chat message" autocomplete="off" data-input>
        <button type="button" class="primary" data-send>Send</button>
      </div>
    `}renderMessage(e){return`
      <div class="bubble ${e.role}">
        ${this.renderMessageContent(e)}
      </div>
    `}renderMessageContent(e){return`
      ${d(e.content)}
      ${e.productCards?.length?this.renderProductCards(e.productCards):this.renderProductLinks(e.content)}
    `}renderProductCards(e){const r=e.filter(s=>s.handle||s.title).slice(0,4);return r.length===0?"":`
      <div class="inline-products">
        ${r.map(s=>this.renderProductCard(s)).join("")}
      </div>
    `}renderProductCard(e){const r=String(e.handle||""),s=String(e.title||r.replace(/-/g," ")||"Recommended product"),a=r?`/products/${d(r)}`:"";return`
      <article class="inline-product" data-product-card data-handle="${d(r)}">
        ${e.imageUrl?`<img data-product-image src="${d(e.imageUrl)}" alt="${d(s)}" loading="lazy">`:'<span class="image-placeholder" aria-hidden="true"></span>'}
        <span class="product-copy">
          <span class="product-name">${d(s)}</span>
          ${e.price?`<span class="price">${d(e.price)}</span>`:""}
          <span class="product-actions">
            ${a?`<a href="${a}">View product</a>`:""}
            ${e.variantId?`<button type="button" data-chat-add="${d(e.variantId)}">Add to cart</button>`:""}
          </span>
        </span>
      </article>
    `}renderProductLinks(e){const r=e.match(/\/products\/([a-z0-9-]+)/i);if(!r)return"";const s=r[1];return this.renderProductCards([{handle:s,title:s.replace(/-/g," ")}])}appendMessage(e){const r=this.root.querySelector("[data-messages]");if(!r)throw new Error("Messages container not found");const s=document.createElement("div");return s.className=`bubble ${e.role}`,s.innerHTML=this.renderMessageContent(e),r.appendChild(s),this.hydrateProductCards(s),this.scrollToBottom(),s}async hydrateProductCards(e){const r=Array.from(e.querySelectorAll("[data-product-card][data-handle]"));await Promise.all(r.map(async s=>{if(s.dataset.hydrated==="true")return;const a=s.dataset.handle;if(!a)return;if(!!s.querySelector("img[data-product-image]")){s.dataset.hydrated="true";return}try{const o=await fetch(`/products/${a}.js`,{headers:{Accept:"application/json"}});if(!o.ok)throw new Error(`Product read failed: ${o.status}`);const l=await o.json(),u=l.featured_image||l.images?.[0]||l.media?.[0]?.src||"";if(!u)return;const h=document.createElement("img");h.dataset.productImage="true",h.src=u,h.alt=String(l.title||a.replace(/-/g," ")),h.loading="lazy",s.querySelector(".image-placeholder")?.replaceWith(h),s.dataset.hydrated="true"}catch{s.dataset.hydrated="true"}}))}async sendMessage(){if(this.sending)return;const e=this.root.querySelector("[data-input]"),r=this.root.querySelector("[data-send]"),s=e?.value.trim();if(!s)return;this.sending=!0,r&&(r.disabled=!0),e.value="",this.messages.push({role:"user",content:s}),this.appendMessage({role:"user",content:s}),this.trackClick("send_message"),ae(s)&&(this.track("chat_intent",{intent:"price_sensitive"}),document.dispatchEvent(new CustomEvent("aovboost:trigger",{detail:{type:"price_sensitive_chat",message:s}})));const a=this.messages.push({role:"assistant",content:""})-1,n=this.appendMessage({role:"assistant",content:""});this.showTyping();try{let o=await this.requestChat(s);if(o.status===401&&(await this.applyRecoverySession(o)||await window.AOVBoostSDK?.refreshSession?.(),o=await this.requestChat(s)),!o.ok)throw new Error(`Server returned ${o.status}`);if(!o.body)throw new Error("Missing stream body");const l=o.body.getReader(),u=new TextDecoder;let h="",m=!1,p=!1;for(;;){const{done:v,value:_}=await l.read();if(v)break;h+=u.decode(_,{stream:!0});const y=h.split(`
`);h=y.pop()||"";for(const A of y){if(!A.startsWith("data: "))continue;const z=A.slice(6);if(z!=="[DONE]")try{const S=JSON.parse(z);S.delta&&(m||(this.removeTyping(),m=!0),this.messages[a].content+=S.delta,Array.isArray(S.productCards)&&(this.messages[a].productCards=S.productCards),n.innerHTML=this.renderMessageContent(this.messages[a]),this.hydrateProductCards(n),S.cartAction&&!p&&(p=!0,await this.handleCartAction(S.cartAction,a,n)),this.scrollToBottom())}catch{}}}m||(this.removeTyping(),this.messages[a].content||(this.messages[a].content="I can help you compare products and find the right add-ons.",n.innerHTML=this.renderMessageContent(this.messages[a])))}catch{this.removeTyping(),this.messages[a].content=this.messages[a].content||"I had trouble connecting. Please try again in a moment.",n.innerHTML=this.renderMessageContent(this.messages[a])}finally{this.sending=!1,r&&(r.disabled=!1)}}async requestChat(e){const r=window.AOVBoost||{},s=window.AOVBoostSDK,a=ne(r.apiBase).replace(/\/$/,""),n=typeof s?.getSignedAuthPayload=="function"?await s.getSignedAuthPayload():null;if(!n)throw new Error("Missing signed storefront auth");const o=C();return fetch(`${a}/chat`,{method:"POST",headers:{"Content-Type":"application/json","X-AOVBoost-Shop":n.shop||r.shop||""},body:JSON.stringify({...n,message:e,messageHistory:this.messages.slice(0,-2),currency:o.code,currencySource:o.source,moneyFormat:o.moneyFormat,moneyWithCurrencyFormat:o.moneyWithCurrencyFormat,locale:o.locale})})}async handleCartAction(e,r,s){if(!(e.type!=="add_to_cart"||!e.variantId))try{if(!await E(e.variantId,Number(e.quantity||1),this.payload.offerId))throw new Error("Cart add failed");this.messages[r].content=`Added ${e.productTitle||"that product"} to your cart.`,s.innerHTML=this.renderMessageContent(this.messages[r]),this.hydrateProductCards(s),document.dispatchEvent(new CustomEvent("add-to-cart",{detail:{source:"chat_widget",variantId:e.variantId,quantity:Number(e.quantity||1)}}))}catch{this.messages[r].content=`I couldn't add ${e.productTitle||"that product"} to your cart. Please use the product card button or open the product page.`,s.innerHTML=this.renderMessageContent(this.messages[r]),this.hydrateProductCards(s)}}async applyRecoverySession(e){try{const r=await e.clone().json(),s=r?.storefrontSession||r?.session,a=window.AOVBoostSDK?.applySession;return typeof a=="function"?!!a(s):!1}catch{return!1}}showTyping(){const e=this.root.querySelector("[data-messages]");if(!e)return;const r=document.createElement("div");r.className="bubble assistant dots",r.dataset.typing="true",r.innerHTML="<span>.</span><span>.</span><span>.</span>",e.appendChild(r),this.scrollToBottom()}removeTyping(){const e=this.root.querySelector("[data-typing]");e&&e.remove()}scrollToBottom(){const e=this.root.querySelector("[data-messages]");e&&(e.scrollTop=e.scrollHeight)}dismiss(){this.trackDismiss(),this.container.animate([{transform:"translateY(0)"},{transform:"translateY(120%)"}],{duration:180,easing:"ease-in",fill:"forwards"}),window.setTimeout(()=>this.destroy(),190)}}function ae(i){return/\b(expensive|cheaper|cheap|discount|coupon|promo|deal|sale|price|afford|budget|cost)\b/i.test(i)}function ne(i){const t=typeof i=="string"?i.trim():"";return!t||t==="/api"||t.startsWith("/api/")?"/apps/aovboost":t.includes("/apps/aovboost")||t.startsWith("/apps/")?t:"/apps/aovboost"}class oe extends g{constructor(){super(...arguments);c(this,"timer")}getWidgetType(){return"countdown_banner"}render(){const e=this.payload.copy||{},r=e.headline||this.payload.headline||"Limited-time offer",s=e.subheadline||e.offerLine||this.payload.body||"Relevant bundles and add-ons are available for this session.";this.html(`
      <style>
        .banner {
          position: sticky;
          top: 0;
          z-index: 9998;
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto auto;
          align-items: center;
          gap: 12px;
          min-height: 48px;
          border-left: 0;
          border-right: 0;
          border-top: 0;
          border-radius: 0;
          padding: 9px 14px;
        }
        .copy { min-width: 0; }
        .timer { font-size: 13px; font-weight: 800; white-space: nowrap; }
        @media (max-width: 520px) {
          .banner { grid-template-columns: minmax(0, 1fr) auto; }
          .timer { grid-column: 1 / -1; }
        }
      </style>
      <aside class="banner card" role="status">
        <div class="copy">
          <h3 class="title">${d(r)}</h3>
          <p class="body">${d(s)}</p>
        </div>
        <strong class="timer" data-countdown></strong>
        <button type="button" class="icon" data-dismiss aria-label="Close">x</button>
      </aside>
    `),this.root.querySelector("[data-dismiss]")?.addEventListener("click",()=>{this.trackDismiss(),this.destroy()}),this.tick(),this.timer=window.setInterval(()=>this.tick(),1e3)}destroy(){this.timer&&window.clearInterval(this.timer),super.destroy()}tick(){const e=this.root.querySelector("[data-countdown]");if(!e)return;const r=Date.parse(String(this.payload.endsAt||""));if(!Number.isFinite(r)){e.textContent="Today";return}const s=Math.max(r-Date.now(),0);if(s<=0){this.destroy();return}const a=Math.floor(s/36e5),n=Math.floor(s%36e5/6e4),o=Math.floor(s%6e4/1e3);e.textContent=a>0?`${a}h ${n}m`:`${n}m ${o.toString().padStart(2,"0")}s`}}class ce extends g{getWidgetType(){return"discount_nudge"}render(){this.draw(),document.addEventListener("add-to-cart",()=>this.draw())}draw(){const t=this.payload.copy||{},e=Number(this.payload.threshold||50),r=Number(this.payload.cartValue||0),s=Math.max(e-r,0),a=e>0?Math.min(r/e,1):0;this.html(`
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
        .track span { display: block; height: 100%; width: ${a*100}%; background: var(--aovboost-accent); transition: width 200ms ease; }
      </style>
      <div class="bar">
        <div class="label">
          <span>${s>0?d(t.progressLabel||`You're ${f(s)} away from your cart goal`):d(t.rewardDescription||"Cart goal reached")}</span>
          <button type="button" class="icon" data-dismiss aria-label="Close">x</button>
        </div>
        <div class="track" aria-hidden="true"><span></span></div>
      </div>
    `),this.root.querySelector("[data-dismiss]")?.addEventListener("click",()=>{this.trackDismiss(),this.destroy()}),s<=0&&window.setTimeout(()=>this.destroy(),3e3)}}class de extends g{constructor(){super(...arguments);c(this,"shown",!1);c(this,"handleMouseLeave",e=>{e.clientY<10&&this.show()});c(this,"handleVisibility",()=>{document.visibilityState==="hidden"&&this.show()})}getWidgetType(){return"exit_intent"}mount(e=document.body){if(e.appendChild(this.container),!this.shouldSkip()){if(this.payload.immediate){this.show();return}document.addEventListener("mouseleave",this.handleMouseLeave),document.addEventListener("visibilitychange",this.handleVisibility)}}render(){const e=this.payload.copy||{};this.html(`
      <style>
        .backdrop { position: fixed; inset: 0; z-index: 9998; background: rgba(17, 24, 39, .38); }
        .modal { position: fixed; inset: 50% auto auto 50%; z-index: 9999; width: min(420px, calc(100vw - 32px)); transform: translate(-50%, -50%); border-radius: 8px; padding: 18px; }
      </style>
      <div class="backdrop" data-dismiss></div>
      <section class="modal">
        <h3 class="title">${d(e.headline||"Wait before you go")}</h3>
        <p class="body">${d(e.offerLine||this.payload.offerLine||"Your cart has a relevant offer available.")}</p>
        ${this.payload.discountCode?`<p class="body"><strong>${d(this.payload.discountCode)}</strong></p>`:""}
        <div class="actions">
          <button type="button" class="primary" data-claim>${d(e.ctaText||"Claim offer")}</button>
          <button type="button" class="secondary" data-dismiss>${d(e.dismissText||"No thanks")}</button>
        </div>
      </section>
    `),this.root.querySelector("[data-claim]")?.addEventListener("click",()=>{this.trackClick("claim_exit_offer"),this.destroy()}),this.root.querySelectorAll("[data-dismiss]").forEach(r=>{r.addEventListener("click",()=>{this.trackDismiss(),this.destroy()})})}destroy(){document.removeEventListener("mouseleave",this.handleMouseLeave),document.removeEventListener("visibilitychange",this.handleVisibility),super.destroy()}show(){if(!(this.shown||this.hasFired())){this.shown=!0;try{sessionStorage.setItem("aovboost_exit_intent_fired","true")}catch{}this.render(),this.trackImpression()}}hasFired(){try{return sessionStorage.getItem("aovboost_exit_intent_fired")==="true"}catch{return!1}}shouldSkip(){return/\/(?:checkout|thank_you)(?:\/|$)/.test(window.location.pathname)}}class le extends g{getWidgetType(){return"inline_alert"}render(){const t=this.payload.copy||{},e=t.headline||this.payload.headline||"Store update",r=t.subheadline||t.offerLine||this.payload.body||"A relevant product update is available.";this.html(`
      <style>
        .alert {
          margin: 10px 0;
          box-shadow: none;
          border-color: rgba(15, 118, 110, .32);
          background: #f0fdfa;
        }
        .head { display: flex; justify-content: space-between; gap: 10px; align-items: start; }
      </style>
      <aside class="alert card" role="status">
        <div class="head">
          <div>
            <h3 class="title">${d(e)}</h3>
            <p class="body">${d(r)}</p>
          </div>
          <button type="button" class="icon" data-dismiss aria-label="Close">x</button>
        </div>
      </aside>
    `),this.root.querySelector("[data-dismiss]")?.addEventListener("click",()=>{this.trackDismiss(),this.destroy()})}}class ue extends g{getWidgetType(){return"post_purchase"}mount(t=document.body){this.isThankYouPage()&&super.mount(t)}render(){const t=this.payload.copy||{},e=$(this.payload)[0]||this.payload.product||{};this.html(`
      <style>
        .post { margin: 18px 0; box-shadow: none; }
      </style>
      <section class="post card">
        <h3 class="title">${d(t.headline||"Complete your purchase")}</h3>
        <article class="product-card">
          ${e.imageUrl?`<img src="${d(e.imageUrl)}" alt="${d(e.title)}" loading="lazy">`:"<span></span>"}
          <div class="stack">
            <div>
              <p class="product-name">${d(t.productName||e.title||"Recommended product")}</p>
              <span class="price">${d(e.price?f(e.price):"")}</span>
            </div>
            <p class="reason">${d(t.oneLineReason||"A useful add-on for what you just bought.")}</p>
            <button type="button" class="primary" data-add>${d(t.ctaText||"Add to my order")}</button>
          </div>
        </article>
      </section>
    `),this.root.querySelector("[data-add]")?.addEventListener("click",async()=>{this.trackClick("add_post_purchase");const r=e.variantId;if(r){await E(r,1,this.payload.offerId);return}const s=e.handle;s&&(window.location.href=`/products/${s}`)})}isThankYouPage(){return/\/thank_you(?:\/|$)/.test(window.location.pathname)||!!window.Shopify?.checkout}}class he extends g{getWidgetType(){return"rec_strip"}render(){const t=$(this.payload);this.html(`
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
          ${t.map((e,r)=>`
                <article class="tile">
                  ${e.reason?`<span class="badge">${d(e.reason)}</span>`:""}
                  ${e.imageUrl?`<img data-src="${d(e.imageUrl)}" alt="${d(e.title)}">`:""}
                  <p class="product-name">${d(e.title)}</p>
                  <span class="price" data-variant-price="rec-${r}">${d(e.price?f(e.price):"")}</span>
                  ${j(e,`rec-${r}`)}
                  ${e.variants.some(s=>s.availableForSale)?`<button type="button" class="primary" data-add data-product-index="${r}">Add to cart</button>`:e.handle?`<a class="primary" href="/products/${d(e.handle)}">View product</a>`:""}
                </article>
              `).join("")}
        </div>
      </section>
    `),this.lazyLoadImages(),this.root.querySelectorAll("[data-variant-picker]").forEach(e=>{e.addEventListener("change",()=>{t.forEach((r,s)=>{const a=`rec-${s}`,n=T(this.root,r,a),o=this.root.querySelector(`[data-variant-price="${a}"]`);o&&n&&(o.textContent=f(n.price))})})}),this.root.querySelectorAll("[data-add]").forEach(e=>{e.addEventListener("click",async()=>{const r=Number(e.dataset.productIndex),s=t[r],a=s?T(this.root,s,`rec-${r}`):null;a&&(this.trackClick("add_recommendation"),await E(a.id,1,this.payload.offerId))})})}lazyLoadImages(){const t=Array.from(this.root.querySelectorAll("img[data-src]"));if(!("IntersectionObserver"in window)){t.forEach(r=>{r.src=r.dataset.src||""});return}const e=new IntersectionObserver(r=>{r.forEach(s=>{if(!s.isIntersecting)return;const a=s.target;a.src=a.dataset.src||"",e.unobserve(a)})});t.forEach(r=>e.observe(r))}}class pe extends g{constructor(){super(...arguments);c(this,"interval")}getWidgetType(){return"social_proof"}render(){const r=$(this.payload).filter(a=>Number(a.orderCount||0)>0).map(a=>`${Number(a.orderCount)} people bought this with ${a.title}`);r.length===0&&r.push("Frequently bought together"),this.html(`
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
      <div class="pill" role="status"><span class="dot"></span><span data-message>${d(r[0])}</span></div>
    `);let s=0;this.interval=window.setInterval(()=>{s=(s+1)%r.length;const a=this.root.querySelector("[data-message]");a&&(a.textContent=r[s])},5e3)}destroy(){this.interval&&window.clearInterval(this.interval),super.destroy()}}class fe extends g{getWidgetType(){return"toast"}render(){const t=this.payload.copy||{},e=t.headline||this.payload.headline||"A better option is available",r=t.subheadline||t.offerLine||this.payload.body||"I can help find a better match or a useful offer.",s=t.ctaText||this.payload.ctaText||"Open assistant";this.html(`
      <style>
        .toast {
          position: fixed;
          right: 18px;
          bottom: 18px;
          z-index: 9999;
          width: min(340px, calc(100vw - 36px));
          transform: translateY(16px);
          opacity: 0;
          animation: toast-in 180ms ease-out forwards;
        }
        @keyframes toast-in { to { transform: translateY(0); opacity: 1; } }
        .head { display: flex; justify-content: space-between; gap: 10px; align-items: start; }
      </style>
      <aside class="toast card" role="status" aria-live="polite">
        <div class="head">
          <div>
            <h3 class="title">${d(e)}</h3>
            <p class="body">${d(r)}</p>
          </div>
          <button type="button" class="icon" data-dismiss aria-label="Close">x</button>
        </div>
        <div class="actions">
          <button type="button" class="primary" data-chat>${d(s)}</button>
        </div>
      </aside>
    `),this.root.querySelector("[data-dismiss]")?.addEventListener("click",()=>{this.trackDismiss(),this.destroy()}),this.root.querySelector("[data-chat]")?.addEventListener("click",()=>{this.trackClick("open_assistant"),document.dispatchEvent(new CustomEvent("aovboost:trigger",{detail:{type:"long_product_dwell",source:"toast"}})),this.destroy()}),window.setTimeout(()=>this.destroy(),9e3)}}class ge extends g{constructor(){super(...arguments);c(this,"timer");c(this,"deadline",Date.now()+8e3)}getWidgetType(){return"upsell_drawer"}render(){const e=$(this.payload).slice(0,3),r=this.payload.copy||{};this.html(`
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
            <h3 class="title">${d(r.headline||"Great choice. Complete the set")}</h3>
            <p class="body">People who bought this also love:</p>
          </div>
          <button type="button" class="icon" data-dismiss aria-label="Close">x</button>
        </div>
        <div class="timer"><span data-timer></span></div>
        <div class="product-grid">
          ${e.map((s,a)=>`
                <article class="product-card">
                  ${s.imageUrl?`<img src="${d(s.imageUrl)}" alt="${d(s.title)}" loading="lazy">`:"<span></span>"}
                  <div class="stack">
                    <div>
                      <p class="product-name">${d(s.title)}</p>
                      <span class="price" data-variant-price="upsell-${a}">${d(s.price?f(s.price):"")}</span>
                    </div>
                    <p class="reason">${d(s.reason||r.whyThisGoes||"It pairs well with your cart.")}</p>
                    ${j(s,`upsell-${a}`)}
                    ${s.variants.some(n=>n.availableForSale)?`<button type="button" class="primary" data-add data-product-index="${a}">Add to cart</button>`:s.handle?`<a class="primary" href="/products/${d(s.handle)}">View product</a>`:""}
                  </div>
                </article>
              `).join("")}
        </div>
        <div class="actions">
          <a class="secondary" href="/cart">Continue to cart</a>
        </div>
      </aside>
    `),this.root.querySelectorAll("[data-dismiss]").forEach(s=>{s.addEventListener("click",()=>this.dismiss())}),this.root.querySelectorAll("[data-variant-picker]").forEach(s=>{s.addEventListener("change",()=>{e.forEach((a,n)=>{const o=`upsell-${n}`,l=T(this.root,a,o),u=this.root.querySelector(`[data-variant-price="${o}"]`);u&&l&&(u.textContent=f(l.price))})})}),this.root.querySelectorAll("[data-add]").forEach(s=>{s.addEventListener("click",async()=>{const a=Number(s.dataset.productIndex),n=e[a],o=n?T(this.root,n,`upsell-${a}`):null;o&&(this.trackClick("add_upsell"),await E(o.id,1,this.payload.offerId))})}),this.startCountdown()}destroy(){this.timer&&window.clearInterval(this.timer),super.destroy()}startCountdown(){this.timer&&window.clearInterval(this.timer),this.deadline=Date.now()+8e3,this.timer=window.setInterval(()=>{const e=Math.max(this.deadline-Date.now(),0),r=this.root.querySelector("[data-timer]");r&&(r.style.transform=`scaleX(${e/8e3})`),e<=0&&this.dismiss()},120)}dismiss(){this.trackDismiss(),this.container.animate([{transform:"translateX(0)"},{transform:"translateX(100%)"}],{duration:180,easing:"ease-in",fill:"forwards"}),window.setTimeout(()=>this.destroy(),190)}}const ht="aovboost_dismissed_widgets",me=1800*1e3,ye=new Set(["bundle","rec_strip","inline_alert","social_proof"]);class we{constructor(t={}){c(this,"settings");c(this,"activeWidget",null);c(this,"activeKey","");c(this,"activeWidgetType","");c(this,"inlineWidgets",new Map);this.settings=t}mountDecision(t){if(!t.widgetType||!be(t.widgetType,this.settings)||this.getDismissedWidgets().includes(t.widgetType))return;const e=t.payload||{},r=String(e.offerId||""),s=`${t.widgetType}:${ve(t.widgetType,e,r)}`;if(ye.has(t.widgetType)){const o=this.inlineWidgets.get(t.widgetType);if(o?.key===s)return;const l=pt(t.widgetType,e);if(!l)return;o?.widget.destroy();const u=this.resolveTarget(t.widgetType);l.mount(u),this.inlineWidgets.set(t.widgetType,{key:s,widget:l});return}if(t.widgetType==="chat"&&this.activeWidgetType==="chat"||s===this.activeKey)return;this.destroyFloatingWidget();const a=pt(t.widgetType,e);if(!a)return;const n=this.resolveTarget(t.widgetType);a.mount(n),this.activeWidget=a,this.activeKey=s,this.activeWidgetType=t.widgetType}destroyActive(){this.destroyFloatingWidget(),this.inlineWidgets.forEach(t=>t.widget.destroy()),this.inlineWidgets.clear()}destroyFloatingWidget(){this.activeWidget?.destroy(),this.activeWidget=null,this.activeKey="",this.activeWidgetType=""}getDismissedWidgets(){try{const t=JSON.parse(localStorage.getItem(ht)||"[]");if(!Array.isArray(t))return[];const e=Date.now(),r=t.filter(s=>s&&typeof s=="object").filter(s=>e-Number(s.dismissedAt||0)<me);return r.length!==t.length&&localStorage.setItem(ht,JSON.stringify(r)),r.map(s=>String(s.widgetType||"")).filter(Boolean)}catch{return[]}}resolveTarget(t){return t==="bundle"?q(".product-form, [data-product-form]"):t==="rec_strip"?q(".product__description, [data-product-description]"):t==="social_proof"?q(".product-form__submit, [data-add-to-cart]"):t==="inline_alert"?q("[data-price], .product__price, .price, .product-form, [data-product-form]"):document.body}}function be(i,t){return i==="chat"?t.chatEnabled!==!1:i==="bundle"?t.bundlesEnabled!==!1:i==="upsell_drawer"||i==="rec_strip"?t.upsellEnabled!==!1:i==="discount_nudge"||i==="countdown_banner"?t.discountNudgeEnabled!==!1:i==="exit_intent"?t.exitIntentEnabled!==!1:i==="post_purchase"?t.postPurchaseEnabled!==!1:!0}function ve(i,t,e){if(i==="bundle"){const r=t.bundle;return String(r?.id||t.currentProductId||e||"product-bundle")}return e||i}function pt(i,t){switch(i){case"chat":return new se(t);case"toast":return new fe(t);case"countdown_banner":return new oe(t);case"inline_alert":return new le(t);case"bundle":return new re(t);case"upsell_drawer":return new ge(t);case"discount_nudge":return new ce(t);case"rec_strip":return new he(t);case"social_proof":return new pe(t);case"exit_intent":return new de(t);case"post_purchase":return new ue(t);default:return null}}function q(i){const t=document.querySelector(i),e=document.createElement("div");return e.setAttribute("data-aovboost-mount",i),t?.parentElement?(t.insertAdjacentElement("afterend",e),e):(document.body.appendChild(e),e)}let ft=!1;function U(){ft||(ft=!0,_e().catch(i=>{console.log("AOVBoost SDK skipped:",i instanceof Error?i.message:String(i))}))}async function _e(){try{const i=window.AOVBoost||{},t=i.shop;if(!t)return;gt(i)||await ke(i);const e=Se(i.apiBase),r=new Ut(t,e);await r.init();const s=new we(r.getSettings()),a=new b({shop:t,sessionManager:r,apiBase:e}),n=new Ot({shop:t,apiBase:e,eventBus:a,sessionManager:r,widgetManager:s}),o=new Yt({eventBus:a,offerPoller:n,sessionManager:r}),l=new At({apiBase:e,sessionManager:r});window.AOVBoostSDK={shop:t,sessionId:r.anonymousId,sessionToken:r.getAuthPayload().sessionToken,refreshSession:async()=>{await r.refreshAuth(),r.syncGlobalSdkAuth()},getSignedAuthPayload:()=>r.getSignedAuthPayload(),applySession:u=>r.applyStorefrontSession(u),track:(u,h={})=>a.track(u,h),trigger:(u,h={})=>o.trigger(u,h),requestOffer:(u="global",h={})=>n.requestOffer(u,h),destroy:()=>{l.destroy(),o.destroy(),n.destroy(),r.destroy(),s.destroyActive()}},o.init(),a.init(),n.init(),r.getSettings().liveEventsEnabled===!0&&l.init()}catch(i){console.log("AOVBoost SDK skipped:",i instanceof Error?i.message:String(i))}}function Se(i){const t=typeof i=="string"?i.trim():"";return!t||t==="/api"||t.startsWith("/api/")?"/apps/aovboost":t.includes("/apps/aovboost")||t.startsWith("/apps/")?t:"/apps/aovboost"}function gt(i){if(i.settings?.trackingConsentRequired!==!0)return!0;const t=window.Shopify?.customerPrivacy;return typeof t?.analyticsProcessingAllowed=="function"?!!t.analyticsProcessingAllowed():typeof t?.userCanBeTracked=="function"?!!t.userCanBeTracked():!0}function ke(i){return new Promise(t=>{const e=()=>{gt({...i,settings:{...i.settings,trackingConsentRequired:!1}})&&(r(),t())},r=()=>{["visitorConsentCollected","shopify:customer_privacy:consent_collected","aovboost:consent-granted"].forEach(s=>window.removeEventListener(s,e))};["visitorConsentCollected","shopify:customer_privacy:consent_collected","aovboost:consent-granted"].forEach(s=>window.addEventListener(s,e))})}return document.readyState==="loading"?document.addEventListener("DOMContentLoaded",U,{once:!0}):U(),w.init=U,Object.defineProperty(w,Symbol.toStringTag,{value:"Module"}),w})({});
