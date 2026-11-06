# Phase 5: honest holdout measurement

Later follow-up: [revised Phase 5](codex-phase-5-revised.md) adds descriptive
pair-origin and placement breakdowns. The record below describes the original
holdout implementation at its completion.

Plan recorded before implementation, 5 November 2026. Phase 4 passed 447 tests in
63 files. Earlier worktree changes and user files are preserved.

- Add AppSettings.holdoutEnabled=false and holdoutPercent=10 (integer 0–30), plus
  a version increment when the experiment configuration changes. Existing and
  new shops stay off until the merchant explicitly enables measurement.
- Assign deterministically by shop and the authenticated anonymous session ID.
  Preserve that ID across signed-token renewal; only a valid signed previous
  token may supply a renewal identity. Expired tokens remain invalid for API
  requests. Return the assignment in the signed token and bootstrap response.
- Add two tenant tables: immutable HoldoutEnrollment snapshots by shop/session/
  version and idempotent HoldoutOrder rows by shop/order. Use composite tenant
  foreign keys, indexes and explicit purge entries with uninstall/redact tests.
  They are needed because existing conversion events only link accepted offers
  and cannot preserve assignment history when settings change.
- Suppress recommendations before selection for holdout shoppers, while keeping
  their authenticated session/events/cart tracking identical. Refresh client
  suppression from server responses so turning holdout off releases everyone.
  Leave recommendation selection and existing z-test arithmetic unchanged.
- Link both arms through the same invisible, signed-purpose cart attribute,
  using the existing locale-aware Shopify Ajax cart API. It updates metadata
  after a verified cart read, never waits in the original add request, never
  changes lines/prices/discounts and never sends an authentication bearer token
  to an order. Validate the link against this shop's enrollment in the signed
  orders/create webhook, including holdout orders with no offer ID.
- Compare all assigned sessions in each arm (intention to treat), not only
  sessions that saw an offer. Keep observed impressions separately. Use a fixed
  seven-day follow-up and mature cohorts for the lift comparison; minimum sample
  and event-count constants, balanced cart-link coverage and the existing
  two-proportion test gate any displayed lift. AOV/revenue per session are
  descriptive; do not claim statistically proven revenue lift from a conversion
  test. Separate currencies; prefer signed order shop-money amounts.
- Add cached, SQL-aggregated date-range reports and a strict offer funnel with
  displayed -> clicked -> confirmed cart add -> purchased denominators. Generated
  decisions are never impressions. Replace observational AOV-lift headline cards
  with measured conversion results or "Not enough data yet".
- Add shared Home/Analytics measurement cards, a material/significant conversion
  drop warning and an authenticated one-click cart recommendation pause. Include
  a calendar-month attributed value card with an optional future plan-price slot.
- Test stable assignment/renewal, signed linkage and duplicate orders, suppression
  with continued tracking, threshold and z-test parity, currencies, SQL tenant
  boundaries, purge, SDK metadata-only linking and response privacy. Rebuild the
  SDK asset and leave npm run verify green. No production migration/deploy.

Expected files: Prisma schema/additive migration; new holdout assignment,
measurement reporting and shared admin card modules; api.session/config/offer,
chat/live guards, orders webhook and event ingestion; minimal signed-session
claim/renewal extensions; admin Home/Analytics/settings; SDK session/event/poller/
manager plus a metadata-only cart linker; tests and this report. No changes to
the candidate selector, AI ranker, z-test math, prices, discount Function,
post-purchase signing, billing, inventory or reorder planning.

Shopify's current [Cart API documentation](https://shopify.dev/docs/api/ajax/reference/cart#private-cart-attributes)
was checked: private cart attributes use a double-underscore prefix, are hidden
from storefront Liquid/Ajax output and checkout, and remain visible in merchant
order details. The linkage key will use both leading/trailing double underscores
for compatibility. Post-purchase offers are disabled for both arms while this
experiment is enabled because that separate checkout identity is unavailable
before its signed order webhook; this restriction is explained in setup.

## Delivered

Holdout is an explicit opt-in for every shop, including new installs. Settings
validate an integer 0–30 percent and require analytics. Changing enablement or
allocation starts a new version; the current report never pools versions.
The pause action disables cart recommendations and holdout and closes that
version. It does not disable other optional features for existing merchants.

Assignment hashes the shop plus the server-authenticated anonymous browser ID.
The signed session includes the arm/version/allocation. Renewal preserves the
ID only when the previous token's signature and shop are valid; an expired
token still cannot authenticate an ordinary API request. Clearing browser
storage creates a new identity; identities are not linked across devices.

