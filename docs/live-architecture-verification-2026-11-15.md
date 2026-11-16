# Live architecture verification — 15 November 2026

**Verdict: not ready for a complete end-to-end sign-off.** The published Agent Core
and its provider adapters run, and the sampled desktop/mobile cart flows work.
Successful AI recommendations, the required hesitation/toast doorway, every
widget's positive flow, and purchase attribution have not been established.

This is a new live verification run, not a replacement for the historical local
[Phase 2 implementation report](aovboost-phase-2-report.md) or the
[earlier checkout failure report](live-store-verification-2026-11-15.md). No new
architecture phase or production code change was implemented during this run.

## Deployment and configuration

| Boundary            | Observed result                                                                                                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Store               | `newsliderapp.myshopify.com`, connected store NewSliderApp, KES, Developer Preview.                                                                                                                                   |
| Backend             | Production `dpl_5JascXp4HzMnNKybLvuiNvudWikd`, commit `76448abb803558495f767feb4980e039945a9813`, READY.                                                                                                              |
| App URL             | `https://ai-agent-dusky-nine.vercel.app/`.                                                                                                                                                                            |
| Shopify assets      | Extension `ai-agent-21-88`; all five published JS assets returned 200 and matched local SHA-256 hashes across the asset checks. The conversation chunk loaded on the first chat gesture.                              |
| Billing QA          | The actual signed-in Admin shows **Billing paused for QA**, uncached Pro QA access, paused monthly counters and the per-instance AI limiter notice. Both new QA flags are active.                                     |
| Normal shopper flag | `agent_core_enabled` is **off**. The optional architecture is deployed, but it is not the ordinary shopper runtime. This matches its required default.                                                                |
| Flagged test        | An isolated Chrome shopper context enabled the literal flag before initialization, using the actual CDN code and real Shopify/app-proxy endpoints. No replacement SDK or mocked recommendation response was supplied. |
| Admin access        | Owner's existing signed-in Chrome AOVBoost tab, via Windows accessibility. No personal browser profile, cookies or tokens were exported.                                                                              |
| Viewports           | Desktop 1440 × 960 and Pixel 7 mobile emulation, CSS width 412.                                                                                                                                                       |

The saved merchant configuration was focused cart mode on; cart recommendations
on; chat, bundles, progress nudges, exit intent, post-purchase, proactive messages
and hesitation detection off; server holdout off. For QA, focused mode was turned
off and chat, bundles, exit intent, proactive messages and hesitation detection
were temporarily enabled through the app's own Recommendations form. Discounts,
payment providers and Shopify subscription contracts were not changed.

The core override was restricted to isolated browser pages. There was no embed
edit, deployment, backend change, model/prompt change, schema change or production
environment-variable change in this verification run.

## Architecture observed in the published runtime

- **AgentCore / SessionStore / SignalBus:** real page, product, refreshed-cart,
  chat, exit and checkout state transitions appeared in the debug log or persisted
  anonymous core state. The new store records counters and IDs, rather than the
  visible conversation text.
- **Arbiter / adapters:** evaluations list all eleven registered provider IDs,
  scores, accepted providers and rejection reasons. Sampled states never showed
  two contextual/interruptive surfaces together. The mobile 50 ms foreground
  sampler recorded a maximum of **one**; this does not exhaust every possible
  collision or exclude a shorter transient.
- **AgentHealth:** GET reachability worked and admitted the launcher. Actual model
  health is weaker than that signal: a successful HTTP chat response can contain
  a deterministic fallback after every provider fails.
- **RecommendationService:** the published optional core contains it and real
  cart/strip selections work. Full cache/coalescing/deduplication behavior across
  every provider was not certified live.
- **AgentVoice / lazy conversation:** launcher, cart card, desktop exit offer,
  mobile sheet and conversation use **NewSliderApp assistant**. The conversation
  chunk is requested on a trusted open gesture. Opening it does not itself send
  an AI message.
- **Telemetry / Debug:** actual requests include standard `interaction` and
  `accepted` metadata alongside legacy events. Debug exposes real candidates and
  rejection reasons. The supplied initial default-off pages request no core
  asset or chat health probe.

