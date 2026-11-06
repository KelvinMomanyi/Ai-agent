# Revised Phase 3: pairing autopilot

Plan recorded before implementation, 5 November 2026. The previous complete gate
passed 529 tests in 73 files. Existing phase changes and user files are preserved.

This revision supersedes the original manual-approval-only pairing rule. This
diff implements revised Phase 3 only. Theme detection, adaptive placement,
ThemeProfile, preview cart tests, the SDK changes and placement reporting belong
to Phase 4A and its follow-up phases, and require their own review.

- Add mode/strictness/sensitive-keyword settings, auto_approved/demoted statuses,
  reasonCode/modelVersion/evidence/counters and ProductPairingState. Keep legacy
  upgrade rows and the existing nonnullable confidence column compatible; stop
  new upgrade writes rather than destructively removing enum values/columns.
  Preserve existing shops in review_first; new defaults become autopilot only
  after backfilling missing settings for all already-installed shops.
- Add pure deterministic validation and fixed reason templates. Confidence is
  model/evidence confidence, never a guaranteed acceptance probability. Defaults:
  cautious .95, balanced .90, broad .85; fallback auto-approval .96; price ratio
  .15–2.0; title-token similarity .80 for same-vendor/type near-duplicates. Never
  auto-approve sensitive text, including treatment/health/chemical/supplement
  terms. Merchant additions can only extend that safety list.
- Enrich only a bounded allowlisted reasoning context with public catalog fields,
  capped descriptions, collection titles, coarse relative-price/affinity labels.
  Validate strict JSON and supporting-field names against deterministic evidence.
  Use configurable reasoning-model overrides through the existing provider chain
  and existing monthly/daily/concurrency guards. Do not log raw model reasoning,
  product text or private signals. Missing/capped/invalid AI uses deterministic
  scoring with the stricter fallback approval threshold.
- Add durable per-product hashes and revision/lease state. First sync seeds and
  processes a bounded batch; product webhooks mark only affected state dirty.
  Authenticated storefront session start and signed order delivery schedule a
  bounded drain through Vercel waitUntil, without awaiting it in a shopper request.
  No cron or catalog-wide cache rebuild. A stale lease/hash cannot commit.
- Keep merchant decisions when refreshing. Runtime order becomes merchant approved,
  auto_approved (only in autopilot), verified co-purchase, catalog fallback.
  Rejected/demoted/excluded targets stay denied. Revalidate cached cards, serve
  fixed reason-code templates and persist pair provenance on the server's Offer
  record. Client-origin/confidence/status fields never establish provenance.
- Roll up visible impressions and confirmed recommendation-add events using
  bounded, tenant-scoped SQL and immutable served-pair provenance. Deduplicate per
  offer/pair; no generated decision counts as displayed. After 100 impressions,
  flag a pair if its 95% Wilson upper bound lies below half the shop median's
  conservative lower bound. Require five qualified pairs before comparison.
  Demote only auto_approved pairs; flag merchant-approved ones. Revalidate and
  promote the next safe suggested candidate. No confidence interval alone proves
  a causal pairing effect; holdout remains the whole-system measurement.
- Add review-by-exception UI sorted by recent traffic then confidence, mode,
  strictness, preset, sensitive additions, safe evidence explanations, origin
  coverage, manual overrides and undo reject. New-install setup explains autopilot;
  pairing review becomes optional in the checklist. Theme verification remains
  unchanged until Phase 4A supplies ThemeProfile.
- Add both tenant tables to explicit purge (ProductRelationship already exists),
  cascades for state, and privacy/demotion/freshness/tenant/integration tests.
  Run npm run verify. Do not modify the SDK, catalog guard core, authentication,
  bundle Function or post-purchase signing. No production deployment/migration.

The supported Vercel Node mechanism was verified in the official
[waitUntil reference](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package).
It retains a bounded promise for the request lifetime and does not supply a
durable queue or guarantee work survives a function timeout. Dirty state remains
durable for a later trigger if execution ends. The lightweight @vercel/functions
package was added as a direct dependency. Outside
Vercel, local development may schedule the same bounded task; other production
hosts must provide a supported lifecycle hook rather than a detached promise.

