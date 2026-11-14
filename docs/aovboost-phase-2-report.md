# aovboost Phase 2 report

13 November 2026. Scope: **Phases 0–2 only**. The flag remains **off by default**. No deployment or live verification was performed. The supplied live-verification status remains the ground truth.

## 1. Changes by file

| File | Result |
| --- | --- |
| `docs/aovboost-phase-0-audit.md` | Audit written before implementation: delivery, all eleven types including chat, endpoints, triggers, tracking, cart correction, collisions, mobile gaps, checkout mismatch and ranked risks. |
| `storefront-sdk/src/agent/AgentCore.ts` | Owns the new modules, immutable context, existing-event bridge, product dwell observer and provider registration. Publishes cart confirmation only from refreshed, confirmed add snapshots. Keeps active-chat state consistent when a widget is removed programmatically. |
| `agent/SessionStore.ts` | Versioned, shop-scoped anonymous session state. Whitelists counters, product IDs, dismissals and failed provider IDs; handles corrupt/empty/blocked storage; exposes detached snapshots. Does not persist tokens, cart contents, messages, URLs or shopper inputs. |
| `agent/SignalBus.ts` | Typed subscriptions, unsubscribe/teardown and subscriber exception isolation. |
| `agent/Arbiter.ts` | One contextual/interruptive foreground reservation, including pending asynchronous mounts; fixed score/priority ordering; exclusive slots; session caps/gap/backoff; checkout/chat/holdout suppression; navigation cancellation; session-long failure isolation. |
| `agent/providers.ts` | Thin adapters for all eleven existing widget types. Keeps existing renderers and placements. Uses supplied decisions, merchant gates and current cart/health context. Forces exit rendering to happen when admitted, rather than installing a second independent exit listener. Chat-dependent CTAs also require an actual mounted chat widget. |
| `agent/AgentHealth.ts` | 1.5s reachability probe, coalescing, rolling 3-failure/60s circuit, 120s open period and retry/half-open recovery. Actual flagged chat outcomes feed it too. |
| `agent/Telemetry.ts` | Additive standard event fields through the existing consent/batched EventBus. Mount impressions, continuous >=50%/1s viewed events, interaction, refreshed-add acceptance, dismissal, suppression and existing-holdout would-have-shown plumbing. |
| `agent/Debug.ts` | Silent by default. Query/session debug flag, safe signal summaries and a copied 50-decision ring buffer. No payloads, auth, messages or raw exception strings are logged by the new core. |
| `agent/constants.ts` | Named default limits, including the requested caps/backoffs/breaker values, desktop boundary and flagged chat response deadline. |
| `agent/types.ts` | Provider, surface, signal, immutable-context and manager bridge contracts. |
| `agent/flag.ts` | Strict boolean flag and cart-source vocabulary/legacy-origin normalization. |
| `agent/loader.ts` | Loads the hashed core ES module relative to the SDK asset only when enabled. |
| `storefront-sdk/src/index.ts` | Boots the core after existing session/settings setup and before observers start. Leaves the legacy path selected when disabled. If the flagged core asset cannot load, suppresses widget mounting while the theme cart continues working. |
| `storefront-sdk/src/sessionManager.ts` | Adds the optional frontend flag type; does not change auth, billing, Redis or backend config schemas. |
| `storefront-sdk/src/widgets/widgetManager.ts` | Routes flagged decisions through adapters; provides bounded per-provider mount/unmount hooks; bridges async theme-engine completion/cancellation; exposes the core's dismissal list to existing offer requests. Retains the legacy path when disabled. |
| `storefront-sdk/src/offerPoller.ts` | Passes the existing trigger into the coordinator; keeps request/auth/cart-price/revision/fallback logic. |
| `storefront-sdk/src/eventBus.ts` | Adds flagged cart-source metadata and consumes helper completion events. Avoids double-reporting helper adds **and quantity changes** from the fetch interceptor. Existing event names and transport source meanings remain intact. |
| `storefront-sdk/src/triggerRouter.ts` | Carries the original mutation type with refreshed snapshots and adds a source guard against recursive upsells. Reuses the existing authoritative read/version/deduplication path. |
| `storefront-sdk/src/shopifyCart.ts` | Adds flagged `X-AOVBoost-Source` and a completion event after the existing section refresh/read-only retry finishes. Keeps one accepted POST, locale-aware URLs, section selection, notes/controls and focus preservation. |
| `storefront-sdk/src/widgets/BaseWidget.ts` | Optional lifecycle hooks release self-expiring/dismissed adapters. Cart helpers accept source tags. Flagged surfaces receive reduced-motion CSS; existing styles and markup remain in use. |
| `storefront-sdk/src/widgets/UpsellDrawer.ts` | Tags accepted adds `aov_upsell`. |
| `storefront-sdk/src/widgets/RecStrip.ts` | Tags accepted adds `aov_strip`. |
| `storefront-sdk/src/widgets/ChatWidget.ts` | Tags adds/changes `aov_chat`; optional health feedback and a flagged 30s request/stream deadline. Intentional destruction cancels the request without counting it as an AI outage. Legacy chat appearance and conversation behavior are retained. |
| `storefront-sdk/agent.vite.config.ts` | Builds the hashed, optional core asset and removes obsolete generated core hashes within the assets directory. |
| `storefront-sdk/vite.config.ts`, `package.json`, `.gitignore` | Wire the generated core filename/build order and ignore the generated filename manifest. No dependency added. |
| `scripts/check-sdk-size.mjs`, `storefront-sdk/src/theme/size.test.ts` | Include the third JS asset in the size check; retain the initial-main ceiling and explicitly account for the optional core in combined ceilings. |
| `agent/core.test.ts`, `agent/Arbiter.test.ts`, `agent/AgentCore.test.ts`, `agent/Telemetry.test.ts` | Cover storage/privacy/corruption, bus isolation, breaker timeout/recovery, deterministic arbitration, async reservations, backoff/caps, chat/checkout/holdout, provider failures, refreshed source attribution, duplicate-change prevention and visibility duration. |
| `widgets/ChatWidget.test.ts` | Adds a stalled flagged-request regression with health feedback and a recovered Send control. |
| `scripts/browser-fixture-server.mjs`, `tests/browser/agent-core.spec.ts` | Local-only flagged fixtures and desktop/mobile tests for acceptance without recursion, Velour refresh, debug/checkout, blocked storage, disabled-path networking, reduced motion/keyboard focus and unavailable chat. |
| `extensions/aovboost-storefront/assets/` | Rebuilt SDK and theme-engine asset; adds the hashed core asset. The superseded theme-engine hash is removed by the existing build process. |

