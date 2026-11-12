# November 11 audit follow-up — November 12, 2026

The code changes are implemented locally. This is not a successful production
retest: the configured Redis endpoint does not resolve, billing configuration
is still awaiting the owner's confirmation, and no release has been published.

## Findings and implemented changes

| Audit recommendation | Implementation | Release dependency |
| --- | --- | --- |
| Investigate shared usage and catalog storage | Added `npm run health:check -- newsliderapp.myshopify.com`, a read-only check of PostgreSQL schema/access, product count, Redis connectivity, Lua support and cache/usage key types. Runtime failures log safe, throttled operation/reason categories. | Restore or replace the Redis connection and recheck the deployed environment. |
| Stop returning an empty catalog for cache failures | Cache claims now distinguish acquisition, contention and unavailability. Concurrent local requests share one fill. Cold requests briefly wait for another instance's snapshot; unresolved fills raise a temporary catalog error. Previous snapshots remain usable with the existing fresh product guards. | Healthy shared Redis is still required; no instance-local replacement for distributed claims was added. |
| Make storefront and Preview failures actionable | The offer route returns a no-card HTTP 503 with `catalog_temporarily_unavailable`, no-store and Retry-After headers. Preview shows a temporary failure with a Retry button; it does not suggest changing exclusions or sync state for an outage. A failed preview cannot be marked reviewed. | Retest real eligible offers after storage recovery. |
| Repair embedded navigation | Configured a Polaris link adapter using React Router for internal paths. Home, Preview back actions, setup links and plan links now use the authenticated router flow. External URLs keep normal anchor behavior. Root errors show recovery instructions instead of `[object Object]` or stack traces. | Verify in the authenticated embedded app after backend release. |
| Harden usage reliability | Failed rollup retry-key cleanup no longer discards successful shared usage results. Corrupt/non-integral/negative counters are refused. If the durable seed cannot be read, the UI marks totals unavailable rather than presenting zero as a verified total. Free-offer and AI limits remain closed during outages. | Healthy database and Redis; no counters were reset or migrated. |
| Configure actual production billing | Added environment-selectable billing source and upgrade mode. Existing Admin Billing API support is retained. Added Shopify App Pricing verification through the Partner API, authenticated shop identity checks, explicit item-handle mappings, durable snapshots, cache isolation and the existing outage grace period. | Confirm the actual source, configured plan handles and required server credentials. No pricing or subscription was changed. |
| Release current storefront SDK | Rebuilt the extension assets from the preserved SDK work and ran size checks. | The generated files are ready for review and publication. The existing Shopify extension remains unchanged until released. |

## Operational evidence

On November 12, the database selected by the local `.env` was reachable. It
contains `MonthlyUsage`, `EntitlementSnapshot` and `Product`; the bounded
tenant-scoped count returned **495 products**. This does not independently prove
that the local database is the production database.

The Redis health check failed with **ENOTFOUND**. A scoped Vercel read confirmed
that the project's `UPSTASH_REDIS_REST_URL` uses the same hostname. The URL was
syntactically valid; no replacement credentials were available. The production
alias still targets READY deployment `dpl_G5ZZuLRN649vYGMrUzf2UHK2vMJV`, commit
`c89dffa54549ecdf82df754446c48437f0897ddf`. No recent warning/error records were
returned for the inspected 50-minute window; this does not establish live health.

The health script never changes data or prints connection strings, tokens,
raw SDK errors, product details or customer data. Select the intended environment
before running it. Run with `node --env-file=<private-env-file>
scripts/check-runtime-health.mjs <shop>` when a different local environment file
is required. Do not copy production secrets into a preview environment.

## Billing configuration

`AOVBOOST_BILLING_SOURCE` accepts `admin_api` or `shopify_app_pricing`; missing
values retain the existing JSON configuration. Unsupported values remain
unconfirmed. `AOVBOOST_UPGRADE_MODE` accepts `shopify_hosted` or `billing_api`.
The app handle remains the existing `ai-agent-21`.

For Shopify App Pricing, provision these server variables in the intended
environment:

