# Chat recommendations and product-hesitation toast repair

15 November 2026. **Local implementation; release and storefront verification pending.**

This repairs the two failures recorded in the [live architecture verification](live-architecture-verification-2026-11-15.md). That report remains the historical live result. These changes have not been deployed to Vercel or released through the Shopify extension.

## Findings and resulting behavior

### Chat recommendations

The gateway had two concrete provider problems that could produce the observed fallback:

- Ordinary Gemini requests used the model's default thinking behavior with a small output allowance. Thinking consumes that allowance too, leaving insufficient room for complete JSON. Ordinary supported Flash models now receive minimal thinking; explicit reasoning jobs retain their reasoning profile. Final text parts are joined while thought summaries are excluded. Truncated output is rejected, and invalid output puts that model into the existing short cooldown before fallback.
- The default Groq model, `llama-3.3-70b-versatile`, was retired for the affected accounts. The configured local account's models list excluded it and included `qwen/qwen3.8-27b`. The latter is now the default, using Groq's completion-token and reasoning controls. Explicit model environment overrides still take precedence.

Ordinary chat now has a 1,200-token response allowance and uses the existing relaxed timeout profile (5.8 seconds per provider, 8 seconds total with default environment settings). Checkout assistance retains the urgent profile. Provider requests remain bounded by existing monthly/daily/concurrency gates and cancellation.

Catalog matching also rejected simple plural queries such as "bags" against "Bag." A conservative catalog-noun map fixes these exact matches. When a shopper explicitly refers to "this product" or the product they are viewing, the recommendation query includes the server-resolved product title. Budget, currency, stock, merchant exclusions, cart exclusions and rejected-product checks remain in force. No AI system prompt or merchant setting was changed.