## Implementation result, 6 November 2026

Revised Phase 3 is implemented locally. New AppSettings constructors explicitly
choose autopilot. The database default remains review_first, and the migration
materializes missing settings for shops already present in session or Shop.
Existing merchants keep their preferences. Home explains the new-install default;
Product pairings provides Autopilot / Review first / Off, strictness, vertical,
additional sensitive phrases, an optional review queue, overrides and undo reject.

The background pipeline considers three sources and eight candidates per source
per batch, stores at most five suggestions per source, and makes one reasoning
gateway invocation per batch. Provider failovers remain separate, budgeted
attempts through the existing gateway. A failed/invalid/capped model response uses
deterministic evidence. Strong routine + brand + collection evidence scores .97;
five or more observed co-purchases score .98. Other deterministic scores remain
below the stricter fallback threshold unless their evidence qualifies.

Low-confidence and sensitive candidates remain suggested for explicit merchant
review, following the revised status rule. They do not acquire auto-approved
status. Independent verified affinity or a safe catalog fallback can still serve
a suggested target; it is recorded as fallback provenance, never as an approved
relationship. Rejected, demoted, excluded and legacy upgrade targets remain
denied. Merchant approval is an explicit override of automatic sensitivity/price
heuristics, with the catalog guard and merchant exclusions still enforced.

