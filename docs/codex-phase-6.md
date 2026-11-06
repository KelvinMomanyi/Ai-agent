# Phase 6: entitlements and cost caps

Plan recorded before implementation, 5 November 2026. Phase 5 passed 489 tests
in 68 files. Previous worktree changes and user files will be preserved.

## Findings and assumptions

No app billing, subscription verification or plan entitlement implementation
exists in app/, shopify.app.toml or the extensions. Matches in generated discount
types concern customer selling plans, not app billing. Prices and the actual
Partner Dashboard setup cannot be established from this repository.

The prompt's statement that both pricing systems always appear in Admin API
activeSubscriptions is outdated. Shopify's current documentation says newer
Shopify App Pricing uses Partner API activeSubscription and no longer sends
app_subscriptions/update notifications. Admin API 2026-07 still supports
currentAppInstallation.activeSubscriptions for Billing API subscriptions and
legacy managed subscriptions. These official sources were checked:

- https://shopify.dev/docs/api/admin-graphql/2026-07/queries/currentAppInstallation
- https://shopify.dev/docs/api/admin-graphql/2026-07/objects/AppSubscription
- https://shopify.dev/docs/api/webhooks/2026-07?reference=toml
- https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing
- https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/redirect-plan-selection-page

The session rule forbids adding new network integrations. No Partner API call
will be added without authorization. The app will distinguish an unconfirmed
billing source from a confirmed absence of a subscription. An unknown source
must not silently classify existing paid merchants as free. The user has been
asked which billing system and exact plan names are in use. Independent work
continues while that answer is pending.

## Implementation plan

- Add editable server-only plan configuration: free/pro, subscription-name
  aliases, monthly displayed-offer and AI-attempt caps, feature flags, billing
  source and upgrade settings. No hard-coded prices. Provisional defaults are
  free: 500 displayed offers / 100 AI attempts per UTC calendar month; pro:
  unlimited displays / 6,000 attempts. Existing daily/global caps still apply.
- Add durable tenant entitlement snapshots and monthly usage rollups in an
  additive, idempotent migration. Include both in explicit uninstall/redact
  deletion and test tenant isolation against real PostgreSQL-compatible SQL.
- Read active subscriptions through the existing Admin client. Cache verified
  results for five minutes, retain last verified entitlements for 24 hours on
  errors, preserve a snapshot during invalidation, and distinguish unknown paid
  subscription names from free. Never refresh a failed result's grace timestamp.
  An unverified shop keeps deterministic recommendations while AI fails closed.
- Add app_subscriptions/update with signature-only validation, invalidating
  cache without refreshing an offline token. Never grant a plan from its payload.
  The five-minute poll remains authoritative even if a webhook is delayed.
- Use atomic Redis monthly counters, deduplicated display receipts and bounded
  pending display reservations. Count only observed impressions, not generated
  decisions. Enforce free capacity before delivering an offer, release unused
  reservations by expiry, and roll counters into PostgreSQL at most once per
  minute during active requests/admin visits. Initialize missing Redis state
  from durable totals. No cron or new service. Fail closed for AI on usage-store
  failure; preserve a paying merchant's deterministic storefront behavior.
- Apply the monthly AI budget at the provider boundary, including fallback
  attempts and legacy/setup/chat entry points, so free users cannot bypass costs.
  Over cap, the existing deterministic fallback remains available.
- Add Plan & usage navigation/page and an admin cap notice. Show verification
  state, UTC month, usage/caps, feature flags and a configured Shopify upgrade
  path. Hosted pricing links require confirmed setup; Billing API creation is
  an explicit authenticated action requiring configured prices, with no live
  mutation in tests or this session.
- Gate holdout reporting and advanced browsing placements through entitlements;
  leave cart selection, z-test math, authentication, discount Function and
  post-purchase signing intact. Inventory/reorder entitlement flags are reserved
  and off; their features remain out of scope.
- Add regression tests for mapping/cache/grace, concurrent counters and display
  deduplication, cap fallback, billing webhook signature/token independence,
  tenant purge, admin upgrade configuration and payload privacy. Rebuild SDK if
  client cap suppression needs a change, then run npm run verify.

