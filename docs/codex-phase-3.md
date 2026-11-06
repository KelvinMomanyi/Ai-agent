# Phase 3: merchant-approved product pairings

Plan recorded before implementation on 5 November 2026. Phase 2's full gate
passed 305 tests in 49 files. Existing worktree changes are preserved.

- Add the generic/beauty_haircare setting and a tenant-scoped ProductRelationship
  table with both composite Product foreign keys, cascade deletion, indexes and
  explicit kind/status/origin enums. Store deterministic confidence for the
  requested high-confidence bulk approval; it is not a predicted conversion rate.
- Add an admin-run suggestion job, bounded to three source products per request,
  eight allowlisted AI candidates per source and five stored suggestions. It
  needs no shopper traffic. Use routine-stage, vendor, collection and verified
  order-affinity evidence; one existing gateway invocation per batch, with its
  provider chain, deadlines, daily budgets and concurrency reservations intact.
  AI may order allowed IDs and choose an exact grounded reason template.
- Preserve approved/rejected merchant decisions when refreshing suggestions.
  Approval is always explicit; no auto-approval toggle is introduced. Changing
  the preset affects regenerated suggestions and never changes approved pairs.
- Add /app/pairings with top-50 order counts, search, approve/reject/replace,
  native resource selection, per-source exclusions, bulk approval and coverage.
  Enable the Phase 2 pairing checklist step and add the preset in settings.
- Make approved complements precede verified co-purchases and catalog fallback.
  Pending/rejected pairs cannot leak through fallback; exclusions win across the
  cart context. The decision engine must use the selected candidates rather than
  rebuild another list. Revalidate cached decisions against current candidates
  and pair restrictions, then retain the existing catalog guard.
- Keep merchant cost, margin and raw inventory out of storefront responses. The
  current widget converter includes variant quantityAvailable, so remove private
  signals at the offer serialization boundary without changing guard internals
  or the SDK. Config/session payloads remain explicit allowlists.
- Add regressions for precedence, exclusions, unapproved pairs, AI allowlists and
  caps, tenant boundaries, cascade deletion, purge and response serialization.
  Run the full verify gate. No production migration or deployment will run.

No bundle-discount Function, post-purchase signing, authentication, SDK or
inventory/reorder work is included. The existing code, rather than older audit
wording, determines integration points. In particular, the decision engine
currently rebuilds affinities and must be connected to the authoritative list.

## Delivered behavior

`/app/pairings` lists the top 50 synced products by recorded lifetime order count,
with alphabetical fill for products without orders, and catalog search. Merchants
can generate suggestions, approve/reject them, add or replace a target through
the native App Bridge product picker, exclude a target for a source product, and
remove an exclusion. All actions authenticate the admin and scope database
operations to the authenticated shop. Replacement marks the original pair
rejected. Removing an exclusion does not silently approve a previously rejected
pair. No product or collection IDs are entered as text.

Generation is an explicit admin job, independent of shopper traffic. Each
request handles at most three source products, reads at most 40 related and 20
co-purchase target products per source, ranks at most eight candidates per source,
and stores at most five suggestions. The top-50 job continues in browser batches
with a pause/resume button; closing the page stops further requests. Completed
batches are stored in PostgreSQL. Re-running refreshes only suggested complements
and preserves approved/rejected decisions. The remaining browser work list is
not a separate durable job; a merchant can rerun generation after leaving.

There is at most one invocation of the existing AI gateway per batch. Its
provider chain, timeouts, abort handling, daily budgets and concurrency limits
remain intact. Candidates are determined before AI. Returned source-target pairs
must be exact allowlist entries, duplicates are discarded, and a returned reason
must exactly match one of that pair's grounded templates. Otherwise the template
is restored. Unranked entries retain deterministic order. Disabled, unavailable,
invalid or capped AI produces deterministic suggestions. Generated rows are
always `suggested`; none are automatically approved.

The stored confidence is a deterministic evidence score, not a sales probability.
Bulk approval requires an explicit merchant action, considers at most 250 strong
suggestions for the top 50 products, and rechecks catalog availability, blocked
products, excluded collections and source-specific exclusions. The threshold is
0.85; three or more recorded co-purchases score 0.92, and a routine complement
with shared brand/collection evidence scores 0.90. AI cannot raise these scores.
Deterministic suggestions use the available `affinity` origin for catalog/routine
evidence as well as order evidence; this does not claim every suggestion was
co-purchased. Reasons distinguish the actual evidence.

Settings now offer Generic and Beauty & haircare. The saved default is Generic
for new and existing merchants. A preset switch affects regenerated suggestions,
preserves approvals/rejections and is checked again before a generation batch
commits. The Home checklist's pairing step is enabled and completes after an
approved complement exists. Coverage explicitly counts approved source products,
not guaranteed live availability. The admin preview uses the same selection and
reasons while retaining its read-only shopper-metrics behavior.

