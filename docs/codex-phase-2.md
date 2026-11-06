# Phase 2: onboarding to a working offer

Implementation plan recorded before editing on 5 November 2026. Phase 1's last
gate passed 255 tests in 41 files. Its uncommitted implementation is preserved.

- Reuse `CatalogSyncJob` and the existing chunk/lease pipeline. Add a
  create-if-absent start mode, start empty shops on authenticated admin entry,
  resume one bounded chunk, and read Home progress from PostgreSQL. Browser
  continuation remains on Home; no cron or queue is added.
- A successful empty fetch is already recorded durably by the job's zero
  `syncedCount` and transition out of `fetching`; completion retains that result.
  Reuse this record instead of adding a competing empty-store flag or TTL.
- Compute checklist states server-side. Pairing approval remains disabled by a
  code feature flag until Phase 3. Recent authenticated connection/session
  activity verifies connectivity, not an offer impression or a purchase.
- Store one connection receipt per shop in the existing Event table on successful
  signed storefront session issuance, and also inspect recent ShopperSession
  activity. Existing tenant purge covers both tables. No shopper identifier is
  stored in the connection receipt.
- Add one nullable AppSettings timestamp for explicit merchant acknowledgement
  after a read-only, catalog-guarded admin preview. The preview loader writes no
  offers, events, sessions or recommendation outcomes and makes no AI calls.
- Replace the four GID text areas with reusable App Bridge product/collection
  pickers while preserving CSV form values and existing String[] storage. Move
  provider status and advanced tuning behind collapsed Advanced controls.
- Test first-start concurrency/idempotency, empty-store persistence, cursor
  resume, checklist states, preview isolation and picker round-tripping; run the
  full quality gate and inspect the SDK artifact diff.

Relevant files: `app/jobs/aovboost.server.ts`, admin parent/Home/settings routes,
`api.sync.tsx`, `api.session.tsx`, new onboarding/preview helpers and components,
and an additive Prisma migration. Pagination, lease internals, the storefront
SDK, bundles, post-purchase code and recommendation behavior remain unchanged.

Shopify documentation checked:

- [Theme app extension configuration](https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/configuration):
  use the app API key and block filename in the embed deep link. The TOML has a
  name and UID, but no separate handle; `blocks/aovboost.liquid` supplies
  `aovboost`. The deprecated extension UUID is unnecessary.