The storefront post-purchase **cart action is unchanged**. In the flagged adapter only, its supplied/default CTA and surrounding copy are replaced with cart wording so it does not claim to amend a completed order. The checkout extension was read for the audit and was not modified. No Liquid, merchant-facing labels, metafield schema, cart attribute/property key, backend endpoint, AI prompt, billing or Redis implementation was changed. The pre-existing untracked `docs/widget-behavior-and-verification.md` was left untouched.

## 2. Audit findings that shaped implementation

The repository already centralizes recommendation decisions in OfferPoller and placement in WidgetManager. The new runtime wraps that boundary rather than creating a parallel renderer/request pipeline. The adaptive cart engine is asynchronous; its foreground slot stays reserved until completion or cancellation. Existing native/cart-page/floating placement, verification, section refresh, read-only retry and reattachment remain in use.

Legacy `source` identifies fetch/XHR/native redirects, so replacing it with a provider ID would break compatibility. Provider source is carried separately as `cartSource` and normalized to `source` on the new internal cart signals/context. Legacy dismissal storage uses a 30-minute window; flagged frontend offer requests now use the core's 10-minute/second-dismissal session policy. Existing server policy can still be stricter; it was not changed.

There is no genuine upstream AI health endpoint. Existing GET `/apps/aovboost/chat` returns `{ok:true}` without generating text or testing billing/Redis. It is used as a bounded **transport reachability probe**, and real chat failures feed the circuit. A successful GET must not be interpreted as verified model/billing health. Dependent CTAs require both health availability and a mounted chat listener. Configured/supplied cart/bundle/strip products are not gated on AI health; an unavailable recommendation response hides the surface using the existing path.