The routine keyword map remains documented in
[the original Phase 3 report](codex-phase-3.md#beauty-and-haircare-keyword-map).
The additional sensitive list is the named SENSITIVE_PAIRING_KEYWORDS constant in
app/models/pairingAutopilot.ts. It covers chemical processing, treatment,
supplements, vitamins, scalp/health language and clinical claims; merchant phrases
extend it. It is an English catalog heuristic, not a semantic safety guarantee.
Unknown languages and ambiguous catalogs can need merchant review. Fixed templates
describe routine, tool, collection, brand, refill or observed-order evidence;
refill wording requires a refill/replenish tag on the target. Raw AI copy and
supporting metadata never become shopper headings.

Source revisions, expiring leases, settings comparisons and fresh catalog hashes
prevent stale jobs from committing. Refresh writes conditionally update suggested
or auto-approved rows, preserving concurrent merchant decisions. Product updates
mark only that product dirty; deletion additionally dirties a bounded set of
incoming sources before foreign-key cascades remove the deleted product's state.
The first completed sync seeds at most the top 50 products. One retained task
processes one three-product batch; later authenticated sessions, displayed/add
events and orders continue the work. Sparse traffic can leave remaining work
pending, and the admin refresh remains available. There is no guaranteed
wall-clock completion time or guarantee that every catalog has a safe live pair.

Runtime selection and final response guards recheck current availability,
exclusions, mode, confidence threshold, sensitive wording, near-duplicates, price
band and reason evidence. A target or policy edit can therefore withhold an old
auto-approved row before background refresh finishes. Merchant decisions and
verified affinity keep precedence. Fixed copy is rebuilt from current trusted
fields on cached responses too.

Offer.pairingProvenance stores the relationship, source/target, served origin,
status, confidence, reason code and model version from server queries. Public
payloads cannot supply that provenance. A final rejection/mode change can prevent
the offer write. The immutable snapshot supports later origin reporting without
attributing historic offers to a relationship's current status.

Cached browsing decisions now create a fresh Offer for the current signed session
after revalidation. Cached product choices can be reused while shopper identity
and provenance are recorded anew; old offer IDs are removed from persisted
payloads. The server supplies the actual selected source, including numeric-ID
canonicalization. Cached experiment variants go through the normal assignment
path, so a prior shopper's variant is not copied. This fixes an existing cached
browsing path that would otherwise undercount the new pair-learning loop.

Learning uses at most 50 pending offers and 250 relevant events per offer in each
rollup. It counts a pair once per displayed offer and a confirmed matching target
add once per offer/pair. An undisplayed generated offer counts neither. Pending
markers are cleared under the transaction lock before reading events so a racing
event batch leaves another rollup pending. Existing signed-session and event
validation remain in force; browser telemetry is still untrusted evidence.

The comparison uses SQL over all qualified active pairs in the shop, rather than
a sampled application-side median. Each evaluation checks at most 20 pairs,
rotating by last check time. Acting requires 100 impressions, at least six
qualified shop pairs (the pair plus five peers), and 20 distinct signed sessions
in the last 31 days. A pair's Wilson 95% upper bound must be below half the shop
median lower bound. Only auto-approved pairs are demoted; merchant approvals get
a review flag. A replacement is promoted only after fresh deterministic checks.
This operational comparison does not establish causal lift; holdout reporting
continues to measure the whole system.

## Files and migration

- New policy and learning modules: app/models/pairingAutopilot.ts,
  app/models/pairingLearning.ts, app/models/pairingLearning.server.ts,
  app/models/pairingProvenance.server.ts, app/jobs/pairingAutopilot.server.ts.
- Pipeline and catalog context: app/jobs/pairingSuggestions.server.ts,
  app/jobs/aovboost.server.ts, app/models/product.server.ts,
  app/models/productCatalogMapping.ts, app/ai/client.server.ts.
- Runtime, events and tenant cleanup: app/models/pairingRecommendations.server.ts,
  app/models/offer.server.ts, app/models/event.server.ts,
  app/routes/api.session.tsx, app/routes/api.webhooks.tsx,
  app/utils/storefrontPayload.server.ts.
- Merchant UI and settings: app/models/productRelationships.server.ts,
  app/routes/app.pairings.tsx, app/routes/app._index.tsx,
  app/routes/app.settings.tsx, app/models/settings.server.ts,
  app/models/onboarding.ts, app/models/onboarding.server.ts,
  app/models/offerPreview.server.ts. New-setting create paths in
  app/routes/api.offer.tsx, app/routes/api.chat.tsx, app/routes/app.preview.tsx and
  app/models/bundleDiscount.server.ts also explicitly choose autopilot.
- Schema/configuration: prisma/schema.prisma, .env.example, package.json,
  package-lock.json; direct @vercel/functions dependency ^3.10.6.
- One new migration: 20261105200000_pairing_autopilot. It adds settings, relationship
  metadata/counters/checkpoint/undo fields, ProductPairingState with a composite
  product foreign key and lease/priority indexes, and Offer provenance/rollup
  fields with tenant-progress and JSON GIN indexes. Existing migrations and legacy
  enum values are preserved. Existing confidence stays nonnullable for additive
  compatibility; absence of relationship confidence is null in served fallback
  provenance. ProductRelationship already had explicit purge; ProductPairingState
  now has it too.

## Tests and commands

Final npm.cmd run verify: **PASS, 583 tests in 76 files**, exit 0. This includes
React Router type generation, TypeScript, ESLint, all Vitest tests, SDK build,
Prisma generation and client/server production builds. The preceding Phase 6 gate
was 529 tests in 73 files. Expected failure-path logs occur in tests. Build output
still includes non-fatal Rollup comment annotations, empty route chunks,
React Router future-flag notices and existing mixed static/dynamic import notices.

Three new test files cover pure validation/privacy/injection/demotion,
lease-guarded scheduling/freshness, and immutable provenance/idempotent learning:
app/models/pairingAutopilot.test.ts,
app/jobs/pairingAutopilot.server.test.ts,
app/models/pairingLearning.server.test.ts.

Expanded existing tests cover pipeline fallback and sensitive handling;
merchant/autopilot/affinity precedence; cached current-evidence checks; fixed copy;
review policy validation and undo; new defaults; first-sync trigger; actual SQL
median and traffic ordering; migration reapplication, tenant FKs, cascades and
uninstall/redact deletion; reasoning-model selection and Mistral text extraction;
and serialized offer/config/session privacy. Related fixture updates were needed
in onboarding, cart selection, storefront responses, billing/holdout/purge tests
and the historical analytics aggregate fixture's Offer type.

Commands run during this revision:

- npm.cmd install @vercel/functions: passed after rerunning outside the sandbox
  when registry access was blocked. No dependency audit-fix was run.
- npm.cmd exec -- prisma generate: passed; generation only, no database migration.
- npm.cmd run typecheck: passed after correcting new policy/catalog fixture types.
- Scoped npm.cmd exec -- prettier --write: passed.
- Targeted npm.cmd test -- ...: passed, including a 120-test initial corrected
  suite and an 83-test cart/SQL follow-up. Older manual-approval fixtures and the
  new final-guard lookup mock were corrected after earlier failing runs.
- npm.cmd run verify: final complete run passed. Earlier runs stopped at a new
  test's union type or incomplete mock; those failures are resolved.
- git diff --check: passed, with Windows line-ending notices only.
- Get-FileHash on the built SDK: unchanged from the pre-revision snapshot,
  SHA256 6B83F10B0C93432D658CAE5FD8E92DBB4535BC195C8D7D18C9323B1F49BDC74C.
  SDK build remains 146.85 kB / 39.49 kB gzip. No SDK source was edited here.

Tests use mocked Shopify/provider transports and isolated PGlite databases. No
live Shopify, billing or model API was exercised. No production data was touched.

## Manual rollout and remaining acceptance

1. Review this phase's diff alongside the earlier uncommitted phase changes.
   Apply the reviewed migration chain, including 20261105200000_pairing_autopilot,
   through the normal migration/release pipeline before serving the updated
   Prisma client. prisma migrate deploy and deployments were not run here.
2. Deploy the server with @vercel/functions installed on the supported Vercel
   Node runtime. waitUntil retains bounded work, not a durable queue. Other
   production hosts currently skip scheduling; implementing another host's
   lifecycle hook would be a separate change. Verify execution time against the
   hosting plan's function limit. Dirty work survives interrupted execution.
3. Optional reasoning overrides are GOOGLE_AI_REASONING_MODEL,
   MISTRAL_AI_REASONING_MODEL, GROQ_AI_REASONING_MODEL and
   DEEPSEEK_AI_REASONING_MODEL. Defaults use Gemini 3.1 Pro preview / Mistral
   Large 4 for those providers; Groq/DeepSeek retain their configured model unless
   overridden. Ordinary request profiles keep their existing model choices.
   AOVBOOST_AI_TIMEOUT_REASONING_MS defaults to 12 seconds per attempt;
   AOVBOOST_AI_TOTAL_TIMEOUT_REASONING_MS defaults to 25 seconds total, bounded at
   15/30 seconds respectively. Variable examples contain names only.
4. Confirm model availability for the configured provider account. The existing
   daily/monthly/global/concurrency caps still apply. Phase 6's unconfirmed
   billing configuration still disables paid AI attempts; this revision does not
   bypass it. Deterministic recommendations and stricter evidence scoring remain
   usable while billing/provider configuration is unresolved.
5. On a fresh dev-store install, finish sync and check top-product state without
   manually generating suggestions. Verify a safe qualifying pair goes live, a
   sensitive pair stays for review, reject removes a live pair immediately, undo
   restores its recorded status, and editing a source dirties only that source.
   Check a changed target's sensitive wording and stale collection evidence are
   withheld before background repair. Embedded resource pickers, real Vercel
   request-lifetime behavior and model quality still require these live checks.
6. An existing shop should remain Review first until it explicitly opts in. No
   new scope, webhook subscription or Shopify extension release is required by
   this revised Phase 3.

The model references were checked against official
[Google structured-output documentation](https://ai.google.dev/gemini-api/docs/generate-content/structured-output)
and [Mistral reasoning documentation](https://docs.mistral.ai/inference/conversations/reasoning).
Reasoning can improve ranking context; it does not guarantee correctness or
commercial acceptance.

## Deliberately deferred

Phase 4A theme identity, fixtures, Shadow DOM adapters, display verification,
quorum/circuit-breaker logic, ThemeProfile and preview test adds remain a separate
phase for review. The Phase 2 checklist's theme verification cannot switch to
ThemeProfile until it exists. Origin/placement reporting splits belong to the
subsequent Phase 5 update; this revision records the provenance needed for it.
The SDK, authentication, catalog guard core, bundle Function and post-purchase
signing were left in their existing phase state. Inventory and reorder work stay
behind the original merchant-demand gates. No production release or migration
was attempted.