Provider registration and matching assets establish deployment of code, not a
positive functional test of every provider. Existing Phase 3–6 code was already
in the repository; this verification did not implement those phases.

## Real AI result

The live chat POST returned HTTP 200, one SSE delta and `[DONE]`, with no product
cards. Both sampled questions produced a finite, usable fallback, including:
“I don't have a verified match for those requirements right now.” This is **not**
successful AI recommendation evidence.

Production logs for the sampled `price_sensitive_chat` request show:

| Provider | Actual result                                                        |
| -------- | -------------------------------------------------------------------- |
| Gemini   | Request timeout; other sampled offer attempts returned invalid JSON. |
| Mistral  | HTTP 429.                                                            |
| Groq     | HTTP 404.                                                            |
| DeepSeek | HTTP 402.                                                            |

The fallback completed after **4,626 ms** of gateway work in the sampled log.
The QA billing bypass therefore reaches provider execution; it does not solve
provider quota, model/endpoint, response-format or funding problems. Their exact
causes were not diagnosed by changing production credentials or configuration.
All four providers show “configured” in Admin; those badges establish credential
presence, not successful execution.

Redis still reports `redis_cache_fallback` / `dns_failure` in production.
Distributed jobs and webhook processing retain their existing safeguards; the
local QA limiter does not repair those dependencies.

## Required manual checklist

“Partial” below identifies a tested subset and the untested remainder. Browser
fault injection is explicitly separated from ordinary live endpoint results.

