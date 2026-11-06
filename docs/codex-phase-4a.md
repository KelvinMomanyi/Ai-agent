# Phase 4A: adaptive theme placement

Later follow-up: [revised Phase 4](codex-phase-4-revised.md) adds normal-shopper
native-form redirect continuation and exercises the engine through the cart flow.
The implementation/verification record below describes Phase 4A at its completion.

Plan recorded before editing, 6 November 2026. Starting commit: 0674e9f, clean
working tree. Baseline npm.cmd run verify passed (583 tests in 76 files, builds
included). This phase implements the theme engine and connects it to the existing
cart surface; recommendation selection and pairing logic remain outside scope.

- Add ThemeProfile and bounded, deduplicated ThemeReport tenant tables plus
  appearance/placement settings, an additive idempotent migration, and explicit
  uninstall/redact deletion. Keep all public reports advisory. Require five
  distinct signed sessions for selector promotion or status changes; require at
  least 20 recent attempts before a low success rate can degrade a profile. One
  session cannot disable or degrade another visitor's placement. Actual display
  reports must also reference that session's own Offer. Limit payload size,
  session/shop request rates, retained samples and selector grammar.
- Theme metadata is optional public input. Read window.Shopify.theme on signed
  session/config requests; new IDs start learning. Shopify explicitly documents
  schema_name/schema_version in its theme-information changelog. Other identity
  fields are treated as optional hints, not an API entitlement or proof. No new
  scope. The config response selects the starting strategy for that exact ID;
  recent multi-session evidence identifies the advisory admin summary.
- After a confirmed add, passively observe cart UI for 1.2 seconds. Use typed
  adapters: known Dawn drawer, structurally verified generic drawer after quorum,
  cart-page inline, non-modal floating card, none. Preserve global overlay and
  protected-page exclusions. Wait for competing dialogs to close; never open,
  intercept, reposition or change the theme's cart. Stop stale async work after
  another mutation or navigation. Reattach after section replacement.
- Reuse UpsellDrawer's Shadow DOM product controls. Verify at least 50% viewport
  intersection for 750 ms, center-point hit testing, visibility and host layout
  stability before emitting an impression. Unknown/obscured display is a failed
  verification, not an impression. Locally step down on adapter exceptions or
  failed verification and stop when all strategies fail.
- Sample fonts/colors/buttons/radius/RTL only after the first confirmed add.
  Enforce WCAG-style 4.5:1 text contrast with a neutral fallback. Add merchant
  accent/radius/font overrides, reduced-motion and safe-area handling.
- Keep the current IIFE embed. Build the engine/adapters as a separate hashed ESM
  asset and dynamically import it only on confirmed-add or explicit preview.
  Inline dynamic imports in the current IIFE build are not genuine lazy loading;
  therefore a separate build is necessary. Enforce main <=170,000 bytes and
  combined JS <=240,000 bytes / 65,000 gzip bytes, including stale-file cleanup
  limited to generated theme-engine assets.
- Add an admin compatibility card/page with placement/appearance controls and a
  short-lived, purpose-bound signed preview link. Branch preview before normal
  SessionManager/EventBus/OfferPoller setup. The merchant explicitly runs one
  native test add; passive cart reads confirm it. Resume after redirects without
  another add. Preview uses read-only catalog data and writes only the profile's
  lastPreviewResult (creating a learning profile shell if absent), never Offer,
  ShopperSession, ShopperEvent, RecommendationOutcome, pairing or billing usage.
  Normal shopper offers continue to require existing signed storefront sessions.
- Update checklist verification to use the current ThemeProfile's verified state;
  connectivity alone continues to describe embed connectivity, not display.
- Use existing Vitest/jsdom/PGlite only. Add fixtures with provenance, classification,
  adapter, display, ladder, selector, quorum, preview isolation, migration/purge,
  admin and size-budget tests; rebuild assets and run npm.cmd run verify.

No captured merchant theme HTML was supplied. The local Dawn snapshot contains
only config/layout, not cart markup. Use reduced Dawn fixtures grounded in the
official Shopify Dawn source and explicitly synthetic structural popup/redirect/
custom-drawer fixtures. They are regression fixtures, not certification of other
themes. Real rendered fixtures and the live four-theme matrix remain manual
acceptance work. No heavy browser dependency, production migration or deployment.

