# Phase 4: cart-first additive cross-sells

Plan recorded before editing, 5 November 2026. Phase 3's last full gate passed
373 tests in 57 files. Earlier worktree changes and user files are preserved.

- Normalize confirmed fetch/XHR cart mutations with one mutation ID, distinguish
  restored carts, and suppress recommendation-originated adds. Custom events and
  button clicks are hints, not proof of an add. Reuse locale-aware Shopify cart
  URLs and existing additive mutations; never wait for recommendations in the
  shopper's original request. No replacement/upgrade mutations.
- Reuse a shared bounded cart reader. Successful empty carts override all session
  and trigger snapshots. Version requests by page and mutation, discard stale
  responses, cancel obsolete work, and refresh the cart surface after changes.
- Add a narrow adapter for Dawn-shaped native cart drawers and explicitly marked
  merchant drawer slots. Keep the global dialog/drawer exclusion rules. Use an
  inline cart-page fallback; unsupported or ambiguous themes show nothing. Do not
  add a floating modal. Preserve native drawer controls and focus trapping, add
  Escape/close and focus return, and reattach after theme section replacement.
- Separate cart recommendations from browsing widget occupancy. Preserve variant
  choices for the same valid decision and refresh on a newer mutation. Record
  impressions only after visibility is confirmed, once per displayed offer.
- Add one authoritative cart decision path using Phase 3 eligibility/precedence,
  recent rejection exclusions, the existing bounded rankOffers gateway, final
  catalog rehydration and templated copy. AI ranks allowlisted IDs only, within
  precedence tiers, with a fast timeout and deterministic fallback. Cache ranking
  IDs without shopper attribution by shop, source variant, cart contents,
  currency/market, settings version and catalog/candidate version. Revalidate
  eligibility on every request and create each shopper's own offer record.
- Share a 30-minute cart-dismissal policy between client and server. New cart
  events do not bypass dismissal. Keep recommendation enablement independent of
  chat and pass maxProductRecommendations through selection and rendering.
- Add an additive focused-mode setting and new-row defaults. Preserve all existing
  settings and seed legacy defaults for installed shops without settings during
  migration before changing defaults. New installs default to two cart cards,
  with auxiliary surfaces off; existing merchants get an explicit settings opt-in.
- Test cart confirmation/dedupe/self-add/restoration, stale responses and empty
  authority, drawer safety/reattachment/keyboard behavior/visibility, ranker
  validation/timeouts/cache/tenant boundaries, defaults preservation and response
  privacy. Rebuild the SDK and run npm run verify.

Expected files: storefront-sdk/src eventBus, triggerRouter, offerPoller,
shopifyCart and widget placement/manager/BaseWidget/UpsellDrawer; app/models/offer,
new cart decision/policy helpers, ai/offerRanker and decisionEngine; api.offer,
settings/public settings and focused-mode schema/migration; related tests and this
report. Authentication, post-purchase extension/signing and bundle Function stay
unchanged. No deployment, production migration or production data access.