- `SHOPIFY_PARTNER_ID`: the numeric Partner ID used in the Partner API endpoint.
- `SHOPIFY_PARTNER_APP_ID`: the app's canonical `gid://shopify/App/...` ID.
- `SHOPIFY_PARTNER_API_TOKEN`: the Partner client credential with Manage apps permission.
- `AOVBOOST_MANAGED_PRO_HANDLES` and `AOVBOOST_MANAGED_FREE_HANDLES`: comma-separated,
  exact item handles from the configured managed plans. These are not display names.

An authenticated Partner response with no contract verifies Free. Missing or
malformed responses, identity mismatches, HTTP/GraphQL errors, absent credentials
and inactive/incomplete items cannot grant a verified plan. Unknown active item
handles retain the existing paid-plan preservation policy and show the unmapped
plan notice. Synthetic test access remains limited to the existing allowed
Development/Preview environments and is never stored as a verified subscription.

The managed implementation follows Shopify's [active subscription reference](https://shopify.dev/docs/api/partner/2026-07/active-subscription)
and [Partner API authentication](https://shopify.dev/docs/api/partner/2026-07).
Both generated GraphQL queries passed Shopify's API 2026-07 schema validation.

## Verification

- `npm run verify`: passed route generation, TypeScript, ESLint, the complete
  regression suite, Prisma generation, SDK builds/size checks and production build.
- Focused regressions cover cold cache contention/recovery, unavailable versus
  empty catalogs, tenant isolation, usage corruption and persistence failures,
  authenticated Preview acknowledgement, storefront HTTP 503 responses, internal
  navigation and managed billing identity/mapping/grace behavior.
- `node --check scripts/check-runtime-health.mjs` and `git diff --check`: passed.
- React review covered the shared Polaris link adapter, forwarded anchor ref,
  external navigation, native keyboard controls, retry loading state and server-only
  billing credentials. No new browser subscription or background polling was added.
- The Shopify UI validator was attempted but targets the newer Polaris web
  component/Preact model and cannot resolve this app's existing Polaris React
  components. The repository's actual React/Polaris types, lint, build and
  navigation regression passed. No UI framework migration was attempted.
- `npm run test:browser`: **16 passed** across desktop and mobile. This covers
  display and one acceptance, restored-cart silence, popup coordination, native
  form redirects, keyboard dismissal, holdout measurement linkage, offer API
  outages and unavailable storefront variants. These are loopback-only simulations.

## Release and live acceptance

1. Restore or replace the actual Upstash service and update the appropriate
   Vercel variables privately. Confirm read/write/Lua permissions through the
   service dashboard. The read-only health script tests connectivity and reads;
   it does not attest to write permissions.
2. Confirm and configure the actual billing integration. For full Pro QA, use
   a Vercel Preview/Development deployment with isolated test database/Redis,
   the intended Shopify development store and the existing test-mode guard.
3. Release the reviewed backend changes to the existing `ai-agent` Vercel
   project. This follow-up did not run a production deployment or migration.
4. Publish the reviewed app configuration and generated extensions with
   `shopify app deploy --version audit-fixes-20261112`. This transmits the
   local app configuration and all extensions for AOVBoost and activates the
   new app version. Obtain the required separate Shopify CLI confirmation first.
5. In authenticated Shopify Admin, navigate Home → Preview → Home and Plan &
   usage without full reloads. Verify Preview has source products, an eligible
   recommendation and accurate usage/plan state.
6. Confirm published SDK bytes match the reviewed asset. On the authorized
   development store, test the real native add, displayed card, acceptance once,
   no recursion, restored-cart silence, desktop/mobile/keyboard placement and
   holdout linkage. Confirm a test payment gateway before submitting a test order;
   verify its webhook, attribution and reporting. A fixture pass cannot establish
   real checkout or incremental revenue.

No merchant product, pairing, exclusion, theme setting, subscription, order,
token or production data was changed during this implementation. Existing
working-tree SDK/browser-test changes were preserved. No paid integration was
provisioned and no extension or backend deployment was published.
