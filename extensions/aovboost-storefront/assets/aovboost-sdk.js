var AOVBoostSDKBundle=function(p){"use strict";var Lt=Object.defineProperty;var Vt=(p,g,m)=>g in p?Lt(p,g,{enumerable:!0,configurable:!0,writable:!0,value:m}):p[g]=m;var a=(p,g,m)=>Vt(p,typeof g!="symbol"?g+"":g,m);class g{constructor(t){a(this,"queue",[]);a(this,"flushTimer");a(this,"scrollDepths",new Set);a(this,"originalFetch",null);this.options=t}init(){this.installNavigationTracking(),this.installCartFetchTracking(),this.installScrollTracking(),this.installHoverTracking(),this.installSearchTracking(),document.addEventListener("add-to-cart",t=>{this.track("add_to_cart",m(t.detail))}),document.addEventListener("aovboost:track",t=>{const e=m(t.detail);this.track(String(e.type||"widget_event"),e)}),window.addEventListener("pagehide",()=>this.flush()),this.trackPageView()}track(t,e={}){const s={type:t,ts:Date.now(),sessionId:this.options.sessionManager.anonymousId,shop:this.options.shop,url:window.location.href,referrer:document.referrer,...e};this.options.sessionManager.recordEvent(s),this.queue.push(s),document.dispatchEvent(new CustomEvent("aovboost:event",{detail:s})),this.scheduleFlush()}flush(){if(this.flushTimer&&(window.clearTimeout(this.flushTimer),this.flushTimer=void 0),this.queue.length===0)return;const t=this.queue.splice(0),e=JSON.stringify({...this.options.sessionManager.getAuthPayload(),events:t});try{if(navigator.sendBeacon&&navigator.sendBeacon(this.endpoint("/events"),new Blob([e],{type:"application/json"})))return}catch{}fetch(this.endpoint("/events"),{method:"POST",headers:{"Content-Type":"application/json","X-AOVBoost-Shop":this.options.shop},body:e,keepalive:!0}).catch(()=>{this.queue.unshift(...t)})}scheduleFlush(){this.flushTimer||(this.flushTimer=window.setTimeout(()=>this.flush(),2e3))}endpoint(t){return`${(this.options.apiBase||"/apps/aovboost").replace(/\/$/,"")}${t}`}installNavigationTracking(){const t=history.pushState,e=history.replaceState;history.pushState=(...s)=>{const o=t.apply(history,s);return window.setTimeout(()=>this.trackPageView(),0),o},history.replaceState=(...s)=>{const o=e.apply(history,s);return window.setTimeout(()=>this.trackPageView(),0),o},window.addEventListener("popstate",()=>this.trackPageView())}trackPageView(){this.track("page_view",{pageType:W()}),H()&&this.track("checkout_start",{path:window.location.pathname});const t=N();t&&this.track("product_view",{productId:J(t.gid||t.id),handle:t.handle,title:t.title});const e=j();(e||window.location.pathname.includes("/collections/"))&&this.track("collection_view",{collectionId:String(e?.id||""),handle:e?.handle||z("/collections/"),title:e?.title})}installCartFetchTracking(){this.originalFetch||(this.originalFetch=window.fetch.bind(window),window.fetch=async(...t)=>{const e=F(t[0]),s=t[1],o=await this.originalFetch(...t);try{U(e)?this.track("add_to_cart",{...I(s?.body),requestUrl:e}):R(e)?this.track("remove_from_cart",{...I(s?.body),requestUrl:e}):Y(e)&&this.track("search",{query:K(e),requestUrl:e})}catch{}return o})}installScrollTracking(){let t=!1;window.addEventListener("scroll",()=>{t||(t=!0,window.setTimeout(()=>{t=!1;const e=document.documentElement.scrollHeight-window.innerHeight;if(e<=0)return;const s=Math.round(window.scrollY/e*100);[25,50,75,90].forEach(o=>{s>=o&&!this.scrollDepths.has(o)&&(this.scrollDepths.add(o),this.track("scroll_depth",{depth:o}))})},200))},{passive:!0})}installHoverTracking(){document.addEventListener("mouseenter",t=>{const s=t.target?.closest?.(".product-card");if(!s)return;const o=window.setTimeout(()=>{this.track("product_hover",{productId:s.dataset.productId||s.dataset.productGid||"",handle:s.dataset.productHandle||""})},800);s.addEventListener("mouseleave",()=>window.clearTimeout(o),{once:!0})},!0)}installSearchTracking(){document.addEventListener("input",t=>{const e=t.target;if(!e||!`${e.name||""} ${e.id||""} ${e.type||""}`.toLowerCase().includes("search"))return;const o=e.value.trim();o.length<2||this.track("search",{query:o,source:"predictive_input"})},!0)}}function m(i){return i&&typeof i=="object"&&!Array.isArray(i)?i:{}}function N(){const i=window;return i.Shopify?.product||i.ShopifyAnalytics?.meta?.product||null}function j(){const i=window;return i.Shopify?.collection||i.ShopifyAnalytics?.meta?.collection||null}function W(){return window.ShopifyAnalytics?.meta?.page?.pageType||document.body?.dataset?.template||(window.location.pathname==="/"?"home":"other")}function H(){return/\/checkout(?:\/|$)/.test(window.location.pathname)}function z(i){const t=window.location.pathname.indexOf(i);return t===-1?"":window.location.pathname.slice(t+i.length).split("/")[0]||""}function F(i){return typeof i=="string"?i:i instanceof URL?i.toString():i.url||""}function U(i){return/\/cart\/add(?:\.js)?/.test(i)}function R(i){return/\/cart\/(?:change|update)(?:\.js)?/.test(i)}function Y(i){return i.includes("/search/suggest.json")}function K(i){try{return new URL(i,window.location.origin).searchParams.get("q")||""}catch{return""}}function I(i){if(!i)return{};if(typeof FormData<"u"&&i instanceof FormData)return{variantId:String(i.get("id")||i.get("items[0][id]")||""),quantity:Number(i.get("quantity")||1)};if(typeof URLSearchParams<"u"&&i instanceof URLSearchParams)return{variantId:String(i.get("id")||i.get("items[0][id]")||""),quantity:Number(i.get("quantity")||1)};try{const t=String(i);if(t.trim().startsWith("{")){const s=JSON.parse(t);return{productId:s.productId||s.product_id,variantId:s.id||s.items?.[0]?.id,quantity:s.quantity||s.items?.[0]?.quantity||1}}const e=new URLSearchParams(t);return{variantId:String(e.get("id")||e.get("items[0][id]")||""),quantity:Number(e.get("quantity")||1)}}catch{return{}}}function J(i){const t=String(i||"");return t?t.startsWith("gid://shopify/Product/")?t:`gid://shopify/Product/${t}`:""}class G{constructor(t){a(this,"timer");a(this,"inFlight",!1);a(this,"stopped",!1);a(this,"options");this.options=t}init(){window.setTimeout(()=>this.requestOffer("initial"),1200),this.options.pollMs&&(this.timer=window.setInterval(()=>this.requestOffer("poll"),this.options.pollMs)),document.addEventListener("aovboost:request-offer",()=>{this.requestOffer("manual")}),window.addEventListener("popstate",()=>{window.setTimeout(()=>this.requestOffer("navigation"),300)})}destroy(){this.stopped=!0,this.timer&&window.clearInterval(this.timer)}async requestOffer(t="manual",e={}){if(this.inFlight||this.stopped)return null;this.inFlight=!0;try{const s=this.options.sessionManager.getSnapshot(),o=Array.isArray(e.cartProductIds)?e.cartProductIds.map(String):s.cartProductIds,r=typeof e.cartValue=="number"?e.cartValue:s.cartValue,d={...this.options.sessionManager.getAuthPayload(),currentProductId:Q(),currentPageType:X(),cartProductIds:o,cartValue:r,dismissedWidgets:this.options.widgetManager.getDismissedWidgets(),trigger:t,triggerCategory:e.triggerCategory,triggerPayload:e};let c=await fetch(this.endpoint("/offer"),{method:"POST",headers:{"Content-Type":"application/json","X-AOVBoost-Shop":this.options.shop},body:JSON.stringify(d),keepalive:!0});if(c.status===401&&(await this.options.sessionManager.refreshAuth(),c=await fetch(this.endpoint("/offer"),{method:"POST",headers:{"Content-Type":"application/json","X-AOVBoost-Shop":this.options.shop},body:JSON.stringify({...d,...this.options.sessionManager.getAuthPayload()}),keepalive:!0})),!c.ok)return null;const l=await c.json();return this.options.widgetManager.mountDecision(l),l}catch{return null}finally{this.inFlight=!1}}endpoint(t){return`${this.options.apiBase.replace(/\/$/,"")}${t}`}}function X(){const i=window.location.pathname,t=String(window.ShopifyAnalytics?.meta?.page?.pageType||document.body?.dataset?.template||"").toLowerCase();return i==="/"?"home":/\/collections(?:\/|$)/.test(i)||t.includes("collection")?"collection":/\/products(?:\/|$)/.test(i)||t.includes("product")?"product":/\/cart(?:\/|$)/.test(i)||t.includes("cart")?"cart":/\/checkout(?:\/|$)/.test(i)?"checkout":/\/thank_you(?:\/|$)/.test(i)||window.Shopify?.checkout?"thankyou":"other"}function Q(){const i=window.Shopify?.product||window.ShopifyAnalytics?.meta?.product||null;if(!i)return;const t=String(i.gid||i.id||"");if(t)return t.startsWith("gid://shopify/Product/")?t:`gid://shopify/Product/${t}`}const Z="aovboost_anonymous_id",S="aovboost_storefront_session";class tt{constructor(t,e="/apps/aovboost"){a(this,"anonymousId","");a(this,"sessionToken","");a(this,"journeyStage","discovering");a(this,"viewedProductIds",new Set);a(this,"productViewCounts",new Map);a(this,"cartProductIds",new Set);a(this,"pageViews",0);a(this,"maxScrollDepth",0);a(this,"cartActionCount",0);a(this,"cartValue",0);a(this,"startedAt",Date.now());a(this,"lastCartActionAt",0);a(this,"lastEventType","");a(this,"syncTimer");this.shop=t,this.apiBase=e}async init(){await this.ensureStorefrontSession(),this.syncTimer=window.setInterval(()=>this.sync(),3e4),window.addEventListener("pagehide",()=>this.sync())}destroy(){this.syncTimer&&window.clearInterval(this.syncTimer)}recordEvent(t){if(this.lastEventType=t.type,t.type==="page_view"&&(this.pageViews+=1),t.type==="product_view"){const e=x(t);e&&(this.viewedProductIds.add(e),this.productViewCounts.set(e,(this.productViewCounts.get(e)||0)+1))}if(t.type==="scroll_depth"&&(this.maxScrollDepth=Math.max(this.maxScrollDepth,Number(t.depth||0))),t.type==="add_to_cart"){this.cartActionCount+=1,this.lastCartActionAt=Date.now();const e=x(t);e&&this.cartProductIds.add(e),Array.isArray(t.cartProductIds)&&t.cartProductIds.forEach(s=>this.cartProductIds.add(String(s))),this.cartValue=Math.max(this.cartValue,Number(t.cartValue||0)),this.journeyStage="buying"}if(t.type==="cart_update"&&(this.lastCartActionAt=Date.now(),Array.isArray(t.cartProductIds)&&(this.cartProductIds=new Set(t.cartProductIds.map(String))),this.cartValue=Number(t.cartValue||0),this.cartProductIds.size>0&&(this.journeyStage="buying")),t.type==="remove_from_cart"){this.cartActionCount+=1,this.lastCartActionAt=Date.now();const e=x(t);e&&this.cartProductIds.delete(e)}this.updateJourneyStage()}getSnapshot(){const t=Math.round((Date.now()-this.startedAt)/1e3),e=Array.from(this.productViewCounts.values()).reduce((c,l)=>c+l,0),s=A(this.pageViews*2+e*5+(this.maxScrollDepth>=90?10:this.maxScrollDepth>=75?8:this.maxScrollDepth>=50?5:this.maxScrollDepth>=25?3:0)+Math.min(t/120,1)*30+(this.cartProductIds.size>0?30:0),0,100),o=Array.from(this.productViewCounts.entries()).some(([c,l])=>l>=2&&!this.cartProductIds.has(c)),r=this.lastCartActionAt?(Date.now()-this.lastCartActionAt)/1e3:t,d=A((s>40&&this.cartActionCount===0&&r>=90?55:0)+(o?35:0),0,100);return{anonymousId:this.anonymousId,journeyStage:this.journeyStage,intentScore:s,hesitationScore:d,viewedProductIds:Array.from(this.viewedProductIds),cartProductIds:Array.from(this.cartProductIds),totalPageViews:this.pageViews,sessionDuration:t,cartValue:this.cartValue,context:{maxScrollDepth:this.maxScrollDepth,productViewCounts:Object.fromEntries(this.productViewCounts),cartActionCount:this.cartActionCount,cartValue:this.cartValue,lastEventType:this.lastEventType}}}getAuthPayload(){return{sessionId:this.anonymousId,sessionToken:this.sessionToken,shop:this.shop}}async refreshAuth(){try{window.localStorage.removeItem(S)}catch{}this.anonymousId="",this.sessionToken="",await this.ensureStorefrontSession()}sync(){if(!this.anonymousId||!this.sessionToken)return;const t=this.getSnapshot(),e=JSON.stringify({...this.getAuthPayload(),events:[{type:"session_sync",ts:Date.now(),sessionId:this.anonymousId,shop:this.shop,url:window.location.href,referrer:document.referrer,snapshot:t,...t}]});fetch(this.endpoint("/events"),{method:"POST",headers:{"Content-Type":"application/json","X-AOVBoost-Shop":this.shop},body:e,keepalive:!0}).catch(()=>{})}updateJourneyStage(){if(this.cartProductIds.size>0){this.journeyStage="buying";return}if(this.getSnapshotDuration()>=60||Array.from(this.productViewCounts.values()).some(t=>t>=2)){this.journeyStage="deciding";return}if(this.viewedProductIds.size>=3){this.journeyStage="comparing";return}this.journeyStage="discovering"}endpoint(t){return`${this.apiBase.replace(/\/$/,"")}${t}`}async ensureStorefrontSession(){const t=this.getStoredStorefrontSession();if(t){this.anonymousId=t.sessionId,this.sessionToken=t.sessionToken;return}const e=await fetch(this.endpoint("/session"),{method:"GET",headers:{Accept:"application/json"}});if(!e.ok)throw new Error(`Session bootstrap failed: ${e.status}`);const s=await e.json();if(!s.sessionId||!s.sessionToken||s.shop!==this.shop)throw new Error("Invalid storefront session bootstrap response");this.anonymousId=s.sessionId,this.sessionToken=s.sessionToken,this.storeStorefrontSession(s)}getStoredStorefrontSession(){try{const t=JSON.parse(window.localStorage.getItem(S)||"null");return!t||t.shop!==this.shop||!t.sessionId||!t.sessionToken||Number(t.expiresAt||0)<=Math.floor(Date.now()/1e3)+60?null:t}catch{return null}}storeStorefrontSession(t){try{window.localStorage.setItem(S,JSON.stringify(t)),window.localStorage.setItem(Z,t.sessionId)}catch{}}getSnapshotDuration(){return Math.round((Date.now()-this.startedAt)/1e3)}}function x(i){const t=i.product;return String(i.productId||i.product_id||t?.id||"")}function A(i,t,e){return Math.min(Math.max(i,t),e)}const P=10*60*1e3,E=5*60*1e3,$=30*1e3,et={long_product_dwell:{category:"browsing_behavior",widgetHint:"chat",throttleMs:60*1e3},repeated_product_view:{category:"browsing_behavior",widgetHint:"bundle",throttleMs:60*1e3},scroll_depth_interest:{category:"browsing_behavior",widgetHint:"chat",oncePerSession:!0},comparison_page_visit:{category:"browsing_behavior",widgetHint:"chat",oncePerSession:!0},search_query:{category:"browsing_behavior",widgetHint:"rec_strip",throttleMs:15*1e3},exit_intent:{category:"browsing_behavior",widgetHint:"exit_intent",oncePerSession:!0},cart_item_added:{category:"cart_checkout",widgetHint:"upsell_drawer",throttleMs:2500,requestDelayMs:50},cart_abandoned:{category:"cart_checkout",widgetHint:"discount_nudge",oncePerSession:!0},cart_value_threshold:{category:"cart_checkout",widgetHint:"discount_nudge",throttleMs:30*1e3},cart_item_removed:{category:"cart_checkout",widgetHint:"rec_strip",throttleMs:5e3},checkout_started:{category:"cart_checkout",widgetHint:"upsell_drawer",oncePerSession:!0},price_hesitation:{category:"user_intent",widgetHint:"toast",throttleMs:30*1e3},price_sensitive_chat:{category:"user_intent",widgetHint:"toast",requestOffer:!1,throttleMs:30*1e3},wishlist_save:{category:"user_intent",widgetHint:"toast",throttleMs:30*1e3},coupon_field_focus:{category:"user_intent",widgetHint:"toast",oncePerSession:!0},purchase_history_match:{category:"customer_profile_loyalty",widgetHint:"chat",throttleMs:60*1e3},loyalty_tier_reached:{category:"customer_profile_loyalty",widgetHint:"chat",throttleMs:60*1e3},subscription_renewal_due:{category:"customer_profile_loyalty",widgetHint:"toast",throttleMs:60*1e3},first_time_visitor:{category:"customer_profile_loyalty",widgetHint:"chat",oncePerSession:!0},flash_sale_window:{category:"time_based",widgetHint:"countdown_banner",oncePerSession:!0},post_purchase_window:{category:"time_based",widgetHint:"post_purchase",oncePerSession:!0},inactivity_timeout:{category:"time_based",widgetHint:"chat",oncePerSession:!0},seasonal_calendar:{category:"time_based",widgetHint:"countdown_banner",oncePerSession:!0},low_inventory_alert:{category:"external_system",widgetHint:"inline_alert",throttleMs:60*1e3},price_drop_webhook:{category:"external_system",widgetHint:"inline_alert",throttleMs:60*1e3},crm_segment_update:{category:"external_system",widgetHint:"chat",throttleMs:60*1e3},payment_failure:{category:"external_system",widgetHint:"toast",throttleMs:60*1e3}};class st{constructor(t){a(this,"abortController",new AbortController);a(this,"firedAt",new Map);a(this,"timers",new Map);a(this,"activePriceTarget",null);a(this,"options");a(this,"handleStorefrontEvent",t=>{const e=y(t.detail);e.type&&(e.type==="product_view"&&(this.scheduleProductDwell(String(e.productId||"")),this.handleRepeatedProductView(String(e.productId||""))),e.type==="scroll_depth"&&Number(e.depth||0)>=75&&this.fire("scroll_depth_interest",{depth:Number(e.depth||0)}),e.type==="search"&&String(e.query||"").trim().length>=2&&this.fire("search_query",{query:String(e.query||"").trim()}),e.type==="add_to_cart"&&this.syncCartAndFire("cart_item_added",e),e.type==="remove_from_cart"&&this.syncCartAndFire("cart_item_removed",e),e.type==="cart_update"&&this.handleCartState(e),e.type==="checkout_start"&&this.fire("checkout_started",{path:e.path||window.location.pathname}))});a(this,"handleCustomTrigger",t=>{const e=y(t.detail),s=String(e.type||e.trigger||"").trim();s&&this.fire(s,e)});a(this,"handleProfileEvent",t=>{const e=y(t.detail),s=String(e.type||"crm_segment_update");this.fire(s,e)});a(this,"handleSystemEvent",t=>{const e=y(t.detail),s=String(e.type||"external_system_event");this.fire(s,e)});this.options=t}init(){document.addEventListener("aovboost:event",this.handleStorefrontEvent,{signal:this.abortController.signal}),document.addEventListener("aovboost:trigger",this.handleCustomTrigger,{signal:this.abortController.signal}),document.addEventListener("aovboost:profile-event",this.handleProfileEvent,{signal:this.abortController.signal}),document.addEventListener("aovboost:system-event",this.handleSystemEvent,{signal:this.abortController.signal}),this.installProductDwellTracking(),this.installComparisonTracking(),this.installExitIntentTracking(),this.installPriceHoverTracking(),this.installCouponFocusTracking(),this.installWishlistTracking(),this.installInactivityTracking(),this.installFirstTimeVisitorTracking(),this.installPostPurchaseTracking(),this.installScheduledCampaignTracking()}destroy(){this.abortController.abort(),this.timers.forEach(t=>window.clearTimeout(t)),this.timers.clear()}trigger(t,e={}){this.fire(t,e)}installProductDwellTracking(){this.scheduleProductDwell(v())}scheduleProductDwell(t){this.clearTimer("product_dwell"),!(!t||!nt())&&this.setTimer("product_dwell",()=>{this.fire("long_product_dwell",{productId:t,dwellSeconds:$/1e3})},$)}handleRepeatedProductView(t){if(!t)return;const e=y(this.options.sessionManager.getSnapshot().context.productViewCounts),s=Number(e[t]||0);s>=2&&this.fire("repeated_product_view",{productId:t,viewCount:s})}installComparisonTracking(){const t=`${window.location.pathname} ${document.title}`.toLowerCase();/\b(compare|comparison|versus|vs|alternative|competitor)\b/.test(t)&&window.setTimeout(()=>{this.fire("comparison_page_visit",{path:window.location.pathname})},800)}installExitIntentTracking(){document.addEventListener("mouseleave",t=>{t.clientY<=8&&this.fire("exit_intent",{immediate:!0,path:window.location.pathname})},{signal:this.abortController.signal})}installPriceHoverTracking(){document.addEventListener("mouseover",t=>{const e=ct(t.target);!e||e===this.activePriceTarget||(this.activePriceTarget=e,this.clearTimer("price_hover"),this.setTimer("price_hover",()=>{this.fire("price_hesitation",{productId:v(),priceText:e.textContent?.trim().slice(0,80)||""})},1200))},{signal:this.abortController.signal}),document.addEventListener("mouseout",t=>{const e=this.activePriceTarget;if(!e)return;const s=t.relatedTarget;s&&e.contains(s)||(this.activePriceTarget=null,this.clearTimer("price_hover"))},{signal:this.abortController.signal})}installCouponFocusTracking(){document.addEventListener("focusin",t=>{const e=t.target;!e||!dt(e)||this.fire("coupon_field_focus",{fieldName:e.name||e.id||""})},{signal:this.abortController.signal})}installWishlistTracking(){document.addEventListener("click",t=>{t.target?.closest?.("[data-wishlist], [data-save-product], .wishlist, .wishlist-button, [aria-label*='wishlist'], [aria-label*='Wishlist'], [aria-label*='save'], [aria-label*='Save']")&&this.fire("wishlist_save",{productId:v()})},{signal:this.abortController.signal})}installInactivityTracking(){const t=()=>{this.clearTimer("inactivity"),this.setTimer("inactivity",()=>{this.fire("inactivity_timeout",{idleSeconds:E/1e3})},E)};["click","keydown","scroll","touchstart"].forEach(e=>{window.addEventListener(e,t,{passive:!0,signal:this.abortController.signal})}),t()}installFirstTimeVisitorTracking(){try{const t="aovboost_returning_visitor";if(window.localStorage.getItem(t)==="true")return;window.localStorage.setItem(t,"true"),window.setTimeout(()=>{this.fire("first_time_visitor",{path:window.location.pathname})},1800)}catch{}}installPostPurchaseTracking(){at()&&window.setTimeout(()=>{this.fire("post_purchase_window",{path:window.location.pathname})},1200)}installScheduledCampaignTracking(){const t=y(window.AOVBoost?.campaign),e=String(t.type||"");if(!e)return;const s=Date.parse(String(t.startsAt||"")),o=Date.parse(String(t.endsAt||"")),r=Date.now();(!Number.isFinite(s)||s<=r)&&(!Number.isFinite(o)||o>r)&&this.fire(e==="seasonal"?"seasonal_calendar":"flash_sale_window",{campaign:t,endsAt:t.endsAt})}syncCartAndFire(t,e){window.setTimeout(async()=>{const s=await this.readCart(),o={...e,...s};this.fire(t,o),(s.cartProductIds.length>0||s.cartValue>0)&&this.options.eventBus.track("cart_update",o),this.handleCartState(o)},350)}async readCart(){try{const t=await fetch("/cart.js",{headers:{Accept:"application/json"},keepalive:!0});if(!t.ok)throw new Error(`Cart read failed: ${t.status}`);const e=await t.json(),s=Array.isArray(e.items)?e.items:[],o=s.map(r=>D(r.product_id)).filter(Boolean);return{cartToken:e.token||"",cartProductIds:o,cartItemCount:Number(e.item_count||s.length||0),cartValue:Number(e.total_price||0)/100}}catch{return{cartToken:"",cartProductIds:[],cartItemCount:0,cartValue:0}}}handleCartState(t){const e=Number(t.cartValue||0),s=Number(t.cartItemCount||0);e>0&&this.fire("cart_value_threshold",t),this.clearTimer("cart_idle"),s>0&&this.setTimer("cart_idle",()=>{this.fire("cart_abandoned",{...t,idleSeconds:P/1e3})},P)}fire(t,e={}){const s=it(t),o=Date.now(),r=s.throttleMs??10*1e3,d=this.firedAt.get(t)||0;if(o-d<r||s.oncePerSession&&ot(t))return;s.oncePerSession&&rt(t),this.firedAt.set(t,o);const c={...e,triggerType:t,triggerCategory:s.category,widgetHint:s.widgetHint};this.options.eventBus.track(t,c),s.requestOffer!==!1&&window.setTimeout(()=>{this.options.offerPoller.requestOffer(t,c)},s.requestDelayMs??150)}setTimer(t,e,s){this.clearTimer(t),this.timers.set(t,window.setTimeout(e,s))}clearTimer(t){const e=this.timers.get(t);e&&window.clearTimeout(e),this.timers.delete(t)}}function it(i){return et[i]||{category:"external_system",widgetHint:"chat",throttleMs:3e4}}function y(i){return i&&typeof i=="object"&&!Array.isArray(i)?i:{}}function ot(i){try{return sessionStorage.getItem(`aovboost_trigger:${i}`)==="true"}catch{return!1}}function rt(i){try{sessionStorage.setItem(`aovboost_trigger:${i}`,"true")}catch{}}function nt(){return/\/products(?:\/|$)/.test(window.location.pathname)||!!v()}function at(){return/\/thank_you(?:\/|$)/.test(window.location.pathname)||!!window.Shopify?.checkout}function v(){const i=window.Shopify?.product||window.ShopifyAnalytics?.meta?.product||null;return i?D(i.gid||i.id):""}function D(i){const t=String(i||"");return t?t.startsWith("gid://shopify/Product/")?t:`gid://shopify/Product/${t}`:""}function ct(i){const t=i instanceof HTMLElement?i:null;return t?t.closest("[data-price], .price, .product-price, .product__price, [class*='price'], [class*='Price'], [id*='price'], [id*='Price']"):null}function dt(i){const t=[i.name,i.id,i.placeholder,i.getAttribute("aria-label"),i.getAttribute("autocomplete")].filter(Boolean).join(" ").toLowerCase();return/\b(coupon|discount|promo|promotion|voucher|code)\b/.test(t)}class u{constructor(t){a(this,"root");a(this,"container");this.payload=t,this.container=document.createElement("div"),this.container.setAttribute("data-aovboost-widget",this.getWidgetType()),this.root=this.container.attachShadow({mode:"open"}),this.injectStyles()}destroy(){this.container.remove()}mount(t=document.body){t.appendChild(this.container),this.render(),this.trackImpression()}injectStyles(){const t=document.createElement("style");t.textContent=ht,this.root.appendChild(t)}trackImpression(){this.track("widget_impression",{})}trackClick(t){this.track("widget_click",{action:t})}trackDismiss(){this.track("widget_dismiss",{});try{const t="aovboost_dismissed_widgets",e=JSON.parse(localStorage.getItem(t)||"[]");localStorage.setItem(t,JSON.stringify(Array.from(new Set([...e,this.getWidgetType()]))))}catch{}}track(t,e){const s=window.AOVBoostSDK?.track,o={type:t,widgetType:this.getWidgetType(),offerId:this.payload.offerId,...e};if(typeof s=="function"){s(t,o);return}document.dispatchEvent(new CustomEvent("aovboost:track",{detail:o}))}html(t){const e=this.root.querySelector("[data-aovboost-content]");e&&e.remove();const s=document.createElement("div");s.setAttribute("data-aovboost-content","true"),s.innerHTML=t,this.root.appendChild(s)}}function n(i,t=""){return ut(typeof i=="string"&&i.trim()?i:t)}function f(i,t="USD"){const e=Number(i||0);try{return new Intl.NumberFormat(void 0,{style:"currency",currency:t}).format(e)}catch{return`$${e.toFixed(2)}`}}function w(i){const e=[i.products,i.bundle?.items,i.items].find(s=>Array.isArray(s));return Array.isArray(e)?e.map(s=>{const o=s.product||s.target||s;return{id:o.id||s.productId||s.targetId,variantId:o.variantId||s.variantId||s.id,title:o.title||s.title||"Recommended product",handle:o.handle||s.handle||"",imageUrl:o.imageUrl||o.image||s.imageUrl||s.image,price:o.price||s.price||"",quantity:s.quantity||1,reason:s.reason||s.affinity?.reason||s.reasoning||"",orderCount:s.orderCount||s.affinity?.orderCount||0}}):[]}async function _(i,t=1){if(!i)return null;const e=String(i).split("/").pop(),s=await fetch("/cart/add.js",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:e,quantity:t})});return s.ok?s.json():null}async function lt(i){const t=i.filter(s=>s.variantId).map(s=>({id:String(s.variantId).split("/").pop(),quantity:s.quantity||1}));if(t.length===0)return null;const e=await fetch("/cart/add.js",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({items:t})});return e.ok?e.json():null}function ut(i){return String(i||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;")}const ht=`
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
`;class pt extends u{getWidgetType(){return"bundle"}render(){const t=this.payload.bundle||{},e=this.payload.copy||{},s=w(this.payload),o=String(window.AOVBoost?.currency||"USD"),r=s.reduce((l,h)=>l+Number(h.price||0)*Number(h.quantity||1),0),d=Number(t.discountValue||0),c=t.discountType==="percentage"?r*(1-d/100):t.discountType==="fixed"?Math.max(r-d,0):r;this.html(`
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
            <h3 class="title">${n(e.headline||t.name||"Complete the set")}</h3>
            <p class="body">${n(t.description||e.totalSavings||"Bundle these products for a better cart.")}</p>
          </div>
          <div class="tiles">
            ${s.map(l=>`
                  <article class="tile">
                    ${l.imageUrl?`<img src="${n(l.imageUrl)}" alt="${n(l.title)}" loading="lazy">`:""}
                    <p class="product-name">${n(l.title)}</p>
                    <span class="price">${n(l.price?f(l.price,o):"")}</span>
                  </article>
                `).join("")}
          </div>
          <div class="totals">
            ${r>c?`<span class="strike">${f(r,o)}</span>`:""}
            <strong>${f(c,o)}</strong>
          </div>
          <div class="actions">
            <button type="button" class="primary" data-add>${n(e.ctaText||"Add bundle to cart")}</button>
          </div>
        </div>
      </section>
    `),this.root.querySelector("[data-add]")?.addEventListener("click",async()=>{this.trackClick("add_bundle"),await lt(s.map(l=>({variantId:l.variantId,quantity:Number(l.quantity||1)}))),document.dispatchEvent(new CustomEvent("add-to-cart",{detail:{source:"bundle_widget"}}))})}}class gt extends u{constructor(e){super(e);a(this,"messages",[]);a(this,"expanded",!1);a(this,"sending",!1);const s=e.copy;this.messages.push({role:"assistant",content:String(s?.greeting||e.greeting||"Hi. Can I help you find the perfect product today?")})}getWidgetType(){return"chat"}render(){const e=this.payload.copy||{};this.html(`
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
        ${this.expanded?this.renderChatUi():`<p class="body">${n(e.greeting||this.messages[0].content)}</p>
              <div class="actions">
                <button type="button" class="primary" data-expand>${n(e.ctaAccept||"Chat with AI")}</button>
                <button type="button" class="secondary" data-dismiss>${n(e.ctaDecline||"Browse myself")}</button>
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
        ${n(e.content)}
        ${this.renderProductLinks(e.content)}
      </div>
    `}renderProductLinks(e){const s=e.match(/\/products\/([a-z0-9-]+)/i);if(!s)return"";const o=s[1];return`
      <div class="inline-product">
        <p class="product-name">${n(o.replace(/-/g," "))}</p>
        <a href="/products/${n(o)}">View product</a>
      </div>
    `}appendMessage(e){const s=this.root.querySelector("[data-messages]");if(!s)throw new Error("Messages container not found");const o=document.createElement("div");return o.className=`bubble ${e.role}`,o.textContent=e.content,s.appendChild(o),this.scrollToBottom(),o}async sendMessage(){if(this.sending)return;const e=this.root.querySelector("[data-input]"),s=this.root.querySelector("[data-send]"),o=e?.value.trim();if(!o)return;this.sending=!0,s&&(s.disabled=!0),e.value="",this.messages.push({role:"user",content:o}),this.appendMessage({role:"user",content:o}),this.trackClick("send_message"),mt(o)&&(this.track("chat_intent",{intent:"price_sensitive"}),document.dispatchEvent(new CustomEvent("aovboost:trigger",{detail:{type:"price_sensitive_chat",message:o}})));const r=this.messages.push({role:"assistant",content:""})-1,d=this.appendMessage({role:"assistant",content:""});this.showTyping();try{let c=await this.requestChat(o);if(c.status===401&&(await window.AOVBoostSDK?.refreshSession?.(),c=await this.requestChat(o)),!c.ok)throw new Error(`Server returned ${c.status}`);if(!c.body)throw new Error("Missing stream body");const l=c.body.getReader(),h=new TextDecoder;let T="",C=!1;for(;;){const{done:Dt,value:Mt}=await l.read();if(Dt)break;T+=h.decode(Mt,{stream:!0});const V=T.split(`
`);T=V.pop()||"";for(const q of V){if(!q.startsWith("data: "))continue;const O=q.slice(6);if(O!=="[DONE]")try{const B=JSON.parse(O);B.delta&&(C||(this.removeTyping(),C=!0),this.messages[r].content+=B.delta,d.textContent=this.messages[r].content,this.updateProductLink(this.messages[r].content,d),this.scrollToBottom())}catch{}}}C||(this.removeTyping(),this.messages[r].content||(this.messages[r].content="I can help you compare products and find the right add-ons.",d.textContent=this.messages[r].content))}catch{this.removeTyping(),this.messages[r].content=this.messages[r].content||"I had trouble connecting. Please try again in a moment.",d.textContent=this.messages[r].content}finally{this.sending=!1,s&&(s.disabled=!1)}}requestChat(e){const s=window.AOVBoost||{},o=window.AOVBoostSDK,r=ft(s.apiBase).replace(/\/$/,"");return fetch(`${r}/chat`,{method:"POST",headers:{"Content-Type":"application/json","X-AOVBoost-Shop":o?.shop||s.shop||""},body:JSON.stringify({sessionId:o?.sessionId,sessionToken:o?.sessionToken,shop:o?.shop||s.shop,message:e,messageHistory:this.messages.slice(0,-2)})})}showTyping(){const e=this.root.querySelector("[data-messages]");if(!e)return;const s=document.createElement("div");s.className="bubble assistant dots",s.dataset.typing="true",s.innerHTML="<span>.</span><span>.</span><span>.</span>",e.appendChild(s),this.scrollToBottom()}removeTyping(){const e=this.root.querySelector("[data-typing]");e&&e.remove()}updateProductLink(e,s){const o=e.match(/\/products\/([a-z0-9-]+)/i),r=s.querySelector(".inline-product");if(r&&r.remove(),!o)return;const d=o[1],c=document.createElement("div");c.className="inline-product",c.innerHTML=`
      <p class="product-name">${n(d.replace(/-/g," "))}</p>
      <a href="/products/${n(d)}">View product</a>
    `,s.appendChild(c)}scrollToBottom(){const e=this.root.querySelector("[data-messages]");e&&(e.scrollTop=e.scrollHeight)}dismiss(){this.trackDismiss(),this.container.animate([{transform:"translateY(0)"},{transform:"translateY(120%)"}],{duration:180,easing:"ease-in",fill:"forwards"}),window.setTimeout(()=>this.destroy(),190)}}function mt(i){return/\b(expensive|cheaper|cheap|discount|coupon|promo|deal|sale|price|afford|budget|cost)\b/i.test(i)}function ft(i){const t=typeof i=="string"?i.trim():"";return!t||t==="/api"||t.startsWith("/api/")?"/apps/aovboost":t.includes("/apps/aovboost")||t.startsWith("/apps/")?t:"/apps/aovboost"}class yt extends u{constructor(){super(...arguments);a(this,"timer")}getWidgetType(){return"countdown_banner"}render(){const e=this.payload.copy||{},s=e.headline||this.payload.headline||"Limited-time offer",o=e.subheadline||e.offerLine||this.payload.body||"Relevant bundles and add-ons are available for this session.";this.html(`
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
          <h3 class="title">${n(s)}</h3>
          <p class="body">${n(o)}</p>
        </div>
        <strong class="timer" data-countdown></strong>
        <button type="button" class="icon" data-dismiss aria-label="Close">x</button>
      </aside>
    `),this.root.querySelector("[data-dismiss]")?.addEventListener("click",()=>{this.trackDismiss(),this.destroy()}),this.tick(),this.timer=window.setInterval(()=>this.tick(),1e3)}destroy(){this.timer&&window.clearInterval(this.timer),super.destroy()}tick(){const e=this.root.querySelector("[data-countdown]");if(!e)return;const s=Date.parse(String(this.payload.endsAt||""));if(!Number.isFinite(s)){e.textContent="Today";return}const o=Math.max(s-Date.now(),0);if(o<=0){this.destroy();return}const r=Math.floor(o/36e5),d=Math.floor(o%36e5/6e4),c=Math.floor(o%6e4/1e3);e.textContent=r>0?`${r}h ${d}m`:`${d}m ${c.toString().padStart(2,"0")}s`}}class wt extends u{getWidgetType(){return"discount_nudge"}render(){this.draw(),document.addEventListener("add-to-cart",()=>this.draw())}draw(){const t=this.payload.copy||{},e=String(window.AOVBoost?.currency||"USD"),s=Number(this.payload.threshold||50),o=Number(this.payload.cartValue||0),r=Math.max(s-o,0),d=s>0?Math.min(o/s,1):0;this.html(`
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
          <span>${r>0?n(t.progressLabel||`You're ${f(r,e)} away from your reward`):n(t.rewardDescription||"Reward unlocked")}</span>
          <button type="button" class="icon" data-dismiss aria-label="Close">x</button>
        </div>
        <div class="track" aria-hidden="true"><span></span></div>
      </div>
    `),this.root.querySelector("[data-dismiss]")?.addEventListener("click",()=>{this.trackDismiss(),this.destroy()}),r<=0&&window.setTimeout(()=>this.destroy(),3e3)}}class vt extends u{constructor(){super(...arguments);a(this,"shown",!1);a(this,"handleMouseLeave",e=>{e.clientY<10&&this.show()});a(this,"handleVisibility",()=>{document.visibilityState==="hidden"&&this.show()})}getWidgetType(){return"exit_intent"}mount(e=document.body){if(e.appendChild(this.container),!this.shouldSkip()){if(this.payload.immediate){this.show();return}document.addEventListener("mouseleave",this.handleMouseLeave),document.addEventListener("visibilitychange",this.handleVisibility)}}render(){const e=this.payload.copy||{};this.html(`
      <style>
        .backdrop { position: fixed; inset: 0; z-index: 9998; background: rgba(17, 24, 39, .38); }
        .modal { position: fixed; inset: 50% auto auto 50%; z-index: 9999; width: min(420px, calc(100vw - 32px)); transform: translate(-50%, -50%); border-radius: 8px; padding: 18px; }
      </style>
      <div class="backdrop" data-dismiss></div>
      <section class="modal">
        <h3 class="title">${n(e.headline||"Wait before you go")}</h3>
        <p class="body">${n(e.offerLine||this.payload.offerLine||"Your cart has a relevant offer available.")}</p>
        ${this.payload.discountCode?`<p class="body"><strong>${n(this.payload.discountCode)}</strong></p>`:""}
        <div class="actions">
          <button type="button" class="primary" data-claim>${n(e.ctaText||"Claim offer")}</button>
          <button type="button" class="secondary" data-dismiss>${n(e.dismissText||"No thanks")}</button>
        </div>
      </section>
    `),this.root.querySelector("[data-claim]")?.addEventListener("click",()=>{this.trackClick("claim_exit_offer"),this.destroy()}),this.root.querySelectorAll("[data-dismiss]").forEach(s=>{s.addEventListener("click",()=>{this.trackDismiss(),this.destroy()})})}destroy(){document.removeEventListener("mouseleave",this.handleMouseLeave),document.removeEventListener("visibilitychange",this.handleVisibility),super.destroy()}show(){if(!(this.shown||this.hasFired())){this.shown=!0;try{sessionStorage.setItem("aovboost_exit_intent_fired","true")}catch{}this.render(),this.trackImpression()}}hasFired(){try{return sessionStorage.getItem("aovboost_exit_intent_fired")==="true"}catch{return!1}}shouldSkip(){return/\/(?:checkout|thank_you)(?:\/|$)/.test(window.location.pathname)}}class bt extends u{getWidgetType(){return"inline_alert"}render(){const t=this.payload.copy||{},e=t.headline||this.payload.headline||"Store update",s=t.subheadline||t.offerLine||this.payload.body||"A relevant product update is available.";this.html(`
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
            <h3 class="title">${n(e)}</h3>
            <p class="body">${n(s)}</p>
          </div>
          <button type="button" class="icon" data-dismiss aria-label="Close">x</button>
        </div>
      </aside>
    `),this.root.querySelector("[data-dismiss]")?.addEventListener("click",()=>{this.trackDismiss(),this.destroy()})}}class St extends u{getWidgetType(){return"post_purchase"}mount(t=document.body){this.isThankYouPage()&&super.mount(t)}render(){const t=this.payload.copy||{},e=w(this.payload)[0]||this.payload.product||{},s=String(window.AOVBoost?.currency||"USD");this.html(`
      <style>
        .post { margin: 18px 0; box-shadow: none; }
      </style>
      <section class="post card">
        <h3 class="title">${n(t.headline||"Complete your purchase")}</h3>
        <article class="product-card">
          ${e.imageUrl?`<img src="${n(e.imageUrl)}" alt="${n(e.title)}" loading="lazy">`:"<span></span>"}
          <div class="stack">
            <div>
              <p class="product-name">${n(t.productName||e.title||"Recommended product")}</p>
              <span class="price">${n(e.price?f(e.price,s):"")}</span>
            </div>
            <p class="reason">${n(t.oneLineReason||"A useful add-on for what you just bought.")}</p>
            <button type="button" class="primary" data-add>${n(t.ctaText||"Add to my order")}</button>
          </div>
        </article>
      </section>
    `),this.root.querySelector("[data-add]")?.addEventListener("click",async()=>{this.trackClick("add_post_purchase");const o=e.variantId;if(o){await _(o);return}const r=e.handle;r&&(window.location.href=`/products/${r}`)})}isThankYouPage(){return/\/thank_you(?:\/|$)/.test(window.location.pathname)||!!window.Shopify?.checkout}}class xt extends u{getWidgetType(){return"rec_strip"}render(){const t=w(this.payload),e=String(window.AOVBoost?.currency||"USD");this.html(`
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
                  ${s.reason?`<span class="badge">${n(s.reason)}</span>`:""}
                  ${s.imageUrl?`<img data-src="${n(s.imageUrl)}" alt="${n(s.title)}">`:""}
                  <p class="product-name">${n(s.title)}</p>
                  <span class="price">${n(s.price?f(s.price,e):"")}</span>
                  <button type="button" class="primary" data-add="${n(s.variantId)}">Add to cart</button>
                </article>
              `).join("")}
        </div>
      </section>
    `),this.lazyLoadImages(),this.root.querySelectorAll("[data-add]").forEach(s=>{s.addEventListener("click",async()=>{this.trackClick("add_recommendation"),await _(s.dataset.add)})})}lazyLoadImages(){const t=Array.from(this.root.querySelectorAll("img[data-src]"));if(!("IntersectionObserver"in window)){t.forEach(s=>{s.src=s.dataset.src||""});return}const e=new IntersectionObserver(s=>{s.forEach(o=>{if(!o.isIntersecting)return;const r=o.target;r.src=r.dataset.src||"",e.unobserve(r)})});t.forEach(s=>e.observe(s))}}class _t extends u{constructor(){super(...arguments);a(this,"interval")}getWidgetType(){return"social_proof"}render(){const s=w(this.payload).filter(r=>Number(r.orderCount||0)>0).map(r=>`${Number(r.orderCount)} people bought this with ${r.title}`);s.length===0&&s.push("Frequently bought together"),this.html(`
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
      <div class="pill" role="status"><span class="dot"></span><span data-message>${n(s[0])}</span></div>
    `);let o=0;this.interval=window.setInterval(()=>{o=(o+1)%s.length;const r=this.root.querySelector("[data-message]");r&&(r.textContent=s[o])},5e3)}destroy(){this.interval&&window.clearInterval(this.interval),super.destroy()}}class kt extends u{getWidgetType(){return"toast"}render(){const t=this.payload.copy||{},e=t.headline||this.payload.headline||"A better option is available",s=t.subheadline||t.offerLine||this.payload.body||"I can help find a better match or a useful offer.",o=t.ctaText||this.payload.ctaText||"Open assistant";this.html(`
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
            <h3 class="title">${n(e)}</h3>
            <p class="body">${n(s)}</p>
          </div>
          <button type="button" class="icon" data-dismiss aria-label="Close">x</button>
        </div>
        <div class="actions">
          <button type="button" class="primary" data-chat>${n(o)}</button>
        </div>
      </aside>
    `),this.root.querySelector("[data-dismiss]")?.addEventListener("click",()=>{this.trackDismiss(),this.destroy()}),this.root.querySelector("[data-chat]")?.addEventListener("click",()=>{this.trackClick("open_assistant"),document.dispatchEvent(new CustomEvent("aovboost:trigger",{detail:{type:"long_product_dwell",source:"toast"}})),this.destroy()}),window.setTimeout(()=>this.destroy(),9e3)}}class Tt extends u{constructor(){super(...arguments);a(this,"timer");a(this,"deadline",Date.now()+8e3)}getWidgetType(){return"upsell_drawer"}render(){const e=w(this.payload).slice(0,3),s=this.payload.copy||{},o=String(window.AOVBoost?.currency||"USD");this.html(`
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
            <h3 class="title">${n(s.headline||"Great choice. Complete the set")}</h3>
            <p class="body">People who bought this also love:</p>
          </div>
          <button type="button" class="icon" data-dismiss aria-label="Close">x</button>
        </div>
        <div class="timer"><span data-timer></span></div>
        <div class="product-grid">
          ${e.map(r=>`
                <article class="product-card">
                  ${r.imageUrl?`<img src="${n(r.imageUrl)}" alt="${n(r.title)}" loading="lazy">`:"<span></span>"}
                  <div class="stack">
                    <div>
                      <p class="product-name">${n(r.title)}</p>
                      <span class="price">${n(r.price?f(r.price,o):"")}</span>
                    </div>
                    <p class="reason">${n(r.reason||s.whyThisGoes||"It pairs well with your cart.")}</p>
                    <button type="button" class="primary" data-add="${n(r.variantId)}">Add to cart</button>
                  </div>
                </article>
              `).join("")}
        </div>
        <div class="actions">
          <a class="secondary" href="/cart">Continue to cart</a>
        </div>
      </aside>
    `),this.root.querySelectorAll("[data-dismiss]").forEach(r=>{r.addEventListener("click",()=>this.dismiss())}),this.root.querySelectorAll("[data-add]").forEach(r=>{r.addEventListener("click",async()=>{this.trackClick("add_upsell"),await _(r.dataset.add)})}),this.startCountdown()}destroy(){this.timer&&window.clearInterval(this.timer),super.destroy()}startCountdown(){this.timer&&window.clearInterval(this.timer),this.deadline=Date.now()+8e3,this.timer=window.setInterval(()=>{const e=Math.max(this.deadline-Date.now(),0),s=this.root.querySelector("[data-timer]");s&&(s.style.transform=`scaleX(${e/8e3})`),e<=0&&this.dismiss()},120)}dismiss(){this.trackDismiss(),this.container.animate([{transform:"translateX(0)"},{transform:"translateX(100%)"}],{duration:180,easing:"ease-in",fill:"forwards"}),window.setTimeout(()=>this.destroy(),190)}}const Ct="aovboost_dismissed_widgets";class It{constructor(){a(this,"activeWidget",null);a(this,"activeKey","");a(this,"activeWidgetType","")}mountDecision(t){if(!t.widgetType||this.getDismissedWidgets().includes(t.widgetType))return;const e=t.payload||{},s=String(e.offerId||""),o=`${t.widgetType}:${s}`;if(t.widgetType==="chat"&&this.activeWidgetType==="chat"||o===this.activeKey)return;this.destroyActive();const r=At(t.widgetType,e);if(!r)return;const d=this.resolveTarget(t.widgetType);r.mount(d),this.activeWidget=r,this.activeKey=o,this.activeWidgetType=t.widgetType}destroyActive(){this.activeWidget?.destroy(),this.activeWidget=null,this.activeKey="",this.activeWidgetType=""}getDismissedWidgets(){try{const t=JSON.parse(localStorage.getItem(Ct)||"[]");return Array.isArray(t)?t.map(String):[]}catch{return[]}}resolveTarget(t){return t==="bundle"?b(".product-form, [data-product-form]"):t==="rec_strip"?b(".product__description, [data-product-description]"):t==="social_proof"?b(".product-form__submit, [data-add-to-cart]"):t==="inline_alert"?b("[data-price], .product__price, .price, .product-form, [data-product-form]"):document.body}}function At(i,t){switch(i){case"chat":return new gt(t);case"toast":return new kt(t);case"countdown_banner":return new yt(t);case"inline_alert":return new bt(t);case"bundle":return new pt(t);case"upsell_drawer":return new Tt(t);case"discount_nudge":return new wt(t);case"rec_strip":return new xt(t);case"social_proof":return new _t(t);case"exit_intent":return new vt(t);case"post_purchase":return new St(t);default:return null}}function b(i){const t=document.querySelector(i),e=document.createElement("div");return e.setAttribute("data-aovboost-mount",i),t?.parentElement?(t.insertAdjacentElement("afterend",e),e):(document.body.appendChild(e),e)}let M=!1;function k(){M||(M=!0,Pt().catch(i=>{console.log("AOVBoost SDK skipped:",i instanceof Error?i.message:String(i))}))}async function Pt(){try{const i=window.AOVBoost||{},t=i.shop;if(!t)return;L(i)||await $t(i);const e=Et(i.apiBase),s=new tt(t,e),o=new g({shop:t,sessionManager:s,apiBase:e}),r=new It,d=new G({shop:t,apiBase:e,eventBus:o,sessionManager:s,widgetManager:r}),c=new st({eventBus:o,offerPoller:d,sessionManager:s});await s.init(),o.init(),d.init(),c.init(),window.AOVBoostSDK={shop:t,sessionId:s.anonymousId,sessionToken:s.getAuthPayload().sessionToken,refreshSession:async()=>{await s.refreshAuth(),window.AOVBoostSDK&&(window.AOVBoostSDK.sessionId=s.anonymousId,window.AOVBoostSDK.sessionToken=s.getAuthPayload().sessionToken)},track:(l,h={})=>o.track(l,h),trigger:(l,h={})=>c.trigger(l,h),requestOffer:(l="global",h={})=>d.requestOffer(l,h),destroy:()=>{c.destroy(),d.destroy(),s.destroy(),r.destroyActive()}}}catch(i){console.log("AOVBoost SDK skipped:",i instanceof Error?i.message:String(i))}}function Et(i){const t=typeof i=="string"?i.trim():"";return!t||t==="/api"||t.startsWith("/api/")?"/apps/aovboost":t.includes("/apps/aovboost")||t.startsWith("/apps/")?t:"/apps/aovboost"}function L(i){if(i.settings?.trackingConsentRequired!==!0)return!0;const t=window.Shopify?.customerPrivacy;return typeof t?.analyticsProcessingAllowed=="function"?!!t.analyticsProcessingAllowed():typeof t?.userCanBeTracked=="function"?!!t.userCanBeTracked():!0}function $t(i){return new Promise(t=>{const e=()=>{L({...i,settings:{...i.settings,trackingConsentRequired:!1}})&&(s(),t())},s=()=>{["visitorConsentCollected","shopify:customer_privacy:consent_collected","aovboost:consent-granted"].forEach(o=>window.removeEventListener(o,e))};["visitorConsentCollected","shopify:customer_privacy:consent_collected","aovboost:consent-granted"].forEach(o=>window.addEventListener(o,e))})}return document.readyState==="loading"?document.addEventListener("DOMContentLoaded",k,{once:!0}):k(),p.init=k,Object.defineProperty(p,Symbol.toStringTag,{value:"Module"}),p}({});