|   # | Check                                           | Result and practical limit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --: | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   1 | Flag-off product/collection/cart parity         | **Partial.** Sampled home/product/collection/cart pages returned 200, no uncaught error, and no core asset/health probe. Full visual/behavior comparison against the pre-architecture release was not repeated.                                                                                                                                                                                                                                                                                                                                                      |
|   2 | Quiet landing, launcher only                    | **Partial pass.** Flagged desktop and mobile PDP initialization showed only the quiet launcher. An established session on Home also rendered an ambient recommendation strip. A fresh landing on every page type was not exhaustively tested.                                                                                                                                                                                                                                                                                                                        |
|   3 | 20-second hesitation toast and product handoff  | **Fail / incomplete.** With hesitation/proactive settings enabled, the mobile PDP price was scrolled into view and observed beyond 20 seconds. The core's price selector found no PDP price; no `price_hesitation` evaluation or toast occurred. Desktop selector candidates elsewhere included related-product prices, not the PDP price. Chat/exit openings used a generic opening line, not the actual product title. The required toast CTA flow could not be exercised.                                                                                         |
|   4 | Two toast dismissals cause session silence      | **Not tested live.** No qualifying toast was produced. The existing local Arbiter tests cover backoff/caps; they are not substituted for this live case.                                                                                                                                                                                                                                                                                                                                                                                                             |
|   5 | Shopper add → upsell; acceptance → no recursion | **Pass for fresh desktop and mobile native forms.** Each fresh add navigated to the real cart and produced one two-product card. One acceptance sent one `/cart/add.js`, source `aov_upsell`; native quantities and subtotal updated before reload. Both carts contained two quantity-one lines, subtotal **KES 748.73**. No upsell reappeared during the nine-second observation. A separate spend-threshold offer request did occur.                                                                                                                               |
|   6 | Bundle / strip / chat adds do not retrigger     | **Strip pass; bundle/chat not established.** The live mobile strip sent exactly one `aov_strip` add, retained offer/session line attribution, emitted standard acceptance and opened no upsell during nine seconds. No qualifying configured bundle was supplied; chat returned no product cards, so their full UI add/undo flows remain unverified.                                                                                                                                                                                                                 |
|   7 | Chat suppresses exit                            | **Limited observation.** Chat stayed open without an exit offer in the first desktop sample, but that initial mouse movement remained at the viewport edge and did not prove a desktop exit signal. Mobile exit-to-chat CTA removed the exit surface before opening the conversation. No claim of exhaustive active-chat candidate rejection.                                                                                                                                                                                                                        |
|   8 | Desktop exit, non-empty cart, once per session  | **Pass for sampled flow.** Actual pointer movement outside the top edge produced one cart-aware exit dialog with a real cart link. Escape removed it, persisted dismissal count one, and the second exit attempt produced no offer.                                                                                                                                                                                                                                                                                                                                  |
|   9 | Checkout suppression                            | **Pass for sampled navigation.** Native checkout navigation reached Shopify's order summary with zero AOVBoost widgets; core session state retained `checkoutStarted: true` on return. Wire delivery of `checkout_started` was not independently verified. No new order was submitted.                                                                                                                                                                                                                                                                               |
|  10 | AI-down degradation, no dead buttons/errors     | **Partial pass; strict zero-console-error condition not met.** Model failures returned a finite fallback. In the browser-injected 503 case, the launcher hid and a real diagnostic shopper Ajax add still mounted a live deterministic cart upsell. No uncaught JS error or AOVBoost console message occurred, but Chrome reported two HTTP resource errors. GET health remained successful during actual model failures, so model-health inference is not certified.                                                                                                |
|  11 | Missing/past countdown                          | **Not positively tested with a supplied invalid payload.** No countdown appeared; no qualifying campaign or reserved slot was configured. This establishes absence only.                                                                                                                                                                                                                                                                                                                                                                                             |
|  12 | Social proof below threshold/no data            | **Absence observed; explicit threshold boundary not tested.** Live social-proof requests returned no qualifying intervention, and no proof surface appeared. No synthetic count or time window was presented as verified store data.                                                                                                                                                                                                                                                                                                                                 |
|  13 | Block sessionStorage                            | **Pass for sampled page.** A browser-only throwing `sessionStorage` getter left the real SDK/core and launcher working, with zero uncaught page errors or console messages. Cross-document persistence cannot work while storage is blocked.                                                                                                                                                                                                                                                                                                                         |
|  14 | Keyboard / Escape / sensible focus return       | **Pass for sampled chat and exit actions; partial overall.** Desktop and mobile chat Tab traversal stayed in the nested dialog, Escape hid it, and focus returned to the launcher. Desktop exit Escape persisted dismissal. Every widget/control and every screen-reader combination was not exercised. The cart recommendation is an additive card, not a second modal.                                                                                                                                                                                             |
|  15 | Reduced motion                                  | **Pass for sampled mobile chat and strip; partial overall.** With the actual media preference emulated, computed styles across those widgets reported **zero animations and zero nonzero-duration transitions**. Other surfaces were not comprehensively repeated under this preference.                                                                                                                                                                                                                                                                             |
|  16 | Slow network, no CLS/duplicates                 | **Partial.** A mobile tab throttled to 250 ms latency, 250,000 B/s download and 125,000 B/s upload initialized the actual SDK/core/launcher, with no uncaught or console error. Its observed whole-page CLS was zero during the sample, with two startup offer responses. **No general CLS regression sign-off:** another desktop sample had substantial initial shift; no controlled pre-release comparison or causal attribution was completed. Separate initial/social/threshold offers must not be called duplicate-free traffic without tracing their purposes. |
|  17 | Debug decisions                                 | **Pass.** Actual flag-on pages expose `decisions()`, provider scores, selected providers, `no_offer`, merchant-disabled and suppression reasons.                                                                                                                                                                                                                                                                                                                                                                                                                     |
|  18 | Shop currency                                   | **Pass for sampled KES cart/strip/preview amounts.** Cart subtotal KES 748.73, recommended item KES 249.29; storefront locale uses `KSh`, Admin preview uses `KES`. No other currency/locale was tested.                                                                                                                                                                                                                                                                                                                                                             |

One native form add after an extended browsing/chat interval reached the cart
without an upsell. Fresh-page repeats passed on both viewports. The passive
native-continuation code has a bounded baseline lifetime; stale/missing evidence
can safely produce no offer. The exact cause of that single aged-session miss
was not isolated, so it is neither dismissed nor reported as a confirmed new
regression.

## Widget coverage