Expected files: new plan config, entitlements/usage modules and tests; Prisma
schema/new migration; Redis guarded operations; AI gateway; offer/event routes;
webhook validation/handler/config; Plan & usage UI plus Home/Analytics reporting
gates and cap notice. No production migration, deploy or billing action is run.

## Delivered behavior

The editable server configuration is `app/config/plans.json`. Defaults are:

| Tier | Displayed offers / UTC month | AI provider attempts / UTC month | Holdout reporting | Browsing placements |
| --- | ---: | ---: | --- | --- |
| Free | 500 | 100 | No | No |
| Pro | Unlimited | 6,000 | Yes | Yes |

These are provisional usage allowances, not prices or verified App Store plan
terms. The default aliases are Free/AOVBoost Free and Pro/AOVBoost Pro; replace
them with the actual subscription names before activation. Inventory/reorder
flags are false for both tiers. No price is configured or inferred from the
reported $19 listing.

`billingSource` remains `unconfirmed`, `upgradeMode` remains `unconfigured`, and
`proRecurringPrice` remains null because the owner did not supply the pricing
setup. In this state the app does not make a speculative subscription query or
classify an existing merchant as free. It preserves deterministic offers and
existing placements/report access while paid AI fails closed. This state is
explicitly shown on Home and Plan & usage. It is not a confirmed free or paid
entitlement, and does not constitute billing activation.

For a confirmed Admin API source, only a successful, well-formed subscriptions
query can establish Free. An ACTIVE mapped paid subscription establishes Pro.
An unfamiliar ACTIVE subscription conservatively retains Pro with an admin
mapping warning. Mapped paid subscriptions win over mapped free subscriptions.
Pending/cancelled subscriptions do not grant access. Test subscriptions follow
the same entitlement logic so development-store flows can be tested.

Verified subscription results have a five-minute Redis cache and durable
EntitlementSnapshot. API calls use the existing client, one try and an abort
signal with a 1.5-second query timeout. Cache misses can use a recent durable
snapshot. API/cache errors preserve verified access for up to 24 hours from the
original verification time; failures never renew that grace timestamp. A result
confirmed by Shopify is still usable if saving the snapshot/cache fails. Beyond
grace, deterministic offers stay available but paid AI is withheld. A successful
verification of a genuine cancellation can downgrade immediately.

`app_subscriptions/update` uses the installed SDK's signature validator before
parsing/handling, without an offline session refresh. Its payload never grants a
plan: it invalidates Redis and marks the durable snapshot for refresh. Delayed
or missing legacy webhooks are covered by five-minute expiry. This webhook is
not a replacement for the Partner API for modern Shopify App Pricing.

The new authenticated Plan & usage page shows plan verification, actual usage,
allowances, feature flags, pending display reservations and setup/upgrade state.
Home has a cap/verification notice. Free holdout reporting is withheld server-side
(including arm SQL aggregates); the attributed funnel and value summary remain.
Free browsing offer requests are withheld before selection; the confirmed cart
selector is unchanged. Existing experiment assignment/tracking data is retained
when reporting is unavailable so upgrading does not invent or rewrite a cohort.

The authenticated upgrade action either redirects to the configured Shopify-hosted
selector or creates a configured Billing API subscription and redirects to its
Shopify confirmation URL. The default configuration allows neither. Request data
cannot supply a price, test flag, tier or shop. Confirmation URLs must be HTTPS
on Shopify Admin or the authenticated shop. A merchant still approves any charge
on Shopify. No subscription mutation was sent outside a mocked test.

## Usage accounting, failures and retention

- One observed visible merchandising offer counts once, even if it includes
  multiple products or receives repeated impressions. Generated decisions and
  previews do not increment displayed usage. Owned Offer IDs are validated by
  shop and signed shopper session before counting. Chat messages and live notices
  are not merchandising-offer display units.
- Before a free offer is delivered, an atomic Redis operation reserves capacity
  against displayed plus pending offers. Cached responses must reserve too. A
  successful authenticated impression consumes the reservation and increments
  the counter using a deduplicated offer receipt. Unused reservations expire
  after ten minutes. An over-cap response contains no recommendation; the SDK
  respects it without mounting a local fallback.
- Free offers require analytics enabled so the display allowance is measurable;
  the app does not turn analytics or shopper consent on. Disabling analytics
  withholds new free offers and gives the merchant an admin explanation. Known
  paid and unverified deterministic storefront behavior is preserved.
