# Phase 0: storefront audit

Read-only code audit, 13 November 2026. Written before implementation. The supplied list contains **11 types including chat**, and those are the 11 types in the registry. Only the cart upsell has supplied live verification; chat/bundle have automated verification; other widgets remain unverified live. The latest cart-refresh release is unconfirmed. No live store was contacted for this audit.

## Delivery and stack

`extensions/aovboost-storefront/blocks/aovboost.liquid` is a body app embed. It supplies `window.AOVBoost`, consent/currency/locale configuration and a deferred `aovboost-sdk.js`. `blocks/widget-slot.liquid` supplies merchant-selected `data-aovboost-slot` placements. No ScriptTag delivery was found in the active entry path. The SDK is framework-free TypeScript, CSS and Shadow DOM. The admin uses React/React Router, but that is not the storefront stack.

`storefront-sdk/src/index.ts` creates SessionManager, WidgetManager, EventBus, OfferPoller, TriggerRouter, LiveUpdates and MeasurementCartLink after consent/session initialization. Vite produces an ES2020 IIFE, inlines dynamic imports and imports `styles/widgets.css`. The theme compatibility engine is a separate hashed ES module, loaded by `theme/loader.ts`. `npm run build:sdk` builds both and checks sizes. No runtime dependency is needed for the proposed core.

Baseline checked-in assets, measured with Node `zlib.gzipSync`:

| File | Bytes | Gzip bytes |
| --- | ---: | ---: |
| aovboost-sdk.js | 161181 | 43840 |
| aovboost-theme-engine-Zi8_f6Pt.js | 55417 | 16510 |
| ai-agent.css | 27 | 47 |
| JS total | 216598 | 60350 |

## Common widget path and data

All widget files below are under `storefront-sdk/src/widgets/`. The entry/registry is `widgetManager.ts`; the common base is `BaseWidget.ts`. Widgets normally receive products/copy through the **same** OfferPoller POST `/apps/aovboost/offer`. Its body contains signed shop/session authentication, current product/page, cart products/variants/items/value/count, currency/locale, dismissals, trigger/category/payload. It has an 8s request timeout, auth recovery, page/mutation revision guards, a pending-request queue and a local fallback. It reads locale-aware `cart.js` first (1.5s). Product context/prices can additionally read `/products/{handle}.js` (1.5s storefront read). Widgets themselves do not independently call a recommendation API.

BaseWidget gives each widget an open ShadowRoot, inherited theme CSS variables, product normalization, variant pickers, currency formatting, cart helpers and tracking. Dismissal writes `{widgetType,dismissedAt}` to `aovboost_dismissed_widgets` in localStorage; the manager uses the shared time-bounded dismissal guard. Chat also sets a session dismissal key. Storage accesses generally catch failures. Legacy signed SessionManager storage contains a session token; the new store must **not** copy it or cart tokens.

`widget_impression` is recorded when any part is visible (not the requested future 50%/1s definition); adaptive cart impressions require verified display. `widget_click` includes an action; `widget_dismiss` records dismissal; `recommendation_added` is emitted after a confirmed widget cart helper succeeds. These names and existing attribution properties must remain intact.

## Widget inventory