Both arms enroll and track authenticated cart/session activity identically.
The holdout response returns before candidate selection, AI or offer creation;
client fallback, widgets, chat recommendations and live prompts also honor it.
Turning measurement off removes suppression on a subsequent personalized
config/session/offer response. Selection order and AI ranking are unchanged.
Post-purchase offers are withheld for both groups during measurement, since
their checkout identity cannot safely recover the browser assignment there.

The SDK writes only `__aovboost_measurement__` cart metadata after a successful,
nonempty cart read. This background request has a two-second timeout and at most
three attempts per assignment per page; it never delays the original add. Its
own metadata request is ignored by cart mutation detection. The value is a
shop-bound, purpose-specific signature over enrollment identity and version,
not an API bearer credential. The signed orders/create webhook validates it,
checks the tenant's enrollment, and stores an order even when no offer was
accepted or generated. A unique shop/order constraint prevents duplicates.
Shop-money revenue is preferred; invalid amounts, currencies and dates are
discarded. The original attributed-offer path remains separate.

## Measurement method and limits

- The experimental unit is one saved anonymous browser identity per version,
  called a shopper session in the dashboard. Assignment is intention to treat:
  all assigned sessions enter the comparison, whether a card appeared or not.
- Enrollment begins a fixed seven-day observation window. Only fully mature
  enrollments whose start falls in the selected date range enter the comparison.
  Later orders outside that window are excluded. The same browser is not
  enrolled repeatedly in the same version. Recent enrollments appear as pending.
- Conversion = sessions with at least one linked order / assigned sessions.
  Orders can exceed converting sessions. AOV = order revenue / orders; revenue
  per session = order revenue / assigned sessions. Mixed currencies withhold
  monetary comparisons rather than combine them. Missing legacy currency is
  displayed as unavailable without breaking the page.
- Before any lift percentage appears, each arm needs at least 200 mature
  sessions, 20 converting sessions and 20 nonconverting sessions. Each also
  needs at least 95% acknowledged cart linkage among observed nonempty carts,
  with no more than a two-percentage-point gap between arms. These are named
  constants in holdoutAnalytics.server.ts, not a promise of adequate power for
  every merchant's baseline conversion rate.
- The existing two-proportion z-test is reused without changing its arithmetic.
  Lift = exposed conversion / holdout conversion − 1, shown only after the
  thresholds and that significance test pass. A significant relative conversion
  decline of at least 10% raises the pause warning. Repeatedly inspecting results
  is not a sequential testing correction; treat the result as experimental
  evidence rather than a guaranteed causal revenue claim.
- AOV and revenue per session remain descriptive. A significant conversion
  difference does not establish significant revenue lift. Attributed line
  revenue is explicitly labeled attributed; no incremental revenue total is
  calculated.
- The funnel requires an observed visible impression, then click, then a
  successful recommendation cart add, then a signed order linked to that offer.
  Each stage reports its previous-stage denominator. Generated decisions and
  old rows without the required events do not count as display or confirmation.
- Monthly value uses the UTC calendar month ending at the report's selected end
  date, sums only verified attributed product lines after line discounts, and
  separates currencies. It excludes shipping, taxes and subsequent returns.
  Plan price is an optional UI slot; billing is still Phase 6.

Consent, disabled analytics, blocked scripts, storage resets, fast checkout
before a background cart update, or a failed metadata/event request can lose
linkage. Both arms use the same mechanism, and linkage gates withhold lift when
observed coverage is poor or imbalanced; those gates cannot prove that every
unobserved checkout was captured. Accelerated checkout paths and the exact
merchant theme must be checked on a development store before enabling a pilot.
Keep the signing secret consistent across backend instances; rotating it
invalidates outstanding measurement links, like other signed session material.
Do not infer historical holdout data from old attributed orders.

## Files changed in this phase

- Data: prisma/schema.prisma and the new additive, idempotent migration
  `prisma/migrations/20261105150000_holdout_measurement/migration.sql`.
  HoldoutEnrollment and HoldoutOrder use composite tenant foreign keys and
  indexes. Both are explicitly included in deleteShopData(), in addition to
  their session/enrollment cascade behavior.
- Server: shared/holdout.ts; app/utils/measurementLink.server.ts,
  storefrontAuth.server.ts and storefrontSessionRecovery.server.ts;
  app/models/holdout.server.ts, holdoutAnalytics.server.ts,
  measurementAdmin.server.ts, attribution.server.ts, event.server.ts and
  settings.server.ts. analytics.server.ts only exports the existing z-test.