- Each AI provider attempt, including setup/chat/copy and fallback providers,
  consumes monthly capacity in addition to the existing shared daily and
  concurrency limits. A preflight prevents an already exhausted shop from
  draining the global daily allowance. Atomic monthly admission still runs
  immediately before the provider request. Exhaustion or missing shared state
  uses the existing deterministic fallback, with no provider network request.
- Redis keys share a per-shop/month hash tag for atomic operations. Counters are
  initialized from tenant-scoped MonthlyUsage totals. Active operations claim a
  rollup at most once per minute and persist cumulative values with PostgreSQL
  GREATEST, so delayed/retried rollups cannot replace newer totals. Failed writes
  allow the next active request to retry; counters are not reset. Plan-page visits
  also flush the previous month. There is no cron, queue or background service.
- Redis failure never falls back to per-instance billing counters. Free delivery
  and AI pause while shared limits cannot be verified. Pro/unverified unlimited
  deterministic offers continue. UI usage falls back to durable totals and says
  that they may be stale.
- Counter state lives for 100 days after access. Impression receipts accept only
  offers issued within 31 days, and the admin reads only the current/previous
  usage month. Redact/uninstall explicitly clear six months of counter keys,
  pending/rollup keys and the entitlement cache, plus all durable rows. A failed
  cache cleanup does not prevent PostgreSQL deletion; HTTP 500 asks Shopify to
  retry remaining cleanup without an offline-token refresh.

This is allowance accounting, not metered billing. No usage charge or overage
mutation exists. During normal operation rollups can lag live counters by one
active minute; idle counters remain in Redis until a later request. Losing Redis
state between durable rollups can lose recent counts, and losing deduplication
receipts can recount a retried impression. Browser blocking, failed event
delivery or a display after its reservation expires can also make displayed
usage imperfect. These limits must not be represented as audited billable usage.
Durable individual receipts/outbox reconciliation would be required before
charging for metered overages. No such billing was added.

## Files and migration

- Configuration and server modules: `app/config/plans.json`,
  `app/models/entitlements.server.ts`, `usage.server.ts`, `upgrade.server.ts`.
- Data: `prisma/schema.prisma` and new migration
  `prisma/migrations/20261105160000_plan_entitlements/migration.sql` add
  EntitlementSnapshot (shop primary key) and MonthlyUsage (shop/month primary
  key, nonnegative counters). No existing migration was edited.
- Integration: `app/redis.server.ts`, `app/ai/client.server.ts`,
  `app/models/event.server.ts`, `app/routes/api.offer.tsx`,
  `app/services/data-webhook.server.ts`, `app/routes/api.webhooks.tsx`,
  `shopify.app.toml`. Both new tables are explicit deleteShopData() entries.
- Admin: `app/routes/app.plan.tsx`, `app/routes/app.tsx`,
  `app/routes/app._index.tsx`, `app/routes/app.settings.tsx`,
  `app/models/holdoutAnalytics.server.ts`,
  `app/components/dashboard/HoldoutMeasurementCard.tsx`.
- SDK: `storefront-sdk/src/offerPoller.ts` and its regenerated theme asset
  `extensions/aovboost-storefront/assets/aovboost-sdk.js`.
- New tests: `app/models/entitlements.server.test.ts`, `usage.server.test.ts`,
  `billing.integration.test.ts`; `app/ai/monthlyBudget.server.test.ts`;
  `app/plan-routes.test.ts`.
- Extended tests: data-webhook.server.test.ts, storefront-pairing-responses.test.ts,
  holdoutAnalytics.server.test.ts, client.server.test.ts,
  pairingSuggestions.server.test.ts, cartOfferPoller.test.ts. Existing
  holdout/product-relationship integration purge fixtures include the new tables.

Dependencies, authentication/signature algorithms, offline token handling,
catalog guard, product eligibility/ranking, the z-test arithmetic, post-purchase
signing and the discount Function are unchanged. Earlier phase work and user
files remain uncommitted/preserved. This phase does not build inventory or reorder
features or satisfy their merchant-demand decision gates.

## Validation results

- `npm.cmd exec -- prisma generate`: passed after adding the two tenant models.
- `npm.cmd run typecheck`: passed after correcting the SDK's typed GraphQL
  response-body access in the upgrade handler.