Cart/product candidate order is approved complements, verified co-purchases
(`orderCount > 0`, `score > 0`), then the existing catalog fallback. Preferred and
priority products influence the fallback tier without displacing approvals.
Fresh catalog hydration and the existing catalog guard enforce current prices,
variant validity and availability. Blocked products, excluded collections,
source/cart products and matching pending/rejected relationships are removed.
Every `exclude` relationship wins, regardless of status, across the active source
and cart context. Upgrade relationships are stored but never used to perform a
replacement or served as a complementary recommendation.

The decision engine now renders the selected candidate order and stored reason
instead of constructing another catalog list. Product-card copy uses existing
templates. Cached product cards must still match current candidate IDs, order
and reasons; stale decisions are rebuilt with a new offer record. Both new and
cached decisions pass the relationship policy and existing catalog guard. Product
context is bounded at 100 source/cart products and 150 pool candidates; oversized
relationship context fails closed. Fixed merchant bundles containing a denied
item are suppressed as a whole, preserving their discount contents and signing.

The existing widget converter included raw variant `quantityAvailable`, and the
live-alert response included `inventoryQuantity`. Both outgoing paths now strip
private signals recursively before serialization. Merchant cost/margin/stock
fields and internal metafields are removed; public availability booleans, prices
and cart quantity remain. This also applies before offer storage/caching. Config
and signed-session responses retain their existing explicit field allowlists.
Inventory is still available to server-side catalog checks. No SDK source or
catalog-guard implementation changed.

## Beauty and haircare keyword map

English keywords are matched as normalized words/phrases, with punctuation and
case ignored and SPF numbers normalized to `spf`. Product type takes precedence,
then tags, then title. Ambiguous stages at any inspected level are neutral.
These are catalog heuristics, not ingredient, skin/hair suitability, allergy or
clinical advice.

| Stage | Keywords |
| --- | --- |
| Cleanse | shampoo, cleanser, cleansing, face wash, body wash, co-wash, cowash |
| Condition | conditioner, conditioning, moisturizer, moisturiser, body lotion |
| Treat | serum, hair mask, face mask, treatment, scalp treatment, exfoliant, exfoliator |
| Style | styling gel, styling cream, curl cream, mousse, pomade, hairspray, hair spray, edge control |
| Protect | sunscreen, spf, sun protection, heat protectant, heat protection |
| Tools/accessories | brush, comb, bonnet, hair clip, scrunchie, applicator, shower cap |

Complement stages are: cleanse -> condition/treat/protect/tools; condition ->
treat/style/protect/tools; treat -> style/protect/tools; style -> protect/tools;
protect -> tools; tools -> the five product stages. Generic ignores stage
keywords and uses only same-vendor, same-collection and verified order-affinity
evidence. Sparse or unfamiliar catalogs may need manual picker pairings.

## Files changed in Phase 3

- Schema and purge: `prisma/schema.prisma`,
  `prisma/migrations/20261105130000_product_relationships/migration.sql`,
  `app/routes/api.webhooks.tsx`.
- Suggestions and merchant management: `app/models/productPairings.ts`,
  `app/jobs/pairingSuggestions.server.ts`,
  `app/models/productRelationships.server.ts`, `app/routes/app.pairings.tsx`.
- Recommendation policy and output:
  `app/models/pairingRecommendations.server.ts`, `app/models/offer.server.ts`,
  `app/ai/decisionEngine.server.ts`, `app/routes/api.offer.tsx`,
  `app/utils/storefrontPayload.server.ts`, `app/routes/api.live.tsx`.
- Admin integration: `app/routes/app.tsx`, `app/routes/app.settings.tsx`,
  `app/models/onboarding.ts`, `app/models/onboarding.server.ts`,
  `app/components/dashboard/SetupChecklist.tsx`,
  `app/models/offerPreview.server.ts`, `app/routes/app.preview.tsx`.
- Eight new test files: `app/models/productPairings.test.ts`,
  `app/jobs/pairingSuggestions.server.test.ts`,
  `app/models/pairingRecommendations.server.test.ts`,
  `app/models/productRelationships.server.test.ts`,
  `app/models/productRelationships.integration.test.ts`,
  `app/pairing-routes.test.ts`, `app/storefront-pairing-responses.test.ts`,
  `app/ai/pairingDecision.server.test.ts`.
- Extended regressions: `app/models/onboarding.test.ts`,
  `app/models/onboarding.server.test.ts`,
  `app/models/offerPreview.server.test.ts`, `app/onboarding-routes.test.ts`,
  `app/services/data-webhook.server.test.ts`.
- This report. Earlier phase work and pre-existing untracked user files remain
  available in the worktree for review; no new commit was made in this phase.

