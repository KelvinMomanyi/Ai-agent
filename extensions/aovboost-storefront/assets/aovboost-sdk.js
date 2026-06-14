var AOVBoostSDKBundle=function(f){"use strict";var de=Object.defineProperty;var le=(f,g,b)=>g in f?de(f,g,{enumerable:!0,configurable:!0,writable:!0,value:b}):f[g]=b;var c=(f,g,b)=>le(f,typeof g!="symbol"?g+"":g,b);class g{constructor(t){c(this,"queue",[]);c(this,"flushTimer");c(this,"scrollDepths",new Set);c(this,"originalFetch",null);c(this,"authFlushInFlight",!1);this.options=t}init(){this.installNavigationTracking(),this.installCartFetchTracking(),this.installCartDomTracking(),this.installScrollTracking(),this.installHoverTracking(),this.installSearchTracking(),document.addEventListener("add-to-cart",t=>{this.track("add_to_cart",b(t.detail))}),document.addEventListener("aovboost:track",t=>{const e=b(t.detail);this.track(String(e.type||"widget_event"),e)}),window.addEventListener("pagehide",()=>this.flush()),this.trackPageView()}track(t,e={}){const i={type:t,ts:Date.now(),sessionId:this.options.sessionManager.anonymousId,shop:this.options.shop,url:window.location.href,referrer:document.referrer,...e};this.options.sessionManager.recordEvent(i),this.queue.push(i),document.dispatchEvent(new CustomEvent("aovboost:event",{detail:i})),this.scheduleFlush()}flush(){if(this.flushTimer&&(window.clearTimeout(this.flushTimer),this.flushTimer=void 0),this.queue.length===0)return;if(!this.options.sessionManager.getAuthPayload().sessionToken){this.flushAfterAuth();return}const t=this.queue.splice(0);this.postEvents(t)}async flushAfterAuth(){if(!this.authFlushInFlight){this.authFlushInFlight=!0;try{await this.options.sessionManager.ensureAuthenticated()&&this.flush()}finally{this.authFlushInFlight=!1}}}scheduleFlush(){this.flushTimer||(this.flushTimer=window.setTimeout(()=>this.flush(),2e3))}endpoint(t){return`${(this.options.apiBase||"/apps/aovboost").replace(/\/$/,"")}${t}`}async postEvents(t,e=!1){const i=await this.options.sessionManager.getSignedAuthPayload();if(!i){this.queue.unshift(...t);return}try{const s=await fetch(this.endpoint("/events"),{method:"POST",headers:{"Content-Type":"application/json","X-AOVBoost-Shop":this.options.shop},body:JSON.stringify({...i,events:t}),keepalive:!0});if(s.status===401&&!e){if(await this.options.sessionManager.applySessionFromResponse(s)||await this.options.sessionManager.refreshAuth(),!this.options.sessionManager.getAuthPayload().sessionToken){this.queue.unshift(...t);return}await this.postEvents(t,!0);return}!s.ok&&s.status!==401&&this.queue.unshift(...t)}catch{this.queue.unshift(...t)}}installNavigationTracking(){const t=history.pushState,e=history.replaceState;history.pushState=(...i)=>{const s=t.apply(history,i);return window.setTimeout(()=>this.trackPageView(),0),s},history.replaceState=(...i)=>{const s=e.apply(history,i);return window.setTimeout(()=>this.trackPageView(),0),s},window.addEventListener("popstate",()=>this.trackPageView())}trackPageView(){this.track("page_view",{pageType:dt()}),lt()&&this.track("checkout_start",{path:window.location.pathname});const t=nt();t&&this.track("product_view",{productId:mt(t.gid||t.id),handle:t.handle,title:t.title});const e=ct();(e||window.location.pathname.includes("/collections/"))&&this.track("collection_view",{collectionId:String(e?.id||""),handle:e?.handle||ut("/collections/"),title:e?.title})}installCartFetchTracking(){this.originalFetch||(this.originalFetch=window.fetch.bind(window),window.fetch=async(...t)=>{const e=ht(t[0]),i=t[1],s=await this.originalFetch(...t);try{M(e)?this.track("add_to_cart",{...V(i?.body),requestUrl:e}):pt(e)?this.track("remove_from_cart",{...V(i?.body),requestUrl:e}):ft(e)&&this.track("search",{query:gt(e),requestUrl:e})}catch{}return s})}installCartDomTracking(){document.addEventListener("submit",t=>{const e=t.target;if(!(!e||!M(e.action||"")))try{this.track("add_to_cart",{...V(new FormData(e)),source:"cart_form_submit",requestUrl:e.action})}catch{this.track("add_to_cart",{source:"cart_form_submit",requestUrl:e.action})}},!0),document.addEventListener("click",t=>{const i=t.target?.closest?.("button[name='add'], [type='submit'][name='add'], [data-add-to-cart]");if(!i)return;const s=i.closest("form");s&&!M(s.action||"")||this.track("add_to_cart",{source:"add_button_click",requestUrl:s?.action||""})},!0)}installScrollTracking(){let t=!1;window.addEventListener("scroll",()=>{t||(t=!0,window.setTimeout(()=>{t=!1;const e=document.documentElement.scrollHeight-window.innerHeight;if(e<=0)return;const i=Math.round(window.scrollY/e*100);[25,50,75,90].forEach(s=>{i>=s&&!this.scrollDepths.has(s)&&(this.scrollDepths.add(s),this.track("scroll_depth",{depth:s}))})},200))},{passive:!0})}installHoverTracking(){document.addEventListener("mouseenter",t=>{const i=t.target?.closest?.(".product-card");if(!i)return;const s=window.setTimeout(()=>{this.track("product_hover",{productId:i.dataset.productId||i.dataset.productGid||"",handle:i.dataset.productHandle||""})},800);i.addEventListener("mouseleave",()=>window.clearTimeout(s),{once:!0})},!0)}installSearchTracking(){document.addEventListener("input",t=>{const e=t.target;if(!e||!`${e.name||""} ${e.id||""} ${e.type||""}`.toLowerCase().includes("search"))return;const s=e.value.trim();s.length<2||this.track("search",{query:s,source:"predictive_input"})},!0)}}function b(r){return r&&typeof r=="object"&&!Array.isArray(r)?r:{}}function nt(){const r=window;return r.Shopify?.product||r.ShopifyAnalytics?.meta?.product||null}function ct(){const r=window;return r.Shopify?.collection||r.ShopifyAnalytics?.meta?.collection||null}function dt(){return window.ShopifyAnalytics?.meta?.page?.pageType||document.body?.dataset?.template||(window.location.pathname==="/"?"home":"other")}function lt(){return/\/checkout(?:\/|$)/.test(window.location.pathname)}function ut(r){const t=window.location.pathname.indexOf(r);return t===-1?"":window.location.pathname.slice(t+r.length).split("/")[0]||""}function ht(r){return typeof r=="string"?r:r instanceof URL?r.toString():r.url||""}function M(r){return/\/cart\/add(?:\.js)?/.test(r)}function pt(r){return/\/cart\/(?:change|update)(?:\.js)?/.test(r)}function ft(r){return r.includes("/search/suggest.json")}function gt(r){try{return new URL(r,window.location.origin).searchParams.get("q")||""}catch{return""}}function V(r){if(!r)return{};if(typeof FormData<"u"&&r instanceof FormData)return{variantId:String(r.get("id")||r.get("items[0][id]")||""),quantity:Number(r.get("quantity")||1)};if(typeof URLSearchParams<"u"&&r instanceof URLSearchParams)return{variantId:String(r.get("id")||r.get("items[0][id]")||""),quantity:Number(r.get("quantity")||1)};try{const t=String(r);if(t.trim().startsWith("{")){const i=JSON.parse(t);return{productId:i.productId||i.product_id,variantId:i.id||i.items?.[0]?.id,quantity:i.quantity||i.items?.[0]?.quantity||1}}const e=new URLSearchParams(t);return{variantId:String(e.get("id")||e.get("items[0][id]")||""),quantity:Number(e.get("quantity")||1)}}catch{return{}}}function mt(r){const t=String(r||"");return t?t.startsWith("gid://shopify/Product/")?t:`gid://shopify/Product/${t}`:""}const W="aovboost_dismissed_widgets",yt="USD";class p{constructor(t){c(this,"root");c(this,"container");this.payload=t,this.container=document.createElement("div"),this.container.setAttribute("data-aovboost-widget",this.getWidgetType()),this.root=this.container.attachShadow({mode:"open"}),this.injectStyles()}destroy(){this.container.remove()}mount(t=document.body){t.appendChild(this.container),this.render(),this.trackImpression()}injectStyles(){const t=document.createElement("style");t.textContent=xt,this.root.appendChild(t)}trackImpression(){this.track("widget_impression",{})}trackClick(t){this.track("widget_click",{action:t})}trackDismiss(){this.track("widget_dismiss",{});try{const t=JSON.parse(localStorage.getItem(W)||"[]"),i=[...(Array.isArray(t)?t.filter(s=>typeof s=="object"&&s):[]).filter(s=>s.widgetType!==this.getWidgetType()),{widgetType:this.getWidgetType(),dismissedAt:Date.now()}];localStorage.setItem(W,JSON.stringify(i))}catch{}}track(t,e){const i=window.AOVBoostSDK?.track,s={type:t,widgetType:this.getWidgetType(),offerId:this.payload.offerId,...e};if(typeof i=="function"){i(t,s);return}document.dispatchEvent(new CustomEvent("aovboost:track",{detail:s}))}html(t){const e=this.root.querySelector("[data-aovboost-content]");e&&e.remove();const i=document.createElement("div");i.setAttribute("data-aovboost-content","true"),i.innerHTML=t,this.root.appendChild(i)}}function o(r,t=""){return kt(typeof r=="string"&&r.trim()?r:t)}function I(){const r=window.AOVBoost||{},t=window.Shopify||{},e=window.ShopifyAnalytics||{},s=[{value:r.currency,source:"aovboost_config"},{value:r.currencyCode,source:"aovboost_config"},{value:t.currency?.active,source:"shopify_currency"},{value:t.checkout?.currency,source:"shopify_checkout"},{value:e.meta?.currency,source:"shopify_analytics"}].find(n=>T(n.value,"")!=="");return{code:T(s?.value),source:s?.source||"fallback",moneyFormat:D(r.moneyFormat),moneyWithCurrencyFormat:D(r.moneyWithCurrencyFormat),locale:D(r.locale)||document.documentElement.lang||navigator.language}}function H(r){const t=T(r,"");if(!t)return;const e=window.AOVBoost||{};window.AOVBoost={...e,currency:t}}function v(r,t=I()){const e=Number(r||0);if(!Number.isFinite(e))return"";const i=wt(t),s=i.moneyFormat||i.moneyWithCurrencyFormat||"";if(s)return bt(e,s,i.code);try{return new Intl.NumberFormat(i.locale||void 0,{style:"currency",currency:i.code,currencyDisplay:"symbol"}).format(e)}catch{return`${i.code} ${e.toFixed(2)}`.trim()}}function wt(r){if(typeof r=="string")return{...I(),code:T(r)};const t=I();return{...t,...r,code:r.code===void 0?t.code:T(r.code)}}function T(r,t=yt){const e=String(r||"").trim().toUpperCase();return/^[A-Z]{3}$/.test(e)?e:t}function D(r){return typeof r=="string"&&r.trim()?r.trim():""}function bt(r,t,e){const i=_t(t),s=i.match(/\{\{\s*(amount[a-z_]*)\s*\}\}/i),a=s?.[1]||"amount",n=vt(r,a);return(s?i.replace(s[0],n):`${i}${n}`).replace(/\{\{\s*currency\s*\}\}/gi,e)}function vt(r,t){switch(t){case"amount_no_decimals":return _(r,0,",",".");case"amount_with_comma_separator":return _(r,2,".",",");case"amount_no_decimals_with_comma_separator":return _(r,0,".",",");case"amount_with_apostrophe_separator":return _(r,2,"'",".");case"amount_no_decimals_with_space_separator":return _(r,0," ",".");case"amount_with_space_separator":return _(r,2," ",".");default:return _(r,2,",",".")}}function _(r,t,e,i){const s=t>0?r.toFixed(t):String(Math.round(r)),[a,n]=s.split("."),d=a.replace(/\B(?=(\d{3})+(?!\d))/g,e);return n?`${d}${i}${n}`:d}function _t(r){return r.replace(/<[^>]*>/g,"").replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/&quot;/gi,'"').replace(/&#39;/g,"'")}function C(r){const e=[r.products,r.bundle?.items,r.items].find(i=>Array.isArray(i));return Array.isArray(e)?e.map(i=>{const s=i.product||i.target||i;return{id:s.id||i.productId||i.targetId,variantId:s.variantId||i.variantId||"",title:s.title||i.title||"Recommended product",handle:s.handle||i.handle||"",imageUrl:s.imageUrl||s.image||i.imageUrl||i.image,price:s.price||i.price||"",quantity:i.quantity||1,reason:i.reason||i.affinity?.reason||i.reasoning||"",orderCount:i.orderCount||i.affinity?.orderCount||0}}):[]}async function A(r,t=1){if(!r)return null;const e=String(r).split("/").pop(),i=await fetch("/cart/add.js",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:e,quantity:t})});return i.ok?i.json():null}async function St(r){const t=r.filter(i=>i.variantId).map(i=>({id:String(i.variantId).split("/").pop(),quantity:i.quantity||1}));if(t.length===0)return null;const e=await fetch("/cart/add.js",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({items:t})});return e.ok?e.json():null}function kt(r){return String(r||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;")}const xt=`
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
`;class It{constructor(t){c(this,"timer");c(this,"inFlight",!1);c(this,"stopped",!1);c(this,"options");this.options=t}init(){window.setTimeout(()=>this.requestOffer("initial"),1200),this.options.pollMs&&(this.timer=window.setInterval(()=>this.requestOffer("poll"),this.options.pollMs)),document.addEventListener("aovboost:request-offer",()=>{this.requestOffer("manual")}),window.addEventListener("popstate",()=>{window.setTimeout(()=>this.requestOffer("navigation"),300)})}destroy(){this.stopped=!0,this.timer&&window.clearInterval(this.timer)}async requestOffer(t="manual",e={}){if(this.inFlight||this.stopped)return null;this.inFlight=!0;try{const i=this.options.sessionManager.getSnapshot(),s=await Pt(),a=s.cartItemCount>0||s.cartValue>0,n=Array.isArray(e.cartProductIds)?e.cartProductIds.map(String):a?s.cartProductIds:i.cartProductIds,d=Array.isArray(e.cartVariantIds)?e.cartVariantIds.map(String):a?s.cartVariantIds:Array.isArray(i.context.cartVariantIds)?i.context.cartVariantIds.map(String):[],u=Array.isArray(e.cartItems)?e.cartItems:a?s.cartItems:[],l=typeof e.cartItemCount=="number"?e.cartItemCount:a?s.cartItemCount:Number(i.context.cartItemCount||0),h=typeof e.cartValue=="number"?e.cartValue:a?s.cartValue:i.cartValue,S=await this.options.sessionManager.getSignedAuthPayload();if(!S)return this.mountLocalFallback(t,e);const k=I(),E=await At(),L={...S,currentProductId:E,currentPageType:Ct(),cartProductIds:n,cartVariantIds:d,cartItems:u,cartItemCount:l,cartValue:h,currency:k.code,moneyFormat:k.moneyFormat,moneyWithCurrencyFormat:k.moneyWithCurrencyFormat,locale:k.locale,dismissedWidgets:this.options.widgetManager.getDismissedWidgets(),trigger:t,triggerCategory:e.triggerCategory,triggerPayload:e};let w=await fetch(this.endpoint("/offer"),{method:"POST",headers:{"Content-Type":"application/json","X-AOVBoost-Shop":this.options.shop},body:JSON.stringify({...L,...S}),keepalive:!0});if(w.status===401){await this.options.sessionManager.applySessionFromResponse(w)||await this.options.sessionManager.refreshAuth();const m=await this.options.sessionManager.getSignedAuthPayload();if(!m)return this.mountLocalFallback(t,e);w=await fetch(this.endpoint("/offer"),{method:"POST",headers:{"Content-Type":"application/json","X-AOVBoost-Shop":this.options.shop},body:JSON.stringify({...L,...m}),keepalive:!0})}if(!w.ok)return this.mountLocalFallback(t,e);const x=await w.json();return x.widgetType?(this.options.widgetManager.mountDecision(x),x):this.mountLocalFallback(t,e)}catch{return this.mountLocalFallback(t,e)}finally{this.inFlight=!1}}endpoint(t){return`${this.options.apiBase.replace(/\/$/,"")}${t}`}mountLocalFallback(t,e){const i=Tt(t,e);return i?(this.options.widgetManager.mountDecision(i),i):null}}function Tt(r,t){const e=Number(t.cartValue||0);switch(r){case"first_time_visitor":case"long_product_dwell":case"scroll_depth_interest":case"comparison_page_visit":case"inactivity_timeout":case"purchase_history_match":case"loyalty_tier_reached":case"crm_segment_update":return{widgetType:"chat",payload:{offerId:`local:${r}`,greeting:"Hi. I can help you compare products and find useful add-ons.",copy:{greeting:"Hi. I can help you compare products and find useful add-ons.",ctaAccept:"Chat with AI",ctaDecline:"Browse myself"}},reasoning:"Local fallback for proactive chat trigger.",confidence:.4,aiProvider:"heuristic"};case"exit_intent":return{widgetType:"exit_intent",payload:{offerId:"local:exit_intent",immediate:!0,offerLine:"Before you go, I can help find a better match or bundle.",copy:{headline:"Wait before you go",offerLine:"I can help find a better match or bundle.",ctaText:"Open assistant",dismissText:"No thanks"}},reasoning:"Local fallback for exit intent.",confidence:.4,aiProvider:"heuristic"};case"cart_value_threshold":case"cart_abandoned":return{widgetType:"discount_nudge",payload:{offerId:`local:${r}`,cartValue:e,threshold:Number(t.threshold||50),copy:{progressLabel:"You are close to a reward",rewardDescription:"Add one more item to unlock the offer.",ctaText:"View picks"}},reasoning:"Local fallback for cart value or idle cart trigger.",confidence:.4,aiProvider:"heuristic"};case"flash_sale_window":case"seasonal_calendar":return{widgetType:"countdown_banner",payload:{offerId:`local:${r}`,endsAt:t.endsAt,body:"Limited-time product picks are available right now.",copy:{headline:"Limited-time offer",subheadline:"Relevant bundles and add-ons are available now.",ctaText:"View offer"}},reasoning:"Local fallback for scheduled campaign trigger.",confidence:.4,aiProvider:"heuristic"};case"low_inventory_alert":case"price_drop_webhook":return{widgetType:"inline_alert",payload:{offerId:`local:${r}`,body:r==="price_drop_webhook"?"The price on this product has changed.":"Inventory is limited for this product.",copy:{headline:r==="price_drop_webhook"?"Price update":"Limited stock",subheadline:r==="price_drop_webhook"?"The price on this product has changed.":"Inventory is limited for this product."}},reasoning:"Local fallback for system alert trigger.",confidence:.4,aiProvider:"heuristic"};case"cart_item_added":case"cart_item_removed":case"search_query":case"repeated_product_view":case"price_hesitation":case"wishlist_save":case"coupon_field_focus":case"subscription_renewal_due":case"payment_failure":return{widgetType:"toast",payload:{offerId:`local:${r}`,headline:R(r),body:z(r),copy:{headline:R(r),subheadline:z(r),ctaText:"Open assistant",dismissText:"No thanks"}},reasoning:"Local fallback for low-disruption trigger.",confidence:.4,aiProvider:"heuristic"};default:return null}}function R(r){return r==="cart_item_added"?"Complete the set":r==="coupon_field_focus"?"Looking for a code?":r==="price_hesitation"?"Need a better fit?":r==="wishlist_save"?"Saved for later":r==="search_query"?"Need help choosing?":"Need help deciding?"}function z(r){return r==="cart_item_added"?"I can help find matching accessories or add-ons.":r==="cart_item_removed"?"I can help find a better alternative.":r==="coupon_field_focus"?"I can help find a relevant offer or lower-priced option.":r==="price_hesitation"?"I can help compare value and find a lower-priced alternative.":r==="wishlist_save"?"I can compare this with related products when you are ready.":"I can help find the right product or useful add-on."}function Ct(){const r=window.location.pathname,t=String(window.ShopifyAnalytics?.meta?.page?.pageType||document.body?.dataset?.template||"").toLowerCase();return r==="/"?"home":/\/collections(?:\/|$)/.test(r)||t.includes("collection")?"collection":/\/products(?:\/|$)/.test(r)||t.includes("product")?"product":/\/cart(?:\/|$)/.test(r)||t.includes("cart")?"cart":/\/checkout(?:\/|$)/.test(r)?"checkout":/\/thank_you(?:\/|$)/.test(r)||window.Shopify?.checkout?"thankyou":"other"}async function At(){const r=window.Shopify?.product||window.ShopifyAnalytics?.meta?.product||null,t=String(r?.gid||r?.id||"");if(t)return q(t);const e=window.location.pathname.match(/\/products\/([^/?#]+)/)?.[1];if(e)try{const i=await fetch(`/products/${e}.js`,{headers:{Accept:"application/json"},keepalive:!0});if(!i.ok)return;const s=await i.json();return q(s.id)}catch{return}}async function Pt(){try{const r=await fetch("/cart.js",{headers:{Accept:"application/json"},keepalive:!0});if(!r.ok)throw new Error(`Cart read failed: ${r.status}`);const t=await r.json();H(t.currency);const e=Array.isArray(t.items)?t.items:[],i=e.map(a=>U(a)).filter(Boolean),s=e.map(a=>G(a)).filter(Boolean);return{cartToken:t.token||"",cartProductIds:i,cartVariantIds:s,cartItems:e.map(a=>({productId:U(a),variantId:G(a),quantity:Number(a.quantity||1),title:String(a.product_title||a.title||""),handle:String(a.handle||a.url||"").split("/products/")[1]?.split(/[?#/]/)[0]||""})),cartItemCount:Number(t.item_count||e.length||0),cartValue:Number(t.total_price||0)/100,currency:String(t.currency||"")}}catch{return{cartToken:"",cartProductIds:[],cartVariantIds:[],cartItems:[],cartItemCount:0,cartValue:0,currency:""}}}function q(r){const t=String(r||"");return t?t.startsWith("gid://shopify/Product/")?t:`gid://shopify/Product/${t}`:""}function $t(r){const t=String(r||"");return t?t.startsWith("gid://shopify/ProductVariant/")?t:`gid://shopify/ProductVariant/${t}`:""}function U(r){const t=Y(r.product);return q(r.product_id||r.productId||r.product_gid||r.productGid||t.id)}function G(r){const t=Y(r.variant);return $t(r.variant_id||r.variantId||r.id||r.variant_gid||r.variantGid||t.id)}function Y(r){return r&&typeof r=="object"&&!Array.isArray(r)?r:{}}const N="aovboost_anonymous_id",F="aovboost_storefront_session";class Et{constructor(t,e="/apps/aovboost"){c(this,"anonymousId","");c(this,"sessionToken","");c(this,"journeyStage","discovering");c(this,"viewedProductIds",new Set);c(this,"productViewCounts",new Map);c(this,"cartProductIds",new Set);c(this,"cartVariantIds",new Set);c(this,"cartItemCount",0);c(this,"pageViews",0);c(this,"maxScrollDepth",0);c(this,"cartActionCount",0);c(this,"cartValue",0);c(this,"startedAt",Date.now());c(this,"lastCartActionAt",0);c(this,"lastEventType","");c(this,"syncTimer");c(this,"authRefreshPromise");this.shop=t,this.apiBase=e}async init(){await this.ensureAuthenticated()||this.bootstrapLocalSession(),this.syncTimer=window.setInterval(()=>this.sync(),3e4),window.addEventListener("pagehide",()=>this.sync())}destroy(){this.syncTimer&&window.clearInterval(this.syncTimer)}recordEvent(t){if(this.lastEventType=t.type,t.type==="page_view"&&(this.pageViews+=1),t.type==="product_view"){const e=B(t);e&&(this.viewedProductIds.add(e),this.productViewCounts.set(e,(this.productViewCounts.get(e)||0)+1))}if(t.type==="scroll_depth"&&(this.maxScrollDepth=Math.max(this.maxScrollDepth,Number(t.depth||0))),t.type==="add_to_cart"){this.cartActionCount+=1,this.lastCartActionAt=Date.now();const e=B(t);e&&this.cartProductIds.add(e),Array.isArray(t.cartProductIds)&&t.cartProductIds.forEach(i=>this.cartProductIds.add(String(i))),Array.isArray(t.cartVariantIds)&&t.cartVariantIds.forEach(i=>this.cartVariantIds.add(String(i))),this.cartItemCount=Math.max(this.cartItemCount,Number(t.cartItemCount||this.cartItemCount)),this.cartValue=Math.max(this.cartValue,Number(t.cartValue||0)),this.journeyStage="buying"}if(t.type==="cart_update"&&(this.lastCartActionAt=Date.now(),Array.isArray(t.cartProductIds)&&(this.cartProductIds=new Set(t.cartProductIds.map(String))),Array.isArray(t.cartVariantIds)&&(this.cartVariantIds=new Set(t.cartVariantIds.map(String))),this.cartItemCount=Number(t.cartItemCount||this.cartProductIds.size),this.cartValue=Number(t.cartValue||0),(this.cartProductIds.size>0||this.cartItemCount>0)&&(this.journeyStage="buying")),t.type==="remove_from_cart"){this.cartActionCount+=1,this.lastCartActionAt=Date.now();const e=B(t);e&&this.cartProductIds.delete(e)}this.updateJourneyStage()}getSnapshot(){const t=Math.round((Date.now()-this.startedAt)/1e3),e=Array.from(this.productViewCounts.values()).reduce((d,u)=>d+u,0),i=J(this.pageViews*2+e*5+(this.maxScrollDepth>=90?10:this.maxScrollDepth>=75?8:this.maxScrollDepth>=50?5:this.maxScrollDepth>=25?3:0)+Math.min(t/120,1)*30+(this.cartProductIds.size>0?30:0),0,100),s=Array.from(this.productViewCounts.entries()).some(([d,u])=>u>=2&&!this.cartProductIds.has(d)),a=this.lastCartActionAt?(Date.now()-this.lastCartActionAt)/1e3:t,n=J((i>40&&this.cartActionCount===0&&a>=90?55:0)+(s?35:0),0,100);return{anonymousId:this.anonymousId,journeyStage:this.journeyStage,intentScore:i,hesitationScore:n,viewedProductIds:Array.from(this.viewedProductIds),cartProductIds:Array.from(this.cartProductIds),totalPageViews:this.pageViews,sessionDuration:t,cartValue:this.cartValue,context:{maxScrollDepth:this.maxScrollDepth,productViewCounts:Object.fromEntries(this.productViewCounts),cartActionCount:this.cartActionCount,cartItemCount:this.cartItemCount,cartVariantIds:Array.from(this.cartVariantIds),cartValue:this.cartValue,lastEventType:this.lastEventType}}}getAuthPayload(){return{sessionId:this.anonymousId,sessionToken:this.sessionToken,shop:this.shop}}async getSignedAuthPayload(){return!await this.ensureAuthenticated()||!this.anonymousId||!this.sessionToken?null:this.getAuthPayload()}async ensureAuthenticated(){if(this.sessionToken)return!0;try{await this.ensureStorefrontSession()}catch{await this.refreshAuth()}return!!this.sessionToken}async refreshAuth(){return this.authRefreshPromise?this.authRefreshPromise:(this.authRefreshPromise=this.refreshAuthInternal().finally(()=>{this.authRefreshPromise=void 0}),this.authRefreshPromise)}async refreshAuthInternal(){const t=this.anonymousId,e=this.sessionToken;try{window.localStorage.removeItem(F)}catch{}try{await this.ensureStorefrontSession({forceRefresh:!0})}catch{e?(this.anonymousId=t,this.sessionToken=e):this.bootstrapLocalSession()}this.syncGlobalSdkAuth()}applyStorefrontSession(t){const e=Lt(t);return!e||e.shop!==this.shop||!e.sessionId||!e.sessionToken||Number(e.expiresAt||0)<=Math.floor(Date.now()/1e3)+60?!1:(this.anonymousId=e.sessionId,this.sessionToken=e.sessionToken,this.storeStorefrontSession(e),this.syncGlobalSdkAuth(),!0)}async applySessionFromResponse(t){try{const e=await t.clone().json(),i=K(e);return this.applyStorefrontSession(i?.storefrontSession||i?.session||e)}catch{return!1}}syncGlobalSdkAuth(){const t=window.AOVBoostSDK;!t||typeof t!="object"||(t.sessionId=this.anonymousId,t.sessionToken=this.sessionToken)}sync(){if(!this.anonymousId||!this.sessionToken){this.ensureAuthenticated();return}const t=this.getSnapshot(),e=JSON.stringify({...this.getAuthPayload(),events:[{type:"session_sync",ts:Date.now(),sessionId:this.anonymousId,shop:this.shop,url:window.location.href,referrer:document.referrer,snapshot:t,...t}]});fetch(this.endpoint("/events"),{method:"POST",headers:{"Content-Type":"application/json","X-AOVBoost-Shop":this.shop},body:e,keepalive:!0}).then(i=>{i.status===401&&this.refreshAuth()}).catch(()=>{})}updateJourneyStage(){if(this.cartProductIds.size>0){this.journeyStage="buying";return}if(this.cartItemCount>0){this.journeyStage="buying";return}if(this.getSnapshotDuration()>=60||Array.from(this.productViewCounts.values()).some(t=>t>=2)){this.journeyStage="deciding";return}if(this.viewedProductIds.size>=3){this.journeyStage="comparing";return}this.journeyStage="discovering"}endpoint(t){return`${this.apiBase.replace(/\/$/,"")}${t}`}async ensureStorefrontSession(t={}){const e=t.forceRefresh?null:this.getStoredStorefrontSession();if(e){this.anonymousId=e.sessionId,this.sessionToken=e.sessionToken;return}const i=await fetch(this.endpoint("/session"),{method:"GET",headers:{Accept:"application/json"}});if(!i.ok)throw new Error(`Session bootstrap failed: ${i.status}`);const s=await i.json();if(!this.applyStorefrontSession(s))throw new Error("Invalid storefront session bootstrap response")}getStoredStorefrontSession(){try{const t=JSON.parse(window.localStorage.getItem(F)||"null");return!t||t.shop!==this.shop||!t.sessionId||!t.sessionToken||Number(t.expiresAt||0)<=Math.floor(Date.now()/1e3)+60?null:t}catch{return null}}storeStorefrontSession(t){try{window.localStorage.setItem(F,JSON.stringify(t)),window.localStorage.setItem(N,t.sessionId)}catch{}}bootstrapLocalSession(){let t="";try{t=window.localStorage.getItem(N)||"",t||(t=typeof crypto<"u"&&"randomUUID"in crypto?crypto.randomUUID():`local-${Date.now()}-${Math.random().toString(36).slice(2)}`,window.localStorage.setItem(N,t))}catch{t=`local-${Date.now()}-${Math.random().toString(36).slice(2)}`}this.anonymousId=t,this.sessionToken=""}getSnapshotDuration(){return Math.round((Date.now()-this.startedAt)/1e3)}}function Lt(r){const t=K(r);return t?{shop:String(t.shop||""),sessionId:String(t.sessionId||""),sessionToken:String(t.sessionToken||""),expiresAt:Number(t.expiresAt||0)}:null}function K(r){return r&&typeof r=="object"&&!Array.isArray(r)?r:null}function B(r){const t=r.product;return String(r.productId||r.product_id||t?.id||"")}function J(r,t,e){return Math.min(Math.max(r,t),e)}const X=10*60*1e3,Q=5*60*1e3,Z=30*1e3,Mt={long_product_dwell:{category:"browsing_behavior",widgetHint:"chat",throttleMs:60*1e3},repeated_product_view:{category:"browsing_behavior",widgetHint:"bundle",throttleMs:60*1e3},scroll_depth_interest:{category:"browsing_behavior",widgetHint:"chat",oncePerSession:!0},comparison_page_visit:{category:"browsing_behavior",widgetHint:"chat",oncePerSession:!0},search_query:{category:"browsing_behavior",widgetHint:"rec_strip",throttleMs:15*1e3},exit_intent:{category:"browsing_behavior",widgetHint:"exit_intent",oncePerSession:!0},cart_item_added:{category:"cart_checkout",widgetHint:"upsell_drawer",throttleMs:2500,requestDelayMs:50},cart_abandoned:{category:"cart_checkout",widgetHint:"discount_nudge",oncePerSession:!0},cart_value_threshold:{category:"cart_checkout",widgetHint:"discount_nudge",throttleMs:30*1e3},cart_item_removed:{category:"cart_checkout",widgetHint:"rec_strip",throttleMs:5e3},checkout_started:{category:"cart_checkout",widgetHint:"upsell_drawer",oncePerSession:!0},price_hesitation:{category:"user_intent",widgetHint:"toast",throttleMs:30*1e3},price_sensitive_chat:{category:"user_intent",widgetHint:"toast",requestOffer:!1,throttleMs:30*1e3},wishlist_save:{category:"user_intent",widgetHint:"toast",throttleMs:30*1e3},coupon_field_focus:{category:"user_intent",widgetHint:"toast",oncePerSession:!0},purchase_history_match:{category:"customer_profile_loyalty",widgetHint:"chat",throttleMs:60*1e3},loyalty_tier_reached:{category:"customer_profile_loyalty",widgetHint:"chat",throttleMs:60*1e3},subscription_renewal_due:{category:"customer_profile_loyalty",widgetHint:"toast",throttleMs:60*1e3},first_time_visitor:{category:"customer_profile_loyalty",widgetHint:"chat",oncePerSession:!0},flash_sale_window:{category:"time_based",widgetHint:"countdown_banner",oncePerSession:!0},post_purchase_window:{category:"time_based",widgetHint:"post_purchase",oncePerSession:!0},inactivity_timeout:{category:"time_based",widgetHint:"chat",oncePerSession:!0},seasonal_calendar:{category:"time_based",widgetHint:"countdown_banner",oncePerSession:!0},low_inventory_alert:{category:"external_system",widgetHint:"inline_alert",throttleMs:60*1e3},price_drop_webhook:{category:"external_system",widgetHint:"inline_alert",throttleMs:60*1e3},crm_segment_update:{category:"external_system",widgetHint:"chat",throttleMs:60*1e3},payment_failure:{category:"external_system",widgetHint:"toast",throttleMs:60*1e3}};class Vt{constructor(t){c(this,"abortController",new AbortController);c(this,"firedAt",new Map);c(this,"timers",new Map);c(this,"activePriceTarget",null);c(this,"options");c(this,"handleStorefrontEvent",t=>{const e=y(t.detail);e.type&&(e.type==="product_view"&&(this.scheduleProductDwell(String(e.productId||"")),this.handleRepeatedProductView(String(e.productId||""))),e.type==="scroll_depth"&&Number(e.depth||0)>=75&&this.fire("scroll_depth_interest",{depth:Number(e.depth||0)}),e.type==="search"&&String(e.query||"").trim().length>=2&&this.fire("search_query",{query:String(e.query||"").trim()}),e.type==="add_to_cart"&&this.syncCartAndFire("cart_item_added",e),e.type==="remove_from_cart"&&this.syncCartAndFire("cart_item_removed",e),e.type==="cart_update"&&this.handleCartState(e),e.type==="checkout_start"&&this.fire("checkout_started",{path:e.path||window.location.pathname}))});c(this,"handleCustomTrigger",t=>{const e=y(t.detail),i=String(e.type||e.trigger||"").trim();i&&this.fire(i,e)});c(this,"handleProfileEvent",t=>{const e=y(t.detail),i=String(e.type||"crm_segment_update");this.fire(i,e)});c(this,"handleSystemEvent",t=>{const e=y(t.detail),i=String(e.type||"external_system_event");this.fire(i,e)});this.options=t}init(){document.addEventListener("aovboost:event",this.handleStorefrontEvent,{signal:this.abortController.signal}),document.addEventListener("aovboost:trigger",this.handleCustomTrigger,{signal:this.abortController.signal}),document.addEventListener("aovboost:profile-event",this.handleProfileEvent,{signal:this.abortController.signal}),document.addEventListener("aovboost:system-event",this.handleSystemEvent,{signal:this.abortController.signal}),this.installProductDwellTracking(),this.installComparisonTracking(),this.installExitIntentTracking(),this.installPriceHoverTracking(),this.installCouponFocusTracking(),this.installWishlistTracking(),this.installInactivityTracking(),this.installFirstTimeVisitorTracking(),this.installInitialCartTracking(),this.installPostPurchaseTracking(),this.installScheduledCampaignTracking()}destroy(){this.abortController.abort(),this.timers.forEach(t=>window.clearTimeout(t)),this.timers.clear()}trigger(t,e={}){this.fire(t,e)}installProductDwellTracking(){this.scheduleProductDwell(P())}scheduleProductDwell(t){this.clearTimer("product_dwell"),!(!t||!Ft())&&this.setTimer("product_dwell",()=>{this.fire("long_product_dwell",{productId:t,dwellSeconds:Z/1e3})},Z)}handleRepeatedProductView(t){if(!t)return;const e=y(this.options.sessionManager.getSnapshot().context.productViewCounts),i=Number(e[t]||0);i>=2&&this.fire("repeated_product_view",{productId:t,viewCount:i})}installComparisonTracking(){const t=`${window.location.pathname} ${document.title}`.toLowerCase();/\b(compare|comparison|versus|vs|alternative|competitor)\b/.test(t)&&window.setTimeout(()=>{this.fire("comparison_page_visit",{path:window.location.pathname})},800)}installExitIntentTracking(){document.addEventListener("mouseleave",t=>{t.clientY<=8&&this.fire("exit_intent",{immediate:!0,path:window.location.pathname})},{signal:this.abortController.signal})}installPriceHoverTracking(){document.addEventListener("mouseover",t=>{const e=jt(t.target);!e||e===this.activePriceTarget||(this.activePriceTarget=e,this.clearTimer("price_hover"),this.setTimer("price_hover",()=>{this.fire("price_hesitation",{productId:P(),priceText:e.textContent?.trim().slice(0,80)||""})},1200))},{signal:this.abortController.signal}),document.addEventListener("mouseout",t=>{const e=this.activePriceTarget;if(!e)return;const i=t.relatedTarget;i&&e.contains(i)||(this.activePriceTarget=null,this.clearTimer("price_hover"))},{signal:this.abortController.signal})}installCouponFocusTracking(){document.addEventListener("focusin",t=>{const e=t.target;!e||!Wt(e)||this.fire("coupon_field_focus",{fieldName:e.name||e.id||""})},{signal:this.abortController.signal})}installWishlistTracking(){document.addEventListener("click",t=>{t.target?.closest?.("[data-wishlist], [data-save-product], .wishlist, .wishlist-button, [aria-label*='wishlist'], [aria-label*='Wishlist'], [aria-label*='save'], [aria-label*='Save']")&&this.fire("wishlist_save",{productId:P()})},{signal:this.abortController.signal})}installInactivityTracking(){const t=()=>{this.clearTimer("inactivity"),this.setTimer("inactivity",()=>{this.fire("inactivity_timeout",{idleSeconds:Q/1e3})},Q)};["click","keydown","scroll","touchstart"].forEach(e=>{window.addEventListener(e,t,{passive:!0,signal:this.abortController.signal})}),t()}installFirstTimeVisitorTracking(){try{const t="aovboost_returning_visitor";if(window.localStorage.getItem(t)==="true")return;window.localStorage.setItem(t,"true"),window.setTimeout(()=>{this.fire("first_time_visitor",{path:window.location.pathname})},1800)}catch{}}installInitialCartTracking(){/\/cart(?:\/|$)/.test(window.location.pathname)&&window.setTimeout(async()=>{const t=await this.readCart();if(t.cartItemCount<=0)return;const e={...t,source:"initial_cart_state"};this.options.eventBus.track("cart_update",e),this.fire("cart_item_added",e),this.handleCartState(e)},900)}installPostPurchaseTracking(){Bt()&&window.setTimeout(()=>{this.fire("post_purchase_window",{path:window.location.pathname})},1200)}installScheduledCampaignTracking(){const t=y(window.AOVBoost?.campaign),e=String(t.type||"");if(!e)return;const i=Date.parse(String(t.startsAt||"")),s=Date.parse(String(t.endsAt||"")),a=Date.now();(!Number.isFinite(i)||i<=a)&&(!Number.isFinite(s)||s>a)&&this.fire(e==="seasonal"?"seasonal_calendar":"flash_sale_window",{campaign:t,endsAt:t.endsAt})}syncCartAndFire(t,e){window.setTimeout(async()=>{const i=await this.readCart(),s={...e,...i};this.fire(t,s),(i.cartProductIds.length>0||i.cartValue>0)&&this.options.eventBus.track("cart_update",s),this.handleCartState(s)},350)}async readCart(){try{const t=await fetch("/cart.js",{headers:{Accept:"application/json"},keepalive:!0});if(!t.ok)throw new Error(`Cart read failed: ${t.status}`);const e=await t.json();H(e.currency);const i=Array.isArray(e.items)?e.items:[],s=i.map(n=>et(n)).filter(Boolean),a=i.map(n=>rt(n)).filter(Boolean);return{cartToken:e.token||"",cartProductIds:s,cartVariantIds:a,cartItems:i.map(n=>({productId:et(n),variantId:rt(n),quantity:Number(n.quantity||1),title:String(n.product_title||n.title||""),handle:String(n.handle||n.url||"").split("/products/")[1]?.split(/[?#/]/)[0]||""})),cartItemCount:Number(e.item_count||i.length||0),cartValue:Number(e.total_price||0)/100,currency:String(e.currency||"")}}catch{return{cartToken:"",cartProductIds:[],cartVariantIds:[],cartItems:[],cartItemCount:0,cartValue:0,currency:""}}}handleCartState(t){const e=Number(t.cartValue||0),i=Number(t.cartItemCount||0);e>0&&this.fire("cart_value_threshold",t),this.clearTimer("cart_idle"),i>0&&this.setTimer("cart_idle",()=>{this.fire("cart_abandoned",{...t,idleSeconds:X/1e3})},X)}fire(t,e={}){const i=Dt(t),s=Date.now(),a=i.throttleMs??10*1e3,n=this.firedAt.get(t)||0;if(s-n<a||i.oncePerSession&&qt(t))return;i.oncePerSession&&Nt(t),this.firedAt.set(t,s);const d={...e,triggerType:t,triggerCategory:i.category,widgetHint:i.widgetHint};this.options.eventBus.track(t,d),i.requestOffer!==!1&&window.setTimeout(()=>{this.options.offerPoller.requestOffer(t,d)},i.requestDelayMs??150)}setTimer(t,e,i){this.clearTimer(t),this.timers.set(t,window.setTimeout(e,i))}clearTimer(t){const e=this.timers.get(t);e&&window.clearTimeout(e),this.timers.delete(t)}}function Dt(r){return Mt[r]||{category:"external_system",widgetHint:"chat",throttleMs:3e4}}function y(r){return r&&typeof r=="object"&&!Array.isArray(r)?r:{}}function qt(r){try{return sessionStorage.getItem(`aovboost_trigger:${r}`)==="true"}catch{return!1}}function Nt(r){try{sessionStorage.setItem(`aovboost_trigger:${r}`,"true")}catch{}}function Ft(){return/\/products(?:\/|$)/.test(window.location.pathname)||!!P()}function Bt(){return/\/thank_you(?:\/|$)/.test(window.location.pathname)||!!window.Shopify?.checkout}function P(){const r=window.Shopify?.product||window.ShopifyAnalytics?.meta?.product||null;return r?tt(r.gid||r.id):""}function tt(r){const t=String(r||"");return t?t.startsWith("gid://shopify/Product/")?t:`gid://shopify/Product/${t}`:""}function Ot(r){const t=String(r||"");return t?t.startsWith("gid://shopify/ProductVariant/")?t:`gid://shopify/ProductVariant/${t}`:""}function et(r){const t=y(r.product);return tt(r.product_id||r.productId||r.product_gid||r.productGid||t.id)}function rt(r){const t=y(r.variant);return Ot(r.variant_id||r.variantId||r.id||r.variant_gid||r.variantGid||t.id)}function jt(r){const t=r instanceof HTMLElement?r:null;return t?t.closest("[data-price], .price, .product-price, .product__price, [class*='price'], [class*='Price'], [id*='price'], [id*='Price']"):null}function Wt(r){const t=[r.name,r.id,r.placeholder,r.getAttribute("aria-label"),r.getAttribute("autocomplete")].filter(Boolean).join(" ").toLowerCase();return/\b(coupon|discount|promo|promotion|voucher|code)\b/.test(t)}class Ht extends p{getWidgetType(){return"bundle"}render(){const t=this.payload.bundle||{},e=this.payload.copy||{},i=C(this.payload),s=i.length>0&&i.every(l=>l.variantId),a=i.find(l=>l.handle)?.handle,n=i.reduce((l,h)=>l+Number(h.price||0)*Number(h.quantity||1),0),d=Number(t.discountValue||0),u=t.discountType==="percentage"?n*(1-d/100):t.discountType==="fixed"?Math.max(n-d,0):n;this.html(`
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
            <h3 class="title">${o(e.headline||t.name||"Complete the set")}</h3>
            <p class="body">${o(t.description||e.totalSavings||"Bundle these products for a better cart.")}</p>
          </div>
          <div class="tiles">
            ${i.map(l=>`
                  <article class="tile">
                    ${l.imageUrl?`<img src="${o(l.imageUrl)}" alt="${o(l.title)}" loading="lazy">`:""}
                    <p class="product-name">${o(l.title)}</p>
                    <span class="price">${o(l.price?v(l.price):"")}</span>
                  </article>
                `).join("")}
          </div>
          <div class="totals">
            ${n>u?`<span class="strike">${v(n)}</span>`:""}
            <strong>${v(u)}</strong>
          </div>
          <div class="actions">
            ${s?`<button type="button" class="primary" data-add>${o(e.ctaText||"Add bundle to cart")}</button>`:a?`<a class="primary" href="/products/${o(a)}">${o(e.ctaText||"View bundle products")}</a>`:""}
          </div>
        </div>
      </section>
    `),this.root.querySelector("[data-add]")?.addEventListener("click",async()=>{this.trackClick("add_bundle"),await St(i.map(l=>({variantId:l.variantId,quantity:Number(l.quantity||1)}))),document.dispatchEvent(new CustomEvent("add-to-cart",{detail:{source:"bundle_widget"}}))})}}class Rt extends p{constructor(e){super(e);c(this,"messages",[]);c(this,"expanded",!1);c(this,"sending",!1);c(this,"handleProductCardClick",async e=>{const s=e.target?.closest?.("[data-chat-add]");if(!s)return;e.preventDefault();const a=s.dataset.chatAdd;if(!(!a||s.disabled)){s.disabled=!0,s.textContent="Adding";try{if(!await A(a))throw new Error("Cart add failed");s.textContent="Added",document.dispatchEvent(new CustomEvent("add-to-cart",{detail:{source:"chat_widget",variantId:a}}))}catch{s.disabled=!1,s.textContent="Try again"}}});this.root.addEventListener("click",this.handleProductCardClick);const i=e.copy;this.messages.push({role:"assistant",content:String(i?.greeting||e.greeting||"Hi. Can I help you find the perfect product today?")})}getWidgetType(){return"chat"}destroy(){this.root.removeEventListener("click",this.handleProductCardClick),super.destroy()}render(){const e=this.payload.copy||{};this.html(`
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
          <button type="button" class="icon" data-close aria-label="Close">x</button>
        </div>
        ${this.expanded?this.renderChatUi():`<p class="body">${o(e.greeting||this.messages[0].content)}</p>
              <div class="actions">
                <button type="button" class="primary" data-expand>${o(e.ctaAccept||"Chat with AI")}</button>
                <button type="button" class="secondary" data-dismiss>${o(e.ctaDecline||"Browse myself")}</button>
              </div>`}
      </aside>
    `),this.root.querySelector("[data-close]")?.addEventListener("click",()=>this.dismiss()),this.root.querySelector("[data-dismiss]")?.addEventListener("click",()=>this.dismiss()),this.root.querySelector("[data-expand]")?.addEventListener("click",()=>{this.expanded=!0,this.trackClick("open_chat"),this.render()}),this.root.querySelector("[data-send]")?.addEventListener("click",()=>this.sendMessage()),this.root.querySelector("input")?.addEventListener("keydown",i=>{i.key==="Enter"&&(i.preventDefault(),this.sendMessage())}),this.hydrateProductCards(this.root),this.scrollToBottom()}renderChatUi(){return`
      <div class="messages" data-messages>
        ${this.messages.map(e=>this.renderMessage(e)).join("")}
      </div>
      <div class="compose">
        <input type="text" placeholder="Ask me anything" data-input>
        <button type="button" class="primary" data-send>Send</button>
      </div>
    `}renderMessage(e){return`
      <div class="bubble ${e.role}">
        ${this.renderMessageContent(e)}
      </div>
    `}renderMessageContent(e){return`
      ${o(e.content)}
      ${e.productCards?.length?this.renderProductCards(e.productCards):this.renderProductLinks(e.content)}
    `}renderProductCards(e){const i=e.filter(s=>s.handle||s.title).slice(0,4);return i.length===0?"":`
      <div class="inline-products">
        ${i.map(s=>this.renderProductCard(s)).join("")}
      </div>
    `}renderProductCard(e){const i=String(e.handle||""),s=String(e.title||i.replace(/-/g," ")||"Recommended product"),a=i?`/products/${o(i)}`:"";return`
      <article class="inline-product" data-product-card data-handle="${o(i)}">
        ${e.imageUrl?`<img data-product-image src="${o(e.imageUrl)}" alt="${o(s)}" loading="lazy">`:'<span class="image-placeholder" aria-hidden="true"></span>'}
        <span class="product-copy">
          <span class="product-name">${o(s)}</span>
          ${e.price?`<span class="price">${o(e.price)}</span>`:""}
          <span class="product-actions">
            ${a?`<a href="${a}">View product</a>`:""}
            ${e.variantId?`<button type="button" data-chat-add="${o(e.variantId)}">Add to cart</button>`:""}
          </span>
        </span>
      </article>
    `}renderProductLinks(e){const i=e.match(/\/products\/([a-z0-9-]+)/i);if(!i)return"";const s=i[1];return this.renderProductCards([{handle:s,title:s.replace(/-/g," ")}])}appendMessage(e){const i=this.root.querySelector("[data-messages]");if(!i)throw new Error("Messages container not found");const s=document.createElement("div");return s.className=`bubble ${e.role}`,s.innerHTML=this.renderMessageContent(e),i.appendChild(s),this.hydrateProductCards(s),this.scrollToBottom(),s}async hydrateProductCards(e){const i=Array.from(e.querySelectorAll("[data-product-card][data-handle]"));await Promise.all(i.map(async s=>{if(s.dataset.hydrated==="true")return;const a=s.dataset.handle;if(!a)return;if(!!s.querySelector("img[data-product-image]")){s.dataset.hydrated="true";return}try{const d=await fetch(`/products/${a}.js`,{headers:{Accept:"application/json"}});if(!d.ok)throw new Error(`Product read failed: ${d.status}`);const u=await d.json(),l=u.featured_image||u.images?.[0]||u.media?.[0]?.src||"";if(!l)return;const h=document.createElement("img");h.dataset.productImage="true",h.src=l,h.alt=String(u.title||a.replace(/-/g," ")),h.loading="lazy",s.querySelector(".image-placeholder")?.replaceWith(h),s.dataset.hydrated="true"}catch{s.dataset.hydrated="true"}}))}async sendMessage(){if(this.sending)return;const e=this.root.querySelector("[data-input]"),i=this.root.querySelector("[data-send]"),s=e?.value.trim();if(!s)return;this.sending=!0,i&&(i.disabled=!0),e.value="",this.messages.push({role:"user",content:s}),this.appendMessage({role:"user",content:s}),this.trackClick("send_message"),zt(s)&&(this.track("chat_intent",{intent:"price_sensitive"}),document.dispatchEvent(new CustomEvent("aovboost:trigger",{detail:{type:"price_sensitive_chat",message:s}})));const a=this.messages.push({role:"assistant",content:""})-1,n=this.appendMessage({role:"assistant",content:""});this.showTyping();try{let d=await this.requestChat(s);if(d.status===401&&(await this.applyRecoverySession(d)||await window.AOVBoostSDK?.refreshSession?.(),d=await this.requestChat(s)),!d.ok)throw new Error(`Server returned ${d.status}`);if(!d.body)throw new Error("Missing stream body");const u=d.body.getReader(),l=new TextDecoder;let h="",S=!1,k=!1;for(;;){const{done:E,value:L}=await u.read();if(E)break;h+=l.decode(L,{stream:!0});const w=h.split(`
`);h=w.pop()||"";for(const x of w){if(!x.startsWith("data: "))continue;const j=x.slice(6);if(j!=="[DONE]")try{const m=JSON.parse(j);m.delta&&(S||(this.removeTyping(),S=!0),this.messages[a].content+=m.delta,Array.isArray(m.productCards)&&(this.messages[a].productCards=m.productCards),n.innerHTML=this.renderMessageContent(this.messages[a]),this.hydrateProductCards(n),m.cartAction&&!k&&(k=!0,await this.handleCartAction(m.cartAction,a,n)),this.scrollToBottom())}catch{}}}S||(this.removeTyping(),this.messages[a].content||(this.messages[a].content="I can help you compare products and find the right add-ons.",n.innerHTML=this.renderMessageContent(this.messages[a])))}catch{this.removeTyping(),this.messages[a].content=this.messages[a].content||"I had trouble connecting. Please try again in a moment.",n.innerHTML=this.renderMessageContent(this.messages[a])}finally{this.sending=!1,i&&(i.disabled=!1)}}async requestChat(e){const i=window.AOVBoost||{},s=window.AOVBoostSDK,a=Ut(i.apiBase).replace(/\/$/,""),n=typeof s?.getSignedAuthPayload=="function"?await s.getSignedAuthPayload():null;if(!n)throw new Error("Missing signed storefront auth");const d=I();return fetch(`${a}/chat`,{method:"POST",headers:{"Content-Type":"application/json","X-AOVBoost-Shop":n.shop||i.shop||""},body:JSON.stringify({...n,message:e,messageHistory:this.messages.slice(0,-2),currency:d.code,currencySource:d.source,moneyFormat:d.moneyFormat,moneyWithCurrencyFormat:d.moneyWithCurrencyFormat,locale:d.locale})})}async handleCartAction(e,i,s){if(!(e.type!=="add_to_cart"||!e.variantId))try{if(!await A(e.variantId,Number(e.quantity||1)))throw new Error("Cart add failed");this.messages[i].content=`Added **${e.productTitle||"that product"}** to your cart.`,s.innerHTML=this.renderMessageContent(this.messages[i]),this.hydrateProductCards(s),document.dispatchEvent(new CustomEvent("add-to-cart",{detail:{source:"chat_widget",variantId:e.variantId,quantity:Number(e.quantity||1)}}))}catch{this.messages[i].content=`I couldn't add **${e.productTitle||"that product"}** to your cart. Please use the product card button or open the product page.`,s.innerHTML=this.renderMessageContent(this.messages[i]),this.hydrateProductCards(s)}}async applyRecoverySession(e){try{const i=await e.clone().json(),s=i?.storefrontSession||i?.session,a=window.AOVBoostSDK?.applySession;return typeof a=="function"?!!a(s):!1}catch{return!1}}showTyping(){const e=this.root.querySelector("[data-messages]");if(!e)return;const i=document.createElement("div");i.className="bubble assistant dots",i.dataset.typing="true",i.innerHTML="<span>.</span><span>.</span><span>.</span>",e.appendChild(i),this.scrollToBottom()}removeTyping(){const e=this.root.querySelector("[data-typing]");e&&e.remove()}scrollToBottom(){const e=this.root.querySelector("[data-messages]");e&&(e.scrollTop=e.scrollHeight)}dismiss(){this.trackDismiss(),this.container.animate([{transform:"translateY(0)"},{transform:"translateY(120%)"}],{duration:180,easing:"ease-in",fill:"forwards"}),window.setTimeout(()=>this.destroy(),190)}}function zt(r){return/\b(expensive|cheaper|cheap|discount|coupon|promo|deal|sale|price|afford|budget|cost)\b/i.test(r)}function Ut(r){const t=typeof r=="string"?r.trim():"";return!t||t==="/api"||t.startsWith("/api/")?"/apps/aovboost":t.includes("/apps/aovboost")||t.startsWith("/apps/")?t:"/apps/aovboost"}class Gt extends p{constructor(){super(...arguments);c(this,"timer")}getWidgetType(){return"countdown_banner"}render(){const e=this.payload.copy||{},i=e.headline||this.payload.headline||"Limited-time offer",s=e.subheadline||e.offerLine||this.payload.body||"Relevant bundles and add-ons are available for this session.";this.html(`
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
          <h3 class="title">${o(i)}</h3>
          <p class="body">${o(s)}</p>
        </div>
        <strong class="timer" data-countdown></strong>
        <button type="button" class="icon" data-dismiss aria-label="Close">x</button>
      </aside>
    `),this.root.querySelector("[data-dismiss]")?.addEventListener("click",()=>{this.trackDismiss(),this.destroy()}),this.tick(),this.timer=window.setInterval(()=>this.tick(),1e3)}destroy(){this.timer&&window.clearInterval(this.timer),super.destroy()}tick(){const e=this.root.querySelector("[data-countdown]");if(!e)return;const i=Date.parse(String(this.payload.endsAt||""));if(!Number.isFinite(i)){e.textContent="Today";return}const s=Math.max(i-Date.now(),0);if(s<=0){this.destroy();return}const a=Math.floor(s/36e5),n=Math.floor(s%36e5/6e4),d=Math.floor(s%6e4/1e3);e.textContent=a>0?`${a}h ${n}m`:`${n}m ${d.toString().padStart(2,"0")}s`}}class Yt extends p{getWidgetType(){return"discount_nudge"}render(){this.draw(),document.addEventListener("add-to-cart",()=>this.draw())}draw(){const t=this.payload.copy||{},e=Number(this.payload.threshold||50),i=Number(this.payload.cartValue||0),s=Math.max(e-i,0),a=e>0?Math.min(i/e,1):0;this.html(`
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
          <span>${s>0?o(t.progressLabel||`You're ${v(s)} away from your reward`):o(t.rewardDescription||"Reward unlocked")}</span>
          <button type="button" class="icon" data-dismiss aria-label="Close">x</button>
        </div>
        <div class="track" aria-hidden="true"><span></span></div>
      </div>
    `),this.root.querySelector("[data-dismiss]")?.addEventListener("click",()=>{this.trackDismiss(),this.destroy()}),s<=0&&window.setTimeout(()=>this.destroy(),3e3)}}class Kt extends p{constructor(){super(...arguments);c(this,"shown",!1);c(this,"handleMouseLeave",e=>{e.clientY<10&&this.show()});c(this,"handleVisibility",()=>{document.visibilityState==="hidden"&&this.show()})}getWidgetType(){return"exit_intent"}mount(e=document.body){if(e.appendChild(this.container),!this.shouldSkip()){if(this.payload.immediate){this.show();return}document.addEventListener("mouseleave",this.handleMouseLeave),document.addEventListener("visibilitychange",this.handleVisibility)}}render(){const e=this.payload.copy||{};this.html(`
      <style>
        .backdrop { position: fixed; inset: 0; z-index: 9998; background: rgba(17, 24, 39, .38); }
        .modal { position: fixed; inset: 50% auto auto 50%; z-index: 9999; width: min(420px, calc(100vw - 32px)); transform: translate(-50%, -50%); border-radius: 8px; padding: 18px; }
      </style>
      <div class="backdrop" data-dismiss></div>
      <section class="modal">
        <h3 class="title">${o(e.headline||"Wait before you go")}</h3>
        <p class="body">${o(e.offerLine||this.payload.offerLine||"Your cart has a relevant offer available.")}</p>
        ${this.payload.discountCode?`<p class="body"><strong>${o(this.payload.discountCode)}</strong></p>`:""}
        <div class="actions">
          <button type="button" class="primary" data-claim>${o(e.ctaText||"Claim offer")}</button>
          <button type="button" class="secondary" data-dismiss>${o(e.dismissText||"No thanks")}</button>
        </div>
      </section>
    `),this.root.querySelector("[data-claim]")?.addEventListener("click",()=>{this.trackClick("claim_exit_offer"),this.destroy()}),this.root.querySelectorAll("[data-dismiss]").forEach(i=>{i.addEventListener("click",()=>{this.trackDismiss(),this.destroy()})})}destroy(){document.removeEventListener("mouseleave",this.handleMouseLeave),document.removeEventListener("visibilitychange",this.handleVisibility),super.destroy()}show(){if(!(this.shown||this.hasFired())){this.shown=!0;try{sessionStorage.setItem("aovboost_exit_intent_fired","true")}catch{}this.render(),this.trackImpression()}}hasFired(){try{return sessionStorage.getItem("aovboost_exit_intent_fired")==="true"}catch{return!1}}shouldSkip(){return/\/(?:checkout|thank_you)(?:\/|$)/.test(window.location.pathname)}}class Jt extends p{getWidgetType(){return"inline_alert"}render(){const t=this.payload.copy||{},e=t.headline||this.payload.headline||"Store update",i=t.subheadline||t.offerLine||this.payload.body||"A relevant product update is available.";this.html(`
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
            <h3 class="title">${o(e)}</h3>
            <p class="body">${o(i)}</p>
          </div>
          <button type="button" class="icon" data-dismiss aria-label="Close">x</button>
        </div>
      </aside>
    `),this.root.querySelector("[data-dismiss]")?.addEventListener("click",()=>{this.trackDismiss(),this.destroy()})}}class Xt extends p{getWidgetType(){return"post_purchase"}mount(t=document.body){this.isThankYouPage()&&super.mount(t)}render(){const t=this.payload.copy||{},e=C(this.payload)[0]||this.payload.product||{};this.html(`
      <style>
        .post { margin: 18px 0; box-shadow: none; }
      </style>
      <section class="post card">
        <h3 class="title">${o(t.headline||"Complete your purchase")}</h3>
        <article class="product-card">
          ${e.imageUrl?`<img src="${o(e.imageUrl)}" alt="${o(e.title)}" loading="lazy">`:"<span></span>"}
          <div class="stack">
            <div>
              <p class="product-name">${o(t.productName||e.title||"Recommended product")}</p>
              <span class="price">${o(e.price?v(e.price):"")}</span>
            </div>
            <p class="reason">${o(t.oneLineReason||"A useful add-on for what you just bought.")}</p>
            <button type="button" class="primary" data-add>${o(t.ctaText||"Add to my order")}</button>
          </div>
        </article>
      </section>
    `),this.root.querySelector("[data-add]")?.addEventListener("click",async()=>{this.trackClick("add_post_purchase");const i=e.variantId;if(i){await A(i);return}const s=e.handle;s&&(window.location.href=`/products/${s}`)})}isThankYouPage(){return/\/thank_you(?:\/|$)/.test(window.location.pathname)||!!window.Shopify?.checkout}}class Qt extends p{getWidgetType(){return"rec_strip"}render(){const t=C(this.payload);this.html(`
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
          ${t.map(e=>`
                <article class="tile">
                  ${e.reason?`<span class="badge">${o(e.reason)}</span>`:""}
                  ${e.imageUrl?`<img data-src="${o(e.imageUrl)}" alt="${o(e.title)}">`:""}
                  <p class="product-name">${o(e.title)}</p>
                  <span class="price">${o(e.price?v(e.price):"")}</span>
                  ${e.variantId?`<button type="button" class="primary" data-add="${o(e.variantId)}">Add to cart</button>`:e.handle?`<a class="primary" href="/products/${o(e.handle)}">View product</a>`:""}
                </article>
              `).join("")}
        </div>
      </section>
    `),this.lazyLoadImages(),this.root.querySelectorAll("[data-add]").forEach(e=>{e.addEventListener("click",async()=>{this.trackClick("add_recommendation"),await A(e.dataset.add)})})}lazyLoadImages(){const t=Array.from(this.root.querySelectorAll("img[data-src]"));if(!("IntersectionObserver"in window)){t.forEach(i=>{i.src=i.dataset.src||""});return}const e=new IntersectionObserver(i=>{i.forEach(s=>{if(!s.isIntersecting)return;const a=s.target;a.src=a.dataset.src||"",e.unobserve(a)})});t.forEach(i=>e.observe(i))}}class Zt extends p{constructor(){super(...arguments);c(this,"interval")}getWidgetType(){return"social_proof"}render(){const i=C(this.payload).filter(a=>Number(a.orderCount||0)>0).map(a=>`${Number(a.orderCount)} people bought this with ${a.title}`);i.length===0&&i.push("Frequently bought together"),this.html(`
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
      <div class="pill" role="status"><span class="dot"></span><span data-message>${o(i[0])}</span></div>
    `);let s=0;this.interval=window.setInterval(()=>{s=(s+1)%i.length;const a=this.root.querySelector("[data-message]");a&&(a.textContent=i[s])},5e3)}destroy(){this.interval&&window.clearInterval(this.interval),super.destroy()}}class te extends p{getWidgetType(){return"toast"}render(){const t=this.payload.copy||{},e=t.headline||this.payload.headline||"A better option is available",i=t.subheadline||t.offerLine||this.payload.body||"I can help find a better match or a useful offer.",s=t.ctaText||this.payload.ctaText||"Open assistant";this.html(`
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
            <h3 class="title">${o(e)}</h3>
            <p class="body">${o(i)}</p>
          </div>
          <button type="button" class="icon" data-dismiss aria-label="Close">x</button>
        </div>
        <div class="actions">
          <button type="button" class="primary" data-chat>${o(s)}</button>
        </div>
      </aside>
    `),this.root.querySelector("[data-dismiss]")?.addEventListener("click",()=>{this.trackDismiss(),this.destroy()}),this.root.querySelector("[data-chat]")?.addEventListener("click",()=>{this.trackClick("open_assistant"),document.dispatchEvent(new CustomEvent("aovboost:trigger",{detail:{type:"long_product_dwell",source:"toast"}})),this.destroy()}),window.setTimeout(()=>this.destroy(),9e3)}}class ee extends p{constructor(){super(...arguments);c(this,"timer");c(this,"deadline",Date.now()+8e3)}getWidgetType(){return"upsell_drawer"}render(){const e=C(this.payload).slice(0,3),i=this.payload.copy||{};this.html(`
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
            <h3 class="title">${o(i.headline||"Great choice. Complete the set")}</h3>
            <p class="body">People who bought this also love:</p>
          </div>
          <button type="button" class="icon" data-dismiss aria-label="Close">x</button>
        </div>
        <div class="timer"><span data-timer></span></div>
        <div class="product-grid">
          ${e.map(s=>`
                <article class="product-card">
                  ${s.imageUrl?`<img src="${o(s.imageUrl)}" alt="${o(s.title)}" loading="lazy">`:"<span></span>"}
                  <div class="stack">
                    <div>
                      <p class="product-name">${o(s.title)}</p>
                      <span class="price">${o(s.price?v(s.price):"")}</span>
                    </div>
                    <p class="reason">${o(s.reason||i.whyThisGoes||"It pairs well with your cart.")}</p>
                    ${s.variantId?`<button type="button" class="primary" data-add="${o(s.variantId)}">Add to cart</button>`:s.handle?`<a class="primary" href="/products/${o(s.handle)}">View product</a>`:""}
                  </div>
                </article>
              `).join("")}
        </div>
        <div class="actions">
          <a class="secondary" href="/cart">Continue to cart</a>
        </div>
      </aside>
    `),this.root.querySelectorAll("[data-dismiss]").forEach(s=>{s.addEventListener("click",()=>this.dismiss())}),this.root.querySelectorAll("[data-add]").forEach(s=>{s.addEventListener("click",async()=>{this.trackClick("add_upsell"),await A(s.dataset.add)})}),this.startCountdown()}destroy(){this.timer&&window.clearInterval(this.timer),super.destroy()}startCountdown(){this.timer&&window.clearInterval(this.timer),this.deadline=Date.now()+8e3,this.timer=window.setInterval(()=>{const e=Math.max(this.deadline-Date.now(),0),i=this.root.querySelector("[data-timer]");i&&(i.style.transform=`scaleX(${e/8e3})`),e<=0&&this.dismiss()},120)}dismiss(){this.trackDismiss(),this.container.animate([{transform:"translateX(0)"},{transform:"translateX(100%)"}],{duration:180,easing:"ease-in",fill:"forwards"}),window.setTimeout(()=>this.destroy(),190)}}const it="aovboost_dismissed_widgets",re=30*60*1e3,ie=new Set(["bundle","rec_strip","inline_alert","social_proof"]);class se{constructor(){c(this,"activeWidget",null);c(this,"activeKey","");c(this,"activeWidgetType","");c(this,"inlineWidgets",new Map)}mountDecision(t){if(!t.widgetType||this.getDismissedWidgets().includes(t.widgetType))return;const e=t.payload||{},i=String(e.offerId||""),s=`${t.widgetType}:${ae(t.widgetType,e,i)}`;if(ie.has(t.widgetType)){const d=this.inlineWidgets.get(t.widgetType);if(d?.key===s)return;const u=st(t.widgetType,e);if(!u)return;d?.widget.destroy();const l=this.resolveTarget(t.widgetType);u.mount(l),this.inlineWidgets.set(t.widgetType,{key:s,widget:u});return}if(t.widgetType==="chat"&&this.activeWidgetType==="chat"||s===this.activeKey)return;this.destroyFloatingWidget();const a=st(t.widgetType,e);if(!a)return;const n=this.resolveTarget(t.widgetType);a.mount(n),this.activeWidget=a,this.activeKey=s,this.activeWidgetType=t.widgetType}destroyActive(){this.destroyFloatingWidget(),this.inlineWidgets.forEach(t=>t.widget.destroy()),this.inlineWidgets.clear()}destroyFloatingWidget(){this.activeWidget?.destroy(),this.activeWidget=null,this.activeKey="",this.activeWidgetType=""}getDismissedWidgets(){try{const t=JSON.parse(localStorage.getItem(it)||"[]");if(!Array.isArray(t))return[];const e=Date.now(),i=t.filter(s=>s&&typeof s=="object").filter(s=>e-Number(s.dismissedAt||0)<re);return i.length!==t.length&&localStorage.setItem(it,JSON.stringify(i)),i.map(s=>String(s.widgetType||"")).filter(Boolean)}catch{return[]}}resolveTarget(t){return t==="bundle"?$(".product-form, [data-product-form]"):t==="rec_strip"?$(".product__description, [data-product-description]"):t==="social_proof"?$(".product-form__submit, [data-add-to-cart]"):t==="inline_alert"?$("[data-price], .product__price, .price, .product-form, [data-product-form]"):document.body}}function ae(r,t,e){if(r==="bundle"){const i=t.bundle;return String(i?.id||t.currentProductId||e||"product-bundle")}return e||r}function st(r,t){switch(r){case"chat":return new Rt(t);case"toast":return new te(t);case"countdown_banner":return new Gt(t);case"inline_alert":return new Jt(t);case"bundle":return new Ht(t);case"upsell_drawer":return new ee(t);case"discount_nudge":return new Yt(t);case"rec_strip":return new Qt(t);case"social_proof":return new Zt(t);case"exit_intent":return new Kt(t);case"post_purchase":return new Xt(t);default:return null}}function $(r){const t=document.querySelector(r),e=document.createElement("div");return e.setAttribute("data-aovboost-mount",r),t?.parentElement?(t.insertAdjacentElement("afterend",e),e):(document.body.appendChild(e),e)}let at=!1;function O(){at||(at=!0,oe().catch(r=>{console.log("AOVBoost SDK skipped:",r instanceof Error?r.message:String(r))}))}async function oe(){try{const r=window.AOVBoost||{},t=r.shop;if(!t)return;ot(r)||await ce(r);const e=ne(r.apiBase),i=new Et(t,e),s=new g({shop:t,sessionManager:i,apiBase:e}),a=new se,n=new It({shop:t,apiBase:e,eventBus:s,sessionManager:i,widgetManager:a}),d=new Vt({eventBus:s,offerPoller:n,sessionManager:i});await i.init(),window.AOVBoostSDK={shop:t,sessionId:i.anonymousId,sessionToken:i.getAuthPayload().sessionToken,refreshSession:async()=>{await i.refreshAuth(),i.syncGlobalSdkAuth()},getSignedAuthPayload:()=>i.getSignedAuthPayload(),applySession:u=>i.applyStorefrontSession(u),track:(u,l={})=>s.track(u,l),trigger:(u,l={})=>d.trigger(u,l),requestOffer:(u="global",l={})=>n.requestOffer(u,l),destroy:()=>{d.destroy(),n.destroy(),i.destroy(),a.destroyActive()}},d.init(),s.init(),n.init()}catch(r){console.log("AOVBoost SDK skipped:",r instanceof Error?r.message:String(r))}}function ne(r){const t=typeof r=="string"?r.trim():"";return!t||t==="/api"||t.startsWith("/api/")?"/apps/aovboost":t.includes("/apps/aovboost")||t.startsWith("/apps/")?t:"/apps/aovboost"}function ot(r){if(r.settings?.trackingConsentRequired!==!0)return!0;const t=window.Shopify?.customerPrivacy;return typeof t?.analyticsProcessingAllowed=="function"?!!t.analyticsProcessingAllowed():typeof t?.userCanBeTracked=="function"?!!t.userCanBeTracked():!0}function ce(r){return new Promise(t=>{const e=()=>{ot({...r,settings:{...r.settings,trackingConsentRequired:!1}})&&(i(),t())},i=()=>{["visitorConsentCollected","shopify:customer_privacy:consent_collected","aovboost:consent-granted"].forEach(s=>window.removeEventListener(s,e))};["visitorConsentCollected","shopify:customer_privacy:consent_collected","aovboost:consent-granted"].forEach(s=>window.addEventListener(s,e))})}return document.readyState==="loading"?document.addEventListener("DOMContentLoaded",O,{once:!0}):O(),f.init=O,Object.defineProperty(f,Symbol.toStringTag,{value:"Module"}),f}({});
