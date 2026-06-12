var AOVBoostSDKBundle=function(g){"use strict";var Jt=Object.defineProperty;var Xt=(g,m,w)=>m in g?Jt(g,m,{enumerable:!0,configurable:!0,writable:!0,value:w}):g[m]=w;var n=(g,m,w)=>Xt(g,typeof m!="symbol"?m+"":m,w);class m{constructor(t){n(this,"queue",[]);n(this,"flushTimer");n(this,"scrollDepths",new Set);n(this,"originalFetch",null);n(this,"authFlushInFlight",!1);this.options=t}init(){this.installNavigationTracking(),this.installCartFetchTracking(),this.installCartDomTracking(),this.installScrollTracking(),this.installHoverTracking(),this.installSearchTracking(),document.addEventListener("add-to-cart",t=>{this.track("add_to_cart",w(t.detail))}),document.addEventListener("aovboost:track",t=>{const e=w(t.detail);this.track(String(e.type||"widget_event"),e)}),window.addEventListener("pagehide",()=>this.flush()),this.trackPageView()}track(t,e={}){const s={type:t,ts:Date.now(),sessionId:this.options.sessionManager.anonymousId,shop:this.options.shop,url:window.location.href,referrer:document.referrer,...e};this.options.sessionManager.recordEvent(s),this.queue.push(s),document.dispatchEvent(new CustomEvent("aovboost:event",{detail:s})),this.scheduleFlush()}flush(){if(this.flushTimer&&(window.clearTimeout(this.flushTimer),this.flushTimer=void 0),this.queue.length===0)return;if(!this.options.sessionManager.getAuthPayload().sessionToken){this.flushAfterAuth();return}const t=this.queue.splice(0);this.postEvents(t)}async flushAfterAuth(){if(!this.authFlushInFlight){this.authFlushInFlight=!0;try{await this.options.sessionManager.ensureAuthenticated()&&this.flush()}finally{this.authFlushInFlight=!1}}}scheduleFlush(){this.flushTimer||(this.flushTimer=window.setTimeout(()=>this.flush(),2e3))}endpoint(t){return`${(this.options.apiBase||"/apps/aovboost").replace(/\/$/,"")}${t}`}async postEvents(t,e=!1){const s=await this.options.sessionManager.getSignedAuthPayload();if(!s){this.queue.unshift(...t);return}try{const r=await fetch(this.endpoint("/events"),{method:"POST",headers:{"Content-Type":"application/json","X-AOVBoost-Shop":this.options.shop},body:JSON.stringify({...s,events:t}),keepalive:!0});if(r.status===401&&!e){if(await this.options.sessionManager.applySessionFromResponse(r)||await this.options.sessionManager.refreshAuth(),!this.options.sessionManager.getAuthPayload().sessionToken){this.queue.unshift(...t);return}await this.postEvents(t,!0);return}!r.ok&&r.status!==401&&this.queue.unshift(...t)}catch{this.queue.unshift(...t)}}installNavigationTracking(){const t=history.pushState,e=history.replaceState;history.pushState=(...s)=>{const r=t.apply(history,s);return window.setTimeout(()=>this.trackPageView(),0),r},history.replaceState=(...s)=>{const r=e.apply(history,s);return window.setTimeout(()=>this.trackPageView(),0),r},window.addEventListener("popstate",()=>this.trackPageView())}trackPageView(){this.track("page_view",{pageType:et()}),st()&&this.track("checkout_start",{path:window.location.pathname});const t=Z();t&&this.track("product_view",{productId:ct(t.gid||t.id),handle:t.handle,title:t.title});const e=tt();(e||window.location.pathname.includes("/collections/"))&&this.track("collection_view",{collectionId:String(e?.id||""),handle:e?.handle||it("/collections/"),title:e?.title})}installCartFetchTracking(){this.originalFetch||(this.originalFetch=window.fetch.bind(window),window.fetch=async(...t)=>{const e=rt(t[0]),s=t[1],r=await this.originalFetch(...t);try{A(e)?this.track("add_to_cart",{...C(s?.body),requestUrl:e}):at(e)?this.track("remove_from_cart",{...C(s?.body),requestUrl:e}):ot(e)&&this.track("search",{query:nt(e),requestUrl:e})}catch{}return r})}installCartDomTracking(){document.addEventListener("submit",t=>{const e=t.target;if(!(!e||!A(e.action||"")))try{this.track("add_to_cart",{...C(new FormData(e)),source:"cart_form_submit",requestUrl:e.action})}catch{this.track("add_to_cart",{source:"cart_form_submit",requestUrl:e.action})}},!0),document.addEventListener("click",t=>{const s=t.target?.closest?.("button[name='add'], [type='submit'][name='add'], [data-add-to-cart]");if(!s)return;const r=s.closest("form");r&&!A(r.action||"")||this.track("add_to_cart",{source:"add_button_click",requestUrl:r?.action||""})},!0)}installScrollTracking(){let t=!1;window.addEventListener("scroll",()=>{t||(t=!0,window.setTimeout(()=>{t=!1;const e=document.documentElement.scrollHeight-window.innerHeight;if(e<=0)return;const s=Math.round(window.scrollY/e*100);[25,50,75,90].forEach(r=>{s>=r&&!this.scrollDepths.has(r)&&(this.scrollDepths.add(r),this.track("scroll_depth",{depth:r}))})},200))},{passive:!0})}installHoverTracking(){document.addEventListener("mouseenter",t=>{const s=t.target?.closest?.(".product-card");if(!s)return;const r=window.setTimeout(()=>{this.track("product_hover",{productId:s.dataset.productId||s.dataset.productGid||"",handle:s.dataset.productHandle||""})},800);s.addEventListener("mouseleave",()=>window.clearTimeout(r),{once:!0})},!0)}installSearchTracking(){document.addEventListener("input",t=>{const e=t.target;if(!e||!`${e.name||""} ${e.id||""} ${e.type||""}`.toLowerCase().includes("search"))return;const r=e.value.trim();r.length<2||this.track("search",{query:r,source:"predictive_input"})},!0)}}function w(i){return i&&typeof i=="object"&&!Array.isArray(i)?i:{}}function Z(){const i=window;return i.Shopify?.product||i.ShopifyAnalytics?.meta?.product||null}function tt(){const i=window;return i.Shopify?.collection||i.ShopifyAnalytics?.meta?.collection||null}function et(){return window.ShopifyAnalytics?.meta?.page?.pageType||document.body?.dataset?.template||(window.location.pathname==="/"?"home":"other")}function st(){return/\/checkout(?:\/|$)/.test(window.location.pathname)}function it(i){const t=window.location.pathname.indexOf(i);return t===-1?"":window.location.pathname.slice(t+i.length).split("/")[0]||""}function rt(i){return typeof i=="string"?i:i instanceof URL?i.toString():i.url||""}function A(i){return/\/cart\/add(?:\.js)?/.test(i)}function at(i){return/\/cart\/(?:change|update)(?:\.js)?/.test(i)}function ot(i){return i.includes("/search/suggest.json")}function nt(i){try{return new URL(i,window.location.origin).searchParams.get("q")||""}catch{return""}}function C(i){if(!i)return{};if(typeof FormData<"u"&&i instanceof FormData)return{variantId:String(i.get("id")||i.get("items[0][id]")||""),quantity:Number(i.get("quantity")||1)};if(typeof URLSearchParams<"u"&&i instanceof URLSearchParams)return{variantId:String(i.get("id")||i.get("items[0][id]")||""),quantity:Number(i.get("quantity")||1)};try{const t=String(i);if(t.trim().startsWith("{")){const s=JSON.parse(t);return{productId:s.productId||s.product_id,variantId:s.id||s.items?.[0]?.id,quantity:s.quantity||s.items?.[0]?.quantity||1}}const e=new URLSearchParams(t);return{variantId:String(e.get("id")||e.get("items[0][id]")||""),quantity:Number(e.get("quantity")||1)}}catch{return{}}}function ct(i){const t=String(i||"");return t?t.startsWith("gid://shopify/Product/")?t:`gid://shopify/Product/${t}`:""}class dt{constructor(t){n(this,"timer");n(this,"inFlight",!1);n(this,"stopped",!1);n(this,"options");this.options=t}init(){window.setTimeout(()=>this.requestOffer("initial"),1200),this.options.pollMs&&(this.timer=window.setInterval(()=>this.requestOffer("poll"),this.options.pollMs)),document.addEventListener("aovboost:request-offer",()=>{this.requestOffer("manual")}),window.addEventListener("popstate",()=>{window.setTimeout(()=>this.requestOffer("navigation"),300)})}destroy(){this.stopped=!0,this.timer&&window.clearInterval(this.timer)}async requestOffer(t="manual",e={}){if(this.inFlight||this.stopped)return null;this.inFlight=!0;try{const s=this.options.sessionManager.getSnapshot(),r=await pt(),a=r.cartItemCount>0||r.cartValue>0,c=Array.isArray(e.cartProductIds)?e.cartProductIds.map(String):a?r.cartProductIds:s.cartProductIds,d=Array.isArray(e.cartVariantIds)?e.cartVariantIds.map(String):a?r.cartVariantIds:Array.isArray(s.context.cartVariantIds)?s.context.cartVariantIds.map(String):[],u=Array.isArray(e.cartItems)?e.cartItems:a?r.cartItems:[],h=typeof e.cartItemCount=="number"?e.cartItemCount:a?r.cartItemCount:Number(s.context.cartItemCount||0),l=typeof e.cartValue=="number"?e.cartValue:a?r.cartValue:s.cartValue,f=await this.options.sessionManager.getSignedAuthPayload();if(!f)return this.mountLocalFallback(t,e);const k={...f,currentProductId:ht(),currentPageType:ut(),cartProductIds:c,cartVariantIds:d,cartItems:u,cartItemCount:h,cartValue:l,dismissedWidgets:this.options.widgetManager.getDismissedWidgets(),trigger:t,triggerCategory:e.triggerCategory,triggerPayload:e};let v=await fetch(this.endpoint("/offer"),{method:"POST",headers:{"Content-Type":"application/json","X-AOVBoost-Shop":this.options.shop},body:JSON.stringify({...k,...f}),keepalive:!0});if(v.status===401){await this.options.sessionManager.applySessionFromResponse(v)||await this.options.sessionManager.refreshAuth();const x=await this.options.sessionManager.getSignedAuthPayload();if(!x)return this.mountLocalFallback(t,e);v=await fetch(this.endpoint("/offer"),{method:"POST",headers:{"Content-Type":"application/json","X-AOVBoost-Shop":this.options.shop},body:JSON.stringify({...k,...x}),keepalive:!0})}if(!v.ok)return this.mountLocalFallback(t,e);const _=await v.json();return _.widgetType?(this.options.widgetManager.mountDecision(_),_):this.mountLocalFallback(t,e)}catch{return this.mountLocalFallback(t,e)}finally{this.inFlight=!1}}endpoint(t){return`${this.options.apiBase.replace(/\/$/,"")}${t}`}mountLocalFallback(t,e){const s=lt(t,e);return s?(this.options.widgetManager.mountDecision(s),s):null}}function lt(i,t){const e=Number(t.cartValue||0);switch(i){case"first_time_visitor":case"long_product_dwell":case"scroll_depth_interest":case"comparison_page_visit":case"inactivity_timeout":case"purchase_history_match":case"loyalty_tier_reached":case"crm_segment_update":return{widgetType:"chat",payload:{offerId:`local:${i}`,greeting:"Hi. I can help you compare products and find useful add-ons.",copy:{greeting:"Hi. I can help you compare products and find useful add-ons.",ctaAccept:"Chat with AI",ctaDecline:"Browse myself"}},reasoning:"Local fallback for proactive chat trigger.",confidence:.4,aiProvider:"heuristic"};case"exit_intent":return{widgetType:"exit_intent",payload:{offerId:"local:exit_intent",immediate:!0,offerLine:"Before you go, I can help find a better match or bundle.",copy:{headline:"Wait before you go",offerLine:"I can help find a better match or bundle.",ctaText:"Open assistant",dismissText:"No thanks"}},reasoning:"Local fallback for exit intent.",confidence:.4,aiProvider:"heuristic"};case"cart_value_threshold":case"cart_abandoned":return{widgetType:"discount_nudge",payload:{offerId:`local:${i}`,cartValue:e,threshold:Number(t.threshold||50),copy:{progressLabel:"You are close to a reward",rewardDescription:"Add one more item to unlock the offer.",ctaText:"View picks"}},reasoning:"Local fallback for cart value or idle cart trigger.",confidence:.4,aiProvider:"heuristic"};case"flash_sale_window":case"seasonal_calendar":return{widgetType:"countdown_banner",payload:{offerId:`local:${i}`,endsAt:t.endsAt,body:"Limited-time product picks are available right now.",copy:{headline:"Limited-time offer",subheadline:"Relevant bundles and add-ons are available now.",ctaText:"View offer"}},reasoning:"Local fallback for scheduled campaign trigger.",confidence:.4,aiProvider:"heuristic"};case"low_inventory_alert":case"price_drop_webhook":return{widgetType:"inline_alert",payload:{offerId:`local:${i}`,body:i==="price_drop_webhook"?"The price on this product has changed.":"Inventory is limited for this product.",copy:{headline:i==="price_drop_webhook"?"Price update":"Limited stock",subheadline:i==="price_drop_webhook"?"The price on this product has changed.":"Inventory is limited for this product."}},reasoning:"Local fallback for system alert trigger.",confidence:.4,aiProvider:"heuristic"};case"cart_item_added":case"cart_item_removed":case"search_query":case"repeated_product_view":case"price_hesitation":case"wishlist_save":case"coupon_field_focus":case"subscription_renewal_due":case"payment_failure":return{widgetType:"toast",payload:{offerId:`local:${i}`,headline:M(i),body:q(i),copy:{headline:M(i),subheadline:q(i),ctaText:"Open assistant",dismissText:"No thanks"}},reasoning:"Local fallback for low-disruption trigger.",confidence:.4,aiProvider:"heuristic"};default:return null}}function M(i){return i==="cart_item_added"?"Complete the set":i==="coupon_field_focus"?"Looking for a code?":i==="price_hesitation"?"Need a better fit?":i==="wishlist_save"?"Saved for later":i==="search_query"?"Need help choosing?":"Need help deciding?"}function q(i){return i==="cart_item_added"?"I can help find matching accessories or add-ons.":i==="cart_item_removed"?"I can help find a better alternative.":i==="coupon_field_focus"?"I can help find a relevant offer or lower-priced option.":i==="price_hesitation"?"I can help compare value and find a lower-priced alternative.":i==="wishlist_save"?"I can compare this with related products when you are ready.":"I can help find the right product or useful add-on."}function ut(){const i=window.location.pathname,t=String(window.ShopifyAnalytics?.meta?.page?.pageType||document.body?.dataset?.template||"").toLowerCase();return i==="/"?"home":/\/collections(?:\/|$)/.test(i)||t.includes("collection")?"collection":/\/products(?:\/|$)/.test(i)||t.includes("product")?"product":/\/cart(?:\/|$)/.test(i)||t.includes("cart")?"cart":/\/checkout(?:\/|$)/.test(i)?"checkout":/\/thank_you(?:\/|$)/.test(i)||window.Shopify?.checkout?"thankyou":"other"}function ht(){const i=window.Shopify?.product||window.ShopifyAnalytics?.meta?.product||null;if(!i)return;const t=String(i.gid||i.id||"");if(t)return t.startsWith("gid://shopify/Product/")?t:`gid://shopify/Product/${t}`}async function pt(){try{const i=await fetch("/cart.js",{headers:{Accept:"application/json"},keepalive:!0});if(!i.ok)throw new Error(`Cart read failed: ${i.status}`);const t=await i.json(),e=Array.isArray(t.items)?t.items:[],s=e.map(a=>N(a)).filter(Boolean),r=e.map(a=>B(a)).filter(Boolean);return{cartToken:t.token||"",cartProductIds:s,cartVariantIds:r,cartItems:e.map(a=>({productId:N(a),variantId:B(a),quantity:Number(a.quantity||1),title:String(a.product_title||a.title||""),handle:String(a.handle||a.url||"").split("/products/")[1]?.split(/[?#/]/)[0]||""})),cartItemCount:Number(t.item_count||e.length||0),cartValue:Number(t.total_price||0)/100}}catch{return{cartToken:"",cartProductIds:[],cartVariantIds:[],cartItems:[],cartItemCount:0,cartValue:0}}}function ft(i){const t=String(i||"");return t?t.startsWith("gid://shopify/Product/")?t:`gid://shopify/Product/${t}`:""}function gt(i){const t=String(i||"");return t?t.startsWith("gid://shopify/ProductVariant/")?t:`gid://shopify/ProductVariant/${t}`:""}function N(i){const t=O(i.product);return ft(i.product_id||i.productId||i.product_gid||i.productGid||t.id)}function B(i){const t=O(i.variant);return gt(i.variant_id||i.variantId||i.id||i.variant_gid||i.variantGid||t.id)}function O(i){return i&&typeof i=="object"&&!Array.isArray(i)?i:{}}const P="aovboost_anonymous_id",$="aovboost_storefront_session";class mt{constructor(t,e="/apps/aovboost"){n(this,"anonymousId","");n(this,"sessionToken","");n(this,"journeyStage","discovering");n(this,"viewedProductIds",new Set);n(this,"productViewCounts",new Map);n(this,"cartProductIds",new Set);n(this,"cartVariantIds",new Set);n(this,"cartItemCount",0);n(this,"pageViews",0);n(this,"maxScrollDepth",0);n(this,"cartActionCount",0);n(this,"cartValue",0);n(this,"startedAt",Date.now());n(this,"lastCartActionAt",0);n(this,"lastEventType","");n(this,"syncTimer");n(this,"authRefreshPromise");this.shop=t,this.apiBase=e}async init(){await this.ensureAuthenticated()||this.bootstrapLocalSession(),this.syncTimer=window.setInterval(()=>this.sync(),3e4),window.addEventListener("pagehide",()=>this.sync())}destroy(){this.syncTimer&&window.clearInterval(this.syncTimer)}recordEvent(t){if(this.lastEventType=t.type,t.type==="page_view"&&(this.pageViews+=1),t.type==="product_view"){const e=E(t);e&&(this.viewedProductIds.add(e),this.productViewCounts.set(e,(this.productViewCounts.get(e)||0)+1))}if(t.type==="scroll_depth"&&(this.maxScrollDepth=Math.max(this.maxScrollDepth,Number(t.depth||0))),t.type==="add_to_cart"){this.cartActionCount+=1,this.lastCartActionAt=Date.now();const e=E(t);e&&this.cartProductIds.add(e),Array.isArray(t.cartProductIds)&&t.cartProductIds.forEach(s=>this.cartProductIds.add(String(s))),Array.isArray(t.cartVariantIds)&&t.cartVariantIds.forEach(s=>this.cartVariantIds.add(String(s))),this.cartItemCount=Math.max(this.cartItemCount,Number(t.cartItemCount||this.cartItemCount)),this.cartValue=Math.max(this.cartValue,Number(t.cartValue||0)),this.journeyStage="buying"}if(t.type==="cart_update"&&(this.lastCartActionAt=Date.now(),Array.isArray(t.cartProductIds)&&(this.cartProductIds=new Set(t.cartProductIds.map(String))),Array.isArray(t.cartVariantIds)&&(this.cartVariantIds=new Set(t.cartVariantIds.map(String))),this.cartItemCount=Number(t.cartItemCount||this.cartProductIds.size),this.cartValue=Number(t.cartValue||0),(this.cartProductIds.size>0||this.cartItemCount>0)&&(this.journeyStage="buying")),t.type==="remove_from_cart"){this.cartActionCount+=1,this.lastCartActionAt=Date.now();const e=E(t);e&&this.cartProductIds.delete(e)}this.updateJourneyStage()}getSnapshot(){const t=Math.round((Date.now()-this.startedAt)/1e3),e=Array.from(this.productViewCounts.values()).reduce((d,u)=>d+u,0),s=F(this.pageViews*2+e*5+(this.maxScrollDepth>=90?10:this.maxScrollDepth>=75?8:this.maxScrollDepth>=50?5:this.maxScrollDepth>=25?3:0)+Math.min(t/120,1)*30+(this.cartProductIds.size>0?30:0),0,100),r=Array.from(this.productViewCounts.entries()).some(([d,u])=>u>=2&&!this.cartProductIds.has(d)),a=this.lastCartActionAt?(Date.now()-this.lastCartActionAt)/1e3:t,c=F((s>40&&this.cartActionCount===0&&a>=90?55:0)+(r?35:0),0,100);return{anonymousId:this.anonymousId,journeyStage:this.journeyStage,intentScore:s,hesitationScore:c,viewedProductIds:Array.from(this.viewedProductIds),cartProductIds:Array.from(this.cartProductIds),totalPageViews:this.pageViews,sessionDuration:t,cartValue:this.cartValue,context:{maxScrollDepth:this.maxScrollDepth,productViewCounts:Object.fromEntries(this.productViewCounts),cartActionCount:this.cartActionCount,cartItemCount:this.cartItemCount,cartVariantIds:Array.from(this.cartVariantIds),cartValue:this.cartValue,lastEventType:this.lastEventType}}}getAuthPayload(){return{sessionId:this.anonymousId,sessionToken:this.sessionToken,shop:this.shop}}async getSignedAuthPayload(){return!await this.ensureAuthenticated()||!this.anonymousId||!this.sessionToken?null:this.getAuthPayload()}async ensureAuthenticated(){if(this.sessionToken)return!0;try{await this.ensureStorefrontSession()}catch{await this.refreshAuth()}return!!this.sessionToken}async refreshAuth(){return this.authRefreshPromise?this.authRefreshPromise:(this.authRefreshPromise=this.refreshAuthInternal().finally(()=>{this.authRefreshPromise=void 0}),this.authRefreshPromise)}async refreshAuthInternal(){const t=this.anonymousId,e=this.sessionToken;try{window.localStorage.removeItem($)}catch{}try{await this.ensureStorefrontSession({forceRefresh:!0})}catch{e?(this.anonymousId=t,this.sessionToken=e):this.bootstrapLocalSession()}this.syncGlobalSdkAuth()}applyStorefrontSession(t){const e=yt(t);return!e||e.shop!==this.shop||!e.sessionId||!e.sessionToken||Number(e.expiresAt||0)<=Math.floor(Date.now()/1e3)+60?!1:(this.anonymousId=e.sessionId,this.sessionToken=e.sessionToken,this.storeStorefrontSession(e),this.syncGlobalSdkAuth(),!0)}async applySessionFromResponse(t){try{const e=await t.clone().json(),s=j(e);return this.applyStorefrontSession(s?.storefrontSession||s?.session||e)}catch{return!1}}syncGlobalSdkAuth(){const t=window.AOVBoostSDK;!t||typeof t!="object"||(t.sessionId=this.anonymousId,t.sessionToken=this.sessionToken)}sync(){if(!this.anonymousId||!this.sessionToken){this.ensureAuthenticated();return}const t=this.getSnapshot(),e=JSON.stringify({...this.getAuthPayload(),events:[{type:"session_sync",ts:Date.now(),sessionId:this.anonymousId,shop:this.shop,url:window.location.href,referrer:document.referrer,snapshot:t,...t}]});fetch(this.endpoint("/events"),{method:"POST",headers:{"Content-Type":"application/json","X-AOVBoost-Shop":this.shop},body:e,keepalive:!0}).then(s=>{s.status===401&&this.refreshAuth()}).catch(()=>{})}updateJourneyStage(){if(this.cartProductIds.size>0){this.journeyStage="buying";return}if(this.cartItemCount>0){this.journeyStage="buying";return}if(this.getSnapshotDuration()>=60||Array.from(this.productViewCounts.values()).some(t=>t>=2)){this.journeyStage="deciding";return}if(this.viewedProductIds.size>=3){this.journeyStage="comparing";return}this.journeyStage="discovering"}endpoint(t){return`${this.apiBase.replace(/\/$/,"")}${t}`}async ensureStorefrontSession(t={}){const e=t.forceRefresh?null:this.getStoredStorefrontSession();if(e){this.anonymousId=e.sessionId,this.sessionToken=e.sessionToken;return}const s=await fetch(this.endpoint("/session"),{method:"GET",headers:{Accept:"application/json"}});if(!s.ok)throw new Error(`Session bootstrap failed: ${s.status}`);const r=await s.json();if(!this.applyStorefrontSession(r))throw new Error("Invalid storefront session bootstrap response")}getStoredStorefrontSession(){try{const t=JSON.parse(window.localStorage.getItem($)||"null");return!t||t.shop!==this.shop||!t.sessionId||!t.sessionToken||Number(t.expiresAt||0)<=Math.floor(Date.now()/1e3)+60?null:t}catch{return null}}storeStorefrontSession(t){try{window.localStorage.setItem($,JSON.stringify(t)),window.localStorage.setItem(P,t.sessionId)}catch{}}bootstrapLocalSession(){let t="";try{t=window.localStorage.getItem(P)||"",t||(t=typeof crypto<"u"&&"randomUUID"in crypto?crypto.randomUUID():`local-${Date.now()}-${Math.random().toString(36).slice(2)}`,window.localStorage.setItem(P,t))}catch{t=`local-${Date.now()}-${Math.random().toString(36).slice(2)}`}this.anonymousId=t,this.sessionToken=""}getSnapshotDuration(){return Math.round((Date.now()-this.startedAt)/1e3)}}function yt(i){const t=j(i);return t?{shop:String(t.shop||""),sessionId:String(t.sessionId||""),sessionToken:String(t.sessionToken||""),expiresAt:Number(t.expiresAt||0)}:null}function j(i){return i&&typeof i=="object"&&!Array.isArray(i)?i:null}function E(i){const t=i.product;return String(i.productId||i.product_id||t?.id||"")}function F(i,t,e){return Math.min(Math.max(i,t),e)}const W=10*60*1e3,H=5*60*1e3,R=30*1e3,wt={long_product_dwell:{category:"browsing_behavior",widgetHint:"chat",throttleMs:60*1e3},repeated_product_view:{category:"browsing_behavior",widgetHint:"bundle",throttleMs:60*1e3},scroll_depth_interest:{category:"browsing_behavior",widgetHint:"chat",oncePerSession:!0},comparison_page_visit:{category:"browsing_behavior",widgetHint:"chat",oncePerSession:!0},search_query:{category:"browsing_behavior",widgetHint:"rec_strip",throttleMs:15*1e3},exit_intent:{category:"browsing_behavior",widgetHint:"exit_intent",oncePerSession:!0},cart_item_added:{category:"cart_checkout",widgetHint:"upsell_drawer",throttleMs:2500,requestDelayMs:50},cart_abandoned:{category:"cart_checkout",widgetHint:"discount_nudge",oncePerSession:!0},cart_value_threshold:{category:"cart_checkout",widgetHint:"discount_nudge",throttleMs:30*1e3},cart_item_removed:{category:"cart_checkout",widgetHint:"rec_strip",throttleMs:5e3},checkout_started:{category:"cart_checkout",widgetHint:"upsell_drawer",oncePerSession:!0},price_hesitation:{category:"user_intent",widgetHint:"toast",throttleMs:30*1e3},price_sensitive_chat:{category:"user_intent",widgetHint:"toast",requestOffer:!1,throttleMs:30*1e3},wishlist_save:{category:"user_intent",widgetHint:"toast",throttleMs:30*1e3},coupon_field_focus:{category:"user_intent",widgetHint:"toast",oncePerSession:!0},purchase_history_match:{category:"customer_profile_loyalty",widgetHint:"chat",throttleMs:60*1e3},loyalty_tier_reached:{category:"customer_profile_loyalty",widgetHint:"chat",throttleMs:60*1e3},subscription_renewal_due:{category:"customer_profile_loyalty",widgetHint:"toast",throttleMs:60*1e3},first_time_visitor:{category:"customer_profile_loyalty",widgetHint:"chat",oncePerSession:!0},flash_sale_window:{category:"time_based",widgetHint:"countdown_banner",oncePerSession:!0},post_purchase_window:{category:"time_based",widgetHint:"post_purchase",oncePerSession:!0},inactivity_timeout:{category:"time_based",widgetHint:"chat",oncePerSession:!0},seasonal_calendar:{category:"time_based",widgetHint:"countdown_banner",oncePerSession:!0},low_inventory_alert:{category:"external_system",widgetHint:"inline_alert",throttleMs:60*1e3},price_drop_webhook:{category:"external_system",widgetHint:"inline_alert",throttleMs:60*1e3},crm_segment_update:{category:"external_system",widgetHint:"chat",throttleMs:60*1e3},payment_failure:{category:"external_system",widgetHint:"toast",throttleMs:60*1e3}};class bt{constructor(t){n(this,"abortController",new AbortController);n(this,"firedAt",new Map);n(this,"timers",new Map);n(this,"activePriceTarget",null);n(this,"options");n(this,"handleStorefrontEvent",t=>{const e=y(t.detail);e.type&&(e.type==="product_view"&&(this.scheduleProductDwell(String(e.productId||"")),this.handleRepeatedProductView(String(e.productId||""))),e.type==="scroll_depth"&&Number(e.depth||0)>=75&&this.fire("scroll_depth_interest",{depth:Number(e.depth||0)}),e.type==="search"&&String(e.query||"").trim().length>=2&&this.fire("search_query",{query:String(e.query||"").trim()}),e.type==="add_to_cart"&&this.syncCartAndFire("cart_item_added",e),e.type==="remove_from_cart"&&this.syncCartAndFire("cart_item_removed",e),e.type==="cart_update"&&this.handleCartState(e),e.type==="checkout_start"&&this.fire("checkout_started",{path:e.path||window.location.pathname}))});n(this,"handleCustomTrigger",t=>{const e=y(t.detail),s=String(e.type||e.trigger||"").trim();s&&this.fire(s,e)});n(this,"handleProfileEvent",t=>{const e=y(t.detail),s=String(e.type||"crm_segment_update");this.fire(s,e)});n(this,"handleSystemEvent",t=>{const e=y(t.detail),s=String(e.type||"external_system_event");this.fire(s,e)});this.options=t}init(){document.addEventListener("aovboost:event",this.handleStorefrontEvent,{signal:this.abortController.signal}),document.addEventListener("aovboost:trigger",this.handleCustomTrigger,{signal:this.abortController.signal}),document.addEventListener("aovboost:profile-event",this.handleProfileEvent,{signal:this.abortController.signal}),document.addEventListener("aovboost:system-event",this.handleSystemEvent,{signal:this.abortController.signal}),this.installProductDwellTracking(),this.installComparisonTracking(),this.installExitIntentTracking(),this.installPriceHoverTracking(),this.installCouponFocusTracking(),this.installWishlistTracking(),this.installInactivityTracking(),this.installFirstTimeVisitorTracking(),this.installInitialCartTracking(),this.installPostPurchaseTracking(),this.installScheduledCampaignTracking()}destroy(){this.abortController.abort(),this.timers.forEach(t=>window.clearTimeout(t)),this.timers.clear()}trigger(t,e={}){this.fire(t,e)}installProductDwellTracking(){this.scheduleProductDwell(I())}scheduleProductDwell(t){this.clearTimer("product_dwell"),!(!t||!kt())&&this.setTimer("product_dwell",()=>{this.fire("long_product_dwell",{productId:t,dwellSeconds:R/1e3})},R)}handleRepeatedProductView(t){if(!t)return;const e=y(this.options.sessionManager.getSnapshot().context.productViewCounts),s=Number(e[t]||0);s>=2&&this.fire("repeated_product_view",{productId:t,viewCount:s})}installComparisonTracking(){const t=`${window.location.pathname} ${document.title}`.toLowerCase();/\b(compare|comparison|versus|vs|alternative|competitor)\b/.test(t)&&window.setTimeout(()=>{this.fire("comparison_page_visit",{path:window.location.pathname})},800)}installExitIntentTracking(){document.addEventListener("mouseleave",t=>{t.clientY<=8&&this.fire("exit_intent",{immediate:!0,path:window.location.pathname})},{signal:this.abortController.signal})}installPriceHoverTracking(){document.addEventListener("mouseover",t=>{const e=Tt(t.target);!e||e===this.activePriceTarget||(this.activePriceTarget=e,this.clearTimer("price_hover"),this.setTimer("price_hover",()=>{this.fire("price_hesitation",{productId:I(),priceText:e.textContent?.trim().slice(0,80)||""})},1200))},{signal:this.abortController.signal}),document.addEventListener("mouseout",t=>{const e=this.activePriceTarget;if(!e)return;const s=t.relatedTarget;s&&e.contains(s)||(this.activePriceTarget=null,this.clearTimer("price_hover"))},{signal:this.abortController.signal})}installCouponFocusTracking(){document.addEventListener("focusin",t=>{const e=t.target;!e||!At(e)||this.fire("coupon_field_focus",{fieldName:e.name||e.id||""})},{signal:this.abortController.signal})}installWishlistTracking(){document.addEventListener("click",t=>{t.target?.closest?.("[data-wishlist], [data-save-product], .wishlist, .wishlist-button, [aria-label*='wishlist'], [aria-label*='Wishlist'], [aria-label*='save'], [aria-label*='Save']")&&this.fire("wishlist_save",{productId:I()})},{signal:this.abortController.signal})}installInactivityTracking(){const t=()=>{this.clearTimer("inactivity"),this.setTimer("inactivity",()=>{this.fire("inactivity_timeout",{idleSeconds:H/1e3})},H)};["click","keydown","scroll","touchstart"].forEach(e=>{window.addEventListener(e,t,{passive:!0,signal:this.abortController.signal})}),t()}installFirstTimeVisitorTracking(){try{const t="aovboost_returning_visitor";if(window.localStorage.getItem(t)==="true")return;window.localStorage.setItem(t,"true"),window.setTimeout(()=>{this.fire("first_time_visitor",{path:window.location.pathname})},1800)}catch{}}installInitialCartTracking(){/\/cart(?:\/|$)/.test(window.location.pathname)&&window.setTimeout(async()=>{const t=await this.readCart();if(t.cartItemCount<=0)return;const e={...t,source:"initial_cart_state"};this.options.eventBus.track("cart_update",e),this.fire("cart_item_added",e),this.handleCartState(e)},900)}installPostPurchaseTracking(){xt()&&window.setTimeout(()=>{this.fire("post_purchase_window",{path:window.location.pathname})},1200)}installScheduledCampaignTracking(){const t=y(window.AOVBoost?.campaign),e=String(t.type||"");if(!e)return;const s=Date.parse(String(t.startsAt||"")),r=Date.parse(String(t.endsAt||"")),a=Date.now();(!Number.isFinite(s)||s<=a)&&(!Number.isFinite(r)||r>a)&&this.fire(e==="seasonal"?"seasonal_calendar":"flash_sale_window",{campaign:t,endsAt:t.endsAt})}syncCartAndFire(t,e){window.setTimeout(async()=>{const s=await this.readCart(),r={...e,...s};this.fire(t,r),(s.cartProductIds.length>0||s.cartValue>0)&&this.options.eventBus.track("cart_update",r),this.handleCartState(r)},350)}async readCart(){try{const t=await fetch("/cart.js",{headers:{Accept:"application/json"},keepalive:!0});if(!t.ok)throw new Error(`Cart read failed: ${t.status}`);const e=await t.json(),s=Array.isArray(e.items)?e.items:[],r=s.map(c=>z(c)).filter(Boolean),a=s.map(c=>G(c)).filter(Boolean);return{cartToken:e.token||"",cartProductIds:r,cartVariantIds:a,cartItems:s.map(c=>({productId:z(c),variantId:G(c),quantity:Number(c.quantity||1),title:String(c.product_title||c.title||""),handle:String(c.handle||c.url||"").split("/products/")[1]?.split(/[?#/]/)[0]||""})),cartItemCount:Number(e.item_count||s.length||0),cartValue:Number(e.total_price||0)/100}}catch{return{cartToken:"",cartProductIds:[],cartVariantIds:[],cartItems:[],cartItemCount:0,cartValue:0}}}handleCartState(t){const e=Number(t.cartValue||0),s=Number(t.cartItemCount||0);e>0&&this.fire("cart_value_threshold",t),this.clearTimer("cart_idle"),s>0&&this.setTimer("cart_idle",()=>{this.fire("cart_abandoned",{...t,idleSeconds:W/1e3})},W)}fire(t,e={}){const s=vt(t),r=Date.now(),a=s.throttleMs??10*1e3,c=this.firedAt.get(t)||0;if(r-c<a||s.oncePerSession&&_t(t))return;s.oncePerSession&&St(t),this.firedAt.set(t,r);const d={...e,triggerType:t,triggerCategory:s.category,widgetHint:s.widgetHint};this.options.eventBus.track(t,d),s.requestOffer!==!1&&window.setTimeout(()=>{this.options.offerPoller.requestOffer(t,d)},s.requestDelayMs??150)}setTimer(t,e,s){this.clearTimer(t),this.timers.set(t,window.setTimeout(e,s))}clearTimer(t){const e=this.timers.get(t);e&&window.clearTimeout(e),this.timers.delete(t)}}function vt(i){return wt[i]||{category:"external_system",widgetHint:"chat",throttleMs:3e4}}function y(i){return i&&typeof i=="object"&&!Array.isArray(i)?i:{}}function _t(i){try{return sessionStorage.getItem(`aovboost_trigger:${i}`)==="true"}catch{return!1}}function St(i){try{sessionStorage.setItem(`aovboost_trigger:${i}`,"true")}catch{}}function kt(){return/\/products(?:\/|$)/.test(window.location.pathname)||!!I()}function xt(){return/\/thank_you(?:\/|$)/.test(window.location.pathname)||!!window.Shopify?.checkout}function I(){const i=window.Shopify?.product||window.ShopifyAnalytics?.meta?.product||null;return i?U(i.gid||i.id):""}function U(i){const t=String(i||"");return t?t.startsWith("gid://shopify/Product/")?t:`gid://shopify/Product/${t}`:""}function It(i){const t=String(i||"");return t?t.startsWith("gid://shopify/ProductVariant/")?t:`gid://shopify/ProductVariant/${t}`:""}function z(i){const t=y(i.product);return U(i.product_id||i.productId||i.product_gid||i.productGid||t.id)}function G(i){const t=y(i.variant);return It(i.variant_id||i.variantId||i.id||i.variant_gid||i.variantGid||t.id)}function Tt(i){const t=i instanceof HTMLElement?i:null;return t?t.closest("[data-price], .price, .product-price, .product__price, [class*='price'], [class*='Price'], [id*='price'], [id*='Price']"):null}function At(i){const t=[i.name,i.id,i.placeholder,i.getAttribute("aria-label"),i.getAttribute("autocomplete")].filter(Boolean).join(" ").toLowerCase();return/\b(coupon|discount|promo|promotion|voucher|code)\b/.test(t)}const Y="aovboost_dismissed_widgets";class p{constructor(t){n(this,"root");n(this,"container");this.payload=t,this.container=document.createElement("div"),this.container.setAttribute("data-aovboost-widget",this.getWidgetType()),this.root=this.container.attachShadow({mode:"open"}),this.injectStyles()}destroy(){this.container.remove()}mount(t=document.body){t.appendChild(this.container),this.render(),this.trackImpression()}injectStyles(){const t=document.createElement("style");t.textContent=$t,this.root.appendChild(t)}trackImpression(){this.track("widget_impression",{})}trackClick(t){this.track("widget_click",{action:t})}trackDismiss(){this.track("widget_dismiss",{});try{const t=JSON.parse(localStorage.getItem(Y)||"[]"),s=[...(Array.isArray(t)?t.filter(r=>typeof r=="object"&&r):[]).filter(r=>r.widgetType!==this.getWidgetType()),{widgetType:this.getWidgetType(),dismissedAt:Date.now()}];localStorage.setItem(Y,JSON.stringify(s))}catch{}}track(t,e){const s=window.AOVBoostSDK?.track,r={type:t,widgetType:this.getWidgetType(),offerId:this.payload.offerId,...e};if(typeof s=="function"){s(t,r);return}document.dispatchEvent(new CustomEvent("aovboost:track",{detail:r}))}html(t){const e=this.root.querySelector("[data-aovboost-content]");e&&e.remove();const s=document.createElement("div");s.setAttribute("data-aovboost-content","true"),s.innerHTML=t,this.root.appendChild(s)}}function o(i,t=""){return Pt(typeof i=="string"&&i.trim()?i:t)}function b(i,t="USD"){const e=Number(i||0);try{return new Intl.NumberFormat(void 0,{style:"currency",currency:t}).format(e)}catch{return`$${e.toFixed(2)}`}}function S(i){const e=[i.products,i.bundle?.items,i.items].find(s=>Array.isArray(s));return Array.isArray(e)?e.map(s=>{const r=s.product||s.target||s;return{id:r.id||s.productId||s.targetId,variantId:r.variantId||s.variantId||"",title:r.title||s.title||"Recommended product",handle:r.handle||s.handle||"",imageUrl:r.imageUrl||r.image||s.imageUrl||s.image,price:r.price||s.price||"",quantity:s.quantity||1,reason:s.reason||s.affinity?.reason||s.reasoning||"",orderCount:s.orderCount||s.affinity?.orderCount||0}}):[]}async function V(i,t=1){if(!i)return null;const e=String(i).split("/").pop(),s=await fetch("/cart/add.js",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:e,quantity:t})});return s.ok?s.json():null}async function Ct(i){const t=i.filter(s=>s.variantId).map(s=>({id:String(s.variantId).split("/").pop(),quantity:s.quantity||1}));if(t.length===0)return null;const e=await fetch("/cart/add.js",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({items:t})});return e.ok?e.json():null}function Pt(i){return String(i||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;")}const $t=`
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
`;class Et extends p{getWidgetType(){return"bundle"}render(){const t=this.payload.bundle||{},e=this.payload.copy||{},s=S(this.payload),r=String(window.AOVBoost?.currency||"USD"),a=s.length>0&&s.every(l=>l.variantId),c=s.find(l=>l.handle)?.handle,d=s.reduce((l,f)=>l+Number(f.price||0)*Number(f.quantity||1),0),u=Number(t.discountValue||0),h=t.discountType==="percentage"?d*(1-u/100):t.discountType==="fixed"?Math.max(d-u,0):d;this.html(`
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
            ${s.map(l=>`
                  <article class="tile">
                    ${l.imageUrl?`<img src="${o(l.imageUrl)}" alt="${o(l.title)}" loading="lazy">`:""}
                    <p class="product-name">${o(l.title)}</p>
                    <span class="price">${o(l.price?b(l.price,r):"")}</span>
                  </article>
                `).join("")}
          </div>
          <div class="totals">
            ${d>h?`<span class="strike">${b(d,r)}</span>`:""}
            <strong>${b(h,r)}</strong>
          </div>
          <div class="actions">
            ${a?`<button type="button" class="primary" data-add>${o(e.ctaText||"Add bundle to cart")}</button>`:c?`<a class="primary" href="/products/${o(c)}">${o(e.ctaText||"View bundle products")}</a>`:""}
          </div>
        </div>
      </section>
    `),this.root.querySelector("[data-add]")?.addEventListener("click",async()=>{this.trackClick("add_bundle"),await Ct(s.map(l=>({variantId:l.variantId,quantity:Number(l.quantity||1)}))),document.dispatchEvent(new CustomEvent("add-to-cart",{detail:{source:"bundle_widget"}}))})}}class Vt extends p{constructor(e){super(e);n(this,"messages",[]);n(this,"expanded",!1);n(this,"sending",!1);const s=e.copy;this.messages.push({role:"assistant",content:String(s?.greeting||e.greeting||"Hi. Can I help you find the perfect product today?")})}getWidgetType(){return"chat"}render(){const e=this.payload.copy||{};this.html(`
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
        ${this.expanded?this.renderChatUi():`<p class="body">${o(e.greeting||this.messages[0].content)}</p>
              <div class="actions">
                <button type="button" class="primary" data-expand>${o(e.ctaAccept||"Chat with AI")}</button>
                <button type="button" class="secondary" data-dismiss>${o(e.ctaDecline||"Browse myself")}</button>
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
        ${o(e.content)}
        ${this.renderProductLinks(e.content)}
      </div>
    `}renderProductLinks(e){const s=e.match(/\/products\/([a-z0-9-]+)/i);if(!s)return"";const r=s[1];return`
      <div class="inline-product">
        <p class="product-name">${o(r.replace(/-/g," "))}</p>
        <a href="/products/${o(r)}">View product</a>
      </div>
    `}appendMessage(e){const s=this.root.querySelector("[data-messages]");if(!s)throw new Error("Messages container not found");const r=document.createElement("div");return r.className=`bubble ${e.role}`,r.textContent=e.content,s.appendChild(r),this.scrollToBottom(),r}async sendMessage(){if(this.sending)return;const e=this.root.querySelector("[data-input]"),s=this.root.querySelector("[data-send]"),r=e?.value.trim();if(!r)return;this.sending=!0,s&&(s.disabled=!0),e.value="",this.messages.push({role:"user",content:r}),this.appendMessage({role:"user",content:r}),this.trackClick("send_message"),Lt(r)&&(this.track("chat_intent",{intent:"price_sensitive"}),document.dispatchEvent(new CustomEvent("aovboost:trigger",{detail:{type:"price_sensitive_chat",message:r}})));const a=this.messages.push({role:"assistant",content:""})-1,c=this.appendMessage({role:"assistant",content:""});this.showTyping();try{let d=await this.requestChat(r);if(d.status===401&&(await this.applyRecoverySession(d)||await window.AOVBoostSDK?.refreshSession?.(),d=await this.requestChat(r)),!d.ok)throw new Error(`Server returned ${d.status}`);if(!d.body)throw new Error("Missing stream body");const u=d.body.getReader(),h=new TextDecoder;let l="",f=!1;for(;;){const{done:k,value:v}=await u.read();if(k)break;l+=h.decode(v,{stream:!0});const _=l.split(`
`);l=_.pop()||"";for(const D of _){if(!D.startsWith("data: "))continue;const x=D.slice(6);if(x!=="[DONE]")try{const Q=JSON.parse(x);Q.delta&&(f||(this.removeTyping(),f=!0),this.messages[a].content+=Q.delta,c.textContent=this.messages[a].content,this.updateProductLink(this.messages[a].content,c),this.scrollToBottom())}catch{}}}f||(this.removeTyping(),this.messages[a].content||(this.messages[a].content="I can help you compare products and find the right add-ons.",c.textContent=this.messages[a].content))}catch{this.removeTyping(),this.messages[a].content=this.messages[a].content||"I had trouble connecting. Please try again in a moment.",c.textContent=this.messages[a].content}finally{this.sending=!1,s&&(s.disabled=!1)}}async requestChat(e){const s=window.AOVBoost||{},r=window.AOVBoostSDK,a=Dt(s.apiBase).replace(/\/$/,""),c=typeof r?.getSignedAuthPayload=="function"?await r.getSignedAuthPayload():null;if(!c)throw new Error("Missing signed storefront auth");return fetch(`${a}/chat`,{method:"POST",headers:{"Content-Type":"application/json","X-AOVBoost-Shop":c.shop||s.shop||""},body:JSON.stringify({...c,message:e,messageHistory:this.messages.slice(0,-2)})})}async applyRecoverySession(e){try{const s=await e.clone().json(),r=s?.storefrontSession||s?.session,a=window.AOVBoostSDK?.applySession;return typeof a=="function"?!!a(r):!1}catch{return!1}}showTyping(){const e=this.root.querySelector("[data-messages]");if(!e)return;const s=document.createElement("div");s.className="bubble assistant dots",s.dataset.typing="true",s.innerHTML="<span>.</span><span>.</span><span>.</span>",e.appendChild(s),this.scrollToBottom()}removeTyping(){const e=this.root.querySelector("[data-typing]");e&&e.remove()}updateProductLink(e,s){const r=e.match(/\/products\/([a-z0-9-]+)/i),a=s.querySelector(".inline-product");if(a&&a.remove(),!r)return;const c=r[1],d=document.createElement("div");d.className="inline-product",d.innerHTML=`
      <p class="product-name">${o(c.replace(/-/g," "))}</p>
      <a href="/products/${o(c)}">View product</a>
    `,s.appendChild(d)}scrollToBottom(){const e=this.root.querySelector("[data-messages]");e&&(e.scrollTop=e.scrollHeight)}dismiss(){this.trackDismiss(),this.container.animate([{transform:"translateY(0)"},{transform:"translateY(120%)"}],{duration:180,easing:"ease-in",fill:"forwards"}),window.setTimeout(()=>this.destroy(),190)}}function Lt(i){return/\b(expensive|cheaper|cheap|discount|coupon|promo|deal|sale|price|afford|budget|cost)\b/i.test(i)}function Dt(i){const t=typeof i=="string"?i.trim():"";return!t||t==="/api"||t.startsWith("/api/")?"/apps/aovboost":t.includes("/apps/aovboost")||t.startsWith("/apps/")?t:"/apps/aovboost"}class Mt extends p{constructor(){super(...arguments);n(this,"timer")}getWidgetType(){return"countdown_banner"}render(){const e=this.payload.copy||{},s=e.headline||this.payload.headline||"Limited-time offer",r=e.subheadline||e.offerLine||this.payload.body||"Relevant bundles and add-ons are available for this session.";this.html(`
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
          <h3 class="title">${o(s)}</h3>
          <p class="body">${o(r)}</p>
        </div>
        <strong class="timer" data-countdown></strong>
        <button type="button" class="icon" data-dismiss aria-label="Close">x</button>
      </aside>
    `),this.root.querySelector("[data-dismiss]")?.addEventListener("click",()=>{this.trackDismiss(),this.destroy()}),this.tick(),this.timer=window.setInterval(()=>this.tick(),1e3)}destroy(){this.timer&&window.clearInterval(this.timer),super.destroy()}tick(){const e=this.root.querySelector("[data-countdown]");if(!e)return;const s=Date.parse(String(this.payload.endsAt||""));if(!Number.isFinite(s)){e.textContent="Today";return}const r=Math.max(s-Date.now(),0);if(r<=0){this.destroy();return}const a=Math.floor(r/36e5),c=Math.floor(r%36e5/6e4),d=Math.floor(r%6e4/1e3);e.textContent=a>0?`${a}h ${c}m`:`${c}m ${d.toString().padStart(2,"0")}s`}}class qt extends p{getWidgetType(){return"discount_nudge"}render(){this.draw(),document.addEventListener("add-to-cart",()=>this.draw())}draw(){const t=this.payload.copy||{},e=String(window.AOVBoost?.currency||"USD"),s=Number(this.payload.threshold||50),r=Number(this.payload.cartValue||0),a=Math.max(s-r,0),c=s>0?Math.min(r/s,1):0;this.html(`
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
          <span>${a>0?o(t.progressLabel||`You're ${b(a,e)} away from your reward`):o(t.rewardDescription||"Reward unlocked")}</span>
          <button type="button" class="icon" data-dismiss aria-label="Close">x</button>
        </div>
        <div class="track" aria-hidden="true"><span></span></div>
      </div>
    `),this.root.querySelector("[data-dismiss]")?.addEventListener("click",()=>{this.trackDismiss(),this.destroy()}),a<=0&&window.setTimeout(()=>this.destroy(),3e3)}}class Nt extends p{constructor(){super(...arguments);n(this,"shown",!1);n(this,"handleMouseLeave",e=>{e.clientY<10&&this.show()});n(this,"handleVisibility",()=>{document.visibilityState==="hidden"&&this.show()})}getWidgetType(){return"exit_intent"}mount(e=document.body){if(e.appendChild(this.container),!this.shouldSkip()){if(this.payload.immediate){this.show();return}document.addEventListener("mouseleave",this.handleMouseLeave),document.addEventListener("visibilitychange",this.handleVisibility)}}render(){const e=this.payload.copy||{};this.html(`
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
    `),this.root.querySelector("[data-claim]")?.addEventListener("click",()=>{this.trackClick("claim_exit_offer"),this.destroy()}),this.root.querySelectorAll("[data-dismiss]").forEach(s=>{s.addEventListener("click",()=>{this.trackDismiss(),this.destroy()})})}destroy(){document.removeEventListener("mouseleave",this.handleMouseLeave),document.removeEventListener("visibilitychange",this.handleVisibility),super.destroy()}show(){if(!(this.shown||this.hasFired())){this.shown=!0;try{sessionStorage.setItem("aovboost_exit_intent_fired","true")}catch{}this.render(),this.trackImpression()}}hasFired(){try{return sessionStorage.getItem("aovboost_exit_intent_fired")==="true"}catch{return!1}}shouldSkip(){return/\/(?:checkout|thank_you)(?:\/|$)/.test(window.location.pathname)}}class Bt extends p{getWidgetType(){return"inline_alert"}render(){const t=this.payload.copy||{},e=t.headline||this.payload.headline||"Store update",s=t.subheadline||t.offerLine||this.payload.body||"A relevant product update is available.";this.html(`
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
            <p class="body">${o(s)}</p>
          </div>
          <button type="button" class="icon" data-dismiss aria-label="Close">x</button>
        </div>
      </aside>
    `),this.root.querySelector("[data-dismiss]")?.addEventListener("click",()=>{this.trackDismiss(),this.destroy()})}}class Ot extends p{getWidgetType(){return"post_purchase"}mount(t=document.body){this.isThankYouPage()&&super.mount(t)}render(){const t=this.payload.copy||{},e=S(this.payload)[0]||this.payload.product||{},s=String(window.AOVBoost?.currency||"USD");this.html(`
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
              <span class="price">${o(e.price?b(e.price,s):"")}</span>
            </div>
            <p class="reason">${o(t.oneLineReason||"A useful add-on for what you just bought.")}</p>
            <button type="button" class="primary" data-add>${o(t.ctaText||"Add to my order")}</button>
          </div>
        </article>
      </section>
    `),this.root.querySelector("[data-add]")?.addEventListener("click",async()=>{this.trackClick("add_post_purchase");const r=e.variantId;if(r){await V(r);return}const a=e.handle;a&&(window.location.href=`/products/${a}`)})}isThankYouPage(){return/\/thank_you(?:\/|$)/.test(window.location.pathname)||!!window.Shopify?.checkout}}class jt extends p{getWidgetType(){return"rec_strip"}render(){const t=S(this.payload),e=String(window.AOVBoost?.currency||"USD");this.html(`
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
                  ${s.reason?`<span class="badge">${o(s.reason)}</span>`:""}
                  ${s.imageUrl?`<img data-src="${o(s.imageUrl)}" alt="${o(s.title)}">`:""}
                  <p class="product-name">${o(s.title)}</p>
                  <span class="price">${o(s.price?b(s.price,e):"")}</span>
                  ${s.variantId?`<button type="button" class="primary" data-add="${o(s.variantId)}">Add to cart</button>`:s.handle?`<a class="primary" href="/products/${o(s.handle)}">View product</a>`:""}
                </article>
              `).join("")}
        </div>
      </section>
    `),this.lazyLoadImages(),this.root.querySelectorAll("[data-add]").forEach(s=>{s.addEventListener("click",async()=>{this.trackClick("add_recommendation"),await V(s.dataset.add)})})}lazyLoadImages(){const t=Array.from(this.root.querySelectorAll("img[data-src]"));if(!("IntersectionObserver"in window)){t.forEach(s=>{s.src=s.dataset.src||""});return}const e=new IntersectionObserver(s=>{s.forEach(r=>{if(!r.isIntersecting)return;const a=r.target;a.src=a.dataset.src||"",e.unobserve(a)})});t.forEach(s=>e.observe(s))}}class Ft extends p{constructor(){super(...arguments);n(this,"interval")}getWidgetType(){return"social_proof"}render(){const s=S(this.payload).filter(a=>Number(a.orderCount||0)>0).map(a=>`${Number(a.orderCount)} people bought this with ${a.title}`);s.length===0&&s.push("Frequently bought together"),this.html(`
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
      <div class="pill" role="status"><span class="dot"></span><span data-message>${o(s[0])}</span></div>
    `);let r=0;this.interval=window.setInterval(()=>{r=(r+1)%s.length;const a=this.root.querySelector("[data-message]");a&&(a.textContent=s[r])},5e3)}destroy(){this.interval&&window.clearInterval(this.interval),super.destroy()}}class Wt extends p{getWidgetType(){return"toast"}render(){const t=this.payload.copy||{},e=t.headline||this.payload.headline||"A better option is available",s=t.subheadline||t.offerLine||this.payload.body||"I can help find a better match or a useful offer.",r=t.ctaText||this.payload.ctaText||"Open assistant";this.html(`
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
            <p class="body">${o(s)}</p>
          </div>
          <button type="button" class="icon" data-dismiss aria-label="Close">x</button>
        </div>
        <div class="actions">
          <button type="button" class="primary" data-chat>${o(r)}</button>
        </div>
      </aside>
    `),this.root.querySelector("[data-dismiss]")?.addEventListener("click",()=>{this.trackDismiss(),this.destroy()}),this.root.querySelector("[data-chat]")?.addEventListener("click",()=>{this.trackClick("open_assistant"),document.dispatchEvent(new CustomEvent("aovboost:trigger",{detail:{type:"long_product_dwell",source:"toast"}})),this.destroy()}),window.setTimeout(()=>this.destroy(),9e3)}}class Ht extends p{constructor(){super(...arguments);n(this,"timer");n(this,"deadline",Date.now()+8e3)}getWidgetType(){return"upsell_drawer"}render(){const e=S(this.payload).slice(0,3),s=this.payload.copy||{},r=String(window.AOVBoost?.currency||"USD");this.html(`
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
            <h3 class="title">${o(s.headline||"Great choice. Complete the set")}</h3>
            <p class="body">People who bought this also love:</p>
          </div>
          <button type="button" class="icon" data-dismiss aria-label="Close">x</button>
        </div>
        <div class="timer"><span data-timer></span></div>
        <div class="product-grid">
          ${e.map(a=>`
                <article class="product-card">
                  ${a.imageUrl?`<img src="${o(a.imageUrl)}" alt="${o(a.title)}" loading="lazy">`:"<span></span>"}
                  <div class="stack">
                    <div>
                      <p class="product-name">${o(a.title)}</p>
                      <span class="price">${o(a.price?b(a.price,r):"")}</span>
                    </div>
                    <p class="reason">${o(a.reason||s.whyThisGoes||"It pairs well with your cart.")}</p>
                    ${a.variantId?`<button type="button" class="primary" data-add="${o(a.variantId)}">Add to cart</button>`:a.handle?`<a class="primary" href="/products/${o(a.handle)}">View product</a>`:""}
                  </div>
                </article>
              `).join("")}
        </div>
        <div class="actions">
          <a class="secondary" href="/cart">Continue to cart</a>
        </div>
      </aside>
    `),this.root.querySelectorAll("[data-dismiss]").forEach(a=>{a.addEventListener("click",()=>this.dismiss())}),this.root.querySelectorAll("[data-add]").forEach(a=>{a.addEventListener("click",async()=>{this.trackClick("add_upsell"),await V(a.dataset.add)})}),this.startCountdown()}destroy(){this.timer&&window.clearInterval(this.timer),super.destroy()}startCountdown(){this.timer&&window.clearInterval(this.timer),this.deadline=Date.now()+8e3,this.timer=window.setInterval(()=>{const e=Math.max(this.deadline-Date.now(),0),s=this.root.querySelector("[data-timer]");s&&(s.style.transform=`scaleX(${e/8e3})`),e<=0&&this.dismiss()},120)}dismiss(){this.trackDismiss(),this.container.animate([{transform:"translateX(0)"},{transform:"translateX(100%)"}],{duration:180,easing:"ease-in",fill:"forwards"}),window.setTimeout(()=>this.destroy(),190)}}const K="aovboost_dismissed_widgets",Rt=30*60*1e3;class Ut{constructor(){n(this,"activeWidget",null);n(this,"activeKey","");n(this,"activeWidgetType","")}mountDecision(t){if(!t.widgetType||this.getDismissedWidgets().includes(t.widgetType))return;const e=t.payload||{},s=String(e.offerId||""),r=`${t.widgetType}:${s}`;if(t.widgetType==="chat"&&this.activeWidgetType==="chat"||r===this.activeKey)return;this.destroyActive();const a=zt(t.widgetType,e);if(!a)return;const c=this.resolveTarget(t.widgetType);a.mount(c),this.activeWidget=a,this.activeKey=r,this.activeWidgetType=t.widgetType}destroyActive(){this.activeWidget?.destroy(),this.activeWidget=null,this.activeKey="",this.activeWidgetType=""}getDismissedWidgets(){try{const t=JSON.parse(localStorage.getItem(K)||"[]");if(!Array.isArray(t))return[];const e=Date.now(),s=t.filter(r=>r&&typeof r=="object").filter(r=>e-Number(r.dismissedAt||0)<Rt);return s.length!==t.length&&localStorage.setItem(K,JSON.stringify(s)),s.map(r=>String(r.widgetType||"")).filter(Boolean)}catch{return[]}}resolveTarget(t){return t==="bundle"?T(".product-form, [data-product-form]"):t==="rec_strip"?T(".product__description, [data-product-description]"):t==="social_proof"?T(".product-form__submit, [data-add-to-cart]"):t==="inline_alert"?T("[data-price], .product__price, .price, .product-form, [data-product-form]"):document.body}}function zt(i,t){switch(i){case"chat":return new Vt(t);case"toast":return new Wt(t);case"countdown_banner":return new Mt(t);case"inline_alert":return new Bt(t);case"bundle":return new Et(t);case"upsell_drawer":return new Ht(t);case"discount_nudge":return new qt(t);case"rec_strip":return new jt(t);case"social_proof":return new Ft(t);case"exit_intent":return new Nt(t);case"post_purchase":return new Ot(t);default:return null}}function T(i){const t=document.querySelector(i),e=document.createElement("div");return e.setAttribute("data-aovboost-mount",i),t?.parentElement?(t.insertAdjacentElement("afterend",e),e):(document.body.appendChild(e),e)}let J=!1;function L(){J||(J=!0,Gt().catch(i=>{console.log("AOVBoost SDK skipped:",i instanceof Error?i.message:String(i))}))}async function Gt(){try{const i=window.AOVBoost||{},t=i.shop;if(!t)return;X(i)||await Kt(i);const e=Yt(i.apiBase),s=new mt(t,e),r=new m({shop:t,sessionManager:s,apiBase:e}),a=new Ut,c=new dt({shop:t,apiBase:e,eventBus:r,sessionManager:s,widgetManager:a}),d=new bt({eventBus:r,offerPoller:c,sessionManager:s});await s.init(),window.AOVBoostSDK={shop:t,sessionId:s.anonymousId,sessionToken:s.getAuthPayload().sessionToken,refreshSession:async()=>{await s.refreshAuth(),s.syncGlobalSdkAuth()},getSignedAuthPayload:()=>s.getSignedAuthPayload(),applySession:u=>s.applyStorefrontSession(u),track:(u,h={})=>r.track(u,h),trigger:(u,h={})=>d.trigger(u,h),requestOffer:(u="global",h={})=>c.requestOffer(u,h),destroy:()=>{d.destroy(),c.destroy(),s.destroy(),a.destroyActive()}},d.init(),r.init(),c.init()}catch(i){console.log("AOVBoost SDK skipped:",i instanceof Error?i.message:String(i))}}function Yt(i){const t=typeof i=="string"?i.trim():"";return!t||t==="/api"||t.startsWith("/api/")?"/apps/aovboost":t.includes("/apps/aovboost")||t.startsWith("/apps/")?t:"/apps/aovboost"}function X(i){if(i.settings?.trackingConsentRequired!==!0)return!0;const t=window.Shopify?.customerPrivacy;return typeof t?.analyticsProcessingAllowed=="function"?!!t.analyticsProcessingAllowed():typeof t?.userCanBeTracked=="function"?!!t.userCanBeTracked():!0}function Kt(i){return new Promise(t=>{const e=()=>{X({...i,settings:{...i.settings,trackingConsentRequired:!1}})&&(s(),t())},s=()=>{["visitorConsentCollected","shopify:customer_privacy:consent_collected","aovboost:consent-granted"].forEach(r=>window.removeEventListener(r,e))};["visitorConsentCollected","shopify:customer_privacy:consent_collected","aovboost:consent-granted"].forEach(r=>window.addEventListener(r,e))})}return document.readyState==="loading"?document.addEventListener("DOMContentLoaded",L,{once:!0}):L(),g.init=L,Object.defineProperty(g,Symbol.toStringTag,{value:"Module"}),g}({});