The list in the request and registry has eleven types **including chat**. No twelfth widget was invented. Existing focused mode and server holdout gates remain authoritative. New deterministic holdout assignment, shared RecommendationService, AgentVoice/handoff/mobile exit and finalized truthfulness contracts remain Phases 3–6.

## 3. Enabling and debugging

Set a literal boolean before the deferred SDK boots, after the embed defines its existing config:

```js
window.AOVBoost = { ...window.AOVBoost, agent_core_enabled: true };
```

The same flag is also accepted at `window.AOVBoost.settings.agent_core_enabled` or in already-supplied storefront settings. This run does not add a merchant setting or change a backend config schema. For a test build, the flag can be included in the existing app-owned embed's config object. Executing the snippet after initialization will not retrofit an already-running page. Omit the flag or use `false` to retain the legacy path; a fresh page initialization is required when changing it.

With the core enabled, open `?aov_debug=1` (or `&aov_debug=1` when the URL already has a query). Debug preference is session-persisted with guarded storage access. Read:

```js
window.__AOVBOOST_DEBUG__.decisions();
```

Entries contain signal, timestamp, candidates, bounded scores, rejection reasons and selected provider IDs. The buffer holds the last 50 evaluations and returns a copy. `?aov_debug=0` clears the persisted preference. Storage failure falls back to memory. No overlay is shipped. With the feature disabled, the optional core asset and health probe are not requested.

## 4. Local verification and requested checklist

This is automated local verification against synthetic Shopify/app-proxy fixtures. No production AI, Shopify checkout/order mutation, account credentials or live store was used for browser tests. Full manual interaction across every widget was not performed.

Completed checks:

- Full Vitest suite: **819 tests passed in 104 files**.
- `npx.cmd tsc --noEmit`: passed.
- ESLint on all changed source, build scripts and new tests: passed.
- `npm.cmd run build:sdk`: passed, including the asset size check.
- Full desktop/Pixel 7 browser suite: **32 passed**. After the final chat lifecycle/CTA guards, the core-only desktop/mobile suite was rerun: **14 passed**.

