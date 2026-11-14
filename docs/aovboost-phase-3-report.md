# aovboost Phase 3 report

13 November 2026. Phase 3 implements the shared RecommendationService behind the existing `agent_core_enabled` flag, which remains **off by default**. Phase 4–6 work was not started. Verification is local; there was no deployment or live-store verification.

## Result and boundaries

Bundle, recommendation strip and cart-upsell adapters now share one catalog client. It validates current storefront variant availability and presentment prices, caches/coalesces public catalog reads, coalesces identical pending offer requests and prevents overlapping products across the cart and mounted/preparing aovboost recommendation surfaces. It also provides deterministic, non-AI ranking within an app-approved offer.

The existing `/apps/aovboost/offer` endpoint remains the authority for plan limits, merchant filters, holdout and offer IDs. Its successful decisions are **not cached for later authorization reuse**. A server denial, missing offer, authentication failure or offer-endpoint outage does not create a new local catalog offer. If approval is unavailable, the surface stays hidden and the theme cart continues working. This preserves the backend boundary while improving the frontend's handling of approved products.

## Shared client behavior

- Public product/recommendation JSON is cached in memory for **15 seconds**, with **48 entries** maximum. The key includes shop, locale-aware route root, presentment currency, locale and market. No browser storage, credentials, cart tokens or shopper messages are added to the catalog cache or debug output.
- Product reads and their response bodies have a **1.5-second deadline**. Simultaneous consumers share the same read; cancelling one consumer does not cancel a read another consumer needs. Failed reads remain retryable. Returned data is copied so callers do not mutate shared cache entries.
- Product-page ID lookup uses the same cache as later product hydration, avoiding a second fetch of the same PDP product for a bundle. Existing Shopify page globals remain the first lookup source.
- Hydration runs at most **four workers per prepared offer**. Larger configured bundles remain supported; the client does not impose the native recommendations API's ten-result limit on bundle components.
- Confirmed cart mutations, refreshed cart snapshots, navigation, pagehide and destruction invalidate pending work/cache generations. Late responses cannot populate the current cache or mount stale offers. Currency/market scope is checked again after asynchronous work, including the offer response.
- Identical pending offer calls share one task only while it is in flight. Keys distinguish page and cart revisions, mutation, product/variant and origin. Different cart mutations remain separate. No completed offer authorization is reused from cache. Free-form trigger payloads are not introduced into the coalescing keys.
- Current cart products are excluded at product level, including different variants of an already-present product. Other preparing/mounted aovboost recommendation surfaces reserve their products. A final exclusion check after fallback loading closes races between adapters. Reservations are released on dismissal, expiry, suppression, navigation or mount failure.
- Cart recommendations use the existing shared `recommendationLimit` policy when reserving products, so hidden cards beyond the actual display limit do not block other surfaces. If a cart change makes a mounted selection overlap, the outdated surface is removed.
- A configured bundle keeps its component quantities, bundle ID, discount version and discount metadata. Any unavailable/overlapping component suppresses the whole bundle; the client does not silently remove components and retain the original discount. Existing one-request cart mutation and section refresh logic are unchanged.

## Non-AI fallback and truthfulness

For an approved strip/cart offer whose decision is not already marked `heuristic`, unavailable AI health selects the catalog fallback. Shopify's locale-aware recommendations endpoint supplies `related` ranking for strips or `complementary` ranking for cart offers. **Only IDs already present in the app-approved pool are considered.** Unapproved native suggestions never become new offer products. If native recommendations fail or supply no matching IDs, the live-verified approved products have a stable product-ID order and an honest generic reason.

Configured bundles require no AI-dependent ranking. Existing server `heuristic` decisions retain their ranking and avoid an unnecessary native recommendations call. Products without a valid active storefront variant are removed; an unavailable bundle component hides the whole bundle. Prices are taken from Shopify's storefront product response using the existing Ajax cents-to-amount convention. No new currency symbol, urgency, inventory claim, proof count or reward is generated.

The fallback intentionally does not display products during a complete app-proxy outage without an approved offer. Doing so would bypass plan/display reservations, holdout or merchant filters that the frontend cannot independently verify. No backend, AI prompt, billing or Redis code was changed.

