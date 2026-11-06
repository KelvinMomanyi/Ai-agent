# Revised Phase 5: origin and placement reporting

Plan recorded before source edits, 6 November 2026. Revised Phase 4 passed 654
tests in 89 files. Earlier Phase 4A/4 working-tree changes remain intact. Original
Phase 5 already implements assignment, signed order linkage, maturity/sample/
linkage gates, the unchanged two-proportion test, the pause guardrail and monthly
attributed value. This follow-up adds the reporting splits requested by the
pairing-autopilot/theme update; it does not rebuild the experiment.

- Add one tenant-scoped, date-filtered SQL aggregate over existing Offer,
  ShopperEvent and signed-webhook conversion Event data. Reuse the cached holdout
  report and the existing authenticated Home/Analytics loaders. Do not add a
  table, migration, background job, SDK instrumentation or live network call.
- Use the immutable server-written Offer.pairingProvenance snapshot, matched to
  that offer's served product IDs. Never infer historical origin from a mutable
  ProductRelationship or trust a browser origin/status/confidence value. Classify
  each displayed cart offer into exactly one bucket: merchant, autopilot,
  affinity, catalog, mixed origins, or unknown/incomplete legacy provenance.
- Use the first session-owned recorded impression for placement. Only a literal
  verified=true plus an allowed strategy yields Cart drawer, Cart page or Floating
  card. Missing/unverified/unknown metadata stays Unknown. Later recovery or
  duplicate reports must not count the same offer twice. ThemeProfile/ThemeReport
  retention or profile changes must not rewrite historical classification.
- Count displayed -> clicked -> confirmed cart add -> purchased in sequence,
  once per offer. Purchases/revenue require a signed order's attributed line,
  matching this tenant's offer and a served/confirmed-added product. Keep
  discounted line revenue separate by currency and label it attributed. Deduplicate
  order ingestion and prevent event/line/origin join fan-out.
- Show two bounded tables in a shared RecommendationBreakdownCard, included by
  HoldoutMeasurementCard on both Home and Analytics. Show explicit rate
  denominators and counts; show Not enough data yet below a named display
  threshold. Explain mixed/unknown coverage, offer-level units and the difference
  from the whole-system randomized holdout. No per-origin/placement lift, winner,
  confidence or incremental-revenue claim.
- Add real-SQL fixtures with PGlite for provenance, placement, ordering, duplicate
  events/orders, currency separation, ranges, tenant/session boundaries and
  deletion. Add reporting-cache integration and server-rendered UI tests, then
  run npm.cmd run verify. Apply the React best-practices skill to the two shared
  components. Existing statistical math and recommendation selection stay intact.

Assumptions: breakdowns cover cart recommendation offers created in the chosen
date range whose recorded display also falls inside it. They describe served
offer composition, not individual-card visibility; a client may drop an unavailable
card during market-price hydration. This limitation is explained in the UI.
Distinct offers can come from the same shopper and are not randomized subgroups.
No historical metadata or holdout linkage will be invented or backfilled.

## Delivered and files changed

| Files | Change |
| --- | --- |
| `app/models/recommendationBreakdown.server.ts` | A single date/tenant-filtered SQL aggregate over existing tables; fixed origin/placement partitions and a named 30-display descriptive-rate threshold. No raw history is sent to the browser. |
| `app/models/holdoutAnalytics.server.ts` | Run the breakdown query in parallel with existing aggregates; attach the summary to the existing report. Use a v2 cache namespace so old cached shapes cannot omit it. Existing shop/date caching and entitlement behavior remain in effect. |
| `app/components/dashboard/RecommendationBreakdownCard.tsx` | Two Polaris tables with counts, explicit rate denominators, attributed revenue separated by currency, coverage labels and clear limits. |
| `app/components/dashboard/HoldoutMeasurementCard.tsx` | Include the shared breakdown card on Home and Analytics through the existing component; no new route or data-fetching effect. |
| `app/models/recommendationBreakdown.integration.test.ts` | 28 tests using real PostgreSQL-compatible SQL execution against isolated PGlite data. |
| `app/components/dashboard/RecommendationBreakdownCard.test.ts` | Six server-rendered UI/summary tests for empty data, thresholds, denominators, unknown/mixed labels and currencies. |
| `app/models/holdoutAnalytics.server.test.ts` | One added integration regression proving the cached report includes breakdowns while preserving the existing whole-system result; adapt the free-plan aggregate count. |
| `docs/codex-phase-5.md`, this report | Historical follow-up link, plan, implementation details, verification and manual acceptance. |