| Surface                  | Current live coverage                                                                                                                                                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chat                     | Quiet launcher, gesture/lazy load, shared identity, dialog, quick-reply controls, two signed SSE requests, finite fallback and keyboard close. AI answer/product cards/cart add/undo/retry/history continuity not signed off. |
| Toast                    | Provider registered; required natural hesitation flow failed to appear in the sampled theme.                                                                                                                                  |
| Countdown                | Registered; no qualifying future campaign/reserved placement, no positive timer/expiry test.                                                                                                                                  |
| Inline alert             | Registered; no supplied stable notice/reserved placement, no positive dismissal test.                                                                                                                                         |
| Bundle                   | Toggle tested; initial product decision returned “A bundle item is excluded for this product.” No positive bundle/multi-item add/discount test.                                                                               |
| Cart upsell              | Fresh desktop/mobile native add, two-product/variant UI, acceptance, immediate refresh, source tags, event transport and no recursive drawer.                                                                                 |
| Discount nudge           | Merchant-disabled; no verified reward/slot established, so no discount was claimed or created.                                                                                                                                |
| Recommendation strip     | Real Home display and mobile UI add, variant controls, `aov_strip` attribution and no recursive drawer.                                                                                                                       |
| Social proof             | Registered; no qualifying live proof shown. Count/window threshold positive and boundary cases remain unverified.                                                                                                             |
| Exit intent              | Desktop cart-aware dialog, dismissal and repeat suppression; mobile engaged-session idle bottom sheet and gesture CTA to chat.                                                                                                |
| Storefront post-purchase | Kept disabled; unchanged cart-add behavior, not a modification of a completed order. Checkout extension unchanged and not positively exercised.                                                                               |

## Admin and attribution

Plan & usage, Recommendations save/confirmation, advanced provider badges,
Product pairings, catalog offer Preview and Revenue analytics rendered through
the owner's existing signed-in app. Pairings showed **0 approved / 0 autopilot
top products** and **14 needing attention**. No pairing approval, rejection or
regeneration was submitted. The preview showed actual Bag Collection20 and
Collection18 at **KES 249.29** and **KES 403.15**.

The sampled analytics view showed **5 offer impressions**, **3 clicks**, **0
attributed orders** and **KES 0.00 attributed revenue**. This is a point-in-time
snapshot during QA, not a final total or evidence of incremental lift.

A read-only Shopify query confirmed the prior simulated order **#1001** is still
`test: true`, `PAID`, `cancelledAt: null`. No new order, payment or cancellation
was submitted in this run. The previously documented variant-stat Prisma payload
bug remains in the deployed source; it was not fixed or re-certified by another
purchase. Its earlier live failure evidence remains in the linked report.

## Assets, compatibility and changes in this run

No app source, public event name, cart attribute/property, metafield schema,
theme file or merchant-facing setting label was changed. No compatibility shim
was added. Existing `widget_click`, `recommendation_added` and cart events remain
alongside new standard events.

| Published asset                               | Raw bytes | Local gzip bytes |
| --------------------------------------------- | --------: | ---------------: |
| `aovboost-sdk.js`                             |   169,417 |           46,663 |
| `aovboost-theme-engine-DzuyxnIT.js`           |    44,878 |           15,148 |
| `aovboost-agent-core-Dn4sokN2.js`             |       106 |              101 |
| `aovboost-agent-AgentCore-BAfSKDVz.js`        |    61,300 |           20,149 |
| `aovboost-agent-ChatConversation-BD-5ir-h.js` |     8,441 |            3,331 |

Main + optional JavaScript total: **85,392 gzip bytes**. These are local gzip
measurements of the reviewed build, not transfer-encoding sizes from Shopify.
Before/after this verification: **no asset change, zero-byte delta**. The
historical Phase 2 report retains its original implementation before/after sizes.

New tracked changes are this report and a follow-up link in the Phase 2 report.
Test scripts, redacted JSON and viewport screenshots are Git-ignored under
`test-results/live-shopify/architecture-2026-11-15/`. They retain product/variant
IDs and test observations, without passwords, signed session credentials, cart
tokens, checkout URLs or customer details. Test-run controls live beside that
directory and are not storefront runtime dependencies.