| Type / entry | Mount and trigger today | State, dismissal and tracking / additional requests |
| --- | --- | --- |
| Chat / ChatWidget.ts | Body assistant dock on shopping pages. Server decisions and local fallback can show a proactive welcome bubble; it is not a quiet launcher. Dwell, returning/repeated visits, comparison, inactivity and profile triggers can request it. `aovboost:open-chat` expands an existing widget only. | Messages, expanded/sending flags, text-only session conversation restore. Close/decline tracks `chat_closed`, rejection and dismiss, then destroys it. Open emits `chat_opened`; sends emit clicks/intents; shown/clicked recommendation and upsell events, variants and checkout clicks are tracked. POST `/apps/aovboost/chat` includes auth, message/history, storefront/cart context and currency; SSE renders deltas/cards and grounded cart actions. Cart read 1.5s; **chat stream has no deadline**. Product cards may fetch `/products/{handle}.js`. A failed stream shows retry-in-a-moment text; no health gate exists. |
| Toast / ToastNudge.ts | Body desktop attention slot, width >=900, no blocking theme surface. Price hover (1.2s), coupon/wishlist/other trigger decisions can request it. | Timer destroys after 9s; no hover/focus pause. Keyboard button dismisses; CTA emits `aovboost:open-chat` with `{source:'toast'}` then destroys. It neither creates chat nor transfers product context. Common impression/click/dismiss. |
| Countdown / CountdownBanner.ts | Explicit campaign slot with real future `endsAt` enforced by placement. Scheduled campaign trigger from window config or server decision. | One-second timer, destroy at zero; dismiss button; CTA opens existing chat with source only. Direct class rendering without placement would say “Today” on missing expiry. Common tracking. |
| Inline alert / InlineAlert.ts | Product notice slot or after an unambiguous purchase area; inventory/price-drop system events through `/live` and trigger routing. | Payload copy, dismiss button, common tracking. Generic text fallback exists; no per-payload dismissal key. |
| Bundle / BundleWidget.ts | PDP explicit slot or safe purchase boundary; products must include current product and at least two items. Decision from shared offer request. | Selected variants, computed totals; all products must have a purchasable variant to add. One multi-item cart request, success `recommendation_added`, compatibility `add-to-cart` hint. `_aovboost_bundle_id` and `_aovboost_bundle_version` gate displayed calculated discount; actual checkout application is not established by rendering. No dismiss control. |
| Cart upsell / UpsellDrawer.ts + theme/engine.ts | Confirmed shopper add, then refreshed cart, `/offer`, price hydration, adaptive theme placement. Native cart drawer, cart page or verified floating-card fallback; never another competing cart modal. | Mutation/offer identity, variant choices, display verification and bounded reattachment. Dismiss/ESC with focus bridge into native drawer; accepted helper tracks `recommendation_added`. Existing engine asynchronously prepares/mounts and retries placement; preserve its cancellation and revision guards. |
| Discount nudge / DiscountNudge.ts | Cart summary or explicit slot; cart-value/abandoned-cart decisions, configured positive threshold in fallback. | Cart value/progress; listens to legacy `add-to-cart`, GET **literal** `/cart.js` without deadline and redraws; reached state expires after 3s. Dismiss and CTA to existing chat, common events. Does not create/apply a reward. No real-reward guard. |
| Recommendation strip / RecStrip.ts | Explicit slot, safe collection-grid boundary or below PDP section/description. Auto placement avoids visible theme product recommendations (explicit slot bypasses that guard). Search/removal/offer decisions. | Variant selections, lazy image observer, per-card add status; no dismiss. Add confirmed via common helper -> `recommendation_added` and legacy `add-to-cart` hint. |
| Social proof / SocialProof.ts | PDP notice placement, matching current product; startup request after 950ms (600ms on navigation). | Supplied `orderCount > 0`, rotating every 5s, destroys without counts. No dismiss. Labels verified orders but no time window/minimum-count setting. Common impression. |
| Exit intent / ExitIntent.ts | Desktop attention slot only; mouseleave near top triggers router once/session. Class can also wait for mouseleave or document hidden unless immediate. | Class session key `aovboost_exit_intent_fired`, router once key, shown flag. Backdrop/no-thanks dismiss; claim navigates `/cart` only when payload says cart has items, otherwise opens existing chat. Optional supplied code. Common tracking, explicit impression on show. No engagement guard; no mobile exit signal. |
| Storefront post-purchase / PostPurchase.ts | Thank-you/Shopify checkout context with explicit post-purchase slot; router waits 1.2s. | First product, CTA uses common Ajax **cart add**, or navigates to product. It does not amend a completed order. Default “Add to my order” copy is misleading. No dismiss; click tracked, no dedicated confirmed-accept event. Preserve behavior in this run; prevent misleading copy in flagged adapter. |