Shopify's current Ajax Cart API documentation was checked for locale-aware reads,
batch-add response semantics and bundled section rendering:
[Cart API](https://shopify.dev/docs/api/ajax/reference/cart),
[Ajax API](https://shopify.dev/docs/api/ajax). Existing code takes precedence over
the report's older line numbers; Phase 3 already connected selected candidates
to rendered products.

## Delivered behavior

Confirmed same-origin POST fetch/XHR additions receive a unique mutation ID and
one cart-add event. Rapid separate adds retain distinct IDs, while duplicate
delivery of a mutation is ignored. A batch is one mutation. Failed requests,
ordinary reads and custom `add-to-cart` hints do not prove an addition. Fetch
instrumentation parses cloned response data asynchronously and returns the
original response without awaiting recommendations. AOVBoost's additive helper
tags its requests; legacy offer line properties are also recognized. Those adds
update cart state and remove stale cards without requesting another offer.

The additive helper also recognizes Dawn's snippet-rendered `#CartDrawer` when
there is no element/section named `cart-drawer`. It requests that bundled section,
uses the theme's renderer when available, and restores native focus/trapping
after replacement. A missing section or throwing theme renderer cannot turn a
confirmed write into a duplicate retry. Other returned cart sections still use
the existing bounded replacement fallback.

Initial cart reads now emit `cart_restored` on any shopping page, never
`cart_item_added`. The shared locale-aware reader distinguishes a successful
empty cart from an unavailable read. Successful live cart data takes precedence
over trigger/session snapshots, including zero quantities, totals and empty
arrays. A failed or oversized cart read withholds cart recommendations. The
source product must still be in the live request cart.

OfferPoller versions work by page and mutation, aborts obsolete offer requests,
clears stale cart cards immediately and discards late results, including late
presentment-price reads. Navigation/pagehide cannot mount an abandoned card.
Returning focus/visibility rechecks the cart so a change in another tab removes
the previous recommendation without opening another. Focused mode sends no
browsing/startup offer requests. Cart failures show nothing rather than a generic
assistant toast.

The cart has a separate placement slot, independent of a browsing bundle or
recommendation strip. The adapter recognizes one open Dawn-shaped native drawer
with its expected items/dialog/checkout structure, or an explicit custom-theme
drawer slot. It inserts outside the cart form and table, preserves native
checkout/close controls, and creates no floating modal or backdrop. Competing
dialogs, unsafe slots and ambiguous drawers suppress the card. The safe inline
cart-page section remains the fallback; other unsupported surfaces show nothing.
The general dialog/drawer exclusions still apply to browsing widgets.

The same valid decision preserves its card and variant selections. A new cart
mutation refreshes the surface. Theme section replacement reattaches the same
card; dismissal and navigation stop reattachment. A light-DOM focus stop bridges
the card's shadow controls into the native drawer's keyboard order. Escape closes
the recommendation, consumes its key release and returns focus within the cart
without closing the native drawer. No second focus trap is introduced.

Impressions require actual viewport visibility and visible ancestors, not just a
connected DOM node. A displayed widget records one impression during its
lifetime, including across reattachment. A close records dismissal; a successful
Shopify add records `recommendation_added`. Clicks and confirmed cart writes
remain separate events. Existing Offer creation still defaults to `shown=false`.

The server cart path is separate from broad widget/proactive selection. It uses
`upsellEnabled` independently of chat, takes up to 12 Phase 3 eligible candidates,
and excludes up to 30 recently rejected products from this shopper's outcomes.
Approved complement -> verified co-purchase -> catalog fallback precedence stays
deterministic. `rankOffers()` makes at most one existing gateway invocation with
a 1.2-second outer deadline, preserving provider failover, per-shop/global daily
caps and concurrency reservations. It may reorder allowed IDs within precedence
tiers. Invalid/duplicate IDs are dropped, missing IDs retain deterministic order,
and invalid, disabled, late or capped AI falls back without another copy call.
AI cannot alter reasons, prices, stock, discounts or cart actions.

Only ranking IDs and provider are cached for five minutes, without session,
offer or mutation identity. The key hashes shop, source variant, relevant line
keys/quantities/contents, currency/market, settings version, the existing Redis
catalog generation and current candidate content. Approval/reason and eligibility
changes therefore invalidate ranking reuse. This reuses catalog invalidation
without a new product count/aggregate on each cart add. Eligibility is rebuilt on
every request and final cards pass the existing catalog guard and Phase 3 policy.
Each shopper receives a new offer record of their own. Old full-decision caches
cannot restore a cart drawer on reload.

Before displaying cart cards, the SDK reads their existing locale-aware Shopify
product endpoint, retains only server-allowlisted product/variant IDs, and uses
the active storefront's actual variant price and availability. A failed read,
missing price, mismatched ID or unavailable variant removes the affected card.
At most four parallel product reads are made, with 1.5-second deadlines. No new
service or API endpoint is introduced. Server and client both honor the configured
one-to-four recommendation count; new installations default to two cards.

The SDK and server share one 30-minute dismissal policy. A new add never bypasses
it. Signed event processing also persists cart dismissal time in the existing
ShopperSession context, with future client timestamps clamped to server time.
All new queries and cache keys are tenant-scoped. The existing private-field
serialization filter and signed-session/config allowlists remain intact.

## Focused defaults and migration

Added `20261105140000_focused_cart_defaults`. It first adds `focusedMode=false`
for existing rows and fills legacy settings for installed Session/Shop tenants
that had no settings. Existing settings are never updated. It then changes
new-row defaults: focused mode and cart recommendations on; two cards; chat,
bundles, proactive prompts, progress/countdowns, exit intent, post-purchase theme
widgets, hesitation assistance and bundle assistance off. Live alerts also stay
off for focused shops even if their global environment switch is enabled.

The migration is additive/idempotent, drops nothing, and edits no old migration.
An isolated PGlite test applies the actual SQL twice, proves existing custom
values survive, proves installed shops without settings retain legacy defaults,
and checks a newly inserted shop receives focused defaults. There is no new tenant
table. AppSettings and ShopperSession remain covered by existing uninstall/redact
purges. No application or production database migration ran.

Existing merchants can explicitly select Focused cart recommendations in
Recommendations settings. Saving it disables the auxiliary surfaces; turning
focused mode back off lets the merchant explicitly re-enable desired optional
features. Individual auxiliary toggles are disabled while focused mode is selected.
The cart recommendation switch still works independently. Old clients that omit
the focused-mode form field do not change an existing merchant's mode.

## Files changed in Phase 4

- Server cart selection/ranking: `app/models/cartRecommendations.server.ts`,
  `app/models/offer.server.ts`, `app/ai/offerRanker.server.ts`,
  `app/ai/decisionEngine.server.ts`, `app/routes/api.offer.tsx`.
- Shared dismissal/count policy: `shared/cartRecommendations.ts` and
  `app/models/session.server.ts`.
- Settings/defaults: `app/models/settings.server.ts`,
  `app/routes/app.settings.tsx`, `app/routes/app.tsx`, `prisma/schema.prisma`,
  `prisma/migrations/20261105140000_focused_cart_defaults/migration.sql`, and
  `storefront-sdk/src/sessionManager.ts`.
- SDK event/cart/request flow: `storefront-sdk/src/eventBus.ts`,
  `triggerRouter.ts`, `offerPoller.ts`, `shopifyCart.ts`, new `cartState.ts`
  and `cartCardPricing.ts`.
- SDK rendering: `storefront-sdk/src/widgets/placement.ts`, `widgetManager.ts`,
  `BaseWidget.ts`, `UpsellDrawer.ts`, new `cartDrawerPlacement.ts` and
  `visibility.ts`; regenerated theme asset
  `extensions/aovboost-storefront/assets/aovboost-sdk.js`.
- Six new test files: `app/ai/offerRanker.server.test.ts`,
  `app/models/cartRecommendations.server.test.ts`,
  `app/models/focusedCartDefaults.test.ts`,
  `storefront-sdk/src/cartEvents.test.ts`, `cartOfferPoller.test.ts`,
  `widgets/cartSurface.test.ts`.
- Extended route/privacy regressions: `app/onboarding-routes.test.ts` and
  `app/storefront-pairing-responses.test.ts`; native section/focus regressions in
  `storefront-sdk/src/shopifyCart.test.ts`.
- Documentation: this report and `docs/WIDGET_PLACEMENT.md`.

Earlier phase changes remain in the shared worktree. Phase 4 does not edit
authentication, expiring-token handling, catalog guard internals, post-purchase
extension/signing, bundle-discount Function, dependencies, scopes or webhooks.

## Validation

Final `npm.cmd run verify`: **passed** typecheck, lint, **447 tests in 63 files**,
SDK build, Prisma generation, and production client/server builds. This adds
**74 tests and six new test files** over Phase 3's 373 tests in 57 files. Existing
token/compliance, catalog guards, SDK and bundle-discount tests remain green.
React Router future-flag and empty server-route chunk notices are nonfatal.

Commands run:

- `npm.cmd exec -- prisma generate`: passed against the local schema; no migration
  was applied to an application database.
- `npm.cmd run typecheck`: passed during implementation.
- The targeted `npm.cmd test -- ...` runs described below passed.
- Scoped `npm.cmd exec -- prettier --write ...`: passed for Phase 4 source/tests.
- `npm.cmd run verify`: final pass above, including `npm run build:sdk`. The
  regenerated `aovboost-sdk.js` is included in the diff (143.62 kB, 38.50 kB gzip).
- `git diff --check`: passed.
- Scoped `git diff --exit-code` for dependencies, Shopify TOML, core catalog guard,
  post-purchase routes/extensions and the bundle Function: passed. Authentication
  files retain earlier-phase changes and were not edited in this phase.

The two initial targeted runs passed 90 tests across six files and 86 tests
across nine files, respectively. Later regressions extend those suites. Typecheck
passed during implementation. The first full gate passed typecheck/lint and
444 of 445 tests, finding a stale expected widget type in a privacy fixture
after that fixture moved to browsing recommendations. The expectation was fixed.
A subsequent gate passed 445 tests; final native snippet-rendering/focus review
added two meaningful regressions and the final gate passed all 447. All commands
use local fixtures/mocked Shopify and AI transports; PGlite is local.

Coverage includes confirmed fetch/XHR/batch/rapid mutations, custom-hint rejection,
dedupe and self-add suppression; restoration and empty-cart authority; stale
navigation/mutation/pagehide/market reads and cross-tab return; native/custom
drawer safety, browsing coexistence, four-card rendering, reattachment, keyboard
focus and visible-only impressions; allowlisted ranking, duplicates, timeouts,
disabled/capped AI and fallback; cache isolation/invalidation and fresh catalog
validation; per-shopper offer identity; migration idempotence/preservation and
explicit settings opt-in; and serialized response privacy.

The React best-practices review covered the changed admin TSX, authenticated
actions, controlled checkbox state, accessible labels, explicit opt-in and the
disabled auxiliary controls. The SDK review checked cancellation, timer/observer
cleanup, parallel bounded product reads and keyboard interaction. Verification
needed the same Windows filesystem access outside the sandbox as earlier phases
for esbuild. Credential values were never inspected or printed; framework tools
load their environment configuration automatically. No new commit was created.

The current native markup and focus behavior were checked against Shopify's
[Dawn cart drawer](https://github.com/Shopify/dawn/blob/main/snippets/cart-drawer.liquid),
[cart drawer controller](https://github.com/Shopify/dawn/blob/main/assets/cart-drawer.js)
and [focus helpers](https://github.com/Shopify/dawn/blob/main/assets/global.js).
Tests use representative markup plus an explicit custom-theme fixture. These
are automated structural checks, not a claim of live visual testing.

## Manual release and acceptance

1. Review the complete diff. Apply pending Phase 2/3 migrations and
   `20261105140000_focused_cart_defaults` through the reviewed release pipeline
   before deploying its generated server/client. No migration command or deploy
   was run here. Existing rows and old server code tolerate the additive field.
2. Coordinate the backend release with the regenerated theme SDK asset. The
   merchant runs the Shopify extension release (`npm run deploy`) themselves.
   Mixed SDK/server versions fail closed for cart offers. No new environment
   variables, scopes, webhook subscriptions or merchant re-approval are needed.
3. In a development store, use Dawn and one other theme. Test product-page add,
   collection quick-add, drawer-cart add, rapid/batch adds and failed requests.
   Confirm one eligible recommendation surface per mutation. Unsupported themes
   should show only a safe cart-page fallback or nothing.
4. Reload with a non-empty cart: no unsolicited cart offer. Accept a suggestion:
   normal cart totals/sections update, the original item stays, and no follow-on
   recommendation opens. Empty the cart and verify stale session IDs do not
   revive a card. Change the cart in another tab and return.
5. Check mobile scrolling/layout, native checkout/close controls, variant choice,
   Tab/Shift+Tab, Escape and focus return, section replacement, dismissal expiry,
   and an actually visible impression. Check local market pricing and disable
   AI to confirm deterministic recommendations still work with chat off.
6. Existing merchants retain their configuration until opting into focused mode.
   Verify the opt-in and recommendation count, including four rendered cards.

No authenticated development-store browser was supplied or opened. Live Dawn and
second-theme acceptance checks remain manual. No deployment, Shopify release,
production migration or production data mutation was performed. No performance
benchmark or measured revenue lift is claimed.

Deliberately deferred: replacement/upgrade cart operations, post-purchase changes,
bundle-discount changes, holdouts/causal lift (Phase 5), billing, inventory/margin
signals and reorder planning. Native form navigation and custom-event-only themes
without a verified fetch/XHR response restore cart state without an unsolicited
offer; guessing that an add succeeded would violate this phase's confirmation
requirement.