## Migration

Added `20261105130000_product_relationships`: defaulted `verticalPreset` on
AppSettings, relationship kind/status/origin enums, and ProductRelationship with
the required unique key, both composite `(shop, productId)` foreign keys with
cascade deletion, and tenant/source/status and tenant/target indexes. Confidence
is an additional bounded float used only for deterministic bulk-approval evidence.
All type/table/index/column creation is idempotent. No existing migration changed.

Isolated PGlite tests apply the actual SQL twice, preserve settings, check enum,
confidence and unique constraints, reject cross-tenant references, and verify
cascade deletion from either product. Uninstall and shop/redact tests invoke the
actual webhook action with a signature-validated fixture and assert the explicit
shop-scoped relationship purge while another tenant's rows survive. Separate
existing HMAC regressions continue to prove signature validation is mandatory.
No migration ran against an application or production database.

## Commands and validation

- `npm.cmd exec -- prisma generate`: passed against the new local schema.
- `npm.cmd run typecheck`: passed during implementation.
- Targeted `npm.cmd test -- ...`: a ten-file pairing/onboarding suite passed
  97 tests; final additional route, privacy and decision-engine regressions are
  included in the full suite below.
- Scoped `npm.cmd exec -- prettier --write ...`: passed for Phase 3 files.
- The first full gate caught missing Response/data union narrowing in two new
  test assertions. Those fixtures were corrected before the successful gate.
- Final `npm.cmd run verify`: **passed** typecheck, lint, **373 tests in 57
  files**, SDK build, Prisma generation and production client/server builds.
  Phase 3 adds **68 tests and eight files** over Phase 2's 305 tests in 49 files.
  Existing SDK, token and compliance regressions remain green. React Router
  future-flag and empty server-route chunk notices are nonfatal.
- `git diff --check`: passed, with nonfatal Windows line-ending notices.
- `git diff --exit-code -- storefront-sdk extensions shopify.app.toml
  package.json package-lock.json app/models/catalogGuard.server.ts`: passed.
  Verification regenerated identical SDK assets. No dependency, scope, webhook
  subscription, extension, Function or core guard change is included.

Tests cover precedence reaching actual rendering, exclusions across cart sources,
pending/rejected and upgrade suppression, cached-order/reason changes, current
catalog revalidation, tenant boundaries, merchant replacement/bulk actions,
keyword/preset switching, invalid/duplicate AI IDs and invented reasons, real
gateway cap exhaustion without a provider request, disabled AI and aborts,
migration integrity and cleanup, and serialized offer/config/session/live privacy.

Verification required the same Windows filesystem access outside the sandbox as
earlier phases for esbuild. No credential values were inspected or printed;
framework commands load environment configuration automatically. Shopify/AI
transports are mocked in tests and SQL tests use isolated local PGlite databases.
The React review covered controlled preset/search state, native picker errors,
button labels, bounded continuation and effect timer cleanup.

## Manual release and acceptance checks

1. Review the diff, then use the normal reviewed migration/release pipeline to
   apply `20261105130000_product_relationships` before deploying its generated
   client/server. Also include Phase 2's migration if it is still pending.
   `prisma migrate deploy` was not run here. Old code tolerates these additions.
2. No new environment variable, OAuth scope, Shopify webhook subscription or
   Shopify-side extension release is required for Phase 3.
3. In a development store with synced products, open Product pairings and
   generate the top-product suggestions before any storefront visits. Check
   pause/resume, approve/reject/replace, an exclusion and its removal, and bulk
   approval. Native pickers must be checked inside embedded Shopify admin.
4. Select Beauty & haircare, regenerate suggestions, and compare stage matches
   with Generic. Existing approvals/rejections should remain. Disable AI and
   repeat to inspect grounded deterministic suggestions.
5. Preview an approved pair and check a live eligible product/cart surface.
   Confirm its stored reason, current price/availability and exclusions; pending
   and rejected matching pairs must not appear. Check both cached and new
   requests, and search their serialized bodies for private inventory/cost data.
6. On a disposable development installation, test product deletion and
   uninstall/redact cleanup while retaining another development tenant's rows.

Live Shopify admin, picker and storefront acceptance checks remain manual; no
authenticated development-store browser was supplied or opened. Automated tests
verify the code paths and isolated SQL behavior. No deployment, Shopify release,
production migration or production data mutation was performed.

Deliberately deferred: cart add/restored detection, drawer placement, the runtime
AI ranker/cache and SDK changes (Phase 4); holdout reporting, billing, inventory
signals and reorder planning; auto-approval; and upgrade/replacement cart flows.
Bundle-discount Function, post-purchase signing and authentication are untouched
by Phase 3. Existing placement limitations therefore still require Phase 4.