Provider behavior was checked against the official [Gemini thinking documentation](https://aistudio.google.com/docs/thinking?generate-content=true), [Groq deprecations](https://console.groq.com/docs/deprecations), [Groq models](https://console.groq.com/docs/models) and [Groq reasoning controls](https://console.groq.com/docs/reasoning).

### Hesitation toast

The original selector missed the live theme's primary price markup and could match recommendation-card prices. A single timer also missed prices inserted or brought into view later. Separately, legacy product-dwell triggers could request a proactive offer at 15 seconds before the intended 20-second moment.

The optional core now observes the primary purchase area, excludes related-product/quick-add prices, and accumulates time only while the actual price is visible and assistance is allowed. Scrolling, visibility changes and theme section replacement update the detector. It pauses during active chat, checkout and unhealthy-assistant states, and cleans up on navigation/destruction. Existing return-to-product thresholds remain supported.

Core-enabled pages suppress the competing legacy PDP dwell/repeat/hover paths. Legacy flag-off paths retain their triggers. The offer request adds `agent_core_enabled: true` only when enabled. The server recognizes a valid core PDP hesitation moment and creates a **toast** offer using the existing proactive eligibility, cooldown and atomic reservation rules; it does not require a separate AI generation to choose the toast. Malformed/early input does not enter this new branch.

The toast still goes through the Arbiter and opens the same conversation with the actual product title and selected primary variant. The browser regression uses incomplete Shopify product metadata, a visible unrelated product price, and a quick-add variant to catch the observed theme mismatch. During implementation it also caught native form controls named `id` shadowing `form.id`; form identification now uses a CSS attribute selector instead.

Toast remains explicitly desktop-only (minimum width 900 CSS pixels). Mobile keeps the chat launcher and exit bottom sheet. The detector publishes its moment on mobile without requesting an invisible toast.

## Changed files

| Files                                                                                                                                                                         | Change                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/ai/client.server.ts`                                                                                                                                                     | Provider defaults, supported reasoning controls, final-part extraction, token-truncation rejection, malformed-output cooldown; Google key sent in its authentication header.                 |
| `app/routes/api.chat.tsx`                                                                                                                                                     | Bounded response allowance/timeout and grounded recommendation query.                                                                                                                        |
| `app/sales/recommendationEngine.ts`                                                                                                                                           | Explicit current-product reference resolution and conservative noun normalization.                                                                                                           |
| `app/routes/api.offer.tsx`, `app/sales/proactiveEngine.ts`                                                                                                                    | Validated core hesitation route to a durable toast offer, retaining merchant/session limits.                                                                                                 |
| `storefront-sdk/src/agent/ProductHesitation.ts`                                                                                                                               | Primary product context and visible-price dwell observer.                                                                                                                                    |
| `storefront-sdk/src/agent/AgentCore.ts`                                                                                                                                       | Sensor lifecycle, product-title fallback and correct selected-variant handoff.                                                                                                               |
| `storefront-sdk/src/triggerRouter.ts`, `storefront-sdk/src/offerPoller.ts`                                                                                                    | Core-only trigger ownership and optional request flag.                                                                                                                                       |
| `storefront-sdk/src/widgets/BaseWidget.ts`, `ChatWidget.ts`, `storefront-sdk/src/agent/Surfaces.ts`, `storefront-sdk/src/styles/{base-widget,chat-widget,agent-surfaces}.css` | Existing static Shadow DOM styles pass through Vite's inline CSS minifier to keep the unchanged bundle budgets. No new runtime dependency, stylesheet request or intended appearance change. |
| `app/ai/client.server.test.ts`, `app/sales/salesAgent.test.ts`, `app/storefront-pairing-responses.test.ts`, `storefront-sdk/src/agent/{AgentCore,ProductHesitation}.test.ts`  | Provider fallback, catalog grounding/eligibility, validated toast routing and sensor regressions.                                                                                            |
| `scripts/browser-fixture-server.mjs`, `tests/browser/agent-experience.spec.ts`                                                                                                | Sparse-metadata theme fixture and actual hesitation-to-chat browser flow; exit test seeds a prior non-product page rather than fabricating a second PDP visit.                               |
| `extensions/aovboost-storefront/assets/aovboost-*.js`                                                                                                                         | Rebuilt main asset and matching hashed runtime/theme/conversation chunks. Old generated chunks replaced.                                                                                     |

No existing public event, cart property, metafield schema or merchant-facing label was renamed. The offer-body flag is additive and omitted in legacy mode. Backend provider repairs apply to chat in either frontend mode; the new hesitation behavior remains behind the existing default-off core flag.

## Verification

| Check                                                                        | Local result                                                                                                                                                                      |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx.cmd vitest run --config vitest.config.ts --maxWorkers=2 --reporter=dot` | **960 tests passed in 113 files.** The initial unrestricted parallel run had one unrelated billing-route import timeout; it passed alone and in this complete bounded-worker run. |
| `npm.cmd run typecheck`                                                      | Passed.                                                                                                                                                                           |
| ESLint on all changed JS/TS source and tests                                 | Passed.                                                                                                                                                                           |
| `npm.cmd run build:sdk`                                                      | Passed, including every existing size budget.                                                                                                                                     |
| `npx.cmd react-router build`                                                 | Passed. Existing dependency annotation/dynamic-import/future-flag notices remain. No migrations or deployment commands ran.                                                       |
| Focused desktop hesitation, two-dismissal and exit-to-chat tests             | Passed.                                                                                                                                                                           |
| `npx.cmd playwright test --max-failures=0`                                   | **104 passed, 2 intentionally skipped** (mobile toast tests), 5.9 minutes.                                                                                                        |

The complete browser run includes the sparse-metadata price-to-toast-to-chat flow, two-dismissal silence, chat product-card add/undo, desktop/mobile cart-refresh corrections, no recursive upsell, blocked storage, assistant outage, active-chat/checkout suppression, reduced motion, holdout attribution, recommendation coalescing and layout/transfer budgets. These are local simulations, not live storefront verification.

The local agent release checker also passed SDK graph and size validation, with fingerprint `1941c82731c72fe53b23d3e0faa3cb685024c26f7e027a4e98aba8fdd4a84156` in `test-results/agent-release.json`.

Two bounded requests used the actual patched gateway and existing **local** provider credentials with a synthetic blue/red bag catalog:

| Provider | Model              | Result                                                           |
| -------- | ------------------ | ---------------------------------------------------------------- |
| Gemini   | `gemini-3.6-flash` | Valid JSON, correct eligible blue-bag ID, no fallback, 3,172 ms. |
| Groq     | `qwen/qwen3.8-27b` | Valid JSON, correct eligible blue-bag ID, no fallback, 1,111 ms. |

Those requests enabled the existing billing/AI QA flags only inside the diagnostic process. They did not edit cloud environment variables or provider balances. They verify provider connectivity and grounded synthetic output, **not** the deployed store's full chat/API/database path. Browser tests use local synthetic app-proxy responses; no live order was placed.

## SDK sizes

Bytes, gzip per emitted JavaScript asset summed within each stage:

| Stage                     | Before raw / gzip | After raw / gzip |
| ------------------------- | ----------------: | ---------------: |
| Initial SDK               |  169,417 / 46,663 | 168,039 / 46,711 |
| Core boot                 |  230,823 / 66,913 | 232,050 / 67,819 |
| First conversation        |  239,264 / 70,244 | 240,491 / 71,150 |
| Lazy conversation chunk   |     8,441 / 3,331 |    8,441 / 3,331 |
| All SDK/core/theme chunks |  284,142 / 85,392 | 284,980 / 86,209 |

The existing combined ceilings remain 285,000 raw and 87,000 gzip. Raw headroom is only 20 bytes; subsequent changes must continue to run the size check. Chat remains lazy-loaded on intent.

## Release and live follow-up

Both an app/backend deployment and a Shopify extension asset release are required. A backend-only push cannot repair the published price detector; an asset-only release cannot repair provider defaults or server toast routing.

For isolated storefront QA, enable literal `agent_core_enabled: true` before SDK initialization and use `?aov_debug=1`. In the app's existing settings, focused cart mode must be off, and chat, proactive messages and hesitation detection must be enabled. The earlier live verification restored those merchant settings to their original disabled/focused state. This repair does not change them or enable the core for ordinary shoppers.

After release, verify a real catalog recommendation and product-card add, then a fresh desktop session with the primary price visible for 20 seconds, exactly one toast, a contextual chat opening, dismissal backoff and a shopper/cart-upsell acceptance without recursion. Repeat mobile chat/cart checks; mobile toast is intentionally absent.

External Mistral throttling and DeepSeek billing rejection observed in the earlier investigation remain account conditions. Redis/billing infrastructure and the separate order-attribution persistence issue are unchanged. The historical live failures must remain unverified until the released code is exercised against the store.