- Routes: api.session, api.config, api.offer, api.chat, api.live,
  api.post-purchase-offer and api.webhooks; app._index, app.analytics and
  app.settings. Shared UI: app/components/dashboard/HoldoutMeasurementCard.tsx.
- SDK: measurementCartLink.ts; sessionManager.ts, eventBus.ts, index.ts,
  offerPoller.ts, liveUpdates.ts, shopifyCart.ts; widgetManager.ts,
  ChatWidget.ts, RecStrip.ts and BundleWidget.ts. RecStrip/BundleWidget only add
  successful-cart-add instrumentation. The generated theme asset is included
  at extensions/aovboost-storefront/assets/aovboost-sdk.js.
- Tests: new holdout.server.test.ts, holdoutAnalytics.server.test.ts and
  holdout.integration.test.ts under app/models; app/measurement-admin.test.ts;
  storefront-sdk/src/measurementCartLink.test.ts. Extended
  app/storefront-pairing-responses.test.ts and app/onboarding-routes.test.ts;
  updated purge fixtures in data-webhook.server.test.ts and
  productRelationships.integration.test.ts. This report records the method and
  remaining manual checks.

## Validation results

- `npm.cmd exec -- prisma generate`: passed after the additive schema change.
- `npm.cmd run typecheck`: passed during implementation and in the final gate.
- Targeted Phase 5 tests initially exposed a real PostgreSQL parameter-type
  ambiguity in the maturity cutoff. The cutoff is now computed as a Date before
  binding it; both affected real-SQL tests pass in the final full suite.
- Scoped `npm.cmd exec -- prettier --write ...`: passed for changed source/test
  files, including the final measurement card and reporting module.
- `npm.cmd run verify`: exit 0, **489 tests in 68 files**; typecheck, lint, SDK
  build, Prisma generation, production browser build and server build all pass.
  This adds 42 tests across five new test files and existing route suites over
  Phase 4's 447 tests. Tests cover stable assignment and signed renewal,
  suppression without offers, signed holdout order linkage, duplicate orders,
  fixed follow-up, minimum samples, z-test parity, balanced linkage, currencies,
  real SQL tenancy, idempotent migration, composite foreign keys, cascade and
  explicit uninstall/redact deletion, authenticated pause and SDK behavior.
- The generated SDK is **146.81 kB / 39.48 kB gzip**. It includes metadata linkage
  and successful-add instrumentation. No dependency versions changed.
- `git diff --check`: exit 0. Package manifests, Shopify configuration, catalog
  guard core and the discount/post-purchase extension source have no diff.
  Existing React Router future-flag/empty server-route chunk notices remain
  informational. Standard tooling auto-loads environment files; no credential
  file or value was read, printed or committed by this work.

## Rollout and manual acceptance

No deployment, production migration or production-data operation was run.
Earlier Phase 2–4 worktree changes are retained; this phase does not commit or
discard them. No dependency, scope, webhook subscription, discount Function,
post-purchase signing, billing, inventory or reorder feature was changed.

After reviewing the diff, apply the pending additive migrations through the
normal `prisma migrate deploy` release process on a development environment
first. Release the backend and regenerated SDK asset together before enabling
holdout. Deploy the theme extension with the existing Shopify release workflow
(`npm run deploy`) yourself; this command was not run here. No new environment
variables or Shopify permissions are needed.

1. Enable analytics and holdout on a development shop. Use separate anonymous
   browser profiles until both assigned groups are represented. Check the
   signed bootstrap assignment; the holdout browser should see no app
   recommendations while authenticated session/cart events still arrive.
2. Add a normal product and complete an order in each group, including a holdout
   order with no recommendation line. Check the private measurement attribute
   in the Shopify order's attributes and verify each HoldoutOrder joins its own
   shop/session/version. Replay the signed webhook and confirm one stored order.
   Check ordinary and accelerated checkout paths used by the merchant.
3. Before sufficient mature data exists, confirm "Not enough data yet" and no
   lift percentage. Use the tested fixture database, not invented production
   data, to inspect the negative-conversion warning and pause behavior.
4. Turn holdout off, refresh personalized settings or trigger a new eligible
   cart request, and confirm both browsers can receive recommendations again.
   Test disabling the network during metadata linking: cart adds and checkout
   must stay usable. Check mobile and keyboard use of the admin controls.
5. Confirm both new tables disappear for a development-shop uninstall/redact
   while a second shop's rows remain. Automated tests already cover this flow.

Live Shopify browser/order acceptance remains manual because no authenticated
development store was available. A green local gate does not claim a measured
business lift or satisfy the merchant-demand gate before inventory work.