## Cart handling and correction

`eventBus.ts` wraps fetch and XHR. A successful POST `/cart/add(.js)` must yield a real variant before `add_to_cart` with `confirmed:true` and unique `mutationId`. Fetch Requests are cloned for body inspection. Change responses generate confirmed removal/quantity events. A theme `add-to-cart` event is only an unconfirmed `cart_hint`, never evidence to offer.

`triggerRouter.ts::syncCartAndFire` coalesces for 250ms, reads authoritative cart, rejects stale read versions/duplicate mutation IDs, emits `cart_update`, then fires `cart_item_added` only for non-recommendation adds. Initial read/restored cart does not offer. `nativeCartContinuation.ts` verifies native form redirects against a baseline. OfferPoller refreshes cart again, invalidates stale requests/recommendations on mutations, verifies mutation IDs, and checks returned tabs for changed carts. No recurring cart.js polling; focus/visibility, initial read and confirmed writes cause reads. Theme events inform the compatibility engine; MutationObservers keep placement attached after section replacement.

The **cart-refresh correction** is `shopifyCart.ts` plus `cartSections.ts`: bundled actual theme section IDs, locale-aware Ajax URL, Dawn native `renderContents` when available, bounded replacement preserving editable controls/notes, read-only retry of missing sections, focus restoration and `aovboost:cart-updated`. It never retries an accepted POST because rendering failed. Browser tests cover Velour-shaped dynamic section refresh, totals/badge/quantity controls and one-write acceptance. `theme/engine.ts` handles display verification and reattachment.

All current helper mutations send `X-AOVBoost-Recommendation:1`; parsing also recognizes attribution properties, producing `recommendationOrigin:true`. Cart helpers add `_aovboost_session_id`, `_aovboost_offer_id` and bundle keys. There is **no per-provider source tag**: existing source describes transport (`verified_fetch_response`, `verified_xhr_response`, `verified_native_form_redirect`). Add a separate compatibility field/header for provider source; do not replace legacy source meanings.

## Shared code, AI and failure modes

Shared today: EventBus transport/consent/dedupe, SessionManager auth/config/context, OfferPoller request/queue/fallback, BaseWidget formatting/variants/cart/tracking, placement and adaptive theme engine. Duplication: several live cart readers (router/poller/chat/nudge), product hydration reads, independent session counters/dismissals, per-widget CTA-to-chat code, local/server copy, independent timers, partial overlay rules. New RecommendationService is Phase 3, not a reason to rewrite these now.

Every decision can involve AI via `/offer`; chat additionally directly calls `/chat`. Cart products are supplied from server catalog recommendations; on cart offer failure the current client **hides** rather than inventing products. Local fallback can make chat, exit, threshold, campaign and alert decisions. Bundle/strip/proof require supplied data. Live updates POST `/apps/aovboost/live` with auth, bounded timeout and adaptive polling; widgets do not poll AI themselves.

`api.chat.tsx` GET loader returns `{ok:true}` without testing AI/billing/Redis. It can be used only as a cheap **transport reachability probe**, not evidence that an AI generation succeeded. Actual chat responses must feed the breaker. No dedicated AI health endpoint exists; adding one would violate scope. A probe must never synthesize a shopper message or incur AI generation. Auth recovery and endpoint failures must remain isolated from the theme.

## Collisions, mobile and layout

Existing manager permits one campaign, assistant and overlay, one merchandising block (bundle/strip), and one notice (alert/proof/goal), but upsell is separate. Thus **upsell + existing exit/toast**, **upsell + proactive chat**, and multiple ambient blocks + banner can coexist. Toast/exit are blocked by even a collapsed chat bubble, so attention is sometimes over-suppressed. Async adaptive mounts can race later decisions unless their reservation and cancellation are arbiter-owned. Chat opening is not a manager suppression signal today. Checkout triggers can request upsells, though placement guards normally reject them. Exit's delayed internal listeners can outlive the decision that created it.

