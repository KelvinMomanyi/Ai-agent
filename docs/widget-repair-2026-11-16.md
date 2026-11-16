# Storefront and Admin corrections — 16 November 2026

## Verification boundary

**Implemented and tested locally; not released or verified live.** No production migration, backend/Shopify deployment, live merchant-setting change or new order was performed in this repair run. The earlier live verdicts in `live-remaining-widgets-verification-2026-11-15.md` remain historical evidence, not automatically upgraded by local tests.

Final local results: **1,008 unit/integration tests in 121 files passed; 110 desktop/mobile browser tests passed, with two intentional mobile toast skips**. TypeScript, changed-file lint, production Admin/API build, Shopify app configuration validation, extension build/Theme Check and original SDK budgets passed.

## Corrections by flow

| Flow | Correction | Remaining live requirement |
| --- | --- | --- |
| Chat | Preserves the preceding provider/output/grounding repair, current fallback model, malformed/truncated output handling and useful product cards. | Deploy and repeat real recommendation/cart flows. Earlier local provider probes are not a deployed storefront pass. |
| Hesitation toast | Preserves primary PDP price visibility/dwell, sparse-theme metadata handling, product/variant handoff and removal of competing legacy dwell triggers in core mode. | Deploy and test actual desktop hesitation. Toast remains explicitly desktop-only. |
| Bundle | Verifies the exact active, shop-owned configured bundle, matching trigger and complete product membership. Merchant bundle contents override soft complement heuristics; hard product/collection/pairing exclusions and availability checks remain. | Test a deliberately configured bundle, one multi-item add and any actually configured discount. |
| Countdown | Persistent merchant campaign text/start/end configuration, signed facts delivery, bounded placement and existing real-deadline/expiry guards. | Supply a real campaign and deadline. No rolling timer was introduced. |
| Inline alert | Product-selected notice text/schedule, stable payload identity, signed delivery and usable placement; existing dismissal per payload remains. | Supply the actual notice/products. |
| Discount nudge | Verifies an existing Shopify storewide percentage/fixed-amount code, minimum spend, currency, dates and eligibility. Rejects unsupported/restricted/expired rewards; checks subscription-cart eligibility and periodically re-verifies. At the target, the link applies the real code through Shopify. | Supply an eligible real discount; verify actual Shopify cart/checkout receipt and eventual code-use attribution. A click is not a confirmed discount conversion. |
| Social proof | Counts distinct paid, uncancelled, non-test orders in 7 or 30 complete UTC days; one count per product/order. Hides below five and fails closed on incomplete history. | Positive display requires five real eligible orders. Previous live sample had zero; keeping it hidden is correct. No orders/counts were fabricated. |
| Storefront post-order offer | New separate order-status block and signed app-proxy confirmation page, explicitly for a **new cart**. Current options/prices/currency/availability load before Add to cart. Requires shopper submit; uses `aov_postadd`, refreshes before navigation and never repeats an accepted POST because a later read failed. | Release/activate the block and test on a real Shopify order-status page. It never modifies a completed order. |
| Order statistics | Sanitizes variant-stat writes to legal Prisma keys instead of spreading quantity/price/offer fields. Deduplicates repeated variant lines. | Release and recheck a signed order-webhook flow. |

The existing checkout post-purchase extension under `extensions/post-purchase-upsell` was built but **not edited**. It remains separate from the new next-cart flow.

## File map