| # | Requested manual check | Result and evidence/limit |
| ---: | --- | --- |
| 1 | Flag-off product/collection/cart parity | **Not tested as a full manual comparison.** Legacy cart/browser regressions and existing product/collection/cart placement tests passed. Browser asserts no core asset or health request when disabled. |
| 2 | Land: quiet chat launcher only | **Fail against the future UX target.** Existing proactive chat bubble appearance is retained by the Phase 2 thin adapter. A quiet launcher belongs with Phase 4 chat/identity work. Focused mode remains quiet except for cart recommendations. |
| 3 | Product hesitation toast, CTA with product handoff | **Not tested end to end.** Unit test verifies the 20s visible-price dwell gate and one admitted toast. The product handoff and new doorway wiring are Phase 4 and were not implemented. Toast/exit remain desktop-only. |
| 4 | Two toast dismissals silence interruption | **Pass in unit tests.** Fake clock verifies 10-minute first backoff, second dismissal/session suppression and global silence after two interruptive dismissals. No real-time two-toast manual run. |
| 5 | Shopper add -> one upsell; accept -> no reappearance | **Pass, desktop and mobile browser.** Flagged acceptance is attributed to `cart_upsell`; cart event sources are `shopper`, then `aov_upsell`; only one offer is requested. Velour lines/subtotal/badge/quantity controls update after one accepted POST and edited notes survive. |
| 6 | Bundle/strip/chat adds do not retrigger | **Not tested as full flagged widget UI flows.** Unit tests reject recursive upsells for all six `aov_*` sources; real callers pass bundle/strip/chat source tags. Existing bundle/chat tests also pass. |
| 7 | Active chat suppresses exit | **Pass for the Arbiter rule in unit tests; full browser exit interaction not tested.** Chat suppresses foreground and new proactive candidates, with existing ambient content allowed to stay. Programmatic chat removal clears chat-open state. |
| 8 | Engaged desktop exit appears once | **Pass in unit tests; actual exit UI not manually tested.** Covers engagement/non-AI cart action, once/session and frequency caps. No mobile exit observer/sheet was implemented. |
| 9 | Checkout silences interruption | **Pass, desktop/mobile browser and unit.** A checkout click removes the mounted contextual provider, and later foreground eligibility is rejected. Actual checkout is outside the local fixture. |
| 10 | AI down / slow | **Pass for local degradation checks.** Blocked chat endpoint hides chat/dependent toast while cart recommendations work. Unit tests cover stalled flagged chat, retryable legacy error/Send recovery, probe timeout and breaker recovery. No billing/Redis outage or new strip fallback was live-verified. |
| 11 | Missing/past countdown | **Pass for existing placement tests and flagged eligibility.** Future expiry/explicit placement is required; direct legacy renderer behavior remains unchanged. No live campaign was configured. |
| 12 | Social proof below configured minimum/no data | **Not tested against a new minimum.** Existing renderer hides absent/nonpositive counts. `MIN_PROOF_COUNT` plus a verified time-window contract is Phase 5; it was not added in this run. |
| 13 | Block sessionStorage | **Pass, desktop/mobile browser and unit.** Page/cart flow works, dismissal works in memory, no new debug/error console output in the tested path; corrupt/empty storage also covered. |
| 14 | Keyboard: every surface, ESC/focus in drawer/chat | **Not tested for every widget.** Flagged floating cart ESC and focus return pass on desktop/mobile; existing native cart focus/keyboard tests pass. Chat focus trap/ESC and full chat UX baseline remain Phase 4 work. |
| 15 | Reduced motion | **Pass for the changed cart/core path.** Flagged desktop/mobile browser asserts no drawer animation and functional ESC/focus return. Common flagged CSS disables motion; every legacy widget animation was not manually inspected. |
| 16 | Throttled network, CLS, duplicate requests | **Not tested as a full performance pass.** Async reservation/cancellation and single accepted POST/read-only section retry are tested. No CLS measurement or network-throttled full-page comparison was performed. Recommendation coalescing/dedupe is Phase 3. |
| 17 | Debug candidates/reasons | **Pass, desktop/mobile browser and unit.** Cart winner and checkout rejection are visible in decisions; ring capacity and default silence tested. |
| 18 | Currency uses shop format | **Pass for existing automated currency coverage.** Signed KES chat/cart context, widget currency/variant formatting tests pass; the core adds no monetary copy or hardcoded currency. Full multi-currency manual coverage was not performed. |

Phase 2 foreground exclusivity is also checked independently of CSS/placement: equal-score priority, one ambient provider per shared slot, async reservation, cancellation before a higher-scoring mount and ignoring late results. Throwing providers are disabled for the session while another candidate can mount. Existing cart-refresh correction tests remain passing.

## 5. Compatibility and event plumbing

**No existing public event was renamed.** Existing `widget_impression`, `widget_click`, `widget_dismiss`, `recommendation_added`, cart events, `aovboost:open-chat`, `aovboost:cart-updated`, hint events and order-attribution properties remain available.

The new source shim adds `cartSource` to flagged legacy cart events while preserving their transport `source`. Internal `cart_change`/`cart_add_confirmed` signals and `AgentContext.cart.lastChangeSource` use the requested source vocabulary. Helper writes send `X-AOVBoost-Source`; the additive `aovboost:cart-mutation` completion event is consumed by EventBus after refresh. `cartMutationType` preserves the original mutation kind across legacy `cart_update`, preventing quantity changes from masquerading as adds. XHR/older recommendation-origin signals without a provider-specific tag normalize conservatively to `aov_postadd`, so they cannot retrigger an upsell.

Standard `impression`, `viewed`, `interaction`, `accepted`, `dismissed`, `suppressed`, `would_have_shown` events use the existing transport and add provider/class/signal/page/anonymous-session/holdout/health/time fields. The legacy impression remains its original verified/visible event; the new viewed event requires continuous half visibility for one second. Accepted-add events occur only after a confirmed refreshed add; no code-use attribution or new revenue conversion semantics were invented. The frontend can evaluate supplied holdout candidates; the existing backend can return no candidate for its holdout, so complete would-have-shown measurement needs Phase 6 coordination.

## 6. Bundle size

