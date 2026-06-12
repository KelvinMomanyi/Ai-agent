var AOVBoostSDKBundle=function(p){"use strict";var ae=Object.defineProperty;var ne=(p,f,w)=>f in p?ae(p,f,{enumerable:!0,configurable:!0,writable:!0,value:w}):p[f]=w;var c=(p,f,w)=>ne(p,typeof f!="symbol"?f+"":f,w);class f{constructor(t){c(this,"queue",[]);c(this,"flushTimer");c(this,"scrollDepths",new Set);c(this,"originalFetch",null);c(this,"authFlushInFlight",!1);this.options=t}init(){this.installNavigationTracking(),this.installCartFetchTracking(),this.installCartDomTracking(),this.installScrollTracking(),this.installHoverTracking(),this.installSearchTracking(),document.addEventListener("add-to-cart",t=>{this.track("add_to_cart",w(t.detail))}),document.addEventListener("aovboost:track",t=>{const e=w(t.detail);this.track(String(e.type||"widget_event"),e)}),window.addEventListener("pagehide",()=>this.flush()),this.trackPageView()}track(t,e={}){const i={type:t,ts:Date.now(),sessionId:this.options.sessionManager.anonymousId,shop:this.options.shop,url:window.location.href,referrer:document.referrer,...e};this.options.sessionManager.recordEvent(i),this.queue.push(i),document.dispatchEvent(new CustomEvent("aovboost:event",{detail:i})),this.scheduleFlush()}flush(){if(this.flushTimer&&(window.clearTimeout(this.flushTimer),this.flushTimer=void 0),this.queue.length===0)return;if(!this.options.sessionManager.getAuthPayload().sessionToken){this.flushAfterAuth();return}const t=this.queue.splice(0);this.postEvents(t)}async flushAfterAuth(){if(!this.authFlushInFlight){this.authFlushInFlight=!0;try{await this.options.sessionManager.ensureAuthenticated()&&this.flush()}finally{this.authFlushInFlight=!1}}}scheduleFlush(){this.flushTimer||(this.flushTimer=window.setTimeout(()=>this.flush(),2e3))}endpoint(t){return`${(this.options.apiBase||"/apps/aovboost").replace(/\/$/,"")}${t}`}async postEvents(t,e=!1){const i=await this.options.sessionManager.getSignedAuthPayload();if(!i){this.queue.unshift(...t);return}try{const r=await fetch(this.endpoint("/events"),{method:"POST",headers:{"Content-Type":"application/json","X-AOVBoost-Shop":this.options.shop},body:JSON.stringify({...i,events:t}),keepalive:!0});if(r.status===401&&!e){if(await this.options.sessionManager.applySessionFromResponse(r)||await this.options.sessionManager.refreshAuth(),!this.options.sessionManager.getAuthPayload().sessionToken){this.queue.unshift(...t);return}await this.postEvents(t,!0);return}!r.ok&&r.status!==401&&this.queue.unshift(...t)}catch{this.queue.unshift(...t)}}installNavigationTracking(){const t=history.pushState,e=history.replaceState;history.pushState=(...i)=>{const r=t.apply(history,i);return window.setTimeout(()=>this.trackPageView(),0),r},history.replaceState=(...i)=>{const r=e.apply(history,i);return window.setTimeout(()=>this.trackPageView(),0),r},window.addEventListener("popstate",()=>this.trackPageView())}trackPageView(){this.track("page_view",{pageType:at()}),nt()&&this.track("checkout_start",{path:window.location.pathname});const t=rt();t&&this.track("product_view",{productId:pt(t.gid||t.id),handle:t.handle,title:t.title});const e=ot();(e||window.location.pathname.includes("/collections/"))&&this.track("collection_view",{collectionId:String(e?.id||""),handle:e?.handle||ct("/collections/"),title:e?.title})}installCartFetchTracking(){this.originalFetch||(this.originalFetch=window.fetch.bind(window),window.fetch=async(...t)=>{const e=dt(t[0]),i=t[1],r=await this.originalFetch(...t);try{E(e)?this.track("add_to_cart",{...V(i?.body),requestUrl:e}):lt(e)?this.track("remove_from_cart",{...V(i?.body),requestUrl:e}):ut(e)&&this.track("search",{query:ht(e),requestUrl:e})}catch{}return r})}installCartDomTracking(){document.addEventListener("submit",t=>{const e=t.target;if(!(!e||!E(e.action||"")))try{this.track("add_to_cart",{...V(new FormData(e)),source:"cart_form_submit",requestUrl:e.action})}catch{this.track("add_to_cart",{source:"cart_form_submit",requestUrl:e.action})}},!0),document.addEventListener("click",t=>{const i=t.target?.closest?.("button[name='add'], [type='submit'][name='add'], [data-add-to-cart]");if(!i)return;const r=i.closest("form");r&&!E(r.action||"")||this.track("add_to_cart",{source:"add_button_click",requestUrl:r?.action||""})},!0)}installScrollTracking(){let t=!1;window.addEventListener("scroll",()=>{t||(t=!0,window.setTimeout(()=>{t=!1;const e=document.documentElement.scrollHeight-window.innerHeight;if(e<=0)return;const i=Math.round(window.scrollY/e*100);[25,50,75,90].forEach(r=>{i>=r&&!this.scrollDepths.has(r)&&(this.scrollDepths.add(r),this.track("scroll_depth",{depth:r}))})},200))},{passive:!0})}installHoverTracking(){document.addEventListener("mouseenter",t=>{const i=t.target?.closest?.(".product-card");if(!i)return;const r=window.setTimeout(()=>{this.track("product_hover",{productId:i.dataset.productId||i.dataset.productGid||"",handle:i.dataset.productHandle||""})},800);i.addEventListener("mouseleave",()=>window.clearTimeout(r),{once:!0})},!0)}installSearchTracking(){document.addEventListener("input",t=>{const e=t.target;if(!e||!`${e.name||""} ${e.id||""} ${e.type||""}`.toLowerCase().includes("search"))return;const r=e.value.trim();r.length<2||this.track("search",{query:r,source:"predictive_input"})},!0)}}function w(s){return s&&typeof s=="object"&&!Array.isArray(s)?s:{}}function rt(){const s=window;return s.Shopify?.product||s.ShopifyAnalytics?.meta?.product||null}function ot(){const s=window;return s.Shopify?.collection||s.ShopifyAnalytics?.meta?.collection||null}function at(){return window.ShopifyAnalytics?.meta?.page?.pageType||document.body?.dataset?.template||(window.location.pathname==="/"?"home":"other")}function nt(){return/\/checkout(?:\/|$)/.test(window.location.pathname)}function ct(s){const t=window.location.pathname.indexOf(s);return t===-1?"":window.location.pathname.slice(t+s.length).split("/")[0]||""}function dt(s){return typeof s=="string"?s:s instanceof URL?s.toString():s.url||""}function E(s){return/\/cart\/add(?:\.js)?/.test(s)}function lt(s){return/\/cart\/(?:change|update)(?:\.js)?/.test(s)}function ut(s){return s.includes("/search/suggest.json")}function ht(s){try{return new URL(s,window.location.origin).searchParams.get("q")||""}catch{return""}}function V(s){if(!s)return{};if(typeof FormData<"u"&&s instanceof FormData)return{variantId:String(s.get("id")||s.get("items[0][id]")||""),quantity:Number(s.get("quantity")||1)};if(typeof URLSearchParams<"u"&&s instanceof URLSearchParams)return{variantId:String(s.get("id")||s.get("items[0][id]")||""),quantity:Number(s.get("quantity")||1)};try{const t=String(s);if(t.trim().startsWith("{")){const i=JSON.parse(t);return{productId:i.productId||i.product_id,variantId:i.id||i.items?.[0]?.id,quantity:i.quantity||i.items?.[0]?.quantity||1}}const e=new URLSearchParams(t);return{variantId:String(e.get("id")||e.get("items[0][id]")||""),quantity:Number(e.get("quantity")||1)}}catch{return{}}}function pt(s){const t=String(s||"");return t?t.startsWith("gid://shopify/Product/")?t:`gid://shopify/Product/${t}`:""}const O="aovboost_dismissed_widgets",ft="USD";class h{constructor(t){c(this,"root");c(this,"container");this.payload=t,this.container=document.createElement("div"),this.container.setAttribute("data-aovboost-widget",this.getWidgetType()),this.root=this.container.attachShadow({mode:"open"}),this.injectStyles()}destroy(){this.container.remove()}mount(t=document.body){t.appendChild(this.container),this.render(),this.trackImpression()}injectStyles(){const t=document.createElement("style");t.textContent=_t,this.root.appendChild(t)}trackImpression(){this.track("widget_impression",{})}trackClick(t){this.track("widget_click",{action:t})}trackDismiss(){this.track("widget_dismiss",{});try{const t=JSON.parse(localStorage.getItem(O)||"[]"),i=[...(Array.isArray(t)?t.filter(r=>typeof r=="object"&&r):[]).filter(r=>r.widgetType!==this.getWidgetType()),{widgetType:this.getWidgetType(),dismissedAt:Date.now()}];localStorage.setItem(O,JSON.stringify(i))}catch{}}track(t,e){const i=window.AOVBoostSDK?.track,r={type:t,widgetType:this.getWidgetType(),offerId:this.payload.offerId,...e};if(typeof i=="function"){i(t,r);return}document.dispatchEvent(new CustomEvent("aovboost:track",{detail:r}))}html(t){const e=this.root.querySelector("[data-aovboost-content]");e&&e.remove();const i=document.createElement("div");i.setAttribute("data-aovboost-content","true"),i.innerHTML=t,this.root.appendChild(i)}}function a(s,t=""){return bt(typeof s=="string"&&s.trim()?s:t)}function x(){const s=window.AOVBoost||{},t=window.Shopify||{},e=window.ShopifyAnalytics||{},r=[{value:s.currency,source:"aovboost_config"},{value:s.currencyCode,source:"aovboost_config"},{value:t.currency?.active,source:"shopify_currency"},{value:t.checkout?.currency,source:"shopify_checkout"},{value:e.meta?.currency,source:"shopify_analytics"}].find(n=>I(n.value,"")!=="");return{code:I(r?.value),source:r?.source||"fallback",moneyFormat:L(s.moneyFormat),moneyWithCurrencyFormat:L(s.moneyWithCurrencyFormat),locale:L(s.locale)||document.documentElement.lang||navigator.language}}function j(s){const t=I(s,"");if(!t)return;const e=window.AOVBoost||{};window.AOVBoost={...e,currency:t}}function v(s,t=x()){const e=Number(s||0);if(!Number.isFinite(e))return"";const i=mt(t),r=i.moneyFormat||i.moneyWithCurrencyFormat||"";if(r)return gt(e,r,i.code);try{return new Intl.NumberFormat(i.locale||void 0,{style:"currency",currency:i.code,currencyDisplay:"symbol"}).format(e)}catch{return`${i.code} ${e.toFixed(2)}`.trim()}}function mt(s){if(typeof s=="string")return{...x(),code:I(s)};const t=x();return{...t,...s,code:s.code===void 0?t.code:I(s.code)}}function I(s,t=ft){const e=String(s||"").trim().toUpperCase();return/^[A-Z]{3}$/.test(e)?e:t}function L(s){return typeof s=="string"&&s.trim()?s.trim():""}function gt(s,t,e){const i=wt(t),r=i.match(/\{\{\s*(amount[a-z_]*)\s*\}\}/i),o=r?.[1]||"amount",n=yt(s,o);return(r?i.replace(r[0],n):`${i}${n}`).replace(/\{\{\s*currency\s*\}\}/gi,e)}function yt(s,t){switch(t){case"amount_no_decimals":return b(s,0,",",".");case"amount_with_comma_separator":return b(s,2,".",",");case"amount_no_decimals_with_comma_separator":return b(s,0,".",",");case"amount_with_apostrophe_separator":return b(s,2,"'",".");case"amount_no_decimals_with_space_separator":return b(s,0," ",".");case"amount_with_space_separator":return b(s,2," ",".");default:return b(s,2,",",".")}}function b(s,t,e,i){const r=t>0?s.toFixed(t):String(Math.round(s)),[o,n]=r.split("."),d=o.replace(/\B(?=(\d{3})+(?!\d))/g,e);return n?`${d}${i}${n}`:d}function wt(s){return s.replace(/<[^>]*>/g,"").replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/&quot;/gi,'"').replace(/&#39;/g,"'")}function T(s){const e=[s.products,s.bundle?.items,s.items].find(i=>Array.isArray(i));return Array.isArray(e)?e.map(i=>{const r=i.product||i.target||i;return{id:r.id||i.productId||i.targetId,variantId:r.variantId||i.variantId||"",title:r.title||i.title||"Recommended product",handle:r.handle||i.handle||"",imageUrl:r.imageUrl||r.image||i.imageUrl||i.image,price:r.price||i.price||"",quantity:i.quantity||1,reason:i.reason||i.affinity?.reason||i.reasoning||"",orderCount:i.orderCount||i.affinity?.orderCount||0}}):[]}async function D(s,t=1){if(!s)return null;const e=String(s).split("/").pop(),i=await fetch("/cart/add.js",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:e,quantity:t})});return i.ok?i.json():null}async function vt(s){const t=s.filter(i=>i.variantId).map(i=>({id:String(i.variantId).split("/").pop(),quantity:i.quantity||1}));if(t.length===0)return null;const e=await fetch("/cart/add.js",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({items:t})});return e.ok?e.json():null}function bt(s){return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;")}const _t=`
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
`;class St{constructor(t){c(this,"timer");c(this,"inFlight",!1);c(this,"stopped",!1);c(this,"options");this.options=t}init(){window.setTimeout(()=>this.requestOffer("initial"),1200),this.options.pollMs&&(this.timer=window.setInterval(()=>this.requestOffer("poll"),this.options.pollMs)),document.addEventListener("aovboost:request-offer",()=>{this.requestOffer("manual")}),window.addEventListener("popstate",()=>{window.setTimeout(()=>this.requestOffer("navigation"),300)})}destroy(){this.stopped=!0,this.timer&&window.clearInterval(this.timer)}async requestOffer(t="manual",e={}){if(this.inFlight||this.stopped)return null;this.inFlight=!0;try{const i=this.options.sessionManager.getSnapshot(),r=await Tt(),o=r.cartItemCount>0||r.cartValue>0,n=Array.isArray(e.cartProductIds)?e.cartProductIds.map(String):o?r.cartProductIds:i.cartProductIds,d=Array.isArray(e.cartVariantIds)?e.cartVariantIds.map(String):o?r.cartVariantIds:Array.isArray(i.context.cartVariantIds)?i.context.cartVariantIds.map(String):[],u=Array.isArray(e.cartItems)?e.cartItems:o?r.cartItems:[],l=typeof e.cartItemCount=="number"?e.cartItemCount:o?r.cartItemCount:Number(i.context.cartItemCount||0),g=typeof e.cartValue=="number"?e.cartValue:o?r.cartValue:i.cartValue,_=await this.options.sessionManager.getSignedAuthPayload();if(!_)return this.mountLocalFallback(t,e);const S=x(),$={..._,currentProductId:It(),currentPageType:xt(),cartProductIds:n,cartVariantIds:d,cartItems:u,cartItemCount:l,cartValue:g,currency:S.code,moneyFormat:S.moneyFormat,moneyWithCurrencyFormat:S.moneyWithCurrencyFormat,locale:S.locale,dismissedWidgets:this.options.widgetManager.getDismissedWidgets(),trigger:t,triggerCategory:e.triggerCategory,triggerPayload:e};let y=await fetch(this.endpoint("/offer"),{method:"POST",headers:{"Content-Type":"application/json","X-AOVBoost-Shop":this.options.shop},body:JSON.stringify({...$,..._}),keepalive:!0});if(y.status===401){await this.options.sessionManager.applySessionFromResponse(y)||await this.options.sessionManager.refreshAuth();const C=await this.options.sessionManager.getSignedAuthPayload();if(!C)return this.mountLocalFallback(t,e);y=await fetch(this.endpoint("/offer"),{method:"POST",headers:{"Content-Type":"application/json","X-AOVBoost-Shop":this.options.shop},body:JSON.stringify({...$,...C}),keepalive:!0})}if(!y.ok)return this.mountLocalFallback(t,e);const k=await y.json();return k.widgetType?(this.options.widgetManager.mountDecision(k),k):this.mountLocalFallback(t,e)}catch{return this.mountLocalFallback(t,e)}finally{this.inFlight=!1}}endpoint(t){return`${this.options.apiBase.replace(/\/$/,"")}${t}`}mountLocalFallback(t,e){const i=kt(t,e);return i?(this.options.widgetManager.mountDecision(i),i):null}}function kt(s,t){const e=Number(t.cartValue||0);switch(s){case"first_time_visitor":case"long_product_dwell":case"scroll_depth_interest":case"comparison_page_visit":case"inactivity_timeout":case"purchase_history_match":case"loyalty_tier_reached":case"crm_segment_update":return{widgetType:"chat",payload:{offerId:`local:${s}`,greeting:"Hi. I can help you compare products and find useful add-ons.",copy:{greeting:"Hi. I can help you compare products and find useful add-ons.",ctaAccept:"Chat with AI",ctaDecline:"Browse myself"}},reasoning:"Local fallback for proactive chat trigger.",confidence:.4,aiProvider:"heuristic"};case"exit_intent":return{widgetType:"exit_intent",payload:{offerId:"local:exit_intent",immediate:!0,offerLine:"Before you go, I can help find a better match or bundle.",copy:{headline:"Wait before you go",offerLine:"I can help find a better match or bundle.",ctaText:"Open assistant",dismissText:"No thanks"}},reasoning:"Local fallback for exit intent.",confidence:.4,aiProvider:"heuristic"};case"cart_value_threshold":case"cart_abandoned":return{widgetType:"discount_nudge",payload:{offerId:`local:${s}`,cartValue:e,threshold:Number(t.threshold||50),copy:{progressLabel:"You are close to a reward",rewardDescription:"Add one more item to unlock the offer.",ctaText:"View picks"}},reasoning:"Local fallback for cart value or idle cart trigger.",confidence:.4,aiProvider:"heuristic"};case"flash_sale_window":case"seasonal_calendar":return{widgetType:"countdown_banner",payload:{offerId:`local:${s}`,endsAt:t.endsAt,body:"Limited-time product picks are available right now.",copy:{headline:"Limited-time offer",subheadline:"Relevant bundles and add-ons are available now.",ctaText:"View offer"}},reasoning:"Local fallback for scheduled campaign trigger.",confidence:.4,aiProvider:"heuristic"};case"low_inventory_alert":case"price_drop_webhook":return{widgetType:"inline_alert",payload:{offerId:`local:${s}`,body:s==="price_drop_webhook"?"The price on this product has changed.":"Inventory is limited for this product.",copy:{headline:s==="price_drop_webhook"?"Price update":"Limited stock",subheadline:s==="price_drop_webhook"?"The price on this product has changed.":"Inventory is limited for this product."}},reasoning:"Local fallback for system alert trigger.",confidence:.4,aiProvider:"heuristic"};case"cart_item_added":case"cart_item_removed":case"search_query":case"repeated_product_view":case"price_hesitation":case"wishlist_save":case"coupon_field_focus":case"subscription_renewal_due":case"payment_failure":return{widgetType:"toast",payload:{offerId:`local:${s}`,headline:W(s),body:H(s),copy:{headline:W(s),subheadline:H(s),ctaText:"Open assistant",dismissText:"No thanks"}},reasoning:"Local fallback for low-disruption trigger.",confidence:.4,aiProvider:"heuristic"};default:return null}}function W(s){return s==="cart_item_added"?"Complete the set":s==="coupon_field_focus"?"Looking for a code?":s==="price_hesitation"?"Need a better fit?":s==="wishlist_save"?"Saved for later":s==="search_query"?"Need help choosing?":"Need help deciding?"}function H(s){return s==="cart_item_added"?"I can help find matching accessories or add-ons.":s==="cart_item_removed"?"I can help find a better alternative.":s==="coupon_field_focus"?"I can help find a relevant offer or lower-priced option.":s==="price_hesitation"?"I can help compare value and find a lower-priced alternative.":s==="wishlist_save"?"I can compare this with related products when you are ready.":"I can help find the right product or useful add-on."}function xt(){const s=window.location.pathname,t=String(window.ShopifyAnalytics?.meta?.page?.pageType||document.body?.dataset?.template||"").toLowerCase();return s==="/"?"home":/\/collections(?:\/|$)/.test(s)||t.includes("collection")?"collection":/\/products(?:\/|$)/.test(s)||t.includes("product")?"product":/\/cart(?:\/|$)/.test(s)||t.includes("cart")?"cart":/\/checkout(?:\/|$)/.test(s)?"checkout":/\/thank_you(?:\/|$)/.test(s)||window.Shopify?.checkout?"thankyou":"other"}function It(){const s=window.Shopify?.product||window.ShopifyAnalytics?.meta?.product||null;if(!s)return;const t=String(s.gid||s.id||"");if(t)return t.startsWith("gid://shopify/Product/")?t:`gid://shopify/Product/${t}`}async function Tt(){try{const s=await fetch("/cart.js",{headers:{Accept:"application/json"},keepalive:!0});if(!s.ok)throw new Error(`Cart read failed: ${s.status}`);const t=await s.json();j(t.currency);const e=Array.isArray(t.items)?t.items:[],i=e.map(o=>R(o)).filter(Boolean),r=e.map(o=>z(o)).filter(Boolean);return{cartToken:t.token||"",cartProductIds:i,cartVariantIds:r,cartItems:e.map(o=>({productId:R(o),variantId:z(o),quantity:Number(o.quantity||1),title:String(o.product_title||o.title||""),handle:String(o.handle||o.url||"").split("/products/")[1]?.split(/[?#/]/)[0]||""})),cartItemCount:Number(t.item_count||e.length||0),cartValue:Number(t.total_price||0)/100,currency:String(t.currency||"")}}catch{return{cartToken:"",cartProductIds:[],cartVariantIds:[],cartItems:[],cartItemCount:0,cartValue:0,currency:""}}}function Ct(s){const t=String(s||"");return t?t.startsWith("gid://shopify/Product/")?t:`gid://shopify/Product/${t}`:""}function At(s){const t=String(s||"");return t?t.startsWith("gid://shopify/ProductVariant/")?t:`gid://shopify/ProductVariant/${t}`:""}function R(s){const t=U(s.product);return Ct(s.product_id||s.productId||s.product_gid||s.productGid||t.id)}function z(s){const t=U(s.variant);return At(s.variant_id||s.variantId||s.id||s.variant_gid||s.variantGid||t.id)}function U(s){return s&&typeof s=="object"&&!Array.isArray(s)?s:{}}const M="aovboost_anonymous_id",q="aovboost_storefront_session";class Pt{constructor(t,e="/apps/aovboost"){c(this,"anonymousId","");c(this,"sessionToken","");c(this,"journeyStage","discovering");c(this,"viewedProductIds",new Set);c(this,"productViewCounts",new Map);c(this,"cartProductIds",new Set);c(this,"cartVariantIds",new Set);c(this,"cartItemCount",0);c(this,"pageViews",0);c(this,"maxScrollDepth",0);c(this,"cartActionCount",0);c(this,"cartValue",0);c(this,"startedAt",Date.now());c(this,"lastCartActionAt",0);c(this,"lastEventType","");c(this,"syncTimer");c(this,"authRefreshPromise");this.shop=t,this.apiBase=e}async init(){await this.ensureAuthenticated()||this.bootstrapLocalSession(),this.syncTimer=window.setInterval(()=>this.sync(),3e4),window.addEventListener("pagehide",()=>this.sync())}destroy(){this.syncTimer&&window.clearInterval(this.syncTimer)}recordEvent(t){if(this.lastEventType=t.type,t.type==="page_view"&&(this.pageViews+=1),t.type==="product_view"){const e=N(t);e&&(this.viewedProductIds.add(e),this.productViewCounts.set(e,(this.productViewCounts.get(e)||0)+1))}if(t.type==="scroll_depth"&&(this.maxScrollDepth=Math.max(this.maxScrollDepth,Number(t.depth||0))),t.type==="add_to_cart"){this.cartActionCount+=1,this.lastCartActionAt=Date.now();const e=N(t);e&&this.cartProductIds.add(e),Array.isArray(t.cartProductIds)&&t.cartProductIds.forEach(i=>this.cartProductIds.add(String(i))),Array.isArray(t.cartVariantIds)&&t.cartVariantIds.forEach(i=>this.cartVariantIds.add(String(i))),this.cartItemCount=Math.max(this.cartItemCount,Number(t.cartItemCount||this.cartItemCount)),this.cartValue=Math.max(this.cartValue,Number(t.cartValue||0)),this.journeyStage="buying"}if(t.type==="cart_update"&&(this.lastCartActionAt=Date.now(),Array.isArray(t.cartProductIds)&&(this.cartProductIds=new Set(t.cartProductIds.map(String))),Array.isArray(t.cartVariantIds)&&(this.cartVariantIds=new Set(t.cartVariantIds.map(String))),this.cartItemCount=Number(t.cartItemCount||this.cartProductIds.size),this.cartValue=Number(t.cartValue||0),(this.cartProductIds.size>0||this.cartItemCount>0)&&(this.journeyStage="buying")),t.type==="remove_from_cart"){this.cartActionCount+=1,this.lastCartActionAt=Date.now();const e=N(t);e&&this.cartProductIds.delete(e)}this.updateJourneyStage()}getSnapshot(){const t=Math.round((Date.now()-this.startedAt)/1e3),e=Array.from(this.productViewCounts.values()).reduce((d,u)=>d+u,0),i=Y(this.pageViews*2+e*5+(this.maxScrollDepth>=90?10:this.maxScrollDepth>=75?8:this.maxScrollDepth>=50?5:this.maxScrollDepth>=25?3:0)+Math.min(t/120,1)*30+(this.cartProductIds.size>0?30:0),0,100),r=Array.from(this.productViewCounts.entries()).some(([d,u])=>u>=2&&!this.cartProductIds.has(d)),o=this.lastCartActionAt?(Date.now()-this.lastCartActionAt)/1e3:t,n=Y((i>40&&this.cartActionCount===0&&o>=90?55:0)+(r?35:0),0,100);return{anonymousId:this.anonymousId,journeyStage:this.journeyStage,intentScore:i,hesitationScore:n,viewedProductIds:Array.from(this.viewedProductIds),cartProductIds:Array.from(this.cartProductIds),totalPageViews:this.pageViews,sessionDuration:t,cartValue:this.cartValue,context:{maxScrollDepth:this.maxScrollDepth,productViewCounts:Object.fromEntries(this.productViewCounts),cartActionCount:this.cartActionCount,cartItemCount:this.cartItemCount,cartVariantIds:Array.from(this.cartVariantIds),cartValue:this.cartValue,lastEventType:this.lastEventType}}}getAuthPayload(){return{sessionId:this.anonymousId,sessionToken:this.sessionToken,shop:this.shop}}async getSignedAuthPayload(){return!await this.ensureAuthenticated()||!this.anonymousId||!this.sessionToken?null:this.getAuthPayload()}async ensureAuthenticated(){if(this.sessionToken)return!0;try{await this.ensureStorefrontSession()}catch{await this.refreshAuth()}return!!this.sessionToken}async refreshAuth(){return this.authRefreshPromise?this.authRefreshPromise:(this.authRefreshPromise=this.refreshAuthInternal().finally(()=>{this.authRefreshPromise=void 0}),this.authRefreshPromise)}async refreshAuthInternal(){const t=this.anonymousId,e=this.sessionToken;try{window.localStorage.removeItem(q)}catch{}try{await this.ensureStorefrontSession({forceRefresh:!0})}catch{e?(this.anonymousId=t,this.sessionToken=e):this.bootstrapLocalSession()}this.syncGlobalSdkAuth()}applyStorefrontSession(t){const e=$t(t);return!e||e.shop!==this.shop||!e.sessionId||!e.sessionToken||Number(e.expiresAt||0)<=Math.floor(Date.now()/1e3)+60?!1:(this.anonymousId=e.sessionId,this.sessionToken=e.sessionToken,this.storeStorefrontSession(e),this.syncGlobalSdkAuth(),!0)}async applySessionFromResponse(t){try{const e=await t.clone().json(),i=G(e);return this.applyStorefrontSession(i?.storefrontSession||i?.session||e)}catch{return!1}}syncGlobalSdkAuth(){const t=window.AOVBoostSDK;!t||typeof t!="object"||(t.sessionId=this.anonymousId,t.sessionToken=this.sessionToken)}sync(){if(!this.anonymousId||!this.sessionToken){this.ensureAuthenticated();return}const t=this.getSnapshot(),e=JSON.stringify({...this.getAuthPayload(),events:[{type:"session_sync",ts:Date.now(),sessionId:this.anonymousId,shop:this.shop,url:window.location.href,referrer:document.referrer,snapshot:t,...t}]});fetch(this.endpoint("/events"),{method:"POST",headers:{"Content-Type":"application/json","X-AOVBoost-Shop":this.shop},body:e,keepalive:!0}).then(i=>{i.status===401&&this.refreshAuth()}).catch(()=>{})}updateJourneyStage(){if(this.cartProductIds.size>0){this.journeyStage="buying";return}if(this.cartItemCount>0){this.journeyStage="buying";return}if(this.getSnapshotDuration()>=60||Array.from(this.productViewCounts.values()).some(t=>t>=2)){this.journeyStage="deciding";return}if(this.viewedProductIds.size>=3){this.journeyStage="comparing";return}this.journeyStage="discovering"}endpoint(t){return`${this.apiBase.replace(/\/$/,"")}${t}`}async ensureStorefrontSession(t={}){const e=t.forceRefresh?null:this.getStoredStorefrontSession();if(e){this.anonymousId=e.sessionId,this.sessionToken=e.sessionToken;return}const i=await fetch(this.endpoint("/session"),{method:"GET",headers:{Accept:"application/json"}});if(!i.ok)throw new Error(`Session bootstrap failed: ${i.status}`);const r=await i.json();if(!this.applyStorefrontSession(r))throw new Error("Invalid storefront session bootstrap response")}getStoredStorefrontSession(){try{const t=JSON.parse(window.localStorage.getItem(q)||"null");return!t||t.shop!==this.shop||!t.sessionId||!t.sessionToken||Number(t.expiresAt||0)<=Math.floor(Date.now()/1e3)+60?null:t}catch{return null}}storeStorefrontSession(t){try{window.localStorage.setItem(q,JSON.stringify(t)),window.localStorage.setItem(M,t.sessionId)}catch{}}bootstrapLocalSession(){let t="";try{t=window.localStorage.getItem(M)||"",t||(t=typeof crypto<"u"&&"randomUUID"in crypto?crypto.randomUUID():`local-${Date.now()}-${Math.random().toString(36).slice(2)}`,window.localStorage.setItem(M,t))}catch{t=`local-${Date.now()}-${Math.random().toString(36).slice(2)}`}this.anonymousId=t,this.sessionToken=""}getSnapshotDuration(){return Math.round((Date.now()-this.startedAt)/1e3)}}function $t(s){const t=G(s);return t?{shop:String(t.shop||""),sessionId:String(t.sessionId||""),sessionToken:String(t.sessionToken||""),expiresAt:Number(t.expiresAt||0)}:null}function G(s){return s&&typeof s=="object"&&!Array.isArray(s)?s:null}function N(s){const t=s.product;return String(s.productId||s.product_id||t?.id||"")}function Y(s,t,e){return Math.min(Math.max(s,t),e)}const K=10*60*1e3,J=5*60*1e3,X=30*1e3,Et={long_product_dwell:{category:"browsing_behavior",widgetHint:"chat",throttleMs:60*1e3},repeated_product_view:{category:"browsing_behavior",widgetHint:"bundle",throttleMs:60*1e3},scroll_depth_interest:{category:"browsing_behavior",widgetHint:"chat",oncePerSession:!0},comparison_page_visit:{category:"browsing_behavior",widgetHint:"chat",oncePerSession:!0},search_query:{category:"browsing_behavior",widgetHint:"rec_strip",throttleMs:15*1e3},exit_intent:{category:"browsing_behavior",widgetHint:"exit_intent",oncePerSession:!0},cart_item_added:{category:"cart_checkout",widgetHint:"upsell_drawer",throttleMs:2500,requestDelayMs:50},cart_abandoned:{category:"cart_checkout",widgetHint:"discount_nudge",oncePerSession:!0},cart_value_threshold:{category:"cart_checkout",widgetHint:"discount_nudge",throttleMs:30*1e3},cart_item_removed:{category:"cart_checkout",widgetHint:"rec_strip",throttleMs:5e3},checkout_started:{category:"cart_checkout",widgetHint:"upsell_drawer",oncePerSession:!0},price_hesitation:{category:"user_intent",widgetHint:"toast",throttleMs:30*1e3},price_sensitive_chat:{category:"user_intent",widgetHint:"toast",requestOffer:!1,throttleMs:30*1e3},wishlist_save:{category:"user_intent",widgetHint:"toast",throttleMs:30*1e3},coupon_field_focus:{category:"user_intent",widgetHint:"toast",oncePerSession:!0},purchase_history_match:{category:"customer_profile_loyalty",widgetHint:"chat",throttleMs:60*1e3},loyalty_tier_reached:{category:"customer_profile_loyalty",widgetHint:"chat",throttleMs:60*1e3},subscription_renewal_due:{category:"customer_profile_loyalty",widgetHint:"toast",throttleMs:60*1e3},first_time_visitor:{category:"customer_profile_loyalty",widgetHint:"chat",oncePerSession:!0},flash_sale_window:{category:"time_based",widgetHint:"countdown_banner",oncePerSession:!0},post_purchase_window:{category:"time_based",widgetHint:"post_purchase",oncePerSession:!0},inactivity_timeout:{category:"time_based",widgetHint:"chat",oncePerSession:!0},seasonal_calendar:{category:"time_based",widgetHint:"countdown_banner",oncePerSession:!0},low_inventory_alert:{category:"external_system",widgetHint:"inline_alert",throttleMs:60*1e3},price_drop_webhook:{category:"external_system",widgetHint:"inline_alert",throttleMs:60*1e3},crm_segment_update:{category:"external_system",widgetHint:"chat",throttleMs:60*1e3},payment_failure:{category:"external_system",widgetHint:"toast",throttleMs:60*1e3}};class Vt{constructor(t){c(this,"abortController",new AbortController);c(this,"firedAt",new Map);c(this,"timers",new Map);c(this,"activePriceTarget",null);c(this,"options");c(this,"handleStorefrontEvent",t=>{const e=m(t.detail);e.type&&(e.type==="product_view"&&(this.scheduleProductDwell(String(e.productId||"")),this.handleRepeatedProductView(String(e.productId||""))),e.type==="scroll_depth"&&Number(e.depth||0)>=75&&this.fire("scroll_depth_interest",{depth:Number(e.depth||0)}),e.type==="search"&&String(e.query||"").trim().length>=2&&this.fire("search_query",{query:String(e.query||"").trim()}),e.type==="add_to_cart"&&this.syncCartAndFire("cart_item_added",e),e.type==="remove_from_cart"&&this.syncCartAndFire("cart_item_removed",e),e.type==="cart_update"&&this.handleCartState(e),e.type==="checkout_start"&&this.fire("checkout_started",{path:e.path||window.location.pathname}))});c(this,"handleCustomTrigger",t=>{const e=m(t.detail),i=String(e.type||e.trigger||"").trim();i&&this.fire(i,e)});c(this,"handleProfileEvent",t=>{const e=m(t.detail),i=String(e.type||"crm_segment_update");this.fire(i,e)});c(this,"handleSystemEvent",t=>{const e=m(t.detail),i=String(e.type||"external_system_event");this.fire(i,e)});this.options=t}init(){document.addEventListener("aovboost:event",this.handleStorefrontEvent,{signal:this.abortController.signal}),document.addEventListener("aovboost:trigger",this.handleCustomTrigger,{signal:this.abortController.signal}),document.addEventListener("aovboost:profile-event",this.handleProfileEvent,{signal:this.abortController.signal}),document.addEventListener("aovboost:system-event",this.handleSystemEvent,{signal:this.abortController.signal}),this.installProductDwellTracking(),this.installComparisonTracking(),this.installExitIntentTracking(),this.installPriceHoverTracking(),this.installCouponFocusTracking(),this.installWishlistTracking(),this.installInactivityTracking(),this.installFirstTimeVisitorTracking(),this.installInitialCartTracking(),this.installPostPurchaseTracking(),this.installScheduledCampaignTracking()}destroy(){this.abortController.abort(),this.timers.forEach(t=>window.clearTimeout(t)),this.timers.clear()}trigger(t,e={}){this.fire(t,e)}installProductDwellTracking(){this.scheduleProductDwell(A())}scheduleProductDwell(t){this.clearTimer("product_dwell"),!(!t||!qt())&&this.setTimer("product_dwell",()=>{this.fire("long_product_dwell",{productId:t,dwellSeconds:X/1e3})},X)}handleRepeatedProductView(t){if(!t)return;const e=m(this.options.sessionManager.getSnapshot().context.productViewCounts),i=Number(e[t]||0);i>=2&&this.fire("repeated_product_view",{productId:t,viewCount:i})}installComparisonTracking(){const t=`${window.location.pathname} ${document.title}`.toLowerCase();/\b(compare|comparison|versus|vs|alternative|competitor)\b/.test(t)&&window.setTimeout(()=>{this.fire("comparison_page_visit",{path:window.location.pathname})},800)}installExitIntentTracking(){document.addEventListener("mouseleave",t=>{t.clientY<=8&&this.fire("exit_intent",{immediate:!0,path:window.location.pathname})},{signal:this.abortController.signal})}installPriceHoverTracking(){document.addEventListener("mouseover",t=>{const e=Bt(t.target);!e||e===this.activePriceTarget||(this.activePriceTarget=e,this.clearTimer("price_hover"),this.setTimer("price_hover",()=>{this.fire("price_hesitation",{productId:A(),priceText:e.textContent?.trim().slice(0,80)||""})},1200))},{signal:this.abortController.signal}),document.addEventListener("mouseout",t=>{const e=this.activePriceTarget;if(!e)return;const i=t.relatedTarget;i&&e.contains(i)||(this.activePriceTarget=null,this.clearTimer("price_hover"))},{signal:this.abortController.signal})}installCouponFocusTracking(){document.addEventListener("focusin",t=>{const e=t.target;!e||!Ot(e)||this.fire("coupon_field_focus",{fieldName:e.name||e.id||""})},{signal:this.abortController.signal})}installWishlistTracking(){document.addEventListener("click",t=>{t.target?.closest?.("[data-wishlist], [data-save-product], .wishlist, .wishlist-button, [aria-label*='wishlist'], [aria-label*='Wishlist'], [aria-label*='save'], [aria-label*='Save']")&&this.fire("wishlist_save",{productId:A()})},{signal:this.abortController.signal})}installInactivityTracking(){const t=()=>{this.clearTimer("inactivity"),this.setTimer("inactivity",()=>{this.fire("inactivity_timeout",{idleSeconds:J/1e3})},J)};["click","keydown","scroll","touchstart"].forEach(e=>{window.addEventListener(e,t,{passive:!0,signal:this.abortController.signal})}),t()}installFirstTimeVisitorTracking(){try{const t="aovboost_returning_visitor";if(window.localStorage.getItem(t)==="true")return;window.localStorage.setItem(t,"true"),window.setTimeout(()=>{this.fire("first_time_visitor",{path:window.location.pathname})},1800)}catch{}}installInitialCartTracking(){/\/cart(?:\/|$)/.test(window.location.pathname)&&window.setTimeout(async()=>{const t=await this.readCart();if(t.cartItemCount<=0)return;const e={...t,source:"initial_cart_state"};this.options.eventBus.track("cart_update",e),this.fire("cart_item_added",e),this.handleCartState(e)},900)}installPostPurchaseTracking(){Nt()&&window.setTimeout(()=>{this.fire("post_purchase_window",{path:window.location.pathname})},1200)}installScheduledCampaignTracking(){const t=m(window.AOVBoost?.campaign),e=String(t.type||"");if(!e)return;const i=Date.parse(String(t.startsAt||"")),r=Date.parse(String(t.endsAt||"")),o=Date.now();(!Number.isFinite(i)||i<=o)&&(!Number.isFinite(r)||r>o)&&this.fire(e==="seasonal"?"seasonal_calendar":"flash_sale_window",{campaign:t,endsAt:t.endsAt})}syncCartAndFire(t,e){window.setTimeout(async()=>{const i=await this.readCart(),r={...e,...i};this.fire(t,r),(i.cartProductIds.length>0||i.cartValue>0)&&this.options.eventBus.track("cart_update",r),this.handleCartState(r)},350)}async readCart(){try{const t=await fetch("/cart.js",{headers:{Accept:"application/json"},keepalive:!0});if(!t.ok)throw new Error(`Cart read failed: ${t.status}`);const e=await t.json();j(e.currency);const i=Array.isArray(e.items)?e.items:[],r=i.map(n=>Z(n)).filter(Boolean),o=i.map(n=>tt(n)).filter(Boolean);return{cartToken:e.token||"",cartProductIds:r,cartVariantIds:o,cartItems:i.map(n=>({productId:Z(n),variantId:tt(n),quantity:Number(n.quantity||1),title:String(n.product_title||n.title||""),handle:String(n.handle||n.url||"").split("/products/")[1]?.split(/[?#/]/)[0]||""})),cartItemCount:Number(e.item_count||i.length||0),cartValue:Number(e.total_price||0)/100,currency:String(e.currency||"")}}catch{return{cartToken:"",cartProductIds:[],cartVariantIds:[],cartItems:[],cartItemCount:0,cartValue:0,currency:""}}}handleCartState(t){const e=Number(t.cartValue||0),i=Number(t.cartItemCount||0);e>0&&this.fire("cart_value_threshold",t),this.clearTimer("cart_idle"),i>0&&this.setTimer("cart_idle",()=>{this.fire("cart_abandoned",{...t,idleSeconds:K/1e3})},K)}fire(t,e={}){const i=Lt(t),r=Date.now(),o=i.throttleMs??10*1e3,n=this.firedAt.get(t)||0;if(r-n<o||i.oncePerSession&&Dt(t))return;i.oncePerSession&&Mt(t),this.firedAt.set(t,r);const d={...e,triggerType:t,triggerCategory:i.category,widgetHint:i.widgetHint};this.options.eventBus.track(t,d),i.requestOffer!==!1&&window.setTimeout(()=>{this.options.offerPoller.requestOffer(t,d)},i.requestDelayMs??150)}setTimer(t,e,i){this.clearTimer(t),this.timers.set(t,window.setTimeout(e,i))}clearTimer(t){const e=this.timers.get(t);e&&window.clearTimeout(e),this.timers.delete(t)}}function Lt(s){return Et[s]||{category:"external_system",widgetHint:"chat",throttleMs:3e4}}function m(s){return s&&typeof s=="object"&&!Array.isArray(s)?s:{}}function Dt(s){try{return sessionStorage.getItem(`aovboost_trigger:${s}`)==="true"}catch{return!1}}function Mt(s){try{sessionStorage.setItem(`aovboost_trigger:${s}`,"true")}catch{}}function qt(){return/\/products(?:\/|$)/.test(window.location.pathname)||!!A()}function Nt(){return/\/thank_you(?:\/|$)/.test(window.location.pathname)||!!window.Shopify?.checkout}function A(){const s=window.Shopify?.product||window.ShopifyAnalytics?.meta?.product||null;return s?Q(s.gid||s.id):""}function Q(s){const t=String(s||"");return t?t.startsWith("gid://shopify/Product/")?t:`gid://shopify/Product/${t}`:""}function Ft(s){const t=String(s||"");return t?t.startsWith("gid://shopify/ProductVariant/")?t:`gid://shopify/ProductVariant/${t}`:""}function Z(s){const t=m(s.product);return Q(s.product_id||s.productId||s.product_gid||s.productGid||t.id)}function tt(s){const t=m(s.variant);return Ft(s.variant_id||s.variantId||s.id||s.variant_gid||s.variantGid||t.id)}function Bt(s){const t=s instanceof HTMLElement?s:null;return t?t.closest("[data-price], .price, .product-price, .product__price, [class*='price'], [class*='Price'], [id*='price'], [id*='Price']"):null}function Ot(s){const t=[s.name,s.id,s.placeholder,s.getAttribute("aria-label"),s.getAttribute("autocomplete")].filter(Boolean).join(" ").toLowerCase();return/\b(coupon|discount|promo|promotion|voucher|code)\b/.test(t)}class jt extends h{getWidgetType(){return"bundle"}render(){const t=this.payload.bundle||{},e=this.payload.copy||{},i=T(this.payload),r=i.length>0&&i.every(l=>l.variantId),o=i.find(l=>l.handle)?.handle,n=i.reduce((l,g)=>l+Number(g.price||0)*Number(g.quantity||1),0),d=Number(t.discountValue||0),u=t.discountType==="percentage"?n*(1-d/100):t.discountType==="fixed"?Math.max(n-d,0):n;this.html(`
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
            ${i.map(l=>`
                  <article class="tile">
                    ${l.imageUrl?`<img src="${a(l.imageUrl)}" alt="${a(l.title)}" loading="lazy">`:""}
                    <p class="product-name">${a(l.title)}</p>
                    <span class="price">${a(l.price?v(l.price):"")}</span>
                  </article>
                `).join("")}
          </div>
          <div class="totals">
            ${n>u?`<span class="strike">${v(n)}</span>`:""}
            <strong>${v(u)}</strong>
          </div>
          <div class="actions">
            ${r?`<button type="button" class="primary" data-add>${a(e.ctaText||"Add bundle to cart")}</button>`:o?`<a class="primary" href="/products/${a(o)}">${a(e.ctaText||"View bundle products")}</a>`:""}
          </div>
        </div>
      </section>
    `),this.root.querySelector("[data-add]")?.addEventListener("click",async()=>{this.trackClick("add_bundle"),await vt(i.map(l=>({variantId:l.variantId,quantity:Number(l.quantity||1)}))),document.dispatchEvent(new CustomEvent("add-to-cart",{detail:{source:"bundle_widget"}}))})}}class Wt extends h{constructor(e){super(e);c(this,"messages",[]);c(this,"expanded",!1);c(this,"sending",!1);const i=e.copy;this.messages.push({role:"assistant",content:String(i?.greeting||e.greeting||"Hi. Can I help you find the perfect product today?")})}getWidgetType(){return"chat"}render(){const e=this.payload.copy||{};this.html(`
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
    `),this.root.querySelector("[data-close]")?.addEventListener("click",()=>this.dismiss()),this.root.querySelector("[data-dismiss]")?.addEventListener("click",()=>this.dismiss()),this.root.querySelector("[data-expand]")?.addEventListener("click",()=>{this.expanded=!0,this.trackClick("open_chat"),this.render()}),this.root.querySelector("[data-send]")?.addEventListener("click",()=>this.sendMessage()),this.root.querySelector("input")?.addEventListener("keydown",i=>{i.key==="Enter"&&(i.preventDefault(),this.sendMessage())}),this.scrollToBottom()}renderChatUi(){return`
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
    `}renderProductLinks(e){const i=e.match(/\/products\/([a-z0-9-]+)/i);if(!i)return"";const r=i[1];return`
      <div class="inline-product">
        <p class="product-name">${a(r.replace(/-/g," "))}</p>
        <a href="/products/${a(r)}">View product</a>
      </div>
    `}appendMessage(e){const i=this.root.querySelector("[data-messages]");if(!i)throw new Error("Messages container not found");const r=document.createElement("div");return r.className=`bubble ${e.role}`,r.textContent=e.content,i.appendChild(r),this.scrollToBottom(),r}async sendMessage(){if(this.sending)return;const e=this.root.querySelector("[data-input]"),i=this.root.querySelector("[data-send]"),r=e?.value.trim();if(!r)return;this.sending=!0,i&&(i.disabled=!0),e.value="",this.messages.push({role:"user",content:r}),this.appendMessage({role:"user",content:r}),this.trackClick("send_message"),Ht(r)&&(this.track("chat_intent",{intent:"price_sensitive"}),document.dispatchEvent(new CustomEvent("aovboost:trigger",{detail:{type:"price_sensitive_chat",message:r}})));const o=this.messages.push({role:"assistant",content:""})-1,n=this.appendMessage({role:"assistant",content:""});this.showTyping();try{let d=await this.requestChat(r);if(d.status===401&&(await this.applyRecoverySession(d)||await window.AOVBoostSDK?.refreshSession?.(),d=await this.requestChat(r)),!d.ok)throw new Error(`Server returned ${d.status}`);if(!d.body)throw new Error("Missing stream body");const u=d.body.getReader(),l=new TextDecoder;let g="",_=!1;for(;;){const{done:S,value:$}=await u.read();if(S)break;g+=l.decode($,{stream:!0});const y=g.split(`
`);g=y.pop()||"";for(const k of y){if(!k.startsWith("data: "))continue;const B=k.slice(6);if(B!=="[DONE]")try{const C=JSON.parse(B);C.delta&&(_||(this.removeTyping(),_=!0),this.messages[o].content+=C.delta,n.textContent=this.messages[o].content,this.updateProductLink(this.messages[o].content,n),this.scrollToBottom())}catch{}}}_||(this.removeTyping(),this.messages[o].content||(this.messages[o].content="I can help you compare products and find the right add-ons.",n.textContent=this.messages[o].content))}catch{this.removeTyping(),this.messages[o].content=this.messages[o].content||"I had trouble connecting. Please try again in a moment.",n.textContent=this.messages[o].content}finally{this.sending=!1,i&&(i.disabled=!1)}}async requestChat(e){const i=window.AOVBoost||{},r=window.AOVBoostSDK,o=Rt(i.apiBase).replace(/\/$/,""),n=typeof r?.getSignedAuthPayload=="function"?await r.getSignedAuthPayload():null;if(!n)throw new Error("Missing signed storefront auth");const d=x();return fetch(`${o}/chat`,{method:"POST",headers:{"Content-Type":"application/json","X-AOVBoost-Shop":n.shop||i.shop||""},body:JSON.stringify({...n,message:e,messageHistory:this.messages.slice(0,-2),currency:d.code,currencySource:d.source,moneyFormat:d.moneyFormat,moneyWithCurrencyFormat:d.moneyWithCurrencyFormat,locale:d.locale})})}async applyRecoverySession(e){try{const i=await e.clone().json(),r=i?.storefrontSession||i?.session,o=window.AOVBoostSDK?.applySession;return typeof o=="function"?!!o(r):!1}catch{return!1}}showTyping(){const e=this.root.querySelector("[data-messages]");if(!e)return;const i=document.createElement("div");i.className="bubble assistant dots",i.dataset.typing="true",i.innerHTML="<span>.</span><span>.</span><span>.</span>",e.appendChild(i),this.scrollToBottom()}removeTyping(){const e=this.root.querySelector("[data-typing]");e&&e.remove()}updateProductLink(e,i){const r=e.match(/\/products\/([a-z0-9-]+)/i),o=i.querySelector(".inline-product");if(o&&o.remove(),!r)return;const n=r[1],d=document.createElement("div");d.className="inline-product",d.innerHTML=`
      <p class="product-name">${a(n.replace(/-/g," "))}</p>
      <a href="/products/${a(n)}">View product</a>
    `,i.appendChild(d)}scrollToBottom(){const e=this.root.querySelector("[data-messages]");e&&(e.scrollTop=e.scrollHeight)}dismiss(){this.trackDismiss(),this.container.animate([{transform:"translateY(0)"},{transform:"translateY(120%)"}],{duration:180,easing:"ease-in",fill:"forwards"}),window.setTimeout(()=>this.destroy(),190)}}function Ht(s){return/\b(expensive|cheaper|cheap|discount|coupon|promo|deal|sale|price|afford|budget|cost)\b/i.test(s)}function Rt(s){const t=typeof s=="string"?s.trim():"";return!t||t==="/api"||t.startsWith("/api/")?"/apps/aovboost":t.includes("/apps/aovboost")||t.startsWith("/apps/")?t:"/apps/aovboost"}class zt extends h{constructor(){super(...arguments);c(this,"timer")}getWidgetType(){return"countdown_banner"}render(){const e=this.payload.copy||{},i=e.headline||this.payload.headline||"Limited-time offer",r=e.subheadline||e.offerLine||this.payload.body||"Relevant bundles and add-ons are available for this session.";this.html(`
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
          <h3 class="title">${a(i)}</h3>
          <p class="body">${a(r)}</p>
        </div>
        <strong class="timer" data-countdown></strong>
        <button type="button" class="icon" data-dismiss aria-label="Close">x</button>
      </aside>
    `),this.root.querySelector("[data-dismiss]")?.addEventListener("click",()=>{this.trackDismiss(),this.destroy()}),this.tick(),this.timer=window.setInterval(()=>this.tick(),1e3)}destroy(){this.timer&&window.clearInterval(this.timer),super.destroy()}tick(){const e=this.root.querySelector("[data-countdown]");if(!e)return;const i=Date.parse(String(this.payload.endsAt||""));if(!Number.isFinite(i)){e.textContent="Today";return}const r=Math.max(i-Date.now(),0);if(r<=0){this.destroy();return}const o=Math.floor(r/36e5),n=Math.floor(r%36e5/6e4),d=Math.floor(r%6e4/1e3);e.textContent=o>0?`${o}h ${n}m`:`${n}m ${d.toString().padStart(2,"0")}s`}}class Ut extends h{getWidgetType(){return"discount_nudge"}render(){this.draw(),document.addEventListener("add-to-cart",()=>this.draw())}draw(){const t=this.payload.copy||{},e=Number(this.payload.threshold||50),i=Number(this.payload.cartValue||0),r=Math.max(e-i,0),o=e>0?Math.min(i/e,1):0;this.html(`
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
        .track span { display: block; height: 100%; width: ${o*100}%; background: var(--aovboost-accent); transition: width 200ms ease; }
      </style>
      <div class="bar">
        <div class="label">
          <span>${r>0?a(t.progressLabel||`You're ${v(r)} away from your reward`):a(t.rewardDescription||"Reward unlocked")}</span>
          <button type="button" class="icon" data-dismiss aria-label="Close">x</button>
        </div>
        <div class="track" aria-hidden="true"><span></span></div>
      </div>
    `),this.root.querySelector("[data-dismiss]")?.addEventListener("click",()=>{this.trackDismiss(),this.destroy()}),r<=0&&window.setTimeout(()=>this.destroy(),3e3)}}class Gt extends h{constructor(){super(...arguments);c(this,"shown",!1);c(this,"handleMouseLeave",e=>{e.clientY<10&&this.show()});c(this,"handleVisibility",()=>{document.visibilityState==="hidden"&&this.show()})}getWidgetType(){return"exit_intent"}mount(e=document.body){if(e.appendChild(this.container),!this.shouldSkip()){if(this.payload.immediate){this.show();return}document.addEventListener("mouseleave",this.handleMouseLeave),document.addEventListener("visibilitychange",this.handleVisibility)}}render(){const e=this.payload.copy||{};this.html(`
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
    `),this.root.querySelector("[data-claim]")?.addEventListener("click",()=>{this.trackClick("claim_exit_offer"),this.destroy()}),this.root.querySelectorAll("[data-dismiss]").forEach(i=>{i.addEventListener("click",()=>{this.trackDismiss(),this.destroy()})})}destroy(){document.removeEventListener("mouseleave",this.handleMouseLeave),document.removeEventListener("visibilitychange",this.handleVisibility),super.destroy()}show(){if(!(this.shown||this.hasFired())){this.shown=!0;try{sessionStorage.setItem("aovboost_exit_intent_fired","true")}catch{}this.render(),this.trackImpression()}}hasFired(){try{return sessionStorage.getItem("aovboost_exit_intent_fired")==="true"}catch{return!1}}shouldSkip(){return/\/(?:checkout|thank_you)(?:\/|$)/.test(window.location.pathname)}}class Yt extends h{getWidgetType(){return"inline_alert"}render(){const t=this.payload.copy||{},e=t.headline||this.payload.headline||"Store update",i=t.subheadline||t.offerLine||this.payload.body||"A relevant product update is available.";this.html(`
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
            <h3 class="title">${a(e)}</h3>
            <p class="body">${a(i)}</p>
          </div>
          <button type="button" class="icon" data-dismiss aria-label="Close">x</button>
        </div>
      </aside>
    `),this.root.querySelector("[data-dismiss]")?.addEventListener("click",()=>{this.trackDismiss(),this.destroy()})}}class Kt extends h{getWidgetType(){return"post_purchase"}mount(t=document.body){this.isThankYouPage()&&super.mount(t)}render(){const t=this.payload.copy||{},e=T(this.payload)[0]||this.payload.product||{};this.html(`
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
              <span class="price">${a(e.price?v(e.price):"")}</span>
            </div>
            <p class="reason">${a(t.oneLineReason||"A useful add-on for what you just bought.")}</p>
            <button type="button" class="primary" data-add>${a(t.ctaText||"Add to my order")}</button>
          </div>
        </article>
      </section>
    `),this.root.querySelector("[data-add]")?.addEventListener("click",async()=>{this.trackClick("add_post_purchase");const i=e.variantId;if(i){await D(i);return}const r=e.handle;r&&(window.location.href=`/products/${r}`)})}isThankYouPage(){return/\/thank_you(?:\/|$)/.test(window.location.pathname)||!!window.Shopify?.checkout}}class Jt extends h{getWidgetType(){return"rec_strip"}render(){const t=T(this.payload);this.html(`
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
                  ${e.reason?`<span class="badge">${a(e.reason)}</span>`:""}
                  ${e.imageUrl?`<img data-src="${a(e.imageUrl)}" alt="${a(e.title)}">`:""}
                  <p class="product-name">${a(e.title)}</p>
                  <span class="price">${a(e.price?v(e.price):"")}</span>
                  ${e.variantId?`<button type="button" class="primary" data-add="${a(e.variantId)}">Add to cart</button>`:e.handle?`<a class="primary" href="/products/${a(e.handle)}">View product</a>`:""}
                </article>
              `).join("")}
        </div>
      </section>
    `),this.lazyLoadImages(),this.root.querySelectorAll("[data-add]").forEach(e=>{e.addEventListener("click",async()=>{this.trackClick("add_recommendation"),await D(e.dataset.add)})})}lazyLoadImages(){const t=Array.from(this.root.querySelectorAll("img[data-src]"));if(!("IntersectionObserver"in window)){t.forEach(i=>{i.src=i.dataset.src||""});return}const e=new IntersectionObserver(i=>{i.forEach(r=>{if(!r.isIntersecting)return;const o=r.target;o.src=o.dataset.src||"",e.unobserve(o)})});t.forEach(i=>e.observe(i))}}class Xt extends h{constructor(){super(...arguments);c(this,"interval")}getWidgetType(){return"social_proof"}render(){const i=T(this.payload).filter(o=>Number(o.orderCount||0)>0).map(o=>`${Number(o.orderCount)} people bought this with ${o.title}`);i.length===0&&i.push("Frequently bought together"),this.html(`
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
      <div class="pill" role="status"><span class="dot"></span><span data-message>${a(i[0])}</span></div>
    `);let r=0;this.interval=window.setInterval(()=>{r=(r+1)%i.length;const o=this.root.querySelector("[data-message]");o&&(o.textContent=i[r])},5e3)}destroy(){this.interval&&window.clearInterval(this.interval),super.destroy()}}class Qt extends h{getWidgetType(){return"toast"}render(){const t=this.payload.copy||{},e=t.headline||this.payload.headline||"A better option is available",i=t.subheadline||t.offerLine||this.payload.body||"I can help find a better match or a useful offer.",r=t.ctaText||this.payload.ctaText||"Open assistant";this.html(`
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
            <h3 class="title">${a(e)}</h3>
            <p class="body">${a(i)}</p>
          </div>
          <button type="button" class="icon" data-dismiss aria-label="Close">x</button>
        </div>
        <div class="actions">
          <button type="button" class="primary" data-chat>${a(r)}</button>
        </div>
      </aside>
    `),this.root.querySelector("[data-dismiss]")?.addEventListener("click",()=>{this.trackDismiss(),this.destroy()}),this.root.querySelector("[data-chat]")?.addEventListener("click",()=>{this.trackClick("open_assistant"),document.dispatchEvent(new CustomEvent("aovboost:trigger",{detail:{type:"long_product_dwell",source:"toast"}})),this.destroy()}),window.setTimeout(()=>this.destroy(),9e3)}}class Zt extends h{constructor(){super(...arguments);c(this,"timer");c(this,"deadline",Date.now()+8e3)}getWidgetType(){return"upsell_drawer"}render(){const e=T(this.payload).slice(0,3),i=this.payload.copy||{};this.html(`
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
            <h3 class="title">${a(i.headline||"Great choice. Complete the set")}</h3>
            <p class="body">People who bought this also love:</p>
          </div>
          <button type="button" class="icon" data-dismiss aria-label="Close">x</button>
        </div>
        <div class="timer"><span data-timer></span></div>
        <div class="product-grid">
          ${e.map(r=>`
                <article class="product-card">
                  ${r.imageUrl?`<img src="${a(r.imageUrl)}" alt="${a(r.title)}" loading="lazy">`:"<span></span>"}
                  <div class="stack">
                    <div>
                      <p class="product-name">${a(r.title)}</p>
                      <span class="price">${a(r.price?v(r.price):"")}</span>
                    </div>
                    <p class="reason">${a(r.reason||i.whyThisGoes||"It pairs well with your cart.")}</p>
                    ${r.variantId?`<button type="button" class="primary" data-add="${a(r.variantId)}">Add to cart</button>`:r.handle?`<a class="primary" href="/products/${a(r.handle)}">View product</a>`:""}
                  </div>
                </article>
              `).join("")}
        </div>
        <div class="actions">
          <a class="secondary" href="/cart">Continue to cart</a>
        </div>
      </aside>
    `),this.root.querySelectorAll("[data-dismiss]").forEach(r=>{r.addEventListener("click",()=>this.dismiss())}),this.root.querySelectorAll("[data-add]").forEach(r=>{r.addEventListener("click",async()=>{this.trackClick("add_upsell"),await D(r.dataset.add)})}),this.startCountdown()}destroy(){this.timer&&window.clearInterval(this.timer),super.destroy()}startCountdown(){this.timer&&window.clearInterval(this.timer),this.deadline=Date.now()+8e3,this.timer=window.setInterval(()=>{const e=Math.max(this.deadline-Date.now(),0),i=this.root.querySelector("[data-timer]");i&&(i.style.transform=`scaleX(${e/8e3})`),e<=0&&this.dismiss()},120)}dismiss(){this.trackDismiss(),this.container.animate([{transform:"translateX(0)"},{transform:"translateX(100%)"}],{duration:180,easing:"ease-in",fill:"forwards"}),window.setTimeout(()=>this.destroy(),190)}}const et="aovboost_dismissed_widgets",te=30*60*1e3;class ee{constructor(){c(this,"activeWidget",null);c(this,"activeKey","");c(this,"activeWidgetType","")}mountDecision(t){if(!t.widgetType||this.getDismissedWidgets().includes(t.widgetType))return;const e=t.payload||{},i=String(e.offerId||""),r=`${t.widgetType}:${i}`;if(t.widgetType==="chat"&&this.activeWidgetType==="chat"||r===this.activeKey)return;this.destroyActive();const o=se(t.widgetType,e);if(!o)return;const n=this.resolveTarget(t.widgetType);o.mount(n),this.activeWidget=o,this.activeKey=r,this.activeWidgetType=t.widgetType}destroyActive(){this.activeWidget?.destroy(),this.activeWidget=null,this.activeKey="",this.activeWidgetType=""}getDismissedWidgets(){try{const t=JSON.parse(localStorage.getItem(et)||"[]");if(!Array.isArray(t))return[];const e=Date.now(),i=t.filter(r=>r&&typeof r=="object").filter(r=>e-Number(r.dismissedAt||0)<te);return i.length!==t.length&&localStorage.setItem(et,JSON.stringify(i)),i.map(r=>String(r.widgetType||"")).filter(Boolean)}catch{return[]}}resolveTarget(t){return t==="bundle"?P(".product-form, [data-product-form]"):t==="rec_strip"?P(".product__description, [data-product-description]"):t==="social_proof"?P(".product-form__submit, [data-add-to-cart]"):t==="inline_alert"?P("[data-price], .product__price, .price, .product-form, [data-product-form]"):document.body}}function se(s,t){switch(s){case"chat":return new Wt(t);case"toast":return new Qt(t);case"countdown_banner":return new zt(t);case"inline_alert":return new Yt(t);case"bundle":return new jt(t);case"upsell_drawer":return new Zt(t);case"discount_nudge":return new Ut(t);case"rec_strip":return new Jt(t);case"social_proof":return new Xt(t);case"exit_intent":return new Gt(t);case"post_purchase":return new Kt(t);default:return null}}function P(s){const t=document.querySelector(s),e=document.createElement("div");return e.setAttribute("data-aovboost-mount",s),t?.parentElement?(t.insertAdjacentElement("afterend",e),e):(document.body.appendChild(e),e)}let st=!1;function F(){st||(st=!0,ie().catch(s=>{console.log("AOVBoost SDK skipped:",s instanceof Error?s.message:String(s))}))}async function ie(){try{const s=window.AOVBoost||{},t=s.shop;if(!t)return;it(s)||await oe(s);const e=re(s.apiBase),i=new Pt(t,e),r=new f({shop:t,sessionManager:i,apiBase:e}),o=new ee,n=new St({shop:t,apiBase:e,eventBus:r,sessionManager:i,widgetManager:o}),d=new Vt({eventBus:r,offerPoller:n,sessionManager:i});await i.init(),window.AOVBoostSDK={shop:t,sessionId:i.anonymousId,sessionToken:i.getAuthPayload().sessionToken,refreshSession:async()=>{await i.refreshAuth(),i.syncGlobalSdkAuth()},getSignedAuthPayload:()=>i.getSignedAuthPayload(),applySession:u=>i.applyStorefrontSession(u),track:(u,l={})=>r.track(u,l),trigger:(u,l={})=>d.trigger(u,l),requestOffer:(u="global",l={})=>n.requestOffer(u,l),destroy:()=>{d.destroy(),n.destroy(),i.destroy(),o.destroyActive()}},d.init(),r.init(),n.init()}catch(s){console.log("AOVBoost SDK skipped:",s instanceof Error?s.message:String(s))}}function re(s){const t=typeof s=="string"?s.trim():"";return!t||t==="/api"||t.startsWith("/api/")?"/apps/aovboost":t.includes("/apps/aovboost")||t.startsWith("/apps/")?t:"/apps/aovboost"}function it(s){if(s.settings?.trackingConsentRequired!==!0)return!0;const t=window.Shopify?.customerPrivacy;return typeof t?.analyticsProcessingAllowed=="function"?!!t.analyticsProcessingAllowed():typeof t?.userCanBeTracked=="function"?!!t.userCanBeTracked():!0}function oe(s){return new Promise(t=>{const e=()=>{it({...s,settings:{...s.settings,trackingConsentRequired:!1}})&&(i(),t())},i=()=>{["visitorConsentCollected","shopify:customer_privacy:consent_collected","aovboost:consent-granted"].forEach(r=>window.removeEventListener(r,e))};["visitorConsentCollected","shopify:customer_privacy:consent_collected","aovboost:consent-granted"].forEach(r=>window.addEventListener(r,e))})}return document.readyState==="loading"?document.addEventListener("DOMContentLoaded",F,{once:!0}):F(),p.init=F,Object.defineProperty(p,Symbol.toStringTag,{value:"Module"}),p}({});