- `app/models/pairingRecommendations.server.ts` and tests: exact active bundle verification, source-product handling and hard exclusions, including removed configuration and similar-product cases.
- `app/models/product.server.ts`, `performance.integration.test.ts`: sanitized variant-stat writes, asserted against a real local database integration.
- `prisma/schema.prisma`, `prisma/migrations/20261116090000_storefront_configuration/migration.sql`: one nullable `AppSettings.storefrontConfig` JSONB column; additive/idempotent migration. No public metafield schema change.
- `app/models/storefrontConfig.ts`, `settings.server.ts`: versioned default-off configuration and validation; exposes `agent_core_enabled` only when explicitly enabled.
- `app/routes/app.storefront.tsx`, `app/routes/app.tsx`: authenticated Polaris configuration page and Storefront offers/Bundles navigation. Existing setting names/labels are retained.
- `app/models/storefrontData.server.ts`: actual Shopify reward/order queries, complete-window aggregation, bounded 60-second aggregate cache/coalescing and isolated source failures. Public cache contains no credentials, customer records or PII.
- `app/routes/api.experience.tsx`: signed app-proxy/session authentication, installation/product/shop/plan/holdout/rate/quota checks, reusable attributed fact offers and no-store responses.
- `storefront-sdk/src/agent/FactFeed.ts`, `AgentCore.ts`: coalesced/debounced reads, stale-navigation cancellation, periodic revalidation, failure revocation and Arbiter delivery. Starts only with the server-enabled flag; flag-off makes no facts call.
- `OfferFacts.ts`, `cartState.ts`, `agent/types.ts`, `FactSurfaces.ts`: reward verification expiry, actual subscription-cart eligibility, live cart progress and real code-application link.
- `storefront-sdk/src/widgets/placement.ts`: literal form ID avoids named-input shadowing; resolves explicit/automatic placements. `widget-slot.liquid` reserves factual inline space before SDK loading. Optional automatic placements are bounded overlays and prefer explicit app blocks.
- `extensions/aovboost-next-cart`: framework-free Polaris order-status block; guarded storage holds only a random anonymous ID, never tokens/order/customer data. Tokens remain transient; failed recommendations/telemetry leave the order page usable.
- `app/routes/api.order-picks.tsx`: official customer-account token authentication, public catalog selection, stable anonymous holdout, reusable offers and scoped impression/click receipts. No arbitrary private-order query and no browser conversion authority.
- `app/routes/api.postadd.tsx`, `app/utils/nextCartPage.server.ts`: fresh same-shop signed offer, current pairing/catalog validation, escaped markup, current Ajax options/prices, explicit add and existing attribution/source keys.
- `storefront-sdk/src/styles/*.css`, widget imports, three Vite configs, `compactWidgetMarkup.ts`: existing CSS pipeline plus build-time HTML indentation compaction and **build-only** Terser. No runtime framework/dependency added; dynamic text is untouched and original size limits remain.
- New configuration/data/API/Admin/feed/extension/confirmation tests, browser fixture and `tests/browser/verified-facts-feed.spec.ts`: positive/negative facts, auth, scoped saves/events, storage failure, navigation races, cart/currency and real code links.
- `.vercelignore`: excludes environment files, browser/auth test artifacts and private tooling directories from future source uploads.

Earlier chat/toast changes and `chat-toast-repair-2026-11-15.md` were preserved in this pending working-tree release.

## Activation after release

1. Deploy the migration/backend before serving the new Prisma client. The existing Vercel build runs `prisma migrate deploy`; production migration was not run here.
2. Release Shopify assets to AOVBoost (`ai-agent-21`, client ID `b314197727859b8c244255e176f8b2af`). Verified backend: Vercel project `ai-agent`, `prj_eKfMXvc2E0kQosLSFnKBlszk6zQE`, team `team_cRkjburR63WK9vk3G4Yey0gh`, `https://ai-agent-dusky-nine.vercel.app`.
3. Admin → AOVBoost → Storefront offers → Enable Agent Core. It defaults **off**. Turn off existing Focused cart recommendations for browsing widgets and keep intended per-feature switches enabled.
4. Supply real campaign/notice facts and an existing eligible reward code; enable proof if desired. No permanent promotions were invented. Choose compact automatic placements or explicit app-owned theme blocks.
5. Place **AOVBoost next-cart picks** on the order-status page in Shopify's checkout/accounts editor; allow extension network access if Shopify requires it.
6. Debug: `?aov_debug=1`; inspect `window.__AOVBOOST_DEBUG__.decisions()`. No new fact-provider console output in normal mode.

## Tests run

```text
npx.cmd vitest run --maxWorkers=2 --reporter=json --outputFile=test-results/widget-repair-unit.json
npx.cmd playwright test
npx.cmd tsc --noEmit
npx.cmd eslint <changed production and test files>
npm.cmd run build:sdk
node scripts/check-sdk-size.mjs
npx.cmd react-router build
npx.cmd shopify app config validate --json
npx.cmd shopify app build --no-input
```

Both new Admin GraphQL queries passed the Shopify skill's **2026-07** schema validator; proof ordering was revalidated after changing it to `PROCESSED_AT`. CLI returned `valid: true` with zero configuration issues. Extension build and Theme Check passed; the new order-status block built at approximately **2.2 KB raw / 0.9 KB compressed**.

The standalone UI skill validator could not resolve its bundled customer-account type package; standalone Liquid validation lacked its theme-check package. Those source-validator attempts did **not** pass. Actual Shopify CLI configuration/build/Theme Check, extension unit tests, TypeScript and application builds passed. Native order-status rendering still needs Shopify-hosted preview/live verification.

## Original checklist, local evidence only

Fixtures use synthetic products/orders/rewards/chat streams. These are not live certifications. Desktop and Pixel 7 viewports were used.