- Targeted `npm.cmd test --` run covering entitlement/usage modules, real SQL,
  plan actions, provider budgets, webhook/offer routes, prior-phase purge and SDK
  regressions: **111 tests across 12 files passed** before final edge-case tests.
- Scoped `npm.cmd exec -- prettier --write ...`: passed for the changed
  TypeScript/TSX/JSON files. React checklist review covered server action auth,
  parallel plan-page reads, form loading state, status messaging and keeping
  subscription/price configuration out of the browser bundle.
- Initial full `npm.cmd run verify`: passed with 527 tests. After the final
  free-analytics/retention changes and two regressions, the required full gate
  was rerun: **exit 0, 529 tests in 73 files**, typecheck/lint/Prisma generation/
  SDK build/production browser and server builds all green. This adds 40 tests
  in five new files and existing suites over Phase 5's 489 tests.
- The regenerated SDK is **146.85 kB / 39.49 kB gzip**. The only SDK logic change
  in this phase is respecting server plan-suppression responses.
- `git diff --check`: exit 0. Package manifests, catalog guard core, discount
  Function and post-purchase extension source are unchanged. The only z-test
  module diff remains Phase 5's export keyword; its math is unchanged.
- The build reports informational React Router future-flag/empty route notices,
  plus Vite's expected mixed static/dynamic server-import notices. No dependency
  update was performed. Standard build/Prisma tooling auto-loads environment
  files; no credential file or value was read, printed or committed by this work.

No live Shopify/Partner API subscription query, charge mutation, production
migration, deploy, development-store browser session or live Upstash validation
was performed. Those are not inferred from mocked tests or local builds.

## Activation and manual acceptance

Billing activation remains dependent on owner information; implementation cannot
verify the Partner Dashboard from this repository.

1. Confirm the actual billing system and exact subscription names. For Billing
   API or a verified legacy Managed Pricing installation, set billingSource to
   `admin_api` and update the aliases. Test a real active paid subscription and
   an app installation with no subscription before allowing Free classification.
   Review the provisional usage allowances against the plan terms.
2. For legacy hosted pricing, set upgradeMode to `shopify_hosted` and verify the
   appHandle from shopify.app.toml. For Billing API upgrades, set upgradeMode to
   `billing_api` and provide proRecurringPrice with the intended numeric amount,
   uppercase currencyCode, EVERY_30_DAYS or ANNUAL interval, and an explicit test
   boolean. Keep test=true for development-store acceptance. Production prices
   require an owner decision; none were supplied or assumed here.
3. If using modern Shopify App Pricing, leave the source unconfirmed until a
   Partner API adapter is separately authorized/configured. Selecting
   `shopify_app_pricing` currently shows unverified access, rather than falsely
   reading Free from Admin API. The pack's prohibition on new network integrations
   prevented adding that service/credentials in this phase. Hosted redirection
   alone does not verify a modern subscription or enforce a confirmed free tier.
4. Review the diff and apply pending additive migrations through the normal
   `prisma migrate deploy` process on a development environment first. Coordinate
   the backend release with the SDK asset. Deploy Shopify-side changes yourself
   (`npm run deploy`) to register app_subscriptions/update and publish the asset.
   No new Shopify scopes, re-approval or environment variables are needed for the
   implemented Admin API path. No deploy/migration command was run here.
5. On the development store, verify free/pro mapping, approval and cancellation,
   a signed subscription-update invalidation, five-minute refresh, and paid
   access during simulated transient API/cache failures. Refresh plan manually
   after approval if the new subscription has not yet invalidated its old cache.
6. Exercise the actual Upstash Lua script with concurrent requests for the last
   free slot; verify exactly one admission, visible-only increment, repeated
   impression deduplication, reservation expiry, UTC rollover and durable rollup.
   Local tests verify the service/Redis contract and real SQL, not a live Upstash
   server. Disable analytics on Free and verify the admin notice/no new offers.
7. Exhaust the AI allowance and confirm deterministic cart recommendations still
   render. Exhaust display allowance and confirm a clear admin notice, no SDK
   fallback offer, and a usable original cart/checkout. Check both tenant tables
   and their cache keys are removed on dev-shop uninstall/redact while another
   tenant remains. No live-store or billing mutation acceptance was performed.