No schema, migration, dependency, scope, webhook, environment variable or SDK source
change was needed. The full gate still rebuilds and size-checks the existing SDK
assets. No deployment or production-data operation was performed.

## Reporting method and limits

The unit is one displayed **cart recommendation offer**, not a shopper, order or
individually visible card. Only upsell_drawer offers created within [from,to) and
with a session-owned impression within that range enter these tables. Events
before the offer was generated are ignored. The existing main funnel also covers
optional browsing/bundle offers and has its original legacy event requirements;
monthly value uses a calendar month and a broader attributed-line population.
Those totals need not match these stricter cart-only, product-linked breakdowns.

Origin is derived exclusively from the saved Offer.pairingProvenance and its
served product IDs, with the expected approval/fallback status. A snapshot must
cover every served product to classify it. Duplicate, missing, invalid or partial
snapshot records yield Unknown. One valid origin yields its own row; several
yield Mixed origins. Each table partitions offers once, so neither multi-product
offers nor repeated impressions duplicate their funnel counts. This describes
the server-served composition; it does not pretend to know which individual cards
were visible or dropped during active-market price hydration.

Placement uses the first stored impression ordered by event timestamp and row ID.
Only literal boolean verified=true plus native_drawer, cart_page or floating_card
yields a named placement. Strings pretending to be booleans, absent fields and
unrecognized strategies are Unknown. A later recovery report does not count a
second offer. ThemeProfile changes or deletion/retention of ThemeReport samples
have no effect. This is signed-session-owned, browser-reported evidence, not an
independent attestation; a visitor can forge their own telemetry. Browser fields
never select pairing origin or change the theme's compatibility profile here.

Clicks must follow display; confirmed recommendation-added events must follow
clicks and name a served product. Purchases and revenue require a conversion Event
written by the signed Shopify order webhook, a verified attributed offer link,
and a matching line for that confirmed-added product after its add. Browser
purchase/value events cannot supply revenue. Duplicate order IDs use one stored
record; multiple legitimate lines remain distinct. SQL grouping prevents event,
origin and line joins from multiplying counts or revenue.

Revenue = max(0, line price * quantity - line discount), before subsequent returns,
shipping and taxes. Only valid nonnegative monetary values and positive integer
quantities qualify. Currencies remain separate; an unknown currency stays unknown,
without substituting shop currency. These are attributed amounts, never incremental
revenue. Missing event/order linkage can undercount, including otherwise valid
orders without the full observed funnel.

Descriptive rates appear only at MIN_BREAKDOWN_DISPLAYS=30 and when their own
denominator is nonzero. Below that, the UI shows counts and Not enough data yet.
This is a presentation policy, not a power calculation or significance test.
There is no subgroup lift, winner, p-value or causal claim. The whole-system
holdout assignment, seven-day maturity window, 200/20/20 sample requirements,
linkage coverage gates, z-test and material-decline pause action are unchanged.
The two tables must not be summed together or treated as randomized groups.

The descriptive tables are available alongside the ordinary attributed funnel.
The existing Pro holdout-report entitlement is still checked server-side; adding
the tables does not reveal the paid randomized comparison to a free shop.

## Verification