Toast/exit placement is explicitly desktop-only (<900px rejected). Countdown, bundle, strip, chat and adaptive cart surfaces have responsive layouts; notices/progress wrap inline. No mobile exit observer exists. Shadow DOM provides style isolation, and CSS variables inherit theme styling. Dynamic inline insertion has no reserved-height contract, so CLS cannot be assumed zero. The theme engine adds reduced-motion overrides; the common base does not apply them to every widget. Floating drawer/chat focus behavior needs broader keyboard tests; native cart focus bridging already has tests.

## Attribution and checkout mismatch

Legacy telemetry retains widget/offer/session IDs. `widget_click` is intent, `recommendation_added` is confirmed frontend acceptance, and line properties carry offer/session to order attribution. Analytics distinguish accepted recommendations and converted orders; clicking alone is not proof of revenue. The backend events endpoint accepts generic event types, so additive standardized frontend events can use the existing batching/consent path without backend changes.

Read-only `extensions/post-purchase-upsell/src/index.jsx` registers `Checkout::PostPurchase::ShouldRender` and `Render`, requests `/api/post-purchase-offer`, calculates changes, requests `/api/post-purchase-sign`, calls Shopify `applyChangeset`, then `/api/post-purchase-convert` and `done`. This is the actual completed-purchase mechanism. Storefront PostPurchase uses Ajax cart/add.js and cannot claim the same outcome. No checkout extension changes are authorized.

## Tests and implementation implications

Vitest: `npm test` (root `vitest.config.ts`), or `npx vitest run --config vitest.config.ts storefront-sdk`. Tests cover manager placement/gating, chat/cart actions, bundles/discount math, cart interception/router/continuation, offers/races, telemetry/consent and adaptive engine. Browser: `npm run test:browser` builds SDK, starts `scripts/browser-fixture-server.mjs`, runs `tests/browser/cart-flow.spec.ts` in desktop and Pixel 7. Local in-memory fixtures use no real store, DB or credentials. `npm run typecheck`, lint and SDK build are additional checks. Prior evidence is not a result of this run.

Plan adjustments: adapt **WidgetManager's existing decision entry point**, rather than replace widget renders; preserve the adaptive engine as an async provider and reserve its foreground slot while mounting. Reuse verified router cart snapshots, not another fetch interceptor. Keep legacy source fields, public names and attribution keys; add provider-source metadata. Keep pre-existing focused-mode/server holdout gates. Phase 4 owns launcher/identity/handoff/mobile exit; Phase 5 owns full reward/proof/copy contracts; Phase 6 owns new deterministic holdout assignment. Core should accept existing holdout now. Frontend health cannot certify upstream AI dependencies.

## Ranked risks

1. **Cart-event loops / refresh regression**: highest practical risk because this is the only live-verified flow; multiple asynchronous paths, native continuations and section replacement must remain correct.
2. **Stacking/interruption collisions**: partial existing rules miss contextual upsell, chat-open state and async mounts. Central reservation is necessary.
3. **Dead CTAs during AI outages**: open-chat only targets an existing listener; transport health does not certify generation. Suppress dependent surfaces conservatively.
4. **Theme conflicts / layout shift**: arbitrary inline placements and native reattachment/focus are sensitive; keep tested adapters.
5. **Desktop-only interruption triggers**: explicit mobile gap; mobile exit is Phase 4.
6. **Duplicate recommendation/context requests**: existing queue helps, but cart/product reads repeat; consolidate recommendation fetching in Phase 3.

Official references consulted: [Ajax cart and bundled sections](https://shopify.dev/docs/api/ajax/reference/cart), [app blocks](https://shopify.dev/docs/storefronts/themes/architecture/blocks/app-blocks), [dynamic section rendering](https://shopify.dev/docs/storefronts/themes/best-practices/performance/use-section-rendering-api). These confirm the existing delivery/cart approach; they do not establish live behavior.