Exact bytes from Node `zlib.gzipSync`; CSS is unchanged at 27 raw / 47 gzip bytes and excluded from JS totals.

| Asset | Before raw | After raw | Before gzip | After gzip |
| --- | ---: | ---: | ---: | ---: |
| Initial `aovboost-sdk.js` | 161181 | 165272 | 43840 | 44975 |
| Lazy theme engine | 55417 | 56644 | 16510 | 16891 |
| Flagged lazy agent core | 0 | 29206 | 0 | 8399 |
| All JS assets | 216598 | 251122 | 60350 | 70265 |

The initial SDK grows **1135 gzip bytes**. With the flag off, the core is not downloaded; SDK plus theme engine total 61866 gzip bytes when the cart engine is needed. With it on, the optional core adds 8399 gzip bytes. Chat code remains in the existing IIFE: changing that delivery while retaining exactly the same disabled-path requests was not attempted. Intent-based chat loading remains future work.

The existing initial-main raw ceiling remains **170000** bytes. The combined checker now counts all three assets; its raw/gzip ceilings were explicitly adjusted from **240000/65000** to **255000/73000** to include the optional core. This is an accounted size increase, not a performance improvement or proof of zero CLS. Phase 6 performance policy/QA remains outstanding.

## 7. Ranked open issues

1. **Live validation/release remains outstanding.** These local passes do not confirm release of the earlier cart correction, any new core behavior on merchant themes, or live operation of the other widgets. Keep the flag off until deliberate rollout/verification.
2. **AI reachability is weaker than AI-generation health.** The existing GET cannot verify billing, Redis, provider credits or model latency. Actual flagged chat outcomes/30s cancellation supplement the breaker. Upstream billing/Redis remediation is outside this run.
3. **RecommendationService is not implemented.** Cart/product reads still repeat in legacy paths. Shared cache/coalescing/cart-and-surface dedupe and rule-based recommendation fallback are Phase 3; current failures safely hide catalog offers rather than inventing products.
4. **Phase 4 conversation UX remains.** Quiet/lazy launcher, identity/voice, context handoff, toast hover/focus pause, full chat keyboard/undo/quick replies and mobile exit sheet/signals are not implemented. Desktop toast/exit remain explicitly desktop-only. Chat-dependent legacy CTA surfaces are conservatively suppressed if chat is absent/unavailable.
5. **Phase 5 truthfulness remains.** Discount nudge still creates/applies no discount. Reward linkage, finalized alert payload IDs, proof minimum/time window, copy templates and comprehensive campaign guards need their planned phase. No new reward, urgency or proof data is generated by the core.
6. **Storefront/checkout post-purchase mismatch remains architectural.** Flagged copy now describes cart behavior, but the widget still adds to a cart. Legacy flag-off copy is unchanged for parity. The separate checkout extension was not edited or order-tested.
7. **Performance/accessibility coverage is incomplete.** No measured CLS/throttled-network budget pass, full-theme survey or all-widget keyboard audit. Existing signed-session/conversation storage predates this work and is not migrated; the new core store excludes tokens and message text. Unavailable-provider handling covers provider contract calls; legacy asynchronous widget internals still need their planned UX review.
8. **Phase 6 experiment/telemetry QA remains.** No new stable-hash holdout assignment, merchant percentage setting/dashboard, code-use attribution or revenue claims. Existing server holdout is respected, but it can withhold candidates needed for would-have-shown data. Frontend backoff cannot override a stricter existing server dismissal policy.

## 8. Recommended Phase 3 starting point

Start at `OfferPoller.requestOffer`, the repeated router/poller cart reads, `hydrateCartCardPrices` and the existing payload normalization in BaseWidget. Introduce a shared RecommendationService at the core/adapter boundary with a request key that includes shop, product/page, cart revision, locale/currency and recommendation purpose. Coalesce identical in-flight requests, bound cache lifetime, discard results after cart/navigation revisions and dedupe against cart plus already-mounted aovboost surfaces. Preserve the existing server decision endpoint/auth and the theme-engine cart refresh/verification path. Begin with bundle/strip/catalog-backed cart adapters and run the established one-add/one-acceptance/section-refresh regressions before extending fallback behavior.