The targeted command
`npm.cmd test -- app/models/recommendationBreakdown.integration.test.ts app/components/dashboard/RecommendationBreakdownCard.test.ts app/models/holdoutAnalytics.server.test.ts`
passed 48 tests across three files. This includes 35 added cases across two new
files and the existing holdout suite. SQL tests cover all origin/placement buckets,
legacy/partial snapshots, forged client metadata, exact tenant/session joins,
ordering, product/order linkage, malformed monetary fields, repeated events/orders,
multiple lines/currencies, date ranges, generated-but-unseen offers and tenant
deletion while preserving another shop. A payload scan excludes IDs, provenance,
confidence, evidence, cost, margin and inventory fields from the serialized summary.

React best-practices review: data loading stays on the authenticated server and
queries run in parallel; the new component is presentational, without effects,
duplicated state, client fetches or dependencies. Both screens reuse it. Polaris
table headings and explicit denominators provide accessible structure; sample,
currency and empty states are tested through server rendering. An initial lint
failure in the rendering test's createElement setup was corrected before the
final gate.

Final gate results, 6 November 2026:

| Command | Result |
| --- | --- |
| Targeted reporting SQL/UI/holdout command above | Passed: 48 tests in three files. |
| `npm.cmd run verify` | Passed, exit 0: typecheck, lint, 689 tests in 91 files, SDK build/size check, Prisma generation and production client/server builds. Net increase: 35 tests and two files over revised Phase 4. |
| `npm.cmd run build:sdk` (through verify/build) | Passed; existing main SDK and `aovboost-theme-engine-B_pv7Vzj.js` rebuilt without source changes in this phase. |
| `prisma generate` (through verify/build) | Passed, Prisma Client 6.19.3; no new schema change. |
| `node scripts/check-sdk-size.mjs` | Passed: main 158,670 bytes; combined 210,625 bytes; combined gzip 58,597 bytes, unchanged from the previous phase and within the enforced budgets. |
| `git diff --check` | Passed; no whitespace errors. |

Existing nonfatal React Router future-flag, Rollup annotation and mixed static/
dynamic import warnings remain. Verification used approved filesystem access
because Vite config loading is blocked in the restricted Windows sandbox. Standard
build tools auto-load their environment; no credential file or value was read or
printed by this work. No commit or deployment was created.

## Manual release and acceptance

1. Review this follow-up and the preserved earlier working-tree changes. This
   phase adds no migration. If the preceding Phase 4A migration/server/SDK release
   is still pending, apply it through your normal development/staging/release
   process before releasing this backend/UI. No production migration or deploy
   was run here.
2. No new service, secret, scope or webhook is required. The cache namespace
   changes automatically; no manual cache flush or historical backfill is needed.
3. In a dev shop, display and accept a merchant-only offer and an autopilot-only
   offer, then complete orders. Check the corresponding rows on Home and Analytics.
   Display a mixed offer and confirm it occupies one Mixed origins row. Change
   the live pair's approval afterward and confirm old provenance remains unchanged.
4. Check verified cart-drawer/cart-page/floating displays and an older impression
   with no metadata. The latter must remain Unknown. Test recovery/repeated events
   without a second offer count. The Phase 4A preview must not enter these tables.
5. Select a bounded Analytics date range. Verify counts use that range and amounts
   remain separate by currency. Reconcile differences from the broader main funnel
   and calendar-month value using the cohort and linkage rules above. Below 30
   displayed offers, subgroup rates must remain hidden.
6. Confirm holdout still suppresses offers while tracking orders, a small immature
   sample still shows Not enough data yet, and the existing pause guardrail works.
   Use test fixtures for large samples; do not manufacture production performance.
   Check the new tables on mobile and with keyboard navigation.

No authenticated live store/browser acceptance was available. No measured business
lift or merchant-demand gate is claimed. Deliberately unchanged: recommendation
selection, AI/provider budgets, authentication, holdout math/assignment, billing,
pairing learning, theme reports, storefront SDK, post-purchase, bundle Function,
inventory and reorder planning. Those future product gates still apply.