Official references consulted: [Shopify Product API](https://shopify.dev/docs/api/ajax/reference/product) documents locale-aware product reads and presentment-currency monetary fields; [Shopify Product Recommendations API](https://shopify.dev/docs/api/ajax/reference/product-recommendations) documents the `related`/`complementary` intents and ten-result query limit. Their actual live responses were not exercised in this run.

## Files changed in this phase

| File | Phase 3 change |
| --- | --- |
| `storefront-sdk/src/agent/RecommendationService.ts` | Shared public-catalog cache, in-flight coalescing, hydration, cancellation/revision guards, cross-surface reservations and approved-pool fallback. |
| `storefront-sdk/src/agent/AgentCore.ts` | Owns the service through the existing manager bridge; invalidates it on cart/navigation/pagehide and destroys it with the runtime. |
| `storefront-sdk/src/agent/providers.ts` | The three recommendation adapters prepare products through the service, cancel pending preparation when unmounted and release product reservations. Existing widget renderers stay in use. |
| `storefront-sdk/src/agent/types.ts` | Adds typed product-normalization/scope bridge hooks. Isolated core tests that do not host real widgets can continue using their smaller bridge stubs. |
| `storefront-sdk/src/widgets/widgetManager.ts` | Supplies existing `getProducts` normalization and locale/currency/market context to the shared client. |
| `storefront-sdk/src/offerPoller.ts` | Coalesces eligible pending requests, checks response market scope, shares PDP lookup and keeps legacy cart-price hydration on the flag-off path. Existing authorization, plan/holdout and stale-cart checks remain. |
| `storefront-sdk/src/index.ts` | Connects the core-owned client to OfferPoller only when the core is enabled. |
| `storefront-sdk/agent.vite.config.ts` | Builds the runtime as a fully minified ES entry with strict exported API preservation. This removes library-mode whitespace overhead and keeps the Phase 2 size ceilings. |
| `storefront-sdk/src/agent/RecommendationService.test.ts` | Cache/coalescing, expiry/market isolation, cancellation, stale responses, larger-bundle concurrency, atomic bundle metadata, actual display reservations and bounded fallback tests. |
| `scripts/browser-fixture-server.mjs` | Extends synthetic fixtures with catalog counters, native recommendations, approved bundle/strip modes, delayed offers and plan denials. |
| `tests/browser/recommendations.spec.ts` | Desktop/mobile request coalescing, approved-pool fallback, stale response rejection, flag-off parity, server gates/outages and real bundle/strip acceptance without recursion. |
| `extensions/aovboost-storefront/assets/aovboost-sdk.js` and hashed core asset | Rebuilt artifacts. The theme-engine hash and CSS content remain unchanged. |

The Phase 0/2 reports are historical snapshots. The earlier untracked `docs/widget-behavior-and-verification.md` was not edited. This phase does not modify widget markup, merchant-facing labels/settings, event names, cart property/attribute keys, Liquid/theme files, the checkout extension or application backend.

## Enabling and diagnostics

Use the existing flag before the deferred SDK initializes:

```js
window.AOVBoost = { ...window.AOVBoost, agent_core_enabled: true };
```

The corresponding existing frontend settings location is also supported, as described in the Phase 2 report. A fresh initialization is needed to change modes. Debug remains `?aov_debug=1`; no new shopper-facing debug UI was added.

When enabled, the existing diagnostic API includes numeric service counters:

```js
window.AOVBoostSDK.diagnose().recommendations;
// catalogReads, cacheHits, coalescedReads, coalescedOffers, fallbacks,
// cachedReads, pendingReads, pendingOffers
```

The flag-off status shape and request path are preserved. No source payloads, product lists, credentials or customer data are logged by these counters. Existing impression/acceptance telemetry and cart-source attribution continue through the Phase 2 event plumbing; no event is renamed.

## Verification

The checks use local synthetic Shopify/app-proxy responses. They do not establish live AI availability, native Shopify recommendation quality, actual checkout discount application or order-level conversion.

Completed checks:

- Full Vitest suite: **837 tests passed in 105 files**, including 18 service tests.
- `npx.cmd tsc --noEmit`: passed.
- ESLint on all Phase 3 source/build/test files: passed.
- `npm.cmd run build:sdk`: passed, including the unchanged size ceilings.
- Full desktop/Pixel 7 browser suite: **50 passed**. This includes the 18 existing cart-flow checks, 14 core checks and 18 Phase 3 checks. After the final PDP-cache build, the core/recommendation suite was rerun: **32 passed**.

| Check | Local result |
| --- | --- |
| Same confirmed mutation requested three times while pending | One app-offer request and one complementary-product validation read; coalescing counter records the additional consumers. |
| Cart acceptance and refresh | Existing one-POST acceptance, no recursive upsell, Velour notes/line/total/badge/quantity controls and native cart paths pass. |
| Bundle and strip acceptance | Both render real fixture products, add with the correct source and do not trigger cart upsell. |
| AI-unavailable fallback | Uses native complementary ranking within the approved IDs; unrelated native ID is excluded. Native failure has a deterministic approved-catalog fallback in unit tests. |
| Holdout, plan denial and offer outage | No recommendation fallback/catalog surface is created; shopper cart behavior stays available. |
| Cart changes during a delayed catalog read | The late product response does not mount a stale card. |
| Cache policy | Expiry, bounded size, cloned results, currency/locale isolation and reuse across PDP lookup/hydration pass. |
| Cancellation and reservations | One consumer can cancel without breaking another; mutation invalidates old results; mounted/pending cross-surface and cart duplicates are excluded. |
| Configured bundles | Whole-bundle suppression on unavailable/overlapping components, preserved quantities/discount metadata and bounded hydration of a twelve-item configured bundle pass in unit tests. |
| Flag off | Legacy catalog/cart path remains selected, no native recommendation fallback is requested, and service diagnostics are absent. |

Actual backend dependency outages, live Shopify-native recommendation responses, full-theme/mobile visual review, completed-order behavior, real discount application and measured CLS were **not tested**.

## Bundle size

Exact Node `zlib.gzipSync` measurements, compared with the completed Phase 2 artifacts. The existing 170000-byte main / 255000-byte combined / 73000-byte combined-gzip ceilings are unchanged.

| Asset | Phase 2 raw | Phase 3 raw | Phase 2 gzip | Phase 3 gzip |
| --- | ---: | ---: | ---: | ---: |
| Initial SDK | 165272 | 166484 | 44975 | 45345 |
| Flagged core | 29206 | 29660 | 8399 | 9945 |
| Lazy theme engine | 56644 | 56644 | 16891 | 16891 |
| JS total | 251122 | 252788 | 70265 | 72181 |

The initial SDK adds **370 gzip bytes**. All JS adds **1916 gzip bytes**. The core still loads only with the flag enabled; the theme engine still loads on its existing intent path. CSS is unchanged at 27 raw / 47 gzip bytes and excluded from JS totals. An initial build exceeded the combined ceiling; full whitespace minification for the core ES runtime brought the final artifacts within the existing limits without increasing those limits or adding dependencies.

## Remaining work and Phase 4 handoff

1. The feature remains off by default. Merchant-theme/live validation and confirmation of the earlier cart correction's release are still outstanding.
2. The AI health probe remains a transport check; billing/Redis/provider health was not changed or live-tested. An absent approved offer still hides recommendations during an app-proxy outage.
3. Cart snapshots still use the established fresh-read/version path. This phase consolidates recommendation and PDP catalog reads, not authoritative cart refresh reads, to preserve confirmed-add and section-refresh guarantees.
4. Catalog availability can change during the bounded cache lifetime. Shopify still authorizes the actual add; existing retry/error handling remains in the widgets. This phase does not add a new atomic-cart or checkout-discount guarantee.
5. No measured CLS or production-throttling performance pass was run. Request delay/cancellation and duplicate request/write behavior are covered locally; full performance QA remains Phase 6.
6. Phase 4 should start with AgentVoice and the chat doorway contract across ChatWidget, ToastNudge and ExitIntent: quiet/lazy launcher, one identity, explicit product/cart handoff, toast hover/focus pause and mobile exit signals/sheet. The service's shared product context and cancellation/reservation boundary can support that work without another recommendation client.
7. Phase 5 reward/proof/alert truthfulness and Phase 6 deterministic holdout/telemetry QA remain as listed in the Phase 2 report. The storefront post-purchase widget still adds to the cart; the separate checkout extension remains untouched.