References checked before implementation:
[Shopify theme information](https://shopify.dev/changelog/posts/updates-to-theme-information-access-in-shopify),
[deprecated Liquid theme object](https://shopify.dev/docs/api/liquid/objects/theme),
[Ajax Cart API](https://shopify.dev/docs/api/ajax/reference/cart).

## Implementation and review map

| Files | Change |
| --- | --- |
| `shared/themeCompatibility.ts` | Shared enums, identity normalization, selector grammar, quorum and circuit-breaker constants/math. |
| `prisma/schema.prisma`, `prisma/migrations/20261106120000_theme_compatibility/migration.sql` | Four placement/appearance settings, ThemeProfile and ThemeReport. AppSettings deletion cascades to profiles and reports; a late asynchronous write cannot recreate them after the parent is removed. The migration is additive and tested twice against an isolated PostgreSQL-compatible database. |
| `app/models/themeCompatibility.server.ts` | Exact-theme runtime config, bounded identity/display evidence, rate limits, deduplication, retention, selector promotion and sampled seven-day admin summary. |
| `app/models/themePreview.server.ts`, `app/utils/cappedJson.server.ts`, `app/routes/api.theme-preview.tsx`, `app/routes/api.theme-report.tsx` | Five-minute purpose/shop/source-bound preview tokens, one-time preview bootstrap/result, 4 KiB streaming body cap and signed offer-bound public display reporting. |
| `app/routes/api.session.tsx`, `app/routes/api.config.tsx` | Optional theme metadata/config; identity writes use the existing Vercel after-response mechanism. Missing advisory data does not prevent session/config delivery. |
| `app/routes/api.offer.tsx`, `app/routes/api.webhooks.tsx` | Merchant placement Off stops cart offers before ranking while preserving measurement; explicit shop-scoped theme-table purge. |
| `app/routes/app.theme.tsx`, `app/components/ThemeTestButton.tsx`, `app/routes/app._index.tsx` | Compatibility page/Home card, appearance and placement controls, reset, authenticated preview-link fetch and popup-blocked fallback. Normal admin settings initialization creates the parent settings row before preview use. |
| `app/models/onboarding.ts`, `app/models/onboarding.server.ts` | Checklist display verification requires a recently verified ThemeProfile. Storefront connectivity remains the separate embed step. |
| `app/models/offerPreview.server.ts` | Forward the existing vertical preset to read-only preview validation, so beauty routine reasons use the same context as the real catalog. No pairing or ranking algorithm change. |
| `storefront-sdk/src/theme/{identity,loader,adapters,appearance,verification,engine,preview}.ts` | Passive cart classification, typed placement ladder, guarded Shadow DOM card, contrast adaptation, verified display and isolated native-add preview with redirect resume. |
| `storefront-sdk/src/{index,sessionManager,offerPoller}.ts`, `storefront-sdk/src/widgets/{BaseWidget,UpsellDrawer,widgetManager}.ts` | Preview branches before normal tracking; cached config refreshes on theme change; lazy engine integration, pending verification, stale-work cancellation, impression gating and cleanup. |
| `storefront-sdk/theme.vite.config.ts`, `storefront-sdk/vite.config.ts`, `scripts/check-sdk-size.mjs`, `package.json`, `.gitignore`, `.eslintignore` | Separate hashed ESM engine, IIFE loader, generated-manifest handling, generated-bundle lint exclusion and enforced SDK budgets. |
| `extensions/aovboost-storefront/assets/aovboost-sdk.js`, `extensions/aovboost-storefront/assets/aovboost-theme-engine-*.js` | Regenerated main SDK and lazy engine asset, shipped together. |
| `storefront-sdk/test/fixtures/themes/*` | Reduced official Dawn structures and explicitly synthetic regression fixtures, with provenance in README. |

The public trust boundary uses five distinct signed sessions, not five verified
people. It resists one-session poisoning; it is not proof against a coordinated
multi-session attacker. Theme identity and success reports remain advisory. A
learned selector is only a querySelector hint and the SDK rechecks the current
visible cart structure before mounting. No report can inject HTML or a selector
outside the restricted grammar.

Automatic identity learning is limited to 20 profiles per shop (a concurrency
guard, not a transactional hard quota). Explicit admin preview can create a
learning shell for a legitimate theme beyond that limit. Reports allow 30 requests
per signed session/hour and 300 per shop/minute. Each profile retains approximately
1,000 recent reports, with bounded cleanup batches; the circuit uses at most 100
recent display reports and the seven-day summary uses at most 1,000 reports.
Adapter failures are grouped by offer for the overall verified-display denominator.
Preview results are ordered by their server-written timestamp, so public traffic
on an older profile cannot make an old test appear newest.

Preview requires an explicit click to run one native product-form add at quantity
one, using an available variant from the signed source product. It never retries
or changes that request, and it leaves the item in the merchant's cart. The preview
token is removed from the URL before the test and saved only for short-lived
same-tab redirect continuation. Existing profile updates contain only
lastPreviewResult; an absent profile gets a learning shell. Preview never starts
the regular shopper SDK, pairing drain, billing counters or shopper analytics.

## Verification

Eleven new test files cover identity/selector validation, one-session poison
rejection, quorum promotion/degradation/circuit breaking, offer ownership,
deduplication/rate limits, bounded retention, preview signature/expiry/replay,
preview write isolation, migration idempotency/cascades, newest-preview selection,
admin validation, lazy loading, fixtures, adapter placement, verification dwell/
occlusion/host displacement, contrast fallback, Escape/focus behavior, stale work
and bundle-budget failure. New files:

- `app/models/themeEvidence.test.ts`
- `app/models/themeCompatibility.server.test.ts`
- `app/models/themePreview.server.test.ts`
- `app/models/themeMigration.test.ts`
- `app/theme-routes.test.ts`
- `app/components/ThemeTestButton.test.ts`
- `storefront-sdk/src/theme/adapters.test.ts`
- `storefront-sdk/src/theme/engine.test.ts`
- `storefront-sdk/src/theme/manager.test.ts`
- `storefront-sdk/src/theme/previewStart.test.ts`
- `storefront-sdk/src/theme/size.test.ts`

Existing session-manager, onboarding, storefront-response and webhook integration
tests were extended. Actual uninstall/redact integration deletes the target shop's
ThemeProfile and ThemeReport rows while preserving another shop. Migration tests
also prove that deleting the parent settings removes both tables' tenant data and
rejects a late profile insert.

Final verification on 6 November 2026:

| Command | Result |
| --- | --- |
| `npm.cmd run verify` before edits | Passed: 583 tests in 76 files, typecheck, lint and builds. |
| `npm.cmd run verify` after final source/config changes | Passed, exit 0: 625 tests in 87 files, typecheck, lint, SDK build, Prisma generation and production client/server builds. Net increase: 42 tests and 11 test files. |
| `npm.cmd run build:sdk` (through verify/build) | Passed; rebuilt main SDK and `aovboost-theme-engine-D_ulkUm-.js`. |
| `prisma generate` (through verify/build) | Passed, Prisma Client 6.19.3. |
| `node scripts/check-sdk-size.mjs` | Passed: main 151,396 bytes; combined 203,252 bytes; combined gzip 56,409 bytes. Budgets: 170,000 / 240,000 / 65,000 respectively. |
| `git diff --check` | Passed; no whitespace errors. |

The SDK engine is 51,856 bytes and loads separately on the first confirmed add or
explicit preview. Main gzip is 40.89 kB and engine gzip is 15.52 kB. No dependency
was added. A repeat verification exposed linting of the newly generated ESM asset;
the matching generated-file exclusion now accompanies the existing SDK exclusion.
One sandboxed repeat was blocked by Vite config filesystem access, then rerun with
approved access. Existing nonfatal React Router future-flag, Rollup annotation and
mixed static/dynamic import warnings remain; no unrelated warning cleanup was done.

## Manual release and acceptance

1. Review this diff. Apply migration `20261106120000_theme_compatibility` with the
   normal `prisma migrate deploy` process in a development/staging database first.
   No production migration was run by Codex.
2. Release the server and both storefront assets together using your normal app
   and Shopify extension release process. Run `npm run build:sdk` before packaging
   if source changes again. The main SDK references the hashed engine on the same
   asset host. Verify CDN dynamic-module loading/CORS/MIME behavior in the dev
   store. No new dependency, environment variable, scope or webhook is required.
3. On a dev store with the embed enabled and eligible synced products, open Theme
   compatibility and run Test on my store. Confirm exactly one native add, a
   useful result on return, and no Offer/ShopperSession/ShopperEvent/
   RecommendationOutcome or billing-usage writes from preview.
4. Supply rendered product/cart/open-drawer fixtures for Dawn, another drawer
   theme, a popup-notification theme and a redirect-to-cart theme. Run the live
   matrix on mobile and desktop, including quick add, native drawer close/reopen,
   section replacement, keyboard focus, Escape, RTL, reduced motion, blocked popups,
   disabled placement, theme changes and module-load failures. No theme was
   installed and no live storefront test was run in this workspace.
5. Verify normal signed sessions can reach the five-session display quorum, a
   new theme starts learning, repeated multi-session failures step down, and one
   session cannot disable placement. Reset compatibility learning after fixing a
   disabled theme; reload the storefront to pick up the new config/preferences.

## Scope and remaining limits

The original Phase 4 cart path was already present. This phase connects that path
to the new engine. It does not add normal-shopper continuation of offers across
a native full-document form redirect. Classification handles observed path changes,
and the isolated preview explicitly resumes after document redirects; real normal
redirect-to-cart delivery remains an acceptance item for the revised Phase 4
follow-up. A restored cart still must not count as a new add.

Display stability measures cumulative card-host displacement during verification;
it does not claim a full-page Core Web Vitals CLS audit. The seven-day display rate
is a bounded recent sample. A preview pass does not promote a theme to verified;
normal multi-session evidence is required. The admin detected-theme summary
prioritizes quorum evidence, so one forged identity cannot replace an established
theme. It is not authoritative published-theme detection, and individual sessions
still receive config for the exact theme ID they report.

No recommendation selection, pairing generation, authentication, AI provider chain,
post-purchase signing or bundle Function was changed. Inventory and reorder phases
remain gated. Real merchant fixtures, live theme/browser acceptance, deployment and
production migration remain manual; no production data or services were touched.
