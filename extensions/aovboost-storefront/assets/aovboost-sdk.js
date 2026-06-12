var AOVBoostSDKBundle=function(f){"use strict";var Rt=Object.defineProperty;var Ut=(f,g,y)=>g in f?Rt(f,g,{enumerable:!0,configurable:!0,writable:!0,value:y}):f[g]=y;var n=(f,g,y)=>Ut(f,typeof g!="symbol"?g+"":g,y);class g{constructor(t){n(this,"queue",[]);n(this,"flushTimer");n(this,"scrollDepths",new Set);n(this,"originalFetch",null);n(this,"authFlushInFlight",!1);this.options=t}init(){this.installNavigationTracking(),this.installCartFetchTracking(),this.installCartDomTracking(),this.installScrollTracking(),this.installHoverTracking(),this.installSearchTracking(),document.addEventListener("add-to-cart",t=>{this.track("add_to_cart",y(t.detail))}),document.addEventListener("aovboost:track",t=>{const e=y(t.detail);this.track(String(e.type||"widget_event"),e)}),window.addEventListener("pagehide",()=>this.flush()),this.trackPageView()}track(t,e={}){const s={type:t,ts:Date.now(),sessionId:this.options.sessionManager.anonymousId,shop:this.options.shop,url:window.location.href,referrer:document.referrer,...e};this.options.sessionManager.recordEvent(s),this.queue.push(s),document.dispatchEvent(new CustomEvent("aovboost:event",{detail:s})),this.scheduleFlush()}flush(){if(this.flushTimer&&(window.clearTimeout(this.flushTimer),this.flushTimer=void 0),this.queue.length===0)return;if(!this.options.sessionManager.getAuthPayload().sessionToken){this.flushAfterAuth();return}const t=this.queue.splice(0);this.postEvents(t)}async flushAfterAuth(){if(!this.authFlushInFlight){this.authFlushInFlight=!0;try{await this.options.sessionManager.ensureAuthenticated()&&this.flush()}finally{this.authFlushInFlight=!1}}}scheduleFlush(){this.flushTimer||(this.flushTimer=window.setTimeout(()=>this.flush(),2e3))}endpoint(t){return`${(this.options.apiBase||"/apps/aovboost").replace(/\/$/,"")}${t}`}async postEvents(t,e=!1){const s=await this.options.sessionManager.getSignedAuthPayload();if(!s){this.queue.unshift(...t);return}try{const r=await fetch(this.endpoint("/events"),{method:"POST",headers:{"Content-Type":"application/json","X-AOVBoost-Shop":this.options.shop},body:JSON.stringify({...s,events:t}),keepalive:!0});if(r.status===401&&!e){if(await this.options.sessionManager.applySessionFromResponse(r)||await this.options.sessionManager.refreshAuth(),!this.options.sessionManager.getAuthPayload().sessionToken){this.queue.unshift(...t);return}await this.postEvents(t,!0);return}!r.ok&&r.status!==401&&this.queue.unshift(...t)}catch{this.queue.unshift(...t)}}installNavigationTracking(){const t=history.pushState,e=history.replaceState;history.pushState=(...s)=>{const r=t.apply(history,s);return window.setTimeout(()=>this.trackPageView(),0),r},history.replaceState=(...s)=>{const r=e.apply(history,s);return window.setTimeout(()=>this.trackPageView(),0),r},window.addEventListener("popstate",()=>this.trackPageView())}trackPageView(){this.track("page_view",{pageType:X()}),Q()&&this.track("checkout_start",{path:window.location.pathname});const t=K();t&&this.track("product_view",{productId:rt(t.gid||t.id),handle:t.handle,title:t.title});const e=J();(e||window.location.pathname.includes("/collections/"))&&this.track("collection_view",{collectionId:String(e?.id||""),handle:e?.handle||Z("/collections/"),title:e?.title})}installCartFetchTracking(){this.originalFetch||(this.originalFetch=window.fetch.bind(window),window.fetch=async(...t)=>{const e=tt(t[0]),s=t[1],r=await this.originalFetch(...t);try{x(e)?this.track("add_to_cart",{...T(s?.body),requestUrl:e}):et(e)?this.track("remove_from_cart",{...T(s?.body),requestUrl:e}):st(e)&&this.track("search",{query:it(e),requestUrl:e})}catch{}return r})}installCartDomTracking(){document.addEventListener("submit",t=>{const e=t.target;if(!(!e||!x(e.action||"")))try{this.track("add_to_cart",{...T(new FormData(e)),source:"cart_form_submit",requestUrl:e.action})}catch{this.track("add_to_cart",{source:"cart_form_submit",requestUrl:e.action})}},!0),document.addEventListener("click",t=>{const s=t.target?.closest?.("button[name='add'], [type='submit'][name='add'], [data-add-to-cart]");if(!s)return;const r=s.closest("form");r&&!x(r.action||"")||this.track("add_to_cart",{source:"add_button_click",requestUrl:r?.action||""})},!0)}installScrollTracking(){let t=!1;window.addEventListener("scroll",()=>{t||(t=!0,window.setTimeout(()=>{t=!1;const e=document.documentElement.scrollHeight-window.innerHeight;if(e<=0)return;const s=Math.round(window.scrollY/e*100);[25,50,75,90].forEach(r=>{s>=r&&!this.scrollDepths.has(r)&&(this.scrollDepths.add(r),this.track("scroll_depth",{depth:r}))})},200))},{passive:!0})}installHoverTracking(){document.addEventListener("mouseenter",t=>{const s=t.target?.closest?.(".product-card");if(!s)return;const r=window.setTimeout(()=>{this.track("product_hover",{productId:s.dataset.productId||s.dataset.productGid||"",handle:s.dataset.productHandle||""})},800);s.addEventListener("mouseleave",()=>window.clearTimeout(r),{once:!0})},!0)}installSearchTracking(){document.addEventListener("input",t=>{const e=t.target;if(!e||!`${e.name||""} ${e.id||""} ${e.type||""}`.toLowerCase().includes("search"))return;const r=e.value.trim();r.length<2||this.track("search",{query:r,source:"predictive_input"})},!0)}}function y(i){return i&&typeof i=="object"&&!Array.isArray(i)?i:{}}function K(){const i=window;return i.Shopify?.product||i.ShopifyAnalytics?.meta?.product||null}function J(){const i=window;return i.Shopify?.collection||i.ShopifyAnalytics?.meta?.collection||null}function X(){return window.ShopifyAnalytics?.meta?.page?.pageType||document.body?.dataset?.template||(window.location.pathname==="/"?"home":"other")}function Q(){return/\/checkout(?:\/|$)/.test(window.location.pathname)}function Z(i){const t=window.location.pathname.indexOf(i);return t===-1?"":window.location.pathname.slice(t+i.length).split("/")[0]||""}function tt(i){return typeof i=="string"?i:i instanceof URL?i.toString():i.url||""}function x(i){return/\/cart\/add(?:\.js)?/.test(i)}function et(i){return/\/cart\/(?:change|update)(?:\.js)?/.test(i)}function st(i){return i.includes("/search/suggest.json")}function it(i){try{return new URL(i,window.location.origin).searchParams.get("q")||""}catch{return""}}function T(i){if(!i)return{};if(typeof FormData<"u"&&i instanceof FormData)return{variantId:String(i.get("id")||i.get("items[0][id]")||""),quantity:Number(i.get("quantity")||1)};if(typeof URLSearchParams<"u"&&i instanceof URLSearchParams)return{variantId:String(i.get("id")||i.get("items[0][id]")||""),quantity:Number(i.get("quantity")||1)};try{const t=String(i);if(t.trim().startsWith("{")){const s=JSON.parse(t);return{productId:s.productId||s.product_id,variantId:s.id||s.items?.[0]?.id,quantity:s.quantity||s.items?.[0]?.quantity||1}}const e=new URLSearchParams(t);return{variantId:String(e.get("id")||e.get("items[0][id]")||""),quantity:Number(e.get("quantity")||1)}}catch{return{}}}function rt(i){const t=String(i||"");return t?t.startsWith("gid://shopify/Product/")?t:`gid://shopify/Product/${t}`:""}class ot{constructor(t){n(this,"timer");n(this,"inFlight",!1);n(this,"stopped",!1);n(this,"options");this.options=t}init(){window.setTimeout(()=>this.requestOffer("initial"),1200),this.options.pollMs&&(this.timer=window.setInterval(()=>this.requestOffer("poll"),this.options.pollMs)),document.addEventListener("aovboost:request-offer",()=>{this.requestOffer("manual")}),window.addEventListener("popstate",()=>{window.setTimeout(()=>this.requestOffer("navigation"),300)})}destroy(){this.stopped=!0,this.timer&&window.clearInterval(this.timer)}async requestOffer(t="manual",e={}){if(this.inFlight||this.stopped)return null;this.inFlight=!0;try{const s=this.options.sessionManager.getSnapshot(),r=Array.isArray(e.cartProductIds)?e.cartProductIds.map(String):s.cartProductIds,o=Array.isArray(e.cartVariantIds)?e.cartVariantIds.map(String):Array.isArray(s.context.cartVariantIds)?s.context.cartVariantIds.map(String):[],c=typeof e.cartValue=="number"?e.cartValue:s.cartValue,d=await this.options.sessionManager.getSignedAuthPayload();if(!d)return this.mountLocalFallback(t,e);const u={...d,currentProductId:ct(),currentPageType:nt(),cartProductIds:r,cartVariantIds:o,cartValue:c,dismissedWidgets:this.options.widgetManager.getDismissedWidgets(),trigger:t,triggerCategory:e.triggerCategory,triggerPayload:e};let h=await fetch(this.endpoint("/offer"),{method:"POST",headers:{"Content-Type":"application/json","X-AOVBoost-Shop":this.options.shop},body:JSON.stringify({...u,...d}),keepalive:!0});if(h.status===401){await this.options.sessionManager.applySessionFromResponse(h)||await this.options.sessionManager.refreshAuth();const _=await this.options.sessionManager.getSignedAuthPayload();if(!_)return this.mountLocalFallback(t,e);h=await fetch(this.endpoint("/offer"),{method:"POST",headers:{"Content-Type":"application/json","X-AOVBoost-Shop":this.options.shop},body:JSON.stringify({...u,..._}),keepalive:!0})}if(!h.ok)return this.mountLocalFallback(t,e);const l=await h.json();return l.widgetType?(this.options.widgetManager.mountDecision(l),l):this.mountLocalFallback(t,e)}catch{return this.mountLocalFallback(t,e)}finally{this.inFlight=!1}}endpoint(t){return`${this.options.apiBase.replace(/\/$/,"")}${t}`}mountLocalFallback(t,e){const s=at(t,e);return s?(this.options.widgetManager.mountDecision(s),s):null}}function at(i,t){const e=Number(t.cartValue||0);switch(i){case"first_time_visitor":case"long_product_dwell":case"scroll_depth_interest":case"comparison_page_visit":case"inactivity_timeout":case"purchase_history_match":case"loyalty_tier_reached":case"crm_segment_update":return{widgetType:"chat",payload:{offerId:`local:${i}`,greeting:"Hi. I can help you compare products and find useful add-ons.",copy:{greeting:"Hi. I can help you compare products and find useful add-ons.",ctaAccept:"Chat with AI",ctaDecline:"Browse myself"}},reasoning:"Local fallback for proactive chat trigger.",confidence:.4,aiProvider:"heuristic"};case"exit_intent":return{widgetType:"exit_intent",payload:{offerId:"local:exit_intent",immediate:!0,offerLine:"Before you go, I can help find a better match or bundle.",copy:{headline:"Wait before you go",offerLine:"I can help find a better match or bundle.",ctaText:"Open assistant",dismissText:"No thanks"}},reasoning:"Local fallback for exit intent.",confidence:.4,aiProvider:"heuristic"};case"cart_value_threshold":case"cart_abandoned":return{widgetType:"discount_nudge",payload:{offerId:`local:${i}`,cartValue:e,threshold:Number(t.threshold||50),copy:{progressLabel:"You are close to a reward",rewardDescription:"Add one more item to unlock the offer.",ctaText:"View picks"}},reasoning:"Local fallback for cart value or idle cart trigger.",confidence:.4,aiProvider:"heuristic"};case"flash_sale_window":case"seasonal_calendar":return{widgetType:"countdown_banner",payload:{offerId:`local:${i}`,endsAt:t.endsAt,body:"Limited-time product picks are available right now.",copy:{headline:"Limited-time offer",subheadline:"Relevant bundles and add-ons are available now.",ctaText:"View offer"}},reasoning:"Local fallback for scheduled campaign trigger.",confidence:.4,aiProvider:"heuristic"};case"low_inventory_alert":case"price_drop_webhook":return{widgetType:"inline_alert",payload:{offerId:`local:${i}`,body:i==="price_drop_webhook"?"The price on this product has changed.":"Inventory is limited for this product.",copy:{headline:i==="price_drop_webhook"?"Price update":"Limited stock",subheadline:i==="price_drop_webhook"?"The price on this product has changed.":"Inventory is limited for this product."}},reasoning:"Local fallback for system alert trigger.",confidence:.4,aiProvider:"heuristic"};case"cart_item_added":case"cart_item_removed":case"search_query":case"repeated_product_view":case"price_hesitation":case"wishlist_save":case"coupon_field_focus":case"subscription_renewal_due":case"payment_failure":return{widgetType:"toast",payload:{offerId:`local:${i}`,headline:E(i),body:L(i),copy:{headline:E(i),subheadline:L(i),ctaText:"Open assistant",dismissText:"No thanks"}},reasoning:"Local fallback for low-disruption trigger.",confidence:.4,aiProvider:"heuristic"};default:return null}}function E(i){return i==="cart_item_added"?"Complete the set":i==="coupon_field_focus"?"Looking for a code?":i==="price_hesitation"?"Need a better fit?":i==="wishlist_save"?"Saved for later":i==="search_query"?"Need help choosing?":"Need help deciding?"}function L(i){return i==="cart_item_added"?"I can help find matching accessories or add-ons.":i==="cart_item_removed"?"I can help find a better alternative.":i==="coupon_field_focus"?"I can help find a relevant offer or lower-priced option.":i==="price_hesitation"?"I can help compare value and find a lower-priced alternative.":i==="wishlist_save"?"I can compare this with related products when you are ready.":"I can help find the right product or useful add-on."}function nt(){const i=window.location.pathname,t=String(window.ShopifyAnalytics?.meta?.page?.pageType||document.body?.dataset?.template||"").toLowerCase();return i==="/"?"home":/\/collections(?:\/|$)/.test(i)||t.includes("collection")?"collection":/\/products(?:\/|$)/.test(i)||t.includes("product")?"product":/\/cart(?:\/|$)/.test(i)||t.includes("cart")?"cart":/\/checkout(?:\/|$)/.test(i)?"checkout":/\/thank_you(?:\/|$)/.test(i)||window.Shopify?.checkout?"thankyou":"other"}function ct(){const i=window.Shopify?.product||window.ShopifyAnalytics?.meta?.product||null;if(!i)return;const t=String(i.gid||i.id||"");if(t)return t.startsWith("gid://shopify/Product/")?t:`gid://shopify/Product/${t}`}const I="aovboost_anonymous_id",A="aovboost_storefront_session";class dt{constructor(t,e="/apps/aovboost"){n(this,"anonymousId","");n(this,"sessionToken","");n(this,"journeyStage","discovering");n(this,"viewedProductIds",new Set);n(this,"productViewCounts",new Map);n(this,"cartProductIds",new Set);n(this,"cartVariantIds",new Set);n(this,"cartItemCount",0);n(this,"pageViews",0);n(this,"maxScrollDepth",0);n(this,"cartActionCount",0);n(this,"cartValue",0);n(this,"startedAt",Date.now());n(this,"lastCartActionAt",0);n(this,"lastEventType","");n(this,"syncTimer");n(this,"authRefreshPromise");this.shop=t,this.apiBase=e}async init(){await this.ensureAuthenticated()||this.bootstrapLocalSession(),this.syncTimer=window.setInterval(()=>this.sync(),3e4),window.addEventListener("pagehide",()=>this.sync())}destroy(){this.syncTimer&&window.clearInterval(this.syncTimer)}recordEvent(t){if(this.lastEventType=t.type,t.type==="page_view"&&(this.pageViews+=1),t.type==="product_view"){const e=C(t);e&&(this.viewedProductIds.add(e),this.productViewCounts.set(e,(this.productViewCounts.get(e)||0)+1))}if(t.type==="scroll_depth"&&(this.maxScrollDepth=Math.max(this.maxScrollDepth,Number(t.depth||0))),t.type==="add_to_cart"){this.cartActionCount+=1,this.lastCartActionAt=Date.now();const e=C(t);e&&this.cartProductIds.add(e),Array.isArray(t.cartProductIds)&&t.cartProductIds.forEach(s=>this.cartProductIds.add(String(s))),Array.isArray(t.cartVariantIds)&&t.cartVariantIds.forEach(s=>this.cartVariantIds.add(String(s))),this.cartItemCount=Math.max(this.cartItemCount,Number(t.cartItemCount||this.cartItemCount)),this.cartValue=Math.max(this.cartValue,Number(t.cartValue||0)),this.journeyStage="buying"}if(t.type==="cart_update"&&(this.lastCartActionAt=Date.now(),Array.isArray(t.cartProductIds)&&(this.cartProductIds=new Set(t.cartProductIds.map(String))),Array.isArray(t.cartVariantIds)&&(this.cartVariantIds=new Set(t.cartVariantIds.map(String))),this.cartItemCount=Number(t.cartItemCount||this.cartProductIds.size),this.cartValue=Number(t.cartValue||0),(this.cartProductIds.size>0||this.cartItemCount>0)&&(this.journeyStage="buying")),t.type==="remove_from_cart"){this.cartActionCount+=1,this.lastCartActionAt=Date.now();const e=C(t);e&&this.cartProductIds.delete(e)}this.updateJourneyStage()}getSnapshot(){const t=Math.round((Date.now()-this.startedAt)/1e3),e=Array.from(this.productViewCounts.values()).reduce((d,u)=>d+u,0),s=D(this.pageViews*2+e*5+(this.maxScrollDepth>=90?10:this.maxScrollDepth>=75?8:this.maxScrollDepth>=50?5:this.maxScrollDepth>=25?3:0)+Math.min(t/120,1)*30+(this.cartProductIds.size>0?30:0),0,100),r=Array.from(this.productViewCounts.entries()).some(([d,u])=>u>=2&&!this.cartProductIds.has(d)),o=this.lastCartActionAt?(Date.now()-this.lastCartActionAt)/1e3:t,c=D((s>40&&this.cartActionCount===0&&o>=90?55:0)+(r?35:0),0,100);return{anonymousId:this.anonymousId,journeyStage:this.journeyStage,intentScore:s,hesitationScore:c,viewedProductIds:Array.from(this.viewedProductIds),cartProductIds:Array.from(this.cartProductIds),totalPageViews:this.pageViews,sessionDuration:t,cartValue:this.cartValue,context:{maxScrollDepth:this.maxScrollDepth,productViewCounts:Object.fromEntries(this.productViewCounts),cartActionCount:this.cartActionCount,cartItemCount:this.cartItemCount,cartVariantIds:Array.from(this.cartVariantIds),cartValue:this.cartValue,lastEventType:this.lastEventType}}}getAuthPayload(){return{sessionId:this.anonymousId,sessionToken:this.sessionToken,shop:this.shop}}async getSignedAuthPayload(){return!await this.ensureAuthenticated()||!this.anonymousId||!this.sessionToken?null:this.getAuthPayload()}async ensureAuthenticated(){if(this.sessionToken)return!0;try{await this.ensureStorefrontSession()}catch{await this.refreshAuth()}return!!this.sessionToken}async refreshAuth(){return this.authRefreshPromise?this.authRefreshPromise:(this.authRefreshPromise=this.refreshAuthInternal().finally(()=>{this.authRefreshPromise=void 0}),this.authRefreshPromise)}async refreshAuthInternal(){const t=this.anonymousId,e=this.sessionToken;try{window.localStorage.removeItem(A)}catch{}try{await this.ensureStorefrontSession({forceRefresh:!0})}catch{e?(this.anonymousId=t,this.sessionToken=e):this.bootstrapLocalSession()}this.syncGlobalSdkAuth()}applyStorefrontSession(t){const e=lt(t);return!e||e.shop!==this.shop||!e.sessionId||!e.sessionToken||Number(e.expiresAt||0)<=Math.floor(Date.now()/1e3)+60?!1:(this.anonymousId=e.sessionId,this.sessionToken=e.sessionToken,this.storeStorefrontSession(e),this.syncGlobalSdkAuth(),!0)}async applySessionFromResponse(t){try{const e=await t.clone().json(),s=V(e);return this.applyStorefrontSession(s?.storefrontSession||s?.session||e)}catch{return!1}}syncGlobalSdkAuth(){const t=window.AOVBoostSDK;!t||typeof t!="object"||(t.sessionId=this.anonymousId,t.sessionToken=this.sessionToken)}sync(){if(!this.anonymousId||!this.sessionToken){this.ensureAuthenticated();return}const t=this.getSnapshot(),e=JSON.stringify({...this.getAuthPayload(),events:[{type:"session_sync",ts:Date.now(),sessionId:this.anonymousId,shop:this.shop,url:window.location.href,referrer:document.referrer,snapshot:t,...t}]});fetch(this.endpoint("/events"),{method:"POST",headers:{"Content-Type":"application/json","X-AOVBoost-Shop":this.shop},body:e,keepalive:!0}).then(s=>{s.status===401&&this.refreshAuth()}).catch(()=>{})}updateJourneyStage(){if(this.cartProductIds.size>0){this.journeyStage="buying";return}if(this.cartItemCount>0){this.journeyStage="buying";return}if(this.getSnapshotDuration()>=60||Array.from(this.productViewCounts.values()).some(t=>t>=2)){this.journeyStage="deciding";return}if(this.viewedProductIds.size>=3){this.journeyStage="comparing";return}this.journeyStage="discovering"}endpoint(t){return`${this.apiBase.replace(/\/$/,"")}${t}`}async ensureStorefrontSession(t={}){const e=t.forceRefresh?null:this.getStoredStorefrontSession();if(e){this.anonymousId=e.sessionId,this.sessionToken=e.sessionToken;return}const s=await fetch(this.endpoint("/session"),{method:"GET",headers:{Accept:"application/json"}});if(!s.ok)throw new Error(`Session bootstrap failed: ${s.status}`);const r=await s.json();if(!this.applyStorefrontSession(r))throw new Error("Invalid storefront session bootstrap response")}getStoredStorefrontSession(){try{const t=JSON.parse(window.localStorage.getItem(A)||"null");return!t||t.shop!==this.shop||!t.sessionId||!t.sessionToken||Number(t.expiresAt||0)<=Math.floor(Date.now()/1e3)+60?null:t}catch{return null}}storeStorefrontSession(t){try{window.localStorage.setItem(A,JSON.stringify(t)),window.localStorage.setItem(I,t.sessionId)}catch{}}bootstrapLocalSession(){let t="";try{t=window.localStorage.getItem(I)||"",t||(t=typeof crypto<"u"&&"randomUUID"in crypto?crypto.randomUUID():`local-${Date.now()}-${Math.random().toString(36).slice(2)}`,window.localStorage.setItem(I,t))}catch{t=`local-${Date.now()}-${Math.random().toString(36).slice(2)}`}this.anonymousId=t,this.sessionToken=""}getSnapshotDuration(){return Math.round((Date.now()-this.startedAt)/1e3)}}function lt(i){const t=V(i);return t?{shop:String(t.shop||""),sessionId:String(t.sessionId||""),sessionToken:String(t.sessionToken||""),expiresAt:Number(t.expiresAt||0)}:null}function V(i){return i&&typeof i=="object"&&!Array.isArray(i)?i:null}function C(i){const t=i.product;return String(i.productId||i.product_id||t?.id||"")}function D(i,t,e){return Math.min(Math.max(i,t),e)}const M=10*60*1e3,q=5*60*1e3,O=30*1e3,ut={long_product_dwell:{category:"browsing_behavior",widgetHint:"chat",throttleMs:60*1e3},repeated_product_view:{category:"browsing_behavior",widgetHint:"bundle",throttleMs:60*1e3},scroll_depth_interest:{category:"browsing_behavior",widgetHint:"chat",oncePerSession:!0},comparison_page_visit:{category:"browsing_behavior",widgetHint:"chat",oncePerSession:!0},search_query:{category:"browsing_behavior",widgetHint:"rec_strip",throttleMs:15*1e3},exit_intent:{category:"browsing_behavior",widgetHint:"exit_intent",oncePerSession:!0},cart_item_added:{category:"cart_checkout",widgetHint:"upsell_drawer",throttleMs:2500,requestDelayMs:50},cart_abandoned:{category:"cart_checkout",widgetHint:"discount_nudge",oncePerSession:!0},cart_value_threshold:{category:"cart_checkout",widgetHint:"discount_nudge",throttleMs:30*1e3},cart_item_removed:{category:"cart_checkout",widgetHint:"rec_strip",throttleMs:5e3},checkout_started:{category:"cart_checkout",widgetHint:"upsell_drawer",oncePerSession:!0},price_hesitation:{category:"user_intent",widgetHint:"toast",throttleMs:30*1e3},price_sensitive_chat:{category:"user_intent",widgetHint:"toast",requestOffer:!1,throttleMs:30*1e3},wishlist_save:{category:"user_intent",widgetHint:"toast",throttleMs:30*1e3},coupon_field_focus:{category:"user_intent",widgetHint:"toast",oncePerSession:!0},purchase_history_match:{category:"customer_profile_loyalty",widgetHint:"chat",throttleMs:60*1e3},loyalty_tier_reached:{category:"customer_profile_loyalty",widgetHint:"chat",throttleMs:60*1e3},subscription_renewal_due:{category:"customer_profile_loyalty",widgetHint:"toast",throttleMs:60*1e3},first_time_visitor:{category:"customer_profile_loyalty",widgetHint:"chat",oncePerSession:!0},flash_sale_window:{category:"time_based",widgetHint:"countdown_banner",oncePerSession:!0},post_purchase_window:{category:"time_based",widgetHint:"post_purchase",oncePerSession:!0},inactivity_timeout:{category:"time_based",widgetHint:"chat",oncePerSession:!0},seasonal_calendar:{category:"time_based",widgetHint:"countdown_banner",oncePerSession:!0},low_inventory_alert:{category:"external_system",widgetHint:"inline_alert",throttleMs:60*1e3},price_drop_webhook:{category:"external_system",widgetHint:"inline_alert",throttleMs:60*1e3},crm_segment_update:{category:"external_system",widgetHint:"chat",throttleMs:60*1e3},payment_failure:{category:"external_system",widgetHint:"toast",throttleMs:60*1e3}};class ht{constructor(t){n(this,"abortController",new AbortController);n(this,"firedAt",new Map);n(this,"timers",new Map);n(this,"activePriceTarget",null);n(this,"options");n(this,"handleStorefrontEvent",t=>{const e=m(t.detail);e.type&&(e.type==="product_view"&&(this.scheduleProductDwell(String(e.productId||"")),this.handleRepeatedProductView(String(e.productId||""))),e.type==="scroll_depth"&&Number(e.depth||0)>=75&&this.fire("scroll_depth_interest",{depth:Number(e.depth||0)}),e.type==="search"&&String(e.query||"").trim().length>=2&&this.fire("search_query",{query:String(e.query||"").trim()}),e.type==="add_to_cart"&&this.syncCartAndFire("cart_item_added",e),e.type==="remove_from_cart"&&this.syncCartAndFire("cart_item_removed",e),e.type==="cart_update"&&this.handleCartState(e),e.type==="checkout_start"&&this.fire("checkout_started",{path:e.path||window.location.pathname}))});n(this,"handleCustomTrigger",t=>{const e=m(t.detail),s=String(e.type||e.trigger||"").trim();s&&this.fire(s,e)});n(this,"handleProfileEvent",t=>{const e=m(t.detail),s=String(e.type||"crm_segment_update");this.fire(s,e)});n(this,"handleSystemEvent",t=>{const e=m(t.detail),s=String(e.type||"external_system_event");this.fire(s,e)});this.options=t}init(){document.addEventListener("aovboost:event",this.handleStorefrontEvent,{signal:this.abortController.signal}),document.addEventListener("aovboost:trigger",this.handleCustomTrigger,{signal:this.abortController.signal}),document.addEventListener("aovboost:profile-event",this.handleProfileEvent,{signal:this.abortController.signal}),document.addEventListener("aovboost:system-event",this.handleSystemEvent,{signal:this.abortController.signal}),this.installProductDwellTracking(),this.installComparisonTracking(),this.installExitIntentTracking(),this.installPriceHoverTracking(),this.installCouponFocusTracking(),this.installWishlistTracking(),this.installInactivityTracking(),this.installFirstTimeVisitorTracking(),this.installInitialCartTracking(),this.installPostPurchaseTracking(),this.installScheduledCampaignTracking()}destroy(){this.abortController.abort(),this.timers.forEach(t=>window.clearTimeout(t)),this.timers.clear()}trigger(t,e={}){this.fire(t,e)}installProductDwellTracking(){this.scheduleProductDwell(S())}scheduleProductDwell(t){this.clearTimer("product_dwell"),!(!t||!mt())&&this.setTimer("product_dwell",()=>{this.fire("long_product_dwell",{productId:t,dwellSeconds:O/1e3})},O)}handleRepeatedProductView(t){if(!t)return;const e=m(this.options.sessionManager.getSnapshot().context.productViewCounts),s=Number(e[t]||0);s>=2&&this.fire("repeated_product_view",{productId:t,viewCount:s})}installComparisonTracking(){const t=`${window.location.pathname} ${document.title}`.toLowerCase();/\b(compare|comparison|versus|vs|alternative|competitor)\b/.test(t)&&window.setTimeout(()=>{this.fire("comparison_page_visit",{path:window.location.pathname})},800)}installExitIntentTracking(){document.addEventListener("mouseleave",t=>{t.clientY<=8&&this.fire("exit_intent",{immediate:!0,path:window.location.pathname})},{signal:this.abortController.signal})}installPriceHoverTracking(){document.addEventListener("mouseover",t=>{const e=bt(t.target);!e||e===this.activePriceTarget||(this.activePriceTarget=e,this.clearTimer("price_hover"),this.setTimer("price_hover",()=>{this.fire("price_hesitation",{productId:S(),priceText:e.textContent?.trim().slice(0,80)||""})},1200))},{signal:this.abortController.signal}),document.addEventListener("mouseout",t=>{const e=this.activePriceTarget;if(!e)return;const s=t.relatedTarget;s&&e.contains(s)||(this.activePriceTarget=null,this.clearTimer("price_hover"))},{signal:this.abortController.signal})}installCouponFocusTracking(){document.addEventListener("focusin",t=>{const e=t.target;!e||!vt(e)||this.fire("coupon_field_focus",{fieldName:e.name||e.id||""})},{signal:this.abortController.signal})}installWishlistTracking(){document.addEventListener("click",t=>{t.target?.closest?.("[data-wishlist], [data-save-product], .wishlist, .wishlist-button, [aria-label*='wishlist'], [aria-label*='Wishlist'], [aria-label*='save'], [aria-label*='Save']")&&this.fire("wishlist_save",{productId:S()})},{signal:this.abortController.signal})}installInactivityTracking(){const t=()=>{this.clearTimer("inactivity"),this.setTimer("inactivity",()=>{this.fire("inactivity_timeout",{idleSeconds:q/1e3})},q)};["click","keydown","scroll","touchstart"].forEach(e=>{window.addEventListener(e,t,{passive:!0,signal:this.abortController.signal})}),t()}installFirstTimeVisitorTracking(){try{const t="aovboost_returning_visitor";if(window.localStorage.getItem(t)==="true")return;window.localStorage.setItem(t,"true"),window.setTimeout(()=>{this.fire("first_time_visitor",{path:window.location.pathname})},1800)}catch{}}installInitialCartTracking(){/\/cart(?:\/|$)/.test(window.location.pathname)&&window.setTimeout(async()=>{const t=await this.readCart();if(t.cartItemCount<=0)return;const e={...t,source:"initial_cart_state"};this.options.eventBus.track("cart_update",e),this.fire("cart_item_added",e),this.handleCartState(e)},900)}installPostPurchaseTracking(){yt()&&window.setTimeout(()=>{this.fire("post_purchase_window",{path:window.location.pathname})},1200)}installScheduledCampaignTracking(){const t=m(window.AOVBoost?.campaign),e=String(t.type||"");if(!e)return;const s=Date.parse(String(t.startsAt||"")),r=Date.parse(String(t.endsAt||"")),o=Date.now();(!Number.isFinite(s)||s<=o)&&(!Number.isFinite(r)||r>o)&&this.fire(e==="seasonal"?"seasonal_calendar":"flash_sale_window",{campaign:t,endsAt:t.endsAt})}syncCartAndFire(t,e){window.setTimeout(async()=>{const s=await this.readCart(),r={...e,...s};this.fire(t,r),(s.cartProductIds.length>0||s.cartValue>0)&&this.options.eventBus.track("cart_update",r),this.handleCartState(r)},350)}async readCart(){try{const t=await fetch("/cart.js",{headers:{Accept:"application/json"},keepalive:!0});if(!t.ok)throw new Error(`Cart read failed: ${t.status}`);const e=await t.json(),s=Array.isArray(e.items)?e.items:[],r=s.map(c=>N(c)).filter(Boolean),o=s.map(c=>j(c)).filter(Boolean);return{cartToken:e.token||"",cartProductIds:r,cartVariantIds:o,cartItems:s.map(c=>({productId:N(c),variantId:j(c),quantity:Number(c.quantity||1),title:String(c.product_title||c.title||""),handle:String(c.handle||c.url||"").split("/products/")[1]?.split(/[?#/]/)[0]||""})),cartItemCount:Number(e.item_count||s.length||0),cartValue:Number(e.total_price||0)/100}}catch{return{cartToken:"",cartProductIds:[],cartVariantIds:[],cartItems:[],cartItemCount:0,cartValue:0}}}handleCartState(t){const e=Number(t.cartValue||0),s=Number(t.cartItemCount||0);e>0&&this.fire("cart_value_threshold",t),this.clearTimer("cart_idle"),s>0&&this.setTimer("cart_idle",()=>{this.fire("cart_abandoned",{...t,idleSeconds:M/1e3})},M)}fire(t,e={}){const s=pt(t),r=Date.now(),o=s.throttleMs??10*1e3,c=this.firedAt.get(t)||0;if(r-c<o||s.oncePerSession&&ft(t))return;s.oncePerSession&&gt(t),this.firedAt.set(t,r);const d={...e,triggerType:t,triggerCategory:s.category,widgetHint:s.widgetHint};this.options.eventBus.track(t,d),s.requestOffer!==!1&&window.setTimeout(()=>{this.options.offerPoller.requestOffer(t,d)},s.requestDelayMs??150)}setTimer(t,e,s){this.clearTimer(t),this.timers.set(t,window.setTimeout(e,s))}clearTimer(t){const e=this.timers.get(t);e&&window.clearTimeout(e),this.timers.delete(t)}}function pt(i){return ut[i]||{category:"external_system",widgetHint:"chat",throttleMs:3e4}}function m(i){return i&&typeof i=="object"&&!Array.isArray(i)?i:{}}function ft(i){try{return sessionStorage.getItem(`aovboost_trigger:${i}`)==="true"}catch{return!1}}function gt(i){try{sessionStorage.setItem(`aovboost_trigger:${i}`,"true")}catch{}}function mt(){return/\/products(?:\/|$)/.test(window.location.pathname)||!!S()}function yt(){return/\/thank_you(?:\/|$)/.test(window.location.pathname)||!!window.Shopify?.checkout}function S(){const i=window.Shopify?.product||window.ShopifyAnalytics?.meta?.product||null;return i?B(i.gid||i.id):""}function B(i){const t=String(i||"");return t?t.startsWith("gid://shopify/Product/")?t:`gid://shopify/Product/${t}`:""}function wt(i){const t=String(i||"");return t?t.startsWith("gid://shopify/ProductVariant/")?t:`gid://shopify/ProductVariant/${t}`:""}function N(i){const t=m(i.product);return B(i.product_id||i.productId||i.product_gid||i.productGid||t.id)}function j(i){const t=m(i.variant);return wt(i.variant_id||i.variantId||i.id||i.variant_gid||i.variantGid||t.id)}function bt(i){const t=i instanceof HTMLElement?i:null;return t?t.closest("[data-price], .price, .product-price, .product__price, [class*='price'], [class*='Price'], [id*='price'], [id*='Price']"):null}function vt(i){const t=[i.name,i.id,i.placeholder,i.getAttribute("aria-label"),i.getAttribute("autocomplete")].filter(Boolean).join(" ").toLowerCase();return/\b(coupon|discount|promo|promotion|voucher|code)\b/.test(t)}const F="aovboost_dismissed_widgets";class p{constructor(t){n(this,"root");n(this,"container");this.payload=t,this.container=document.createElement("div"),this.container.setAttribute("data-aovboost-widget",this.getWidgetType()),this.root=this.container.attachShadow({mode:"open"}),this.injectStyles()}destroy(){this.container.remove()}mount(t=document.body){t.appendChild(this.container),this.render(),this.trackImpression()}injectStyles(){const t=document.createElement("style");t.textContent=kt,this.root.appendChild(t)}trackImpression(){this.track("widget_impression",{})}trackClick(t){this.track("widget_click",{action:t})}trackDismiss(){this.track("widget_dismiss",{});try{const t=JSON.parse(localStorage.getItem(F)||"[]"),s=[...(Array.isArray(t)?t.filter(r=>typeof r=="object"&&r):[]).filter(r=>r.widgetType!==this.getWidgetType()),{widgetType:this.getWidgetType(),dismissedAt:Date.now()}];localStorage.setItem(F,JSON.stringify(s))}catch{}}track(t,e){const s=window.AOVBoostSDK?.track,r={type:t,widgetType:this.getWidgetType(),offerId:this.payload.offerId,...e};if(typeof s=="function"){s(t,r);return}document.dispatchEvent(new CustomEvent("aovboost:track",{detail:r}))}html(t){const e=this.root.querySelector("[data-aovboost-content]");e&&e.remove();const s=document.createElement("div");s.setAttribute("data-aovboost-content","true"),s.innerHTML=t,this.root.appendChild(s)}}function a(i,t=""){return St(typeof i=="string"&&i.trim()?i:t)}function w(i,t="USD"){const e=Number(i||0);try{return new Intl.NumberFormat(void 0,{style:"currency",currency:t}).format(e)}catch{return`$${e.toFixed(2)}`}}function v(i){const e=[i.products,i.bundle?.items,i.items].find(s=>Array.isArray(s));return Array.isArray(e)?e.map(s=>{const r=s.product||s.target||s;return{id:r.id||s.productId||s.targetId,variantId:r.variantId||s.variantId||"",title:r.title||s.title||"Recommended product",handle:r.handle||s.handle||"",imageUrl:r.imageUrl||r.image||s.imageUrl||s.image,price:r.price||s.price||"",quantity:s.quantity||1,reason:s.reason||s.affinity?.reason||s.reasoning||"",orderCount:s.orderCount||s.affinity?.orderCount||0}}):[]}async function P(i,t=1){if(!i)return null;const e=String(i).split("/").pop(),s=await fetch("/cart/add.js",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:e,quantity:t})});return s.ok?s.json():null}async function _t(i){const t=i.filter(s=>s.variantId).map(s=>({id:String(s.variantId).split("/").pop(),quantity:s.quantity||1}));if(t.length===0)return null;const e=await fetch("/cart/add.js",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({items:t})});return e.ok?e.json():null}function St(i){return String(i||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;")}const kt=`
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
`;class xt extends p{getWidgetType(){return"bundle"}render(){const t=this.payload.bundle||{},e=this.payload.copy||{},s=v(this.payload),r=String(window.AOVBoost?.currency||"USD"),o=s.length>0&&s.every(l=>l.variantId),c=s.find(l=>l.handle)?.handle,d=s.reduce((l,b)=>l+Number(b.price||0)*Number(b.quantity||1),0),u=Number(t.discountValue||0),h=t.discountType==="percentage"?d*(1-u/100):t.discountType==="fixed"?Math.max(d-u,0):d;this.html(`
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
            ${s.map(l=>`
                  <article class="tile">
                    ${l.imageUrl?`<img src="${a(l.imageUrl)}" alt="${a(l.title)}" loading="lazy">`:""}
                    <p class="product-name">${a(l.title)}</p>
                    <span class="price">${a(l.price?w(l.price,r):"")}</span>
                  </article>
                `).join("")}
          </div>
          <div class="totals">
            ${d>h?`<span class="strike">${w(d,r)}</span>`:""}
            <strong>${w(h,r)}</strong>
          </div>
          <div class="actions">
            ${o?`<button type="button" class="primary" data-add>${a(e.ctaText||"Add bundle to cart")}</button>`:c?`<a class="primary" href="/products/${a(c)}">${a(e.ctaText||"View bundle products")}</a>`:""}
          </div>
        </div>
      </section>
    `),this.root.querySelector("[data-add]")?.addEventListener("click",async()=>{this.trackClick("add_bundle"),await _t(s.map(l=>({variantId:l.variantId,quantity:Number(l.quantity||1)}))),document.dispatchEvent(new CustomEvent("add-to-cart",{detail:{source:"bundle_widget"}}))})}}class Tt extends p{constructor(e){super(e);n(this,"messages",[]);n(this,"expanded",!1);n(this,"sending",!1);const s=e.copy;this.messages.push({role:"assistant",content:String(s?.greeting||e.greeting||"Hi. Can I help you find the perfect product today?")})}getWidgetType(){return"chat"}render(){const e=this.payload.copy||{};this.html(`
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
    `}renderProductLinks(e){const s=e.match(/\/products\/([a-z0-9-]+)/i);if(!s)return"";const r=s[1];return`
      <div class="inline-product">
        <p class="product-name">${a(r.replace(/-/g," "))}</p>
        <a href="/products/${a(r)}">View product</a>
      </div>
    `}appendMessage(e){const s=this.root.querySelector("[data-messages]");if(!s)throw new Error("Messages container not found");const r=document.createElement("div");return r.className=`bubble ${e.role}`,r.textContent=e.content,s.appendChild(r),this.scrollToBottom(),r}async sendMessage(){if(this.sending)return;const e=this.root.querySelector("[data-input]"),s=this.root.querySelector("[data-send]"),r=e?.value.trim();if(!r)return;this.sending=!0,s&&(s.disabled=!0),e.value="",this.messages.push({role:"user",content:r}),this.appendMessage({role:"user",content:r}),this.trackClick("send_message"),It(r)&&(this.track("chat_intent",{intent:"price_sensitive"}),document.dispatchEvent(new CustomEvent("aovboost:trigger",{detail:{type:"price_sensitive_chat",message:r}})));const o=this.messages.push({role:"assistant",content:""})-1,c=this.appendMessage({role:"assistant",content:""});this.showTyping();try{let d=await this.requestChat(r);if(d.status===401&&(await this.applyRecoverySession(d)||await window.AOVBoostSDK?.refreshSession?.(),d=await this.requestChat(r)),!d.ok)throw new Error(`Server returned ${d.status}`);if(!d.body)throw new Error("Missing stream body");const u=d.body.getReader(),h=new TextDecoder;let l="",b=!1;for(;;){const{done:_,value:Wt}=await u.read();if(_)break;l+=h.decode(Wt,{stream:!0});const U=l.split(`
`);l=U.pop()||"";for(const z of U){if(!z.startsWith("data: "))continue;const Y=z.slice(6);if(Y!=="[DONE]")try{const G=JSON.parse(Y);G.delta&&(b||(this.removeTyping(),b=!0),this.messages[o].content+=G.delta,c.textContent=this.messages[o].content,this.updateProductLink(this.messages[o].content,c),this.scrollToBottom())}catch{}}}b||(this.removeTyping(),this.messages[o].content||(this.messages[o].content="I can help you compare products and find the right add-ons.",c.textContent=this.messages[o].content))}catch{this.removeTyping(),this.messages[o].content=this.messages[o].content||"I had trouble connecting. Please try again in a moment.",c.textContent=this.messages[o].content}finally{this.sending=!1,s&&(s.disabled=!1)}}async requestChat(e){const s=window.AOVBoost||{},r=window.AOVBoostSDK,o=At(s.apiBase).replace(/\/$/,""),c=typeof r?.getSignedAuthPayload=="function"?await r.getSignedAuthPayload():null;if(!c)throw new Error("Missing signed storefront auth");return fetch(`${o}/chat`,{method:"POST",headers:{"Content-Type":"application/json","X-AOVBoost-Shop":c.shop||s.shop||""},body:JSON.stringify({...c,message:e,messageHistory:this.messages.slice(0,-2)})})}async applyRecoverySession(e){try{const s=await e.clone().json(),r=s?.storefrontSession||s?.session,o=window.AOVBoostSDK?.applySession;return typeof o=="function"?!!o(r):!1}catch{return!1}}showTyping(){const e=this.root.querySelector("[data-messages]");if(!e)return;const s=document.createElement("div");s.className="bubble assistant dots",s.dataset.typing="true",s.innerHTML="<span>.</span><span>.</span><span>.</span>",e.appendChild(s),this.scrollToBottom()}removeTyping(){const e=this.root.querySelector("[data-typing]");e&&e.remove()}updateProductLink(e,s){const r=e.match(/\/products\/([a-z0-9-]+)/i),o=s.querySelector(".inline-product");if(o&&o.remove(),!r)return;const c=r[1],d=document.createElement("div");d.className="inline-product",d.innerHTML=`
      <p class="product-name">${a(c.replace(/-/g," "))}</p>
      <a href="/products/${a(c)}">View product</a>
    `,s.appendChild(d)}scrollToBottom(){const e=this.root.querySelector("[data-messages]");e&&(e.scrollTop=e.scrollHeight)}dismiss(){this.trackDismiss(),this.container.animate([{transform:"translateY(0)"},{transform:"translateY(120%)"}],{duration:180,easing:"ease-in",fill:"forwards"}),window.setTimeout(()=>this.destroy(),190)}}function It(i){return/\b(expensive|cheaper|cheap|discount|coupon|promo|deal|sale|price|afford|budget|cost)\b/i.test(i)}function At(i){const t=typeof i=="string"?i.trim():"";return!t||t==="/api"||t.startsWith("/api/")?"/apps/aovboost":t.includes("/apps/aovboost")||t.startsWith("/apps/")?t:"/apps/aovboost"}class Ct extends p{constructor(){super(...arguments);n(this,"timer")}getWidgetType(){return"countdown_banner"}render(){const e=this.payload.copy||{},s=e.headline||this.payload.headline||"Limited-time offer",r=e.subheadline||e.offerLine||this.payload.body||"Relevant bundles and add-ons are available for this session.";this.html(`
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
          <h3 class="title">${a(s)}</h3>
          <p class="body">${a(r)}</p>
        </div>
        <strong class="timer" data-countdown></strong>
        <button type="button" class="icon" data-dismiss aria-label="Close">x</button>
      </aside>
    `),this.root.querySelector("[data-dismiss]")?.addEventListener("click",()=>{this.trackDismiss(),this.destroy()}),this.tick(),this.timer=window.setInterval(()=>this.tick(),1e3)}destroy(){this.timer&&window.clearInterval(this.timer),super.destroy()}tick(){const e=this.root.querySelector("[data-countdown]");if(!e)return;const s=Date.parse(String(this.payload.endsAt||""));if(!Number.isFinite(s)){e.textContent="Today";return}const r=Math.max(s-Date.now(),0);if(r<=0){this.destroy();return}const o=Math.floor(r/36e5),c=Math.floor(r%36e5/6e4),d=Math.floor(r%6e4/1e3);e.textContent=o>0?`${o}h ${c}m`:`${c}m ${d.toString().padStart(2,"0")}s`}}class Pt extends p{getWidgetType(){return"discount_nudge"}render(){this.draw(),document.addEventListener("add-to-cart",()=>this.draw())}draw(){const t=this.payload.copy||{},e=String(window.AOVBoost?.currency||"USD"),s=Number(this.payload.threshold||50),r=Number(this.payload.cartValue||0),o=Math.max(s-r,0),c=s>0?Math.min(r/s,1):0;this.html(`
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
          <span>${o>0?a(t.progressLabel||`You're ${w(o,e)} away from your reward`):a(t.rewardDescription||"Reward unlocked")}</span>
          <button type="button" class="icon" data-dismiss aria-label="Close">x</button>
        </div>
        <div class="track" aria-hidden="true"><span></span></div>
      </div>
    `),this.root.querySelector("[data-dismiss]")?.addEventListener("click",()=>{this.trackDismiss(),this.destroy()}),o<=0&&window.setTimeout(()=>this.destroy(),3e3)}}class $t extends p{constructor(){super(...arguments);n(this,"shown",!1);n(this,"handleMouseLeave",e=>{e.clientY<10&&this.show()});n(this,"handleVisibility",()=>{document.visibilityState==="hidden"&&this.show()})}getWidgetType(){return"exit_intent"}mount(e=document.body){if(e.appendChild(this.container),!this.shouldSkip()){if(this.payload.immediate){this.show();return}document.addEventListener("mouseleave",this.handleMouseLeave),document.addEventListener("visibilitychange",this.handleVisibility)}}render(){const e=this.payload.copy||{};this.html(`
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
    `),this.root.querySelector("[data-claim]")?.addEventListener("click",()=>{this.trackClick("claim_exit_offer"),this.destroy()}),this.root.querySelectorAll("[data-dismiss]").forEach(s=>{s.addEventListener("click",()=>{this.trackDismiss(),this.destroy()})})}destroy(){document.removeEventListener("mouseleave",this.handleMouseLeave),document.removeEventListener("visibilitychange",this.handleVisibility),super.destroy()}show(){if(!(this.shown||this.hasFired())){this.shown=!0;try{sessionStorage.setItem("aovboost_exit_intent_fired","true")}catch{}this.render(),this.trackImpression()}}hasFired(){try{return sessionStorage.getItem("aovboost_exit_intent_fired")==="true"}catch{return!1}}shouldSkip(){return/\/(?:checkout|thank_you)(?:\/|$)/.test(window.location.pathname)}}class Et extends p{getWidgetType(){return"inline_alert"}render(){const t=this.payload.copy||{},e=t.headline||this.payload.headline||"Store update",s=t.subheadline||t.offerLine||this.payload.body||"A relevant product update is available.";this.html(`
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
            <p class="body">${a(s)}</p>
          </div>
          <button type="button" class="icon" data-dismiss aria-label="Close">x</button>
        </div>
      </aside>
    `),this.root.querySelector("[data-dismiss]")?.addEventListener("click",()=>{this.trackDismiss(),this.destroy()})}}class Lt extends p{getWidgetType(){return"post_purchase"}mount(t=document.body){this.isThankYouPage()&&super.mount(t)}render(){const t=this.payload.copy||{},e=v(this.payload)[0]||this.payload.product||{},s=String(window.AOVBoost?.currency||"USD");this.html(`
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
              <span class="price">${a(e.price?w(e.price,s):"")}</span>
            </div>
            <p class="reason">${a(t.oneLineReason||"A useful add-on for what you just bought.")}</p>
            <button type="button" class="primary" data-add>${a(t.ctaText||"Add to my order")}</button>
          </div>
        </article>
      </section>
    `),this.root.querySelector("[data-add]")?.addEventListener("click",async()=>{this.trackClick("add_post_purchase");const r=e.variantId;if(r){await P(r);return}const o=e.handle;o&&(window.location.href=`/products/${o}`)})}isThankYouPage(){return/\/thank_you(?:\/|$)/.test(window.location.pathname)||!!window.Shopify?.checkout}}class Vt extends p{getWidgetType(){return"rec_strip"}render(){const t=v(this.payload),e=String(window.AOVBoost?.currency||"USD");this.html(`
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
                  <span class="price">${a(s.price?w(s.price,e):"")}</span>
                  ${s.variantId?`<button type="button" class="primary" data-add="${a(s.variantId)}">Add to cart</button>`:s.handle?`<a class="primary" href="/products/${a(s.handle)}">View product</a>`:""}
                </article>
              `).join("")}
        </div>
      </section>
    `),this.lazyLoadImages(),this.root.querySelectorAll("[data-add]").forEach(s=>{s.addEventListener("click",async()=>{this.trackClick("add_recommendation"),await P(s.dataset.add)})})}lazyLoadImages(){const t=Array.from(this.root.querySelectorAll("img[data-src]"));if(!("IntersectionObserver"in window)){t.forEach(s=>{s.src=s.dataset.src||""});return}const e=new IntersectionObserver(s=>{s.forEach(r=>{if(!r.isIntersecting)return;const o=r.target;o.src=o.dataset.src||"",e.unobserve(o)})});t.forEach(s=>e.observe(s))}}class Dt extends p{constructor(){super(...arguments);n(this,"interval")}getWidgetType(){return"social_proof"}render(){const s=v(this.payload).filter(o=>Number(o.orderCount||0)>0).map(o=>`${Number(o.orderCount)} people bought this with ${o.title}`);s.length===0&&s.push("Frequently bought together"),this.html(`
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
    `);let r=0;this.interval=window.setInterval(()=>{r=(r+1)%s.length;const o=this.root.querySelector("[data-message]");o&&(o.textContent=s[r])},5e3)}destroy(){this.interval&&window.clearInterval(this.interval),super.destroy()}}class Mt extends p{getWidgetType(){return"toast"}render(){const t=this.payload.copy||{},e=t.headline||this.payload.headline||"A better option is available",s=t.subheadline||t.offerLine||this.payload.body||"I can help find a better match or a useful offer.",r=t.ctaText||this.payload.ctaText||"Open assistant";this.html(`
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
            <p class="body">${a(s)}</p>
          </div>
          <button type="button" class="icon" data-dismiss aria-label="Close">x</button>
        </div>
        <div class="actions">
          <button type="button" class="primary" data-chat>${a(r)}</button>
        </div>
      </aside>
    `),this.root.querySelector("[data-dismiss]")?.addEventListener("click",()=>{this.trackDismiss(),this.destroy()}),this.root.querySelector("[data-chat]")?.addEventListener("click",()=>{this.trackClick("open_assistant"),document.dispatchEvent(new CustomEvent("aovboost:trigger",{detail:{type:"long_product_dwell",source:"toast"}})),this.destroy()}),window.setTimeout(()=>this.destroy(),9e3)}}class qt extends p{constructor(){super(...arguments);n(this,"timer");n(this,"deadline",Date.now()+8e3)}getWidgetType(){return"upsell_drawer"}render(){const e=v(this.payload).slice(0,3),s=this.payload.copy||{},r=String(window.AOVBoost?.currency||"USD");this.html(`
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
          ${e.map(o=>`
                <article class="product-card">
                  ${o.imageUrl?`<img src="${a(o.imageUrl)}" alt="${a(o.title)}" loading="lazy">`:"<span></span>"}
                  <div class="stack">
                    <div>
                      <p class="product-name">${a(o.title)}</p>
                      <span class="price">${a(o.price?w(o.price,r):"")}</span>
                    </div>
                    <p class="reason">${a(o.reason||s.whyThisGoes||"It pairs well with your cart.")}</p>
                    ${o.variantId?`<button type="button" class="primary" data-add="${a(o.variantId)}">Add to cart</button>`:o.handle?`<a class="primary" href="/products/${a(o.handle)}">View product</a>`:""}
                  </div>
                </article>
              `).join("")}
        </div>
        <div class="actions">
          <a class="secondary" href="/cart">Continue to cart</a>
        </div>
      </aside>
    `),this.root.querySelectorAll("[data-dismiss]").forEach(o=>{o.addEventListener("click",()=>this.dismiss())}),this.root.querySelectorAll("[data-add]").forEach(o=>{o.addEventListener("click",async()=>{this.trackClick("add_upsell"),await P(o.dataset.add)})}),this.startCountdown()}destroy(){this.timer&&window.clearInterval(this.timer),super.destroy()}startCountdown(){this.timer&&window.clearInterval(this.timer),this.deadline=Date.now()+8e3,this.timer=window.setInterval(()=>{const e=Math.max(this.deadline-Date.now(),0),s=this.root.querySelector("[data-timer]");s&&(s.style.transform=`scaleX(${e/8e3})`),e<=0&&this.dismiss()},120)}dismiss(){this.trackDismiss(),this.container.animate([{transform:"translateX(0)"},{transform:"translateX(100%)"}],{duration:180,easing:"ease-in",fill:"forwards"}),window.setTimeout(()=>this.destroy(),190)}}const H="aovboost_dismissed_widgets",Ot=30*60*1e3;class Bt{constructor(){n(this,"activeWidget",null);n(this,"activeKey","");n(this,"activeWidgetType","")}mountDecision(t){if(!t.widgetType||this.getDismissedWidgets().includes(t.widgetType))return;const e=t.payload||{},s=String(e.offerId||""),r=`${t.widgetType}:${s}`;if(t.widgetType==="chat"&&this.activeWidgetType==="chat"||r===this.activeKey)return;this.destroyActive();const o=Nt(t.widgetType,e);if(!o)return;const c=this.resolveTarget(t.widgetType);o.mount(c),this.activeWidget=o,this.activeKey=r,this.activeWidgetType=t.widgetType}destroyActive(){this.activeWidget?.destroy(),this.activeWidget=null,this.activeKey="",this.activeWidgetType=""}getDismissedWidgets(){try{const t=JSON.parse(localStorage.getItem(H)||"[]");if(!Array.isArray(t))return[];const e=Date.now(),s=t.filter(r=>r&&typeof r=="object").filter(r=>e-Number(r.dismissedAt||0)<Ot);return s.length!==t.length&&localStorage.setItem(H,JSON.stringify(s)),s.map(r=>String(r.widgetType||"")).filter(Boolean)}catch{return[]}}resolveTarget(t){return t==="bundle"?k(".product-form, [data-product-form]"):t==="rec_strip"?k(".product__description, [data-product-description]"):t==="social_proof"?k(".product-form__submit, [data-add-to-cart]"):t==="inline_alert"?k("[data-price], .product__price, .price, .product-form, [data-product-form]"):document.body}}function Nt(i,t){switch(i){case"chat":return new Tt(t);case"toast":return new Mt(t);case"countdown_banner":return new Ct(t);case"inline_alert":return new Et(t);case"bundle":return new xt(t);case"upsell_drawer":return new qt(t);case"discount_nudge":return new Pt(t);case"rec_strip":return new Vt(t);case"social_proof":return new Dt(t);case"exit_intent":return new $t(t);case"post_purchase":return new Lt(t);default:return null}}function k(i){const t=document.querySelector(i),e=document.createElement("div");return e.setAttribute("data-aovboost-mount",i),t?.parentElement?(t.insertAdjacentElement("afterend",e),e):(document.body.appendChild(e),e)}let W=!1;function $(){W||(W=!0,jt().catch(i=>{console.log("AOVBoost SDK skipped:",i instanceof Error?i.message:String(i))}))}async function jt(){try{const i=window.AOVBoost||{},t=i.shop;if(!t)return;R(i)||await Ht(i);const e=Ft(i.apiBase),s=new dt(t,e),r=new g({shop:t,sessionManager:s,apiBase:e}),o=new Bt,c=new ot({shop:t,apiBase:e,eventBus:r,sessionManager:s,widgetManager:o}),d=new ht({eventBus:r,offerPoller:c,sessionManager:s});await s.init(),window.AOVBoostSDK={shop:t,sessionId:s.anonymousId,sessionToken:s.getAuthPayload().sessionToken,refreshSession:async()=>{await s.refreshAuth(),s.syncGlobalSdkAuth()},getSignedAuthPayload:()=>s.getSignedAuthPayload(),applySession:u=>s.applyStorefrontSession(u),track:(u,h={})=>r.track(u,h),trigger:(u,h={})=>d.trigger(u,h),requestOffer:(u="global",h={})=>c.requestOffer(u,h),destroy:()=>{d.destroy(),c.destroy(),s.destroy(),o.destroyActive()}},d.init(),r.init(),c.init()}catch(i){console.log("AOVBoost SDK skipped:",i instanceof Error?i.message:String(i))}}function Ft(i){const t=typeof i=="string"?i.trim():"";return!t||t==="/api"||t.startsWith("/api/")?"/apps/aovboost":t.includes("/apps/aovboost")||t.startsWith("/apps/")?t:"/apps/aovboost"}function R(i){if(i.settings?.trackingConsentRequired!==!0)return!0;const t=window.Shopify?.customerPrivacy;return typeof t?.analyticsProcessingAllowed=="function"?!!t.analyticsProcessingAllowed():typeof t?.userCanBeTracked=="function"?!!t.userCanBeTracked():!0}function Ht(i){return new Promise(t=>{const e=()=>{R({...i,settings:{...i.settings,trackingConsentRequired:!1}})&&(s(),t())},s=()=>{["visitorConsentCollected","shopify:customer_privacy:consent_collected","aovboost:consent-granted"].forEach(r=>window.removeEventListener(r,e))};["visitorConsentCollected","shopify:customer_privacy:consent_collected","aovboost:consent-granted"].forEach(r=>window.addEventListener(r,e))})}return document.readyState==="loading"?document.addEventListener("DOMContentLoaded",$,{once:!0}):$(),f.init=$,Object.defineProperty(f,Symbol.toStringTag,{value:"Module"}),f}({});
