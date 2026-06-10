var AOVBoostSDKBundle=function(p){"use strict";var Nt=Object.defineProperty;var jt=(p,g,m)=>g in p?Nt(p,g,{enumerable:!0,configurable:!0,writable:!0,value:m}):p[g]=m;var n=(p,g,m)=>jt(p,typeof g!="symbol"?g+"":g,m);class g{constructor(t){n(this,"queue",[]);n(this,"flushTimer");n(this,"scrollDepths",new Set);n(this,"originalFetch",null);this.options=t}init(){this.installNavigationTracking(),this.installCartFetchTracking(),this.installCartDomTracking(),this.installScrollTracking(),this.installHoverTracking(),this.installSearchTracking(),document.addEventListener("add-to-cart",t=>{this.track("add_to_cart",m(t.detail))}),document.addEventListener("aovboost:track",t=>{const e=m(t.detail);this.track(String(e.type||"widget_event"),e)}),window.addEventListener("pagehide",()=>this.flush()),this.trackPageView()}track(t,e={}){const i={type:t,ts:Date.now(),sessionId:this.options.sessionManager.anonymousId,shop:this.options.shop,url:window.location.href,referrer:document.referrer,...e};this.options.sessionManager.recordEvent(i),this.queue.push(i),document.dispatchEvent(new CustomEvent("aovboost:event",{detail:i})),this.scheduleFlush()}flush(){if(this.flushTimer&&(window.clearTimeout(this.flushTimer),this.flushTimer=void 0),this.queue.length===0||!this.options.sessionManager.getAuthPayload().sessionToken)return;const t=this.queue.splice(0),e=JSON.stringify({...this.options.sessionManager.getAuthPayload(),events:t});try{if(navigator.sendBeacon&&navigator.sendBeacon(this.endpoint("/events"),new Blob([e],{type:"application/json"})))return}catch{}fetch(this.endpoint("/events"),{method:"POST",headers:{"Content-Type":"application/json","X-AOVBoost-Shop":this.options.shop},body:e,keepalive:!0}).catch(()=>{this.queue.unshift(...t)})}scheduleFlush(){this.flushTimer||(this.flushTimer=window.setTimeout(()=>this.flush(),2e3))}endpoint(t){return`${(this.options.apiBase||"/apps/aovboost").replace(/\/$/,"")}${t}`}installNavigationTracking(){const t=history.pushState,e=history.replaceState;history.pushState=(...i)=>{const o=t.apply(history,i);return window.setTimeout(()=>this.trackPageView(),0),o},history.replaceState=(...i)=>{const o=e.apply(history,i);return window.setTimeout(()=>this.trackPageView(),0),o},window.addEventListener("popstate",()=>this.trackPageView())}trackPageView(){this.track("page_view",{pageType:Y()}),K()&&this.track("checkout_start",{path:window.location.pathname});const t=z();t&&this.track("product_view",{productId:tt(t.gid||t.id),handle:t.handle,title:t.title});const e=R();(e||window.location.pathname.includes("/collections/"))&&this.track("collection_view",{collectionId:String(e?.id||""),handle:e?.handle||J("/collections/"),title:e?.title})}installCartFetchTracking(){this.originalFetch||(this.originalFetch=window.fetch.bind(window),window.fetch=async(...t)=>{const e=G(t[0]),i=t[1],o=await this.originalFetch(...t);try{_(e)?this.track("add_to_cart",{...S(i?.body),requestUrl:e}):X(e)?this.track("remove_from_cart",{...S(i?.body),requestUrl:e}):Q(e)&&this.track("search",{query:Z(e),requestUrl:e})}catch{}return o})}installCartDomTracking(){document.addEventListener("submit",t=>{const e=t.target;if(!(!e||!_(e.action||"")))try{this.track("add_to_cart",{...S(new FormData(e)),source:"cart_form_submit",requestUrl:e.action})}catch{this.track("add_to_cart",{source:"cart_form_submit",requestUrl:e.action})}},!0),document.addEventListener("click",t=>{const i=t.target?.closest?.("button[name='add'], [type='submit'][name='add'], [data-add-to-cart]");if(!i)return;const o=i.closest("form");o&&!_(o.action||"")||this.track("add_to_cart",{source:"add_button_click",requestUrl:o?.action||""})},!0)}installScrollTracking(){let t=!1;window.addEventListener("scroll",()=>{t||(t=!0,window.setTimeout(()=>{t=!1;const e=document.documentElement.scrollHeight-window.innerHeight;if(e<=0)return;const i=Math.round(window.scrollY/e*100);[25,50,75,90].forEach(o=>{i>=o&&!this.scrollDepths.has(o)&&(this.scrollDepths.add(o),this.track("scroll_depth",{depth:o}))})},200))},{passive:!0})}installHoverTracking(){document.addEventListener("mouseenter",t=>{const i=t.target?.closest?.(".product-card");if(!i)return;const o=window.setTimeout(()=>{this.track("product_hover",{productId:i.dataset.productId||i.dataset.productGid||"",handle:i.dataset.productHandle||""})},800);i.addEventListener("mouseleave",()=>window.clearTimeout(o),{once:!0})},!0)}installSearchTracking(){document.addEventListener("input",t=>{const e=t.target;if(!e||!`${e.name||""} ${e.id||""} ${e.type||""}`.toLowerCase().includes("search"))return;const o=e.value.trim();o.length<2||this.track("search",{query:o,source:"predictive_input"})},!0)}}function m(s){return s&&typeof s=="object"&&!Array.isArray(s)?s:{}}function z(){const s=window;return s.Shopify?.product||s.ShopifyAnalytics?.meta?.product||null}function R(){const s=window;return s.Shopify?.collection||s.ShopifyAnalytics?.meta?.collection||null}function Y(){return window.ShopifyAnalytics?.meta?.page?.pageType||document.body?.dataset?.template||(window.location.pathname==="/"?"home":"other")}function K(){return/\/checkout(?:\/|$)/.test(window.location.pathname)}function J(s){const t=window.location.pathname.indexOf(s);return t===-1?"":window.location.pathname.slice(t+s.length).split("/")[0]||""}function G(s){return typeof s=="string"?s:s instanceof URL?s.toString():s.url||""}function _(s){return/\/cart\/add(?:\.js)?/.test(s)}function X(s){return/\/cart\/(?:change|update)(?:\.js)?/.test(s)}function Q(s){return s.includes("/search/suggest.json")}function Z(s){try{return new URL(s,window.location.origin).searchParams.get("q")||""}catch{return""}}function S(s){if(!s)return{};if(typeof FormData<"u"&&s instanceof FormData)return{variantId:String(s.get("id")||s.get("items[0][id]")||""),quantity:Number(s.get("quantity")||1)};if(typeof URLSearchParams<"u"&&s instanceof URLSearchParams)return{variantId:String(s.get("id")||s.get("items[0][id]")||""),quantity:Number(s.get("quantity")||1)};try{const t=String(s);if(t.trim().startsWith("{")){const i=JSON.parse(t);return{productId:i.productId||i.product_id,variantId:i.id||i.items?.[0]?.id,quantity:i.quantity||i.items?.[0]?.quantity||1}}const e=new URLSearchParams(t);return{variantId:String(e.get("id")||e.get("items[0][id]")||""),quantity:Number(e.get("quantity")||1)}}catch{return{}}}function tt(s){const t=String(s||"");return t?t.startsWith("gid://shopify/Product/")?t:`gid://shopify/Product/${t}`:""}class et{constructor(t){n(this,"timer");n(this,"inFlight",!1);n(this,"stopped",!1);n(this,"options");this.options=t}init(){window.setTimeout(()=>this.requestOffer("initial"),1200),this.options.pollMs&&(this.timer=window.setInterval(()=>this.requestOffer("poll"),this.options.pollMs)),document.addEventListener("aovboost:request-offer",()=>{this.requestOffer("manual")}),window.addEventListener("popstate",()=>{window.setTimeout(()=>this.requestOffer("navigation"),300)})}destroy(){this.stopped=!0,this.timer&&window.clearInterval(this.timer)}async requestOffer(t="manual",e={}){if(this.inFlight||this.stopped)return null;this.inFlight=!0;try{const i=this.options.sessionManager.getSnapshot(),o=Array.isArray(e.cartProductIds)?e.cartProductIds.map(String):i.cartProductIds,a=typeof e.cartValue=="number"?e.cartValue:i.cartValue,d={...this.options.sessionManager.getAuthPayload(),currentProductId:ot(),currentPageType:st(),cartProductIds:o,cartValue:a,dismissedWidgets:this.options.widgetManager.getDismissedWidgets(),trigger:t,triggerCategory:e.triggerCategory,triggerPayload:e};if(!this.options.sessionManager.getAuthPayload().sessionToken)return this.mountLocalFallback(t,e);let c=await fetch(this.endpoint("/offer"),{method:"POST",headers:{"Content-Type":"application/json","X-AOVBoost-Shop":this.options.shop},body:JSON.stringify(d),keepalive:!0});if(c.status===401&&(await this.options.sessionManager.refreshAuth(),c=await fetch(this.endpoint("/offer"),{method:"POST",headers:{"Content-Type":"application/json","X-AOVBoost-Shop":this.options.shop},body:JSON.stringify({...d,...this.options.sessionManager.getAuthPayload()}),keepalive:!0})),!c.ok)return this.mountLocalFallback(t,e);const l=await c.json();return l.widgetType?(this.options.widgetManager.mountDecision(l),l):this.mountLocalFallback(t,e)}catch{return this.mountLocalFallback(t,e)}finally{this.inFlight=!1}}endpoint(t){return`${this.options.apiBase.replace(/\/$/,"")}${t}`}mountLocalFallback(t,e){const i=it(t,e);return i?(this.options.widgetManager.mountDecision(i),i):null}}function it(s,t){const e=Number(t.cartValue||0);switch(s){case"first_time_visitor":case"long_product_dwell":case"scroll_depth_interest":case"comparison_page_visit":case"inactivity_timeout":case"purchase_history_match":case"loyalty_tier_reached":case"crm_segment_update":return{widgetType:"chat",payload:{offerId:`local:${s}`,greeting:"Hi. I can help you compare products and find useful add-ons.",copy:{greeting:"Hi. I can help you compare products and find useful add-ons.",ctaAccept:"Chat with AI",ctaDecline:"Browse myself"}},reasoning:"Local fallback for proactive chat trigger.",confidence:.4,aiProvider:"heuristic"};case"exit_intent":return{widgetType:"exit_intent",payload:{offerId:"local:exit_intent",immediate:!0,offerLine:"Before you go, I can help find a better match or bundle.",copy:{headline:"Wait before you go",offerLine:"I can help find a better match or bundle.",ctaText:"Open assistant",dismissText:"No thanks"}},reasoning:"Local fallback for exit intent.",confidence:.4,aiProvider:"heuristic"};case"cart_value_threshold":case"cart_abandoned":return{widgetType:"discount_nudge",payload:{offerId:`local:${s}`,cartValue:e,threshold:Number(t.threshold||50),copy:{progressLabel:"You are close to a reward",rewardDescription:"Add one more item to unlock the offer.",ctaText:"View picks"}},reasoning:"Local fallback for cart value or idle cart trigger.",confidence:.4,aiProvider:"heuristic"};case"flash_sale_window":case"seasonal_calendar":return{widgetType:"countdown_banner",payload:{offerId:`local:${s}`,endsAt:t.endsAt,body:"Limited-time product picks are available right now.",copy:{headline:"Limited-time offer",subheadline:"Relevant bundles and add-ons are available now.",ctaText:"View offer"}},reasoning:"Local fallback for scheduled campaign trigger.",confidence:.4,aiProvider:"heuristic"};case"low_inventory_alert":case"price_drop_webhook":return{widgetType:"inline_alert",payload:{offerId:`local:${s}`,body:s==="price_drop_webhook"?"The price on this product has changed.":"Inventory is limited for this product.",copy:{headline:s==="price_drop_webhook"?"Price update":"Limited stock",subheadline:s==="price_drop_webhook"?"The price on this product has changed.":"Inventory is limited for this product."}},reasoning:"Local fallback for system alert trigger.",confidence:.4,aiProvider:"heuristic"};case"cart_item_added":case"cart_item_removed":case"search_query":case"repeated_product_view":case"price_hesitation":case"wishlist_save":case"coupon_field_focus":case"subscription_renewal_due":case"payment_failure":return{widgetType:"toast",payload:{offerId:`local:${s}`,headline:E(s),body:$(s),copy:{headline:E(s),subheadline:$(s),ctaText:"Open assistant",dismissText:"No thanks"}},reasoning:"Local fallback for low-disruption trigger.",confidence:.4,aiProvider:"heuristic"};default:return null}}function E(s){return s==="cart_item_added"?"Complete the set":s==="coupon_field_focus"?"Looking for a code?":s==="price_hesitation"?"Need a better fit?":s==="wishlist_save"?"Saved for later":s==="search_query"?"Need help choosing?":"Need help deciding?"}function $(s){return s==="cart_item_added"?"I can help find matching accessories or add-ons.":s==="cart_item_removed"?"I can help find a better alternative.":s==="coupon_field_focus"?"I can help find a relevant offer or lower-priced option.":s==="price_hesitation"?"I can help compare value and find a lower-priced alternative.":s==="wishlist_save"?"I can compare this with related products when you are ready.":"I can help find the right product or useful add-on."}function st(){const s=window.location.pathname,t=String(window.ShopifyAnalytics?.meta?.page?.pageType||document.body?.dataset?.template||"").toLowerCase();return s==="/"?"home":/\/collections(?:\/|$)/.test(s)||t.includes("collection")?"collection":/\/products(?:\/|$)/.test(s)||t.includes("product")?"product":/\/cart(?:\/|$)/.test(s)||t.includes("cart")?"cart":/\/checkout(?:\/|$)/.test(s)?"checkout":/\/thank_you(?:\/|$)/.test(s)||window.Shopify?.checkout?"thankyou":"other"}function ot(){const s=window.Shopify?.product||window.ShopifyAnalytics?.meta?.product||null;if(!s)return;const t=String(s.gid||s.id||"");if(t)return t.startsWith("gid://shopify/Product/")?t:`gid://shopify/Product/${t}`}const k="aovboost_anonymous_id",x="aovboost_storefront_session";class at{constructor(t,e="/apps/aovboost"){n(this,"anonymousId","");n(this,"sessionToken","");n(this,"journeyStage","discovering");n(this,"viewedProductIds",new Set);n(this,"productViewCounts",new Map);n(this,"cartProductIds",new Set);n(this,"pageViews",0);n(this,"maxScrollDepth",0);n(this,"cartActionCount",0);n(this,"cartValue",0);n(this,"startedAt",Date.now());n(this,"lastCartActionAt",0);n(this,"lastEventType","");n(this,"syncTimer");this.shop=t,this.apiBase=e}async init(){try{await this.ensureStorefrontSession()}catch{this.bootstrapLocalSession()}this.syncTimer=window.setInterval(()=>this.sync(),3e4),window.addEventListener("pagehide",()=>this.sync())}destroy(){this.syncTimer&&window.clearInterval(this.syncTimer)}recordEvent(t){if(this.lastEventType=t.type,t.type==="page_view"&&(this.pageViews+=1),t.type==="product_view"){const e=T(t);e&&(this.viewedProductIds.add(e),this.productViewCounts.set(e,(this.productViewCounts.get(e)||0)+1))}if(t.type==="scroll_depth"&&(this.maxScrollDepth=Math.max(this.maxScrollDepth,Number(t.depth||0))),t.type==="add_to_cart"){this.cartActionCount+=1,this.lastCartActionAt=Date.now();const e=T(t);e&&this.cartProductIds.add(e),Array.isArray(t.cartProductIds)&&t.cartProductIds.forEach(i=>this.cartProductIds.add(String(i))),this.cartValue=Math.max(this.cartValue,Number(t.cartValue||0)),this.journeyStage="buying"}if(t.type==="cart_update"&&(this.lastCartActionAt=Date.now(),Array.isArray(t.cartProductIds)&&(this.cartProductIds=new Set(t.cartProductIds.map(String))),this.cartValue=Number(t.cartValue||0),this.cartProductIds.size>0&&(this.journeyStage="buying")),t.type==="remove_from_cart"){this.cartActionCount+=1,this.lastCartActionAt=Date.now();const e=T(t);e&&this.cartProductIds.delete(e)}this.updateJourneyStage()}getSnapshot(){const t=Math.round((Date.now()-this.startedAt)/1e3),e=Array.from(this.productViewCounts.values()).reduce((c,l)=>c+l,0),i=L(this.pageViews*2+e*5+(this.maxScrollDepth>=90?10:this.maxScrollDepth>=75?8:this.maxScrollDepth>=50?5:this.maxScrollDepth>=25?3:0)+Math.min(t/120,1)*30+(this.cartProductIds.size>0?30:0),0,100),o=Array.from(this.productViewCounts.entries()).some(([c,l])=>l>=2&&!this.cartProductIds.has(c)),a=this.lastCartActionAt?(Date.now()-this.lastCartActionAt)/1e3:t,d=L((i>40&&this.cartActionCount===0&&a>=90?55:0)+(o?35:0),0,100);return{anonymousId:this.anonymousId,journeyStage:this.journeyStage,intentScore:i,hesitationScore:d,viewedProductIds:Array.from(this.viewedProductIds),cartProductIds:Array.from(this.cartProductIds),totalPageViews:this.pageViews,sessionDuration:t,cartValue:this.cartValue,context:{maxScrollDepth:this.maxScrollDepth,productViewCounts:Object.fromEntries(this.productViewCounts),cartActionCount:this.cartActionCount,cartValue:this.cartValue,lastEventType:this.lastEventType}}}getAuthPayload(){return{sessionId:this.anonymousId,sessionToken:this.sessionToken,shop:this.shop}}async refreshAuth(){try{window.localStorage.removeItem(x)}catch{}this.anonymousId="",this.sessionToken="";try{await this.ensureStorefrontSession()}catch{this.bootstrapLocalSession()}}sync(){if(!this.anonymousId||!this.sessionToken)return;const t=this.getSnapshot(),e=JSON.stringify({...this.getAuthPayload(),events:[{type:"session_sync",ts:Date.now(),sessionId:this.anonymousId,shop:this.shop,url:window.location.href,referrer:document.referrer,snapshot:t,...t}]});fetch(this.endpoint("/events"),{method:"POST",headers:{"Content-Type":"application/json","X-AOVBoost-Shop":this.shop},body:e,keepalive:!0}).catch(()=>{})}updateJourneyStage(){if(this.cartProductIds.size>0){this.journeyStage="buying";return}if(this.getSnapshotDuration()>=60||Array.from(this.productViewCounts.values()).some(t=>t>=2)){this.journeyStage="deciding";return}if(this.viewedProductIds.size>=3){this.journeyStage="comparing";return}this.journeyStage="discovering"}endpoint(t){return`${this.apiBase.replace(/\/$/,"")}${t}`}async ensureStorefrontSession(){const t=this.getStoredStorefrontSession();if(t){this.anonymousId=t.sessionId,this.sessionToken=t.sessionToken;return}const e=await fetch(this.endpoint("/session"),{method:"GET",headers:{Accept:"application/json"}});if(!e.ok)throw new Error(`Session bootstrap failed: ${e.status}`);const i=await e.json();if(!i.sessionId||!i.sessionToken||i.shop!==this.shop)throw new Error("Invalid storefront session bootstrap response");this.anonymousId=i.sessionId,this.sessionToken=i.sessionToken,this.storeStorefrontSession(i)}getStoredStorefrontSession(){try{const t=JSON.parse(window.localStorage.getItem(x)||"null");return!t||t.shop!==this.shop||!t.sessionId||!t.sessionToken||Number(t.expiresAt||0)<=Math.floor(Date.now()/1e3)+60?null:t}catch{return null}}storeStorefrontSession(t){try{window.localStorage.setItem(x,JSON.stringify(t)),window.localStorage.setItem(k,t.sessionId)}catch{}}bootstrapLocalSession(){let t="";try{t=window.localStorage.getItem(k)||"",t||(t=typeof crypto<"u"&&"randomUUID"in crypto?crypto.randomUUID():`local-${Date.now()}-${Math.random().toString(36).slice(2)}`,window.localStorage.setItem(k,t))}catch{t=`local-${Date.now()}-${Math.random().toString(36).slice(2)}`}this.anonymousId=t,this.sessionToken=""}getSnapshotDuration(){return Math.round((Date.now()-this.startedAt)/1e3)}}function T(s){const t=s.product;return String(s.productId||s.product_id||t?.id||"")}function L(s,t,e){return Math.min(Math.max(s,t),e)}const D=10*60*1e3,M=5*60*1e3,V=30*1e3,rt={long_product_dwell:{category:"browsing_behavior",widgetHint:"chat",throttleMs:60*1e3},repeated_product_view:{category:"browsing_behavior",widgetHint:"bundle",throttleMs:60*1e3},scroll_depth_interest:{category:"browsing_behavior",widgetHint:"chat",oncePerSession:!0},comparison_page_visit:{category:"browsing_behavior",widgetHint:"chat",oncePerSession:!0},search_query:{category:"browsing_behavior",widgetHint:"rec_strip",throttleMs:15*1e3},exit_intent:{category:"browsing_behavior",widgetHint:"exit_intent",oncePerSession:!0},cart_item_added:{category:"cart_checkout",widgetHint:"upsell_drawer",throttleMs:2500,requestDelayMs:50},cart_abandoned:{category:"cart_checkout",widgetHint:"discount_nudge",oncePerSession:!0},cart_value_threshold:{category:"cart_checkout",widgetHint:"discount_nudge",throttleMs:30*1e3},cart_item_removed:{category:"cart_checkout",widgetHint:"rec_strip",throttleMs:5e3},checkout_started:{category:"cart_checkout",widgetHint:"upsell_drawer",oncePerSession:!0},price_hesitation:{category:"user_intent",widgetHint:"toast",throttleMs:30*1e3},price_sensitive_chat:{category:"user_intent",widgetHint:"toast",requestOffer:!1,throttleMs:30*1e3},wishlist_save:{category:"user_intent",widgetHint:"toast",throttleMs:30*1e3},coupon_field_focus:{category:"user_intent",widgetHint:"toast",oncePerSession:!0},purchase_history_match:{category:"customer_profile_loyalty",widgetHint:"chat",throttleMs:60*1e3},loyalty_tier_reached:{category:"customer_profile_loyalty",widgetHint:"chat",throttleMs:60*1e3},subscription_renewal_due:{category:"customer_profile_loyalty",widgetHint:"toast",throttleMs:60*1e3},first_time_visitor:{category:"customer_profile_loyalty",widgetHint:"chat",oncePerSession:!0},flash_sale_window:{category:"time_based",widgetHint:"countdown_banner",oncePerSession:!0},post_purchase_window:{category:"time_based",widgetHint:"post_purchase",oncePerSession:!0},inactivity_timeout:{category:"time_based",widgetHint:"chat",oncePerSession:!0},seasonal_calendar:{category:"time_based",widgetHint:"countdown_banner",oncePerSession:!0},low_inventory_alert:{category:"external_system",widgetHint:"inline_alert",throttleMs:60*1e3},price_drop_webhook:{category:"external_system",widgetHint:"inline_alert",throttleMs:60*1e3},crm_segment_update:{category:"external_system",widgetHint:"chat",throttleMs:60*1e3},payment_failure:{category:"external_system",widgetHint:"toast",throttleMs:60*1e3}};class nt{constructor(t){n(this,"abortController",new AbortController);n(this,"firedAt",new Map);n(this,"timers",new Map);n(this,"activePriceTarget",null);n(this,"options");n(this,"handleStorefrontEvent",t=>{const e=y(t.detail);e.type&&(e.type==="product_view"&&(this.scheduleProductDwell(String(e.productId||"")),this.handleRepeatedProductView(String(e.productId||""))),e.type==="scroll_depth"&&Number(e.depth||0)>=75&&this.fire("scroll_depth_interest",{depth:Number(e.depth||0)}),e.type==="search"&&String(e.query||"").trim().length>=2&&this.fire("search_query",{query:String(e.query||"").trim()}),e.type==="add_to_cart"&&this.syncCartAndFire("cart_item_added",e),e.type==="remove_from_cart"&&this.syncCartAndFire("cart_item_removed",e),e.type==="cart_update"&&this.handleCartState(e),e.type==="checkout_start"&&this.fire("checkout_started",{path:e.path||window.location.pathname}))});n(this,"handleCustomTrigger",t=>{const e=y(t.detail),i=String(e.type||e.trigger||"").trim();i&&this.fire(i,e)});n(this,"handleProfileEvent",t=>{const e=y(t.detail),i=String(e.type||"crm_segment_update");this.fire(i,e)});n(this,"handleSystemEvent",t=>{const e=y(t.detail),i=String(e.type||"external_system_event");this.fire(i,e)});this.options=t}init(){document.addEventListener("aovboost:event",this.handleStorefrontEvent,{signal:this.abortController.signal}),document.addEventListener("aovboost:trigger",this.handleCustomTrigger,{signal:this.abortController.signal}),document.addEventListener("aovboost:profile-event",this.handleProfileEvent,{signal:this.abortController.signal}),document.addEventListener("aovboost:system-event",this.handleSystemEvent,{signal:this.abortController.signal}),this.installProductDwellTracking(),this.installComparisonTracking(),this.installExitIntentTracking(),this.installPriceHoverTracking(),this.installCouponFocusTracking(),this.installWishlistTracking(),this.installInactivityTracking(),this.installFirstTimeVisitorTracking(),this.installInitialCartTracking(),this.installPostPurchaseTracking(),this.installScheduledCampaignTracking()}destroy(){this.abortController.abort(),this.timers.forEach(t=>window.clearTimeout(t)),this.timers.clear()}trigger(t,e={}){this.fire(t,e)}installProductDwellTracking(){this.scheduleProductDwell(v())}scheduleProductDwell(t){this.clearTimer("product_dwell"),!(!t||!ut())&&this.setTimer("product_dwell",()=>{this.fire("long_product_dwell",{productId:t,dwellSeconds:V/1e3})},V)}handleRepeatedProductView(t){if(!t)return;const e=y(this.options.sessionManager.getSnapshot().context.productViewCounts),i=Number(e[t]||0);i>=2&&this.fire("repeated_product_view",{productId:t,viewCount:i})}installComparisonTracking(){const t=`${window.location.pathname} ${document.title}`.toLowerCase();/\b(compare|comparison|versus|vs|alternative|competitor)\b/.test(t)&&window.setTimeout(()=>{this.fire("comparison_page_visit",{path:window.location.pathname})},800)}installExitIntentTracking(){document.addEventListener("mouseleave",t=>{t.clientY<=8&&this.fire("exit_intent",{immediate:!0,path:window.location.pathname})},{signal:this.abortController.signal})}installPriceHoverTracking(){document.addEventListener("mouseover",t=>{const e=pt(t.target);!e||e===this.activePriceTarget||(this.activePriceTarget=e,this.clearTimer("price_hover"),this.setTimer("price_hover",()=>{this.fire("price_hesitation",{productId:v(),priceText:e.textContent?.trim().slice(0,80)||""})},1200))},{signal:this.abortController.signal}),document.addEventListener("mouseout",t=>{const e=this.activePriceTarget;if(!e)return;const i=t.relatedTarget;i&&e.contains(i)||(this.activePriceTarget=null,this.clearTimer("price_hover"))},{signal:this.abortController.signal})}installCouponFocusTracking(){document.addEventListener("focusin",t=>{const e=t.target;!e||!gt(e)||this.fire("coupon_field_focus",{fieldName:e.name||e.id||""})},{signal:this.abortController.signal})}installWishlistTracking(){document.addEventListener("click",t=>{t.target?.closest?.("[data-wishlist], [data-save-product], .wishlist, .wishlist-button, [aria-label*='wishlist'], [aria-label*='Wishlist'], [aria-label*='save'], [aria-label*='Save']")&&this.fire("wishlist_save",{productId:v()})},{signal:this.abortController.signal})}installInactivityTracking(){const t=()=>{this.clearTimer("inactivity"),this.setTimer("inactivity",()=>{this.fire("inactivity_timeout",{idleSeconds:M/1e3})},M)};["click","keydown","scroll","touchstart"].forEach(e=>{window.addEventListener(e,t,{passive:!0,signal:this.abortController.signal})}),t()}installFirstTimeVisitorTracking(){try{const t="aovboost_returning_visitor";if(window.localStorage.getItem(t)==="true")return;window.localStorage.setItem(t,"true"),window.setTimeout(()=>{this.fire("first_time_visitor",{path:window.location.pathname})},1800)}catch{}}installInitialCartTracking(){/\/cart(?:\/|$)/.test(window.location.pathname)&&window.setTimeout(async()=>{const t=await this.readCart();if(t.cartItemCount<=0)return;const e={...t,source:"initial_cart_state"};this.options.eventBus.track("cart_update",e),this.fire("cart_item_added",e),this.handleCartState(e)},900)}installPostPurchaseTracking(){ht()&&window.setTimeout(()=>{this.fire("post_purchase_window",{path:window.location.pathname})},1200)}installScheduledCampaignTracking(){const t=y(window.AOVBoost?.campaign),e=String(t.type||"");if(!e)return;const i=Date.parse(String(t.startsAt||"")),o=Date.parse(String(t.endsAt||"")),a=Date.now();(!Number.isFinite(i)||i<=a)&&(!Number.isFinite(o)||o>a)&&this.fire(e==="seasonal"?"seasonal_calendar":"flash_sale_window",{campaign:t,endsAt:t.endsAt})}syncCartAndFire(t,e){window.setTimeout(async()=>{const i=await this.readCart(),o={...e,...i};this.fire(t,o),(i.cartProductIds.length>0||i.cartValue>0)&&this.options.eventBus.track("cart_update",o),this.handleCartState(o)},350)}async readCart(){try{const t=await fetch("/cart.js",{headers:{Accept:"application/json"},keepalive:!0});if(!t.ok)throw new Error(`Cart read failed: ${t.status}`);const e=await t.json(),i=Array.isArray(e.items)?e.items:[],o=i.map(a=>q(a.product_id)).filter(Boolean);return{cartToken:e.token||"",cartProductIds:o,cartItemCount:Number(e.item_count||i.length||0),cartValue:Number(e.total_price||0)/100}}catch{return{cartToken:"",cartProductIds:[],cartItemCount:0,cartValue:0}}}handleCartState(t){const e=Number(t.cartValue||0),i=Number(t.cartItemCount||0);e>0&&this.fire("cart_value_threshold",t),this.clearTimer("cart_idle"),i>0&&this.setTimer("cart_idle",()=>{this.fire("cart_abandoned",{...t,idleSeconds:D/1e3})},D)}fire(t,e={}){const i=ct(t),o=Date.now(),a=i.throttleMs??10*1e3,d=this.firedAt.get(t)||0;if(o-d<a||i.oncePerSession&&dt(t))return;i.oncePerSession&&lt(t),this.firedAt.set(t,o);const c={...e,triggerType:t,triggerCategory:i.category,widgetHint:i.widgetHint};this.options.eventBus.track(t,c),i.requestOffer!==!1&&window.setTimeout(()=>{this.options.offerPoller.requestOffer(t,c)},i.requestDelayMs??150)}setTimer(t,e,i){this.clearTimer(t),this.timers.set(t,window.setTimeout(e,i))}clearTimer(t){const e=this.timers.get(t);e&&window.clearTimeout(e),this.timers.delete(t)}}function ct(s){return rt[s]||{category:"external_system",widgetHint:"chat",throttleMs:3e4}}function y(s){return s&&typeof s=="object"&&!Array.isArray(s)?s:{}}function dt(s){try{return sessionStorage.getItem(`aovboost_trigger:${s}`)==="true"}catch{return!1}}function lt(s){try{sessionStorage.setItem(`aovboost_trigger:${s}`,"true")}catch{}}function ut(){return/\/products(?:\/|$)/.test(window.location.pathname)||!!v()}function ht(){return/\/thank_you(?:\/|$)/.test(window.location.pathname)||!!window.Shopify?.checkout}function v(){const s=window.Shopify?.product||window.ShopifyAnalytics?.meta?.product||null;return s?q(s.gid||s.id):""}function q(s){const t=String(s||"");return t?t.startsWith("gid://shopify/Product/")?t:`gid://shopify/Product/${t}`:""}function pt(s){const t=s instanceof HTMLElement?s:null;return t?t.closest("[data-price], .price, .product-price, .product__price, [class*='price'], [class*='Price'], [id*='price'], [id*='Price']"):null}function gt(s){const t=[s.name,s.id,s.placeholder,s.getAttribute("aria-label"),s.getAttribute("autocomplete")].filter(Boolean).join(" ").toLowerCase();return/\b(coupon|discount|promo|promotion|voucher|code)\b/.test(t)}const O="aovboost_dismissed_widgets";class u{constructor(t){n(this,"root");n(this,"container");this.payload=t,this.container=document.createElement("div"),this.container.setAttribute("data-aovboost-widget",this.getWidgetType()),this.root=this.container.attachShadow({mode:"open"}),this.injectStyles()}destroy(){this.container.remove()}mount(t=document.body){t.appendChild(this.container),this.render(),this.trackImpression()}injectStyles(){const t=document.createElement("style");t.textContent=yt,this.root.appendChild(t)}trackImpression(){this.track("widget_impression",{})}trackClick(t){this.track("widget_click",{action:t})}trackDismiss(){this.track("widget_dismiss",{});try{const t=JSON.parse(localStorage.getItem(O)||"[]"),i=[...(Array.isArray(t)?t.filter(o=>typeof o=="object"&&o):[]).filter(o=>o.widgetType!==this.getWidgetType()),{widgetType:this.getWidgetType(),dismissedAt:Date.now()}];localStorage.setItem(O,JSON.stringify(i))}catch{}}track(t,e){const i=window.AOVBoostSDK?.track,o={type:t,widgetType:this.getWidgetType(),offerId:this.payload.offerId,...e};if(typeof i=="function"){i(t,o);return}document.dispatchEvent(new CustomEvent("aovboost:track",{detail:o}))}html(t){const e=this.root.querySelector("[data-aovboost-content]");e&&e.remove();const i=document.createElement("div");i.setAttribute("data-aovboost-content","true"),i.innerHTML=t,this.root.appendChild(i)}}function r(s,t=""){return ft(typeof s=="string"&&s.trim()?s:t)}function f(s,t="USD"){const e=Number(s||0);try{return new Intl.NumberFormat(void 0,{style:"currency",currency:t}).format(e)}catch{return`$${e.toFixed(2)}`}}function w(s){const e=[s.products,s.bundle?.items,s.items].find(i=>Array.isArray(i));return Array.isArray(e)?e.map(i=>{const o=i.product||i.target||i;return{id:o.id||i.productId||i.targetId,variantId:o.variantId||i.variantId||i.id,title:o.title||i.title||"Recommended product",handle:o.handle||i.handle||"",imageUrl:o.imageUrl||o.image||i.imageUrl||i.image,price:o.price||i.price||"",quantity:i.quantity||1,reason:i.reason||i.affinity?.reason||i.reasoning||"",orderCount:i.orderCount||i.affinity?.orderCount||0}}):[]}async function I(s,t=1){if(!s)return null;const e=String(s).split("/").pop(),i=await fetch("/cart/add.js",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:e,quantity:t})});return i.ok?i.json():null}async function mt(s){const t=s.filter(i=>i.variantId).map(i=>({id:String(i.variantId).split("/").pop(),quantity:i.quantity||1}));if(t.length===0)return null;const e=await fetch("/cart/add.js",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({items:t})});return e.ok?e.json():null}function ft(s){return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;")}const yt=`
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
`;class wt extends u{getWidgetType(){return"bundle"}render(){const t=this.payload.bundle||{},e=this.payload.copy||{},i=w(this.payload),o=String(window.AOVBoost?.currency||"USD"),a=i.reduce((l,h)=>l+Number(h.price||0)*Number(h.quantity||1),0),d=Number(t.discountValue||0),c=t.discountType==="percentage"?a*(1-d/100):t.discountType==="fixed"?Math.max(a-d,0):a;this.html(`
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
            ${i.map(l=>`
                  <article class="tile">
                    ${l.imageUrl?`<img src="${r(l.imageUrl)}" alt="${r(l.title)}" loading="lazy">`:""}
                    <p class="product-name">${r(l.title)}</p>
                    <span class="price">${r(l.price?f(l.price,o):"")}</span>
                  </article>
                `).join("")}
          </div>
          <div class="totals">
            ${a>c?`<span class="strike">${f(a,o)}</span>`:""}
            <strong>${f(c,o)}</strong>
          </div>
          <div class="actions">
            <button type="button" class="primary" data-add>${r(e.ctaText||"Add bundle to cart")}</button>
          </div>
        </div>
      </section>
    `),this.root.querySelector("[data-add]")?.addEventListener("click",async()=>{this.trackClick("add_bundle"),await mt(i.map(l=>({variantId:l.variantId,quantity:Number(l.quantity||1)}))),document.dispatchEvent(new CustomEvent("add-to-cart",{detail:{source:"bundle_widget"}}))})}}class vt extends u{constructor(e){super(e);n(this,"messages",[]);n(this,"expanded",!1);n(this,"sending",!1);const i=e.copy;this.messages.push({role:"assistant",content:String(i?.greeting||e.greeting||"Hi. Can I help you find the perfect product today?")})}getWidgetType(){return"chat"}render(){const e=this.payload.copy||{};this.html(`
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
        ${r(e.content)}
        ${this.renderProductLinks(e.content)}
      </div>
    `}renderProductLinks(e){const i=e.match(/\/products\/([a-z0-9-]+)/i);if(!i)return"";const o=i[1];return`
      <div class="inline-product">
        <p class="product-name">${r(o.replace(/-/g," "))}</p>
        <a href="/products/${r(o)}">View product</a>
      </div>
    `}appendMessage(e){const i=this.root.querySelector("[data-messages]");if(!i)throw new Error("Messages container not found");const o=document.createElement("div");return o.className=`bubble ${e.role}`,o.textContent=e.content,i.appendChild(o),this.scrollToBottom(),o}async sendMessage(){if(this.sending)return;const e=this.root.querySelector("[data-input]"),i=this.root.querySelector("[data-send]"),o=e?.value.trim();if(!o)return;this.sending=!0,i&&(i.disabled=!0),e.value="",this.messages.push({role:"user",content:o}),this.appendMessage({role:"user",content:o}),this.trackClick("send_message"),bt(o)&&(this.track("chat_intent",{intent:"price_sensitive"}),document.dispatchEvent(new CustomEvent("aovboost:trigger",{detail:{type:"price_sensitive_chat",message:o}})));const a=this.messages.push({role:"assistant",content:""})-1,d=this.appendMessage({role:"assistant",content:""});this.showTyping();try{let c=await this.requestChat(o);if(c.status===401&&(await window.AOVBoostSDK?.refreshSession?.(),c=await this.requestChat(o)),!c.ok)throw new Error(`Server returned ${c.status}`);if(!c.body)throw new Error("Missing stream body");const l=c.body.getReader(),h=new TextDecoder;let A="",P=!1;for(;;){const{done:Ot,value:Bt}=await l.read();if(Ot)break;A+=h.decode(Bt,{stream:!0});const H=A.split(`
`);A=H.pop()||"";for(const W of H){if(!W.startsWith("data: "))continue;const F=W.slice(6);if(F!=="[DONE]")try{const U=JSON.parse(F);U.delta&&(P||(this.removeTyping(),P=!0),this.messages[a].content+=U.delta,d.textContent=this.messages[a].content,this.updateProductLink(this.messages[a].content,d),this.scrollToBottom())}catch{}}}P||(this.removeTyping(),this.messages[a].content||(this.messages[a].content="I can help you compare products and find the right add-ons.",d.textContent=this.messages[a].content))}catch{this.removeTyping(),this.messages[a].content=this.messages[a].content||"I had trouble connecting. Please try again in a moment.",d.textContent=this.messages[a].content}finally{this.sending=!1,i&&(i.disabled=!1)}}requestChat(e){const i=window.AOVBoost||{},o=window.AOVBoostSDK,a=_t(i.apiBase).replace(/\/$/,"");return fetch(`${a}/chat`,{method:"POST",headers:{"Content-Type":"application/json","X-AOVBoost-Shop":o?.shop||i.shop||""},body:JSON.stringify({sessionId:o?.sessionId,sessionToken:o?.sessionToken,shop:o?.shop||i.shop,message:e,messageHistory:this.messages.slice(0,-2)})})}showTyping(){const e=this.root.querySelector("[data-messages]");if(!e)return;const i=document.createElement("div");i.className="bubble assistant dots",i.dataset.typing="true",i.innerHTML="<span>.</span><span>.</span><span>.</span>",e.appendChild(i),this.scrollToBottom()}removeTyping(){const e=this.root.querySelector("[data-typing]");e&&e.remove()}updateProductLink(e,i){const o=e.match(/\/products\/([a-z0-9-]+)/i),a=i.querySelector(".inline-product");if(a&&a.remove(),!o)return;const d=o[1],c=document.createElement("div");c.className="inline-product",c.innerHTML=`
      <p class="product-name">${r(d.replace(/-/g," "))}</p>
      <a href="/products/${r(d)}">View product</a>
    `,i.appendChild(c)}scrollToBottom(){const e=this.root.querySelector("[data-messages]");e&&(e.scrollTop=e.scrollHeight)}dismiss(){this.trackDismiss(),this.container.animate([{transform:"translateY(0)"},{transform:"translateY(120%)"}],{duration:180,easing:"ease-in",fill:"forwards"}),window.setTimeout(()=>this.destroy(),190)}}function bt(s){return/\b(expensive|cheaper|cheap|discount|coupon|promo|deal|sale|price|afford|budget|cost)\b/i.test(s)}function _t(s){const t=typeof s=="string"?s.trim():"";return!t||t==="/api"||t.startsWith("/api/")?"/apps/aovboost":t.includes("/apps/aovboost")||t.startsWith("/apps/")?t:"/apps/aovboost"}class St extends u{constructor(){super(...arguments);n(this,"timer")}getWidgetType(){return"countdown_banner"}render(){const e=this.payload.copy||{},i=e.headline||this.payload.headline||"Limited-time offer",o=e.subheadline||e.offerLine||this.payload.body||"Relevant bundles and add-ons are available for this session.";this.html(`
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
          <h3 class="title">${r(i)}</h3>
          <p class="body">${r(o)}</p>
        </div>
        <strong class="timer" data-countdown></strong>
        <button type="button" class="icon" data-dismiss aria-label="Close">x</button>
      </aside>
    `),this.root.querySelector("[data-dismiss]")?.addEventListener("click",()=>{this.trackDismiss(),this.destroy()}),this.tick(),this.timer=window.setInterval(()=>this.tick(),1e3)}destroy(){this.timer&&window.clearInterval(this.timer),super.destroy()}tick(){const e=this.root.querySelector("[data-countdown]");if(!e)return;const i=Date.parse(String(this.payload.endsAt||""));if(!Number.isFinite(i)){e.textContent="Today";return}const o=Math.max(i-Date.now(),0);if(o<=0){this.destroy();return}const a=Math.floor(o/36e5),d=Math.floor(o%36e5/6e4),c=Math.floor(o%6e4/1e3);e.textContent=a>0?`${a}h ${d}m`:`${d}m ${c.toString().padStart(2,"0")}s`}}class kt extends u{getWidgetType(){return"discount_nudge"}render(){this.draw(),document.addEventListener("add-to-cart",()=>this.draw())}draw(){const t=this.payload.copy||{},e=String(window.AOVBoost?.currency||"USD"),i=Number(this.payload.threshold||50),o=Number(this.payload.cartValue||0),a=Math.max(i-o,0),d=i>0?Math.min(o/i,1):0;this.html(`
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
        .track span { display: block; height: 100%; width: ${d*100}%; background: var(--aovboost-accent); transition: width 200ms ease; }
      </style>
      <div class="bar">
        <div class="label">
          <span>${a>0?r(t.progressLabel||`You're ${f(a,e)} away from your reward`):r(t.rewardDescription||"Reward unlocked")}</span>
          <button type="button" class="icon" data-dismiss aria-label="Close">x</button>
        </div>
        <div class="track" aria-hidden="true"><span></span></div>
      </div>
    `),this.root.querySelector("[data-dismiss]")?.addEventListener("click",()=>{this.trackDismiss(),this.destroy()}),a<=0&&window.setTimeout(()=>this.destroy(),3e3)}}class xt extends u{constructor(){super(...arguments);n(this,"shown",!1);n(this,"handleMouseLeave",e=>{e.clientY<10&&this.show()});n(this,"handleVisibility",()=>{document.visibilityState==="hidden"&&this.show()})}getWidgetType(){return"exit_intent"}mount(e=document.body){if(e.appendChild(this.container),!this.shouldSkip()){if(this.payload.immediate){this.show();return}document.addEventListener("mouseleave",this.handleMouseLeave),document.addEventListener("visibilitychange",this.handleVisibility)}}render(){const e=this.payload.copy||{};this.html(`
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
    `),this.root.querySelector("[data-claim]")?.addEventListener("click",()=>{this.trackClick("claim_exit_offer"),this.destroy()}),this.root.querySelectorAll("[data-dismiss]").forEach(i=>{i.addEventListener("click",()=>{this.trackDismiss(),this.destroy()})})}destroy(){document.removeEventListener("mouseleave",this.handleMouseLeave),document.removeEventListener("visibilitychange",this.handleVisibility),super.destroy()}show(){if(!(this.shown||this.hasFired())){this.shown=!0;try{sessionStorage.setItem("aovboost_exit_intent_fired","true")}catch{}this.render(),this.trackImpression()}}hasFired(){try{return sessionStorage.getItem("aovboost_exit_intent_fired")==="true"}catch{return!1}}shouldSkip(){return/\/(?:checkout|thank_you)(?:\/|$)/.test(window.location.pathname)}}class Tt extends u{getWidgetType(){return"inline_alert"}render(){const t=this.payload.copy||{},e=t.headline||this.payload.headline||"Store update",i=t.subheadline||t.offerLine||this.payload.body||"A relevant product update is available.";this.html(`
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
            <h3 class="title">${r(e)}</h3>
            <p class="body">${r(i)}</p>
          </div>
          <button type="button" class="icon" data-dismiss aria-label="Close">x</button>
        </div>
      </aside>
    `),this.root.querySelector("[data-dismiss]")?.addEventListener("click",()=>{this.trackDismiss(),this.destroy()})}}class It extends u{getWidgetType(){return"post_purchase"}mount(t=document.body){this.isThankYouPage()&&super.mount(t)}render(){const t=this.payload.copy||{},e=w(this.payload)[0]||this.payload.product||{},i=String(window.AOVBoost?.currency||"USD");this.html(`
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
              <span class="price">${r(e.price?f(e.price,i):"")}</span>
            </div>
            <p class="reason">${r(t.oneLineReason||"A useful add-on for what you just bought.")}</p>
            <button type="button" class="primary" data-add>${r(t.ctaText||"Add to my order")}</button>
          </div>
        </article>
      </section>
    `),this.root.querySelector("[data-add]")?.addEventListener("click",async()=>{this.trackClick("add_post_purchase");const o=e.variantId;if(o){await I(o);return}const a=e.handle;a&&(window.location.href=`/products/${a}`)})}isThankYouPage(){return/\/thank_you(?:\/|$)/.test(window.location.pathname)||!!window.Shopify?.checkout}}class Ct extends u{getWidgetType(){return"rec_strip"}render(){const t=w(this.payload),e=String(window.AOVBoost?.currency||"USD");this.html(`
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
          ${t.map(i=>`
                <article class="tile">
                  ${i.reason?`<span class="badge">${r(i.reason)}</span>`:""}
                  ${i.imageUrl?`<img data-src="${r(i.imageUrl)}" alt="${r(i.title)}">`:""}
                  <p class="product-name">${r(i.title)}</p>
                  <span class="price">${r(i.price?f(i.price,e):"")}</span>
                  <button type="button" class="primary" data-add="${r(i.variantId)}">Add to cart</button>
                </article>
              `).join("")}
        </div>
      </section>
    `),this.lazyLoadImages(),this.root.querySelectorAll("[data-add]").forEach(i=>{i.addEventListener("click",async()=>{this.trackClick("add_recommendation"),await I(i.dataset.add)})})}lazyLoadImages(){const t=Array.from(this.root.querySelectorAll("img[data-src]"));if(!("IntersectionObserver"in window)){t.forEach(i=>{i.src=i.dataset.src||""});return}const e=new IntersectionObserver(i=>{i.forEach(o=>{if(!o.isIntersecting)return;const a=o.target;a.src=a.dataset.src||"",e.unobserve(a)})});t.forEach(i=>e.observe(i))}}class At extends u{constructor(){super(...arguments);n(this,"interval")}getWidgetType(){return"social_proof"}render(){const i=w(this.payload).filter(a=>Number(a.orderCount||0)>0).map(a=>`${Number(a.orderCount)} people bought this with ${a.title}`);i.length===0&&i.push("Frequently bought together"),this.html(`
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
      <div class="pill" role="status"><span class="dot"></span><span data-message>${r(i[0])}</span></div>
    `);let o=0;this.interval=window.setInterval(()=>{o=(o+1)%i.length;const a=this.root.querySelector("[data-message]");a&&(a.textContent=i[o])},5e3)}destroy(){this.interval&&window.clearInterval(this.interval),super.destroy()}}class Pt extends u{getWidgetType(){return"toast"}render(){const t=this.payload.copy||{},e=t.headline||this.payload.headline||"A better option is available",i=t.subheadline||t.offerLine||this.payload.body||"I can help find a better match or a useful offer.",o=t.ctaText||this.payload.ctaText||"Open assistant";this.html(`
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
            <h3 class="title">${r(e)}</h3>
            <p class="body">${r(i)}</p>
          </div>
          <button type="button" class="icon" data-dismiss aria-label="Close">x</button>
        </div>
        <div class="actions">
          <button type="button" class="primary" data-chat>${r(o)}</button>
        </div>
      </aside>
    `),this.root.querySelector("[data-dismiss]")?.addEventListener("click",()=>{this.trackDismiss(),this.destroy()}),this.root.querySelector("[data-chat]")?.addEventListener("click",()=>{this.trackClick("open_assistant"),document.dispatchEvent(new CustomEvent("aovboost:trigger",{detail:{type:"long_product_dwell",source:"toast"}})),this.destroy()}),window.setTimeout(()=>this.destroy(),9e3)}}class Et extends u{constructor(){super(...arguments);n(this,"timer");n(this,"deadline",Date.now()+8e3)}getWidgetType(){return"upsell_drawer"}render(){const e=w(this.payload).slice(0,3),i=this.payload.copy||{},o=String(window.AOVBoost?.currency||"USD");this.html(`
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
            <h3 class="title">${r(i.headline||"Great choice. Complete the set")}</h3>
            <p class="body">People who bought this also love:</p>
          </div>
          <button type="button" class="icon" data-dismiss aria-label="Close">x</button>
        </div>
        <div class="timer"><span data-timer></span></div>
        <div class="product-grid">
          ${e.map(a=>`
                <article class="product-card">
                  ${a.imageUrl?`<img src="${r(a.imageUrl)}" alt="${r(a.title)}" loading="lazy">`:"<span></span>"}
                  <div class="stack">
                    <div>
                      <p class="product-name">${r(a.title)}</p>
                      <span class="price">${r(a.price?f(a.price,o):"")}</span>
                    </div>
                    <p class="reason">${r(a.reason||i.whyThisGoes||"It pairs well with your cart.")}</p>
                    <button type="button" class="primary" data-add="${r(a.variantId)}">Add to cart</button>
                  </div>
                </article>
              `).join("")}
        </div>
        <div class="actions">
          <a class="secondary" href="/cart">Continue to cart</a>
        </div>
      </aside>
    `),this.root.querySelectorAll("[data-dismiss]").forEach(a=>{a.addEventListener("click",()=>this.dismiss())}),this.root.querySelectorAll("[data-add]").forEach(a=>{a.addEventListener("click",async()=>{this.trackClick("add_upsell"),await I(a.dataset.add)})}),this.startCountdown()}destroy(){this.timer&&window.clearInterval(this.timer),super.destroy()}startCountdown(){this.timer&&window.clearInterval(this.timer),this.deadline=Date.now()+8e3,this.timer=window.setInterval(()=>{const e=Math.max(this.deadline-Date.now(),0),i=this.root.querySelector("[data-timer]");i&&(i.style.transform=`scaleX(${e/8e3})`),e<=0&&this.dismiss()},120)}dismiss(){this.trackDismiss(),this.container.animate([{transform:"translateX(0)"},{transform:"translateX(100%)"}],{duration:180,easing:"ease-in",fill:"forwards"}),window.setTimeout(()=>this.destroy(),190)}}const B="aovboost_dismissed_widgets",$t=30*60*1e3;class Lt{constructor(){n(this,"activeWidget",null);n(this,"activeKey","");n(this,"activeWidgetType","")}mountDecision(t){if(!t.widgetType||this.getDismissedWidgets().includes(t.widgetType))return;const e=t.payload||{},i=String(e.offerId||""),o=`${t.widgetType}:${i}`;if(t.widgetType==="chat"&&this.activeWidgetType==="chat"||o===this.activeKey)return;this.destroyActive();const a=Dt(t.widgetType,e);if(!a)return;const d=this.resolveTarget(t.widgetType);a.mount(d),this.activeWidget=a,this.activeKey=o,this.activeWidgetType=t.widgetType}destroyActive(){this.activeWidget?.destroy(),this.activeWidget=null,this.activeKey="",this.activeWidgetType=""}getDismissedWidgets(){try{const t=JSON.parse(localStorage.getItem(B)||"[]");if(!Array.isArray(t))return[];const e=Date.now(),i=t.filter(o=>o&&typeof o=="object").filter(o=>e-Number(o.dismissedAt||0)<$t);return i.length!==t.length&&localStorage.setItem(B,JSON.stringify(i)),i.map(o=>String(o.widgetType||"")).filter(Boolean)}catch{return[]}}resolveTarget(t){return t==="bundle"?b(".product-form, [data-product-form]"):t==="rec_strip"?b(".product__description, [data-product-description]"):t==="social_proof"?b(".product-form__submit, [data-add-to-cart]"):t==="inline_alert"?b("[data-price], .product__price, .price, .product-form, [data-product-form]"):document.body}}function Dt(s,t){switch(s){case"chat":return new vt(t);case"toast":return new Pt(t);case"countdown_banner":return new St(t);case"inline_alert":return new Tt(t);case"bundle":return new wt(t);case"upsell_drawer":return new Et(t);case"discount_nudge":return new kt(t);case"rec_strip":return new Ct(t);case"social_proof":return new At(t);case"exit_intent":return new xt(t);case"post_purchase":return new It(t);default:return null}}function b(s){const t=document.querySelector(s),e=document.createElement("div");return e.setAttribute("data-aovboost-mount",s),t?.parentElement?(t.insertAdjacentElement("afterend",e),e):(document.body.appendChild(e),e)}let N=!1;function C(){N||(N=!0,Mt().catch(s=>{console.log("AOVBoost SDK skipped:",s instanceof Error?s.message:String(s))}))}async function Mt(){try{const s=window.AOVBoost||{},t=s.shop;if(!t)return;j(s)||await qt(s);const e=Vt(s.apiBase),i=new at(t,e),o=new g({shop:t,sessionManager:i,apiBase:e}),a=new Lt,d=new et({shop:t,apiBase:e,eventBus:o,sessionManager:i,widgetManager:a}),c=new nt({eventBus:o,offerPoller:d,sessionManager:i});await i.init(),window.AOVBoostSDK={shop:t,sessionId:i.anonymousId,sessionToken:i.getAuthPayload().sessionToken,refreshSession:async()=>{await i.refreshAuth(),window.AOVBoostSDK&&(window.AOVBoostSDK.sessionId=i.anonymousId,window.AOVBoostSDK.sessionToken=i.getAuthPayload().sessionToken)},track:(l,h={})=>o.track(l,h),trigger:(l,h={})=>c.trigger(l,h),requestOffer:(l="global",h={})=>d.requestOffer(l,h),destroy:()=>{c.destroy(),d.destroy(),i.destroy(),a.destroyActive()}},c.init(),o.init(),d.init()}catch(s){console.log("AOVBoost SDK skipped:",s instanceof Error?s.message:String(s))}}function Vt(s){const t=typeof s=="string"?s.trim():"";return!t||t==="/api"||t.startsWith("/api/")?"/apps/aovboost":t.includes("/apps/aovboost")||t.startsWith("/apps/")?t:"/apps/aovboost"}function j(s){if(s.settings?.trackingConsentRequired!==!0)return!0;const t=window.Shopify?.customerPrivacy;return typeof t?.analyticsProcessingAllowed=="function"?!!t.analyticsProcessingAllowed():typeof t?.userCanBeTracked=="function"?!!t.userCanBeTracked():!0}function qt(s){return new Promise(t=>{const e=()=>{j({...s,settings:{...s.settings,trackingConsentRequired:!1}})&&(i(),t())},i=()=>{["visitorConsentCollected","shopify:customer_privacy:consent_collected","aovboost:consent-granted"].forEach(o=>window.removeEventListener(o,e))};["visitorConsentCollected","shopify:customer_privacy:consent_collected","aovboost:consent-granted"].forEach(o=>window.addEventListener(o,e))})}return document.readyState==="loading"?document.addEventListener("DOMContentLoaded",C,{once:!0}):C(),p.init=C,Object.defineProperty(p,Symbol.toStringTag,{value:"Module"}),p}({});
