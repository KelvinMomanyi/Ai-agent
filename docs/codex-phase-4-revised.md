# Revised Phase 4: cart-first cross-sells

Plan recorded before source edits, 6 November 2026. Phase 4A is present as an
uncommitted working-tree diff and remains intact. Its final gate passed with 625
tests in 87 files. Original Phase 4 already provides cart/restored separation,
fetch/XHR confirmation, source tagging, stale-response protection, authoritative
empty carts, the shared dismissal policy, focused defaults and bounded server
ranking/cache/catalog revalidation. Code takes precedence over the older
cart-restoration report, which describes those pieces as missing.

This follow-up implements the revised Phase 4 using the Phase 4A ladder:

- Add a passive native-form continuation module. A same-origin, same-tab POST
  product form can record one bounded, short-lived intent with its observed cart
  baseline. It cannot delay, cancel, replace or retry the native request. A
  prevented submit, recommendation-origin add or observed Ajax mutation clears
  that intent. Page departure must arm it before another document can use it.
- On cart-page entry, consume the intent once, bound to the same shop and signed
  storefront session, with a matching same-origin referrer. A fresh cart read
  must show exactly the requested variant/count increase and no other quantity
  changes. Empty, unchanged, ambiguous, stale or unavailable carts yield no offer.
  Fresh baseline reads can be started by passive focus/pointer interest in a
  product form; submission never waits for them. If none is ready, show nothing.
- Integrate this into TriggerRouter's existing initial/mutation cart reads and
  EventBus confirmation path. Keep cart_restored non-offering. Carry the verified
  redirect classification to the adaptive engine for theme reporting, while
  retaining mutation-based stale-response and duplicate protection.
- Exercise the real adapters/verification flow on reduced Dawn, a synthetic
  second drawer, popup and cart-page fixtures: no second modal, wait for popup
  close, cart-page delivery after a confirmed native add, one verified impression,
  cancellation on newer mutations, and silent restoration/reload. Extend native
  continuation tests for expiry, cancellation, source tags, invalid form targets,
  failed reads, storage denial, mismatched sessions and unexpected cart deltas.
- Rebuild both SDK assets and run npm.cmd run verify. No dependency, migration,
  authentication, recommendation selection, AI chain, post-purchase or bundle
  Function changes are planned.

Native form.submit() calls that emit no submit event, unsupported/batch forms,
missing referrers and insufficient baseline evidence fail closed. Real rendered
merchant fixtures and the live Dawn/other-drawer/popup/redirect theme matrix remain
manual acceptance; synthetic fixtures do not certify named themes.