## Controlled conditions and cleanup

The following conditions were injected **only into isolated Chrome pages**, using
the published SDK and actual live endpoints except for the named 503 route:

| Controlled condition                  | Result                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sessionStorage` getter throws        | SDK/core and launcher loaded. Zero uncaught errors, zero AOVBoost output, zero console errors. Cart stayed empty.                                                                                                                                                                                                                                     |
| Chat GET/POST returns local 503       | Launcher/toast absent. A real, untagged diagnostic Shopify Ajax add produced a real deterministic upsell through the live offer endpoint. Zero uncaught errors/AOVBoost console output; two expected browser HTTP resource errors. Owned test line was cleared. This was not a native-form or live-provider outage simulation at the provider itself. |
| Network throttling                    | SDK/core and launcher initialized; zero uncaught/console errors in the sample. No purchase was made. Zero measured shift in this warm mobile sample is not a cold-cache or cross-version CLS guarantee.                                                                                                                                               |
| Frontend fallback holdout set to 100% | No widgets. An actual event POST carried `would_have_shown`, provider `chat`, `holdout: true`. Two live offer requests hit HTTP 429 and caused browser resource errors. Other-provider counterfactual coverage, allocation distribution and store-wide randomized outcomes were not established. Server holdout settings were unchanged.              |

Every controlled-case cart read ended at zero. The 429 responses demonstrate that
ordinary request limits remain active during the billing pause; they also limit
what this holdout sample can prove.

The app's Recommendations form restored all **10 saved checkbox values**, and a
fresh accessibility read compared them against the saved originals: **10/10
matched**. Focused cart mode is back on; chat, bundles, progress, exit,
post-purchase, proactive messages and hesitation are off. Server holdout is still
off. The QA billing environment remains as it was before this verification.

The final shopper reload obtained fresh server settings and confirmed focused
mode on, the disabled chat/browsing settings, **zero cart items**, and **zero
visible widgets**. All isolated controlled-case pages were closed. The isolated
shopper browser was then closed, removing its temporary core/debug/holdout
overrides. The local observation router was restored. The owner's existing
signed-in Chrome app tab was left in AOVBoost Admin; it was not closed.

No local unit/browser fixture suite was rerun or represented as live evidence.
Only report files are tracked changes from this verification run.

## Ranked remaining work

1. **Restore a successful AI provider path.** Resolve the actual timeout/JSON,
   429, 404 and 402 results, then demonstrate a grounded answer, product cards,
   selected variant, one confirmed `aov_chat` cart action and safe undo. This
   requires work outside the supplied frontend-only verification scope.
2. **Make activation explicit.** The core is shipped but default-off. Choose an
   app-owned release configuration when ready; browser-only QA activation is not
   a store-wide rollout. Do not enable broadly based on this report alone.
3. **Correct/verify the theme's PDP hesitation observer and product handoff.**
   The sampled selector did not observe the actual mobile PDP price, and opening
   copy stayed generic. Complete toast/CTA, real product/variant handoff, pause on
   hover/focus, double dismissal and interruption collision checks.
4. **Repair Redis and the known order webhook defect; recheck attribution.** The
   QA billing override intentionally does not bypass distributed claims or fix
   invalid Prisma inputs. Purchases are not certified merely by cart acceptance.
5. **Supply real configuration/data and placements for the remaining widgets.**
   Test one real configured bundle, a future campaign with expiry, a stable alert,
   a real reward, and verified proof counts/windows. Keep absence distinct from
   a positive guard/acceptance test.
6. **Finish performance and compatibility verification.** Run a controlled CLS
   comparison, trace recommendation request purposes, exercise long-idle native
   adds, every collision/backoff path, reduced motion and additional themes.

The Phase 3 module already exists from prior work. Its next useful verification
starting point is a configured bundle plus strip/cart selections using the same
real catalog, with request counts, current-cart exclusion and cross-surface
deduplication observed together. Reimplementing it would not resolve provider or
configuration blockers found here.