- [Resource Picker API](https://shopify.dev/docs/api/app-bridge-library/apis/resource-picker):
  preselect with `selectionIds`; confirmation returns an array, cancellation
  returns undefined. Only IDs and display titles are retained from selection.

## Delivered behavior

The parent admin loader initializes empty shops and processes at most one
existing sync chunk per invocation, using the authenticated client. Initial job
creation does not reset an existing cursor or lease; a concurrent Prisma unique
insert collision reloads the winning job. Existing stored catalogs without a job
are left alone. Failed jobs wait for an explicit merchant retry. The existing
pagination and lease implementation remain intact.

Home also performs create-if-absent initialization because parent and child
loaders can run concurrently, then reads durable PostgreSQL progress. The sync
status endpoint now also uses PostgreSQL directly. A completed empty job remains
an empty-store marker without expiration; no automatic repeated fetch occurs.
An empty fetch interrupted during post-processing resumes those phases without
fetching products again. Browser-driven 1.5-second continuation remains, with
copy explaining that closing Home pauses continuation and reopening resumes.
Historical empty state clears when product webhooks populate the catalog; synced
products with no available variants show an availability blocker.

The checklist uses the existing `(shop, lastActivityAt)` ShopperSession and
`(storeId, event, timestamp)` Event indexes for bounded recent-activity lookups.
The signed storefront session endpoint records one anonymous connection receipt
per shop in Event, only after signature/installation checks. Receipt failure does
not break an authenticated session. These receipts are not conversion events,
offer impressions or shopper recommendation outcomes. Existing uninstall/redact
tests assert shop-scoped deletion of both Event and AppSettings, covering the new
receipt and preview marker. No new tenant table or purge path was needed.

`/app/preview` is authenticated and reads real synced products using the existing
catalog ordering and guard. It excludes blocked products/collections, rehydrates
current prices and availability, and renders at most two add-ons. It makes no AI
calls, cart mutations, or writes to Offer, ShopperEvent, ShopperSession or
RecommendationOutcome. Only a separate explicit acknowledgement action saves
`AppSettings.onboardingPreviewedAt`; acknowledgement rechecks that a real preview
is still available. The preview is illustrative: it does not claim a particular
live placement will render. Product selection is bounded to 50 source choices.

All four recommendation product/collection settings use native App Bridge
pickers, preselect existing IDs, retain CSV form submission and String[] database
storage, distinguish cancellation from clearing, and keep raw IDs out of the UI.
Only selected IDs and display titles are retained from picker responses. Provider
status and tuning are in collapsed Advanced settings; the Home loader no longer
returns provider status. Closing Advanced does not reset the form's saved values.

The React best-practices review covered the edited TSX, controlled state,
accessible buttons/selects, picker error recovery, and avoiding shopper/cart side
effects in the preview. Native Shopify pickers manage their own dialog behavior.

## Files changed in Phase 2

- Sync and entry: `app/jobs/aovboost.server.ts`, `app/routes/app.tsx`,
  `app/routes/api.sync.tsx`, `app/routes/app._index.tsx`.
- Setup and connection: `app/models/onboarding.ts`,
  `app/models/onboarding.server.ts`,
  `app/components/dashboard/SetupChecklist.tsx`, `app/routes/api.session.tsx`.
- Preview: `app/models/offerPreview.server.ts`, `app/routes/app.preview.tsx`,
  `prisma/schema.prisma`, and
  `prisma/migrations/20261105120000_onboarding_preview/migration.sql`.
- Settings: `app/routes/app.settings.tsx`,
  `app/components/ResourcePickerField.tsx`, `app/models/resourcePicker.ts`.
- Tests: `app/admin-loader.test.ts`, `app/jobs/aovboost.server.test.ts`,
  `app/models/onboarding.test.ts`, `app/models/onboarding.server.test.ts`,
  `app/models/offerPreview.server.test.ts`, `app/models/resourcePicker.test.ts`,
  `app/onboarding-routes.test.ts`,
  `app/components/ResourcePickerField.test.ts`,
  `app/models/onboardingMigration.test.ts`.
- This report. Phase 1 changes and the user's pre-existing untracked files were
  retained; the worktree remains available for review.

## Migration

Added `20261105120000_onboarding_preview`: one nullable timestamp on AppSettings,
using `ADD COLUMN IF NOT EXISTS`. Existing settings and widget defaults remain
unchanged. The migration is tested twice against an isolated PGlite database,
including preservation of an existing merchant setting. No existing migration
was edited and no production migration ran.

## Commands and validation

- `npm.cmd exec -- prisma generate`: passed; generated local Prisma Client
  6.19.3 for the new nullable field, without applying a migration.
- Scoped `npm.cmd exec -- prettier --write ...`: passed for changed Phase 2
  files. The larger settings diff groups existing tuning cards under Advanced.
- Targeted `npm.cmd test -- ...` across the nine onboarding-related test files:
  initially passed **49 tests**. Additional concurrency/state regressions were
  added during review and included in the final full suite.
- The first full gate caught union-return narrowing in session-route test
  fixtures; those fixture types were corrected. Subsequent gates passed.
- Final `npm.cmd run verify`: **passed** typecheck, lint, **305 tests in 49
  files**, SDK build, Prisma generation, and production client/server builds.
  This adds **50 tests**, with eight new test files and one extended test file,
  over Phase 1's 255 tests in 41 files. Existing SDK/AI and token/compliance
  regressions remain green. Existing build future-flag notices are nonfatal.
- `git diff --check`: passed; existing LF/CRLF notices are nonfatal.
- Scoped `git diff --exit-code -- storefront-sdk extensions shopify.app.toml
  package.json package-lock.json app/models/product.server.ts
  app/models/catalogGuard.server.ts`: passed. The verification build regenerated
  identical SDK assets. Pagination, guards, extensions, dependencies and scopes
  are unchanged.

Coverage includes first-sync concurrency/idempotency and Prisma insert-race
recovery; one bounded page on entry; cursor resume after a simulated two hours
without Redis progress; persisted empty catalogs; active leases and tenant
isolation; checklist thresholds and the 14-day boundary; setup flags; preview
auth, exclusions, availability, response-field allowlisting and no tracking
writes; signed-session connection receipts; picker confirmation, cancellation,
clearing and failure; stored-value round-tripping; and migration idempotence.

Verification required filesystem access outside the sandbox for esbuild, as in
Phase 1. No credential values were inspected or printed. Framework generation
and build commands load environment configuration automatically. Tests use fake
credentials, mocked Shopify transports and isolated local databases.

## Manual release and checks

1. Review the implementation diff. Use the normal reviewed migration/release
   pipeline to apply `20261105120000_onboarding_preview` before the updated
   server uses the generated Prisma client. The existing Vercel build runs
   `prisma migrate deploy`; it was not run here. Old code remains compatible
   with this nullable additive column.
2. No new environment variables, OAuth scopes, services, Shopify webhook
   subscriptions or extension release are required. The existing Shopify app API
   key builds the embed link. The code flag `PAIRINGS_SETUP_ENABLED` remains
   false until Phase 3 supplies approval functionality.
3. In a development store, open the app with a fresh catalog, let the first sync
   start automatically, then close Home mid-sync. Return after two hours and
   confirm the cursor resumes. Check an empty store on repeated visits and
   confirm it waits for products rather than refetching indefinitely.
4. Preview two available real products, confirm shopper offer/impression metrics
   do not change, and explicitly mark the preview reviewed. Save/reopen all four
   picker lists; check cancellation and clearing.
5. Open the theme editor, save the AOVBoost embed, visit the storefront and grant
   tracking consent if required. Return to Home or use Check connection.
   Verified means authenticated activity within 14 days; actual visible offer
   placement must still be checked on the storefront.

Live Shopify admin, native picker and storefront acceptance checks were not run:
no authenticated development-store browser was supplied or opened. Local tests
prove the relevant code paths, not a live installation. No deployment, Shopify
release, production migration or production data mutation was performed.

Deliberately deferred: approved pairing logic (Phase 3), SDK/cart surface changes
(Phase 4), holdout/billing/inventory/reorder work, cron/queue dispatch, full sync
rewrites and changes to bundle/post-purchase behavior. These are outside Phase 2.