Primary references checked:
[Shopify product forms](https://shopify.dev/docs/storefronts/themes/architecture/templates/product/overview)
and [locale-aware Cart API](https://shopify.dev/docs/api/ajax/reference/cart).

## Implemented changes

| Files | Result |
| --- | --- |
| `storefront-sdk/src/nativeCartContinuation.ts` | Passive submit/interest/departure observation and single-use confirmation. Intent TTL 30 seconds; baseline TTL 60 seconds; passive focus/pointer refresh at most once per five seconds. No request on submit. Read only relevant successful controls, including disabled/checkbox/select behavior, without invoking FormData(form) or a theme formdata handler. |
| `storefront-sdk/src/triggerRouter.ts` | Feed successful existing cart reads to the baseline. Consume redirect evidence before the initial asynchronous cart read; after exact delta confirmation, use the normal confirmed add event and mutation routing. Observed Ajax mutations cancel native intents. Ordinary restored carts stay silent. |
| `storefront-sdk/src/widgets/widgetManager.ts`, `storefront-sdk/src/theme/engine.ts` | Associate redirect classification with the same mutation and cart-page location; use the existing adaptive ladder and verified impression path. No server selection or shopper action is derived from that advisory theme hint. |
| `storefront-sdk/src/nativeCartContinuation.test.ts` | 24 tests for one-use confirmation, passive form handling, cancellation, targets/overrides, source tags, batch/duplicate field rejection, freshness/departure, exact quantities, session/shop/referrer/currency mismatches, BFCache, storage denial, consent and obsolete background reads. |
| `storefront-sdk/src/theme/cartFlow.test.ts` | Five integration cases using actual EventBus, TriggerRouter, OfferPoller, WidgetManager, adapters and display verification with simulated Shopify responses/geometry. Dawn and learned second drawer: one verified additive card, no extra modal or recommendation chain. Popup: wait for close then floating fallback. Native redirect: one cart-page card with redirect reporting, followed by a silent reload. Failed destination read: consume the intent without showing an offer. |
| `storefront-sdk/test/fixtures/themes/redirect-product.html`, `storefront-sdk/test/fixtures/themes/README.md` | Synthetic native POST fixture and explicit test/provenance limitations. Existing Dawn/custom/popup/cart-page fixtures reused. |
| `extensions/aovboost-storefront/assets/aovboost-sdk.js`, `extensions/aovboost-storefront/assets/aovboost-theme-engine-*.js` | Rebuilt main SDK and hashed lazy engine. Both must be released together. |
| `docs/codex-phase-4a.md`, this report | Historical Phase 4A follow-up link, plan, implementation, results and release guidance. |

Continuation stores only shop/session identity, a mutation ID, path/time, selected
variant/requested quantity and the baseline's variant quantities/count/currency.
No session credential, cart token, cost, margin or merchant inventory is retained.
It supports one same-tab, same-origin native POST variant add with quantity 1-100,
at most 100 represented cart lines and at most 500 form controls. It never changes
the cart request, submits the form, prevents default, retries a write or removes
the original product. A missing/failing baseline simply disables continuation.

Native continuation is observed browser evidence, not a new security credential.
The existing signed storefront session, proxy checks, tenant isolation, rate
limits, catalog guard and server eligibility checks remain authoritative. The
existing ranking path retains merchant/autopilot/affinity precedence, rejects
excluded or unavailable candidates and rehydrates the ranked order from the
catalog. No new AI call, ranking path or model-selected cart action was added.

## Verification

Baseline: Phase 4A's completed `npm.cmd run verify` passed 625 tests in 87 files.
Targeted native/legacy cart/engine tests passed (40 tests in four files). The new
integrated theme flow passed separately (five tests). After the passive control
reader change, both new files passed together: 29 tests in two files. An earlier
full gate passed 653 tests and the production build; the final gate is rerun for
the added formdata-side-effect regression and final SDK artifacts.

Final results on 6 November 2026:

| Command | Result |
| --- | --- |
| `npm.cmd test -- storefront-sdk/src/nativeCartContinuation.test.ts storefront-sdk/src/theme/cartFlow.test.ts` | Passed: 29 tests in two new files. |
| `npm.cmd run verify` | Passed, exit 0: typecheck, lint, 654 tests in 89 files, SDK build, Prisma generation and production client/server builds. Increase from Phase 4A: 29 tests and two files. |
| `npm.cmd run build:sdk` (through verify/build) | Passed. Regenerated main SDK and `aovboost-theme-engine-B_pv7Vzj.js`; no stale engine asset remains. |
| `node scripts/check-sdk-size.mjs` | Passed: main 158,670 bytes; engine 51,955 bytes; total 210,625 bytes; combined gzip 58,597 bytes. Within existing 170,000 / 240,000 / 65,000 byte budgets. |
| `git diff --check` | Passed; no whitespace errors. |

The existing nonfatal React Router future-flag, Rollup annotation and mixed
static/dynamic-import build warnings remain. No unrelated warning cleanup was
attempted. Verification was run with approved filesystem access because Vite
configuration loading is blocked by the restricted Windows sandbox.

## Manual release and acceptance

1. Review the combined working-tree diff. This follow-up adds no migration. The
   preceding Phase 4A migration `20261106120000_theme_compatibility` and its server
   changes must be applied through your reviewed development/staging/release
   process if still pending. No production migration or deployment was run here.
2. Release the backend and both generated SDK assets together through the normal
   app/Shopify extension release process. No new dependency, environment variable,
   scope, webhook or merchant re-approval is introduced by this follow-up.
3. On a dev store, test Dawn, another drawer theme, a popup-notification theme and
   a native redirect-to-cart theme. Supply sanitized rendered fixtures from those
   real themes; the current fixtures do not certify named non-Dawn themes. Verify
   the hashed engine loads from Shopify's asset CDN.
4. On each theme check product-page add, collection quick-add, drawer-cart add,
   native POST where supported, failed adds, batch/rapid adds, variant choice,
   accepting a recommendation without a new offer, section replacement and an
   actually verified display. A fresh empty cart must override stale session IDs.
5. Reload/back/forward with a nonempty cart and confirm no new unsolicited offer.
   Test expired handoffs, cross-tab cart changes, blocked storage/referrers, mobile
   touch, Tab/Shift+Tab/Escape/focus return, RTL and reduced motion. With AI off,
   deterministic recommendations should still render; chat can stay off.

These checks were exercised with Vitest/jsdom and isolated test data, not a live
Shopify store or browser. No new browser dependency was installed.

Deliberately unchanged: recommendation selection/provider budgets, pairing logic,
authentication, billing, holdout math, post-purchase, bundle Function and database
schema. Replacement/upgrade mutations remain deferred. Native form.submit() calls
without a submit event, batch native forms, other-tab/origin targets, missing
referrers and stale or ambiguous evidence produce no native continuation. Fetch/
XHR paths retain their existing supported behavior. Revised Phase 5 origin and
placement reporting splits are subsequent work, not part of this phase.