| # | Result | Evidence/limit |
| --- | --- | --- |
| 1 Flag-off product/collection/cart | Partial | Product/cart legacy and no-core/no-facts calls pass; collection/live not rerun. Intentional bug-fix exceptions below. |
| 2 Quiet landing | Pass locally | Launcher only without eligible proactive moments; configured ambient facts may render. |
| 3 Hesitation/context handoff | Pass desktop | Actual primary-price dwell and correct product/variant; mobile toast intentionally skipped. |
| 4 Two dismissals/backoff | Pass desktop | Silence/backoff browser regression; mobile toast intentionally skipped. |
| 5 Shopper add/one upsell/no recursion | Pass locally | Both viewports, confirmed adds and refreshed acceptance. |
| 6 Bundle/strip/chat add no upsell | Pass locally | Real widget/helper browser flows in both viewports. |
| 7 Chat suppresses exit | Pass locally | Both viewports. |
| 8 Engaged exit once | Pass locally | Desktop dialog/mobile bottom sheet and real cart CTA. |
| 9 Checkout silence | Pass locally | Signals/navigation suppression, not a live completed checkout. |
| 10 AI down | Pass locally | Blocked endpoint, failed streams, fallback/hide/retry; production provider/billing/Redis not re-certified. |
| 11 Invalid/expired countdown | Pass locally | Missing/past deadline suppressed; supplied deadline expires without moving content. |
| 12 Proof below minimum/no data | Pass locally | Missing/below-five/incomplete histories suppress; exact fixture counts/window. |
| 13 Blocked storage | Pass locally | Core/cart/chat and order-status storage tests. |
| 14 Keyboard/ESC/focus | Partial | Drawer/chat/exit focus/ESC pass; native account block and every new Admin control not manually exercised. |
| 15 Reduced motion | Pass locally | Existing browser/CSS checks; no native account-page audit. |
| 16 Slow network/CLS/coalescing | Pass locally, sampled | Delayed assets/recommendations, stale-response guards, bounded surfaces, no sampled CLS regression, one initial facts call; not every theme. |
| 17 Debug decisions | Pass locally | Candidate/rejection/source tests. |
| 18 Currency | Pass locally | Existing USD/KES/JPY plus KES reward/current-price confirmation tests; live market/discount receipt not rerun. |

## Compatibility and sizes

No existing public event names, line-item keys or metafield schemas were renamed. Existing `_aovboost_offer_id`, `_aovboost_session_id`, `X-AOVBoost-Source` and `aovboost:cart-mutation` remain. New order-status receipts record scoped impressions/clicks; cart add/click never asserts completed-order revenue.

New facts/configuration are default-off and flag-gated. Intentional legacy-path corrections: valid configured bundles now pass; variant statistics no longer contain invalid fields; preceding backend chat repair applies in either mode; legacy post-purchase fallback copy now says **For your next cart / Add to cart**. Style extraction/compaction changes emitted bytes while legacy regressions pass. Absolute byte-identical flag-off behavior is not claimed for this bug-fix release.

Measured per served JS asset against committed HEAD `76448abb803558495f767feb4980e039945a9813`:

| Asset | Before raw | Before gzip | After raw | After gzip |
| --- | ---: | ---: | ---: | ---: |
| Initial SDK | 169,417 | 46,663 | 163,724 | 44,905 |
| Core | 61,300 | 20,149 | 69,090 | 22,184 |
| Core loader | 106 | 101 | 111 | 105 |
| Lazy conversation | 8,441 | 3,331 | 8,416 | 3,296 |
| Theme engine | 44,878 | 15,148 | 43,634 | 14,545 |
| Total | **284,142** | **85,392** | **284,975** | **85,035** |

Flagged boot: **232,925 raw / 67,194 gzip**. First conversation: **241,341 / 70,490**. Unchanged ceilings: initial 170,000/48,000; boot 240,000/72,000; conversation 250,000/76,000; total 285,000/87,000. Combined raw headroom is only **25 bytes**; future runtime additions need further reduction.

## Ranked remaining release/verification work

1. Deploy migration/backend/assets, deliberately activate/configure the test shop, then repeat storefront/Admin live flows. None of the old live failures was relabeled as fixed live.
2. Activate the new order-status block/network capability and test real native rendering, token authentication, navigation and next-cart acceptance.
3. Supply actual merchant campaign/notice/reward facts. Proof must stay hidden below five real eligible orders; never manufacture inputs for a screenshot. The synchronous proof read is bounded to 200 orders and 25 lines per order; larger/incomplete windows hide until a complete aggregation is available.
4. Verify Shopify-applied discount receipt and signed-order code-use attribution. Click tracking is not verified discount use or incremental revenue; no such dashboard claim was added.
5. Re-verify deployed AI/product-card behavior. Existing QA billing flags/subscriptions/Redis configuration were not changed; provider availability/cost and Redis remain dependencies.
6. Extend real theme/accessibility/market coverage. Mobile toast remains unsupported; launcher and exit bottom sheet cover mobile.
7. Preserve size limits and reduce shared/static output before future runtime growth.

Continue from measured failures after release, preserving the passing cart-refresh path. Use the shared recommendation service, voice/handoff and truth guards already present; do not add another recommendation client.
