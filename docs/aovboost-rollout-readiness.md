# aovboost frontend rollout readiness

14 November 2026. Phases 0–6 have local implementation coverage. This follow-up prepares offline release evidence and a controlled-QA runbook; it does not introduce a Phase 7 or enable the core. **Production rollout remains pending.** No deployment, live request, merchant setting, backend endpoint, checkout extension or external theme file was changed in this follow-up.

## Deliverable

`npm.cmd run check:agent-release` checks the current emitted JavaScript against both build manifests, follows references using the existing `aovboost-*.js` filename convention, rejects missing/stale/unreachable chunks and enforces the existing staged size budgets. It writes ignored `test-results/agent-release.json` with individual SHA-256 hashes, a combined fingerprint, sizes and the observed chunk graph. The app-owned Liquid blocks are also fingerprinted. It reads no environment file, browser storage, credentials or network resource and adds no storefront code or dependency.

The command returns nonzero on failure. An earlier successful report is replaced with `checking` before inspection and `failed` on failure, so an interrupted or failed check does not look like today's passing evidence. A passing report retains `productionReady: false` and `liveVerified: false`.

This is an asset-consistency check, not a JavaScript parser, source-freshness proof, security certification or complete theme-extension fingerprint. CSS/other assets are outside its fingerprint scope. Rebuild before running it; the command cannot determine whether someone changed a source file after the last build. Retain its fingerprint alongside the browser-test result, then rerun after testing and compare fingerprints before release. Never rebuild halfway through browser testing: the build removes superseded hashed chunks.

| File                                       | Change in this follow-up                                                                                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `scripts/check-agent-release.mjs`          | Offline graph/manifest validation, existing budget checks and bounded hash evidence.                                                                               |
| `storefront-sdk/src/agent/release.test.ts` | Nine release-integrity checks, including partial builds, stale/unreachable chunks, manifest traversal, size failures and replacement of outdated success evidence. |
| `package.json`                             | Explicit `check:agent-release` command; existing build, verification and deploy commands are unchanged.                                                            |
| This document                              | Integration findings, QA sequence, release boundaries and rollback procedure.                                                                                      |

## Integration findings and gates

| Gate                  | Source finding                                                                                                                                                                                      | Required before the corresponding live test                                                                                                                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Store/theme selection | `shopify.app.toml` lists `teretret.myshopify.com` as its development store. The historical 12 November live report names `newsliderapp.myshopify.com` and Velour. Neither is freshly verified here. | Confirm the intended development store, theme and installed app version. Do not select a target from a stale report or the CLI default alone.                                                                                                         |
| Core enablement       | `extensions/aovboost-storefront/blocks/aovboost.liquid` assigns a new `window.AOVBoost` object and supplies no core flag. There is no merchant-facing flag control.                                 | In an authorized app-owned QA embed, supply the boolean flag in that object or after that assignment and before SDK initialization. An earlier global assignment is overwritten; a console edit after initialization does not switch a running page.  |
| Facts                 | `OfferFacts.ts` accepts optional `agentFacts` version 1. Current endpoints/embed do not populate it.                                                                                                | Supply authoritative reward, closed-window verified counts and stable notices through a separately reviewed integration. Keep these surfaces hidden until then. A generated offer or legacy spend threshold is insufficient.                          |
| Reserved placement    | `blocks/widget-slot.liquid` emits an empty slot with no reserved height outside design mode.                                                                                                        | Reserve the relevant app-owned space before first paint for the enabled, configured surface. No external theme edits or automatic insertion around purchase controls are needed for this QA run. Missing space must continue to suppress the surface. |
| Auth/privacy          | Existing `SessionManager` caches signed credentials in localStorage. Backend renewal reads the bearer token.                                                                                        | Resolve this under separately authorized auth scope before claiming the entire storefront satisfies the original no-credential-storage requirement. This follow-up introduces no credential storage and does not attempt a frontend-only removal.     |
| Order measurement     | Existing server enrollment and frontend fallback cohorts have different authority/linkage.                                                                                                          | Validate signed server enrollment through a genuine authorized test order before making order/AOV claims. A browser `accepted` event establishes a cart action only.                                                                                  |
| AI health             | The health GET checks endpoint reachability, while actual chat outcomes drive the breaker.                                                                                                          | Test real chat success and retry/failure independently. A healthy HTTP probe does not verify model access, billing or Redis.                                                                                                                          |
| Published assets      | The last historical live report predates these phases and says the cart-refresh correction's release was unconfirmed.                                                                               | Compare actual delivered asset hashes with the reviewed local evidence. Preserve the cart-refresh correction and verify display after acceptance without a reload.                                                                                    |

Managed factual slot minimums are width **240 px** and heights: countdown **144 px**, discount nudge **160 px**, social proof **112 px**, inline alert **136 px** (`agent/constants.ts`). Use the existing `data-aovboost-slot` values. Reserving empty space indiscriminately would change legacy layout; implement the eventual reservation in the app's own markup/CSS alongside the real configuration, while preserving flag-off geometry. This follow-up does not add blank slots or synthetic facts to the shipping embed.

For QA enablement, use `agent_core_enabled: true` and frontend `agent_holdout_percent: 0` before initialization. The percentage defaults to zero but does not override an existing server holdout assignment. The core flag also accepts `window.AOVBoost.settings.agent_core_enabled` and the supplied storefront settings; any `true` enables it. Omit all such `true` values to retain the legacy path. Do not place credentials, tokens or private configuration in this public object.

Debug is `?aov_debug=1`, with decisions at `window.__AOVBOOST_DEBUG__.decisions()`. `?aov_debug=0` clears its persisted switch. Use separate fresh anonymous contexts for test scenarios; retain only sanitized assertions/hashes, never tokens, storage exports, full URLs containing shopper data or chat transcripts.

## Repeatable local verification

Run each command to completion and stop if it fails. These commands do not deploy:

```powershell
npm.cmd run build:sdk
npm.cmd run check:agent-release
npx.cmd vitest run --config vitest.config.ts
npx.cmd tsc --noEmit --pretty false
npx.cmd playwright test --max-failures=3
npm.cmd run check:agent-release
git diff --check
```

Run changed-file ESLint as part of the review. For this tooling-only follow-up, the focused command is:

```powershell
npx.cmd eslint scripts/check-agent-release.mjs storefront-sdk/src/agent/release.test.ts
```

Playwright uses the existing loopback-only fixture server, desktop Chromium/Edge and Pixel 7 emulation. It does not use Shopify, a live AI provider, a database or Redis. Review the Phase 6 checklist for coverage limits; do not label fixture results as live verification. Full local acceptance remains necessary for a release candidate even when the small tooling check passes.

## Controlled live QA sequence

Use an explicitly confirmed development store and test theme, after the reviewed asset set is available there through the normal authorized release process. Upload/deployment is not performed or implied by this runbook. A browser-only SDK substitution is diagnostic evidence, not proof of what Shopify ships.

1. Confirm the app embed, current asset hashes, signed session/config responses, consent behavior and core-off parity on product, collection and cart pages. Check the cart-refresh correction with the core off as well as on.
2. Enable the core only for the agreed QA target. Verify quiet landing, one foreground surface, real dwell/product handoff, dismissal backoff, active-chat suppression, checkout-start silence and desktop/mobile exit limits. Toast is intentionally desktop-only.
3. Make an authorized shopper cart add; verify the refreshed lines, totals and counts before the upsell appears. Accept one selected variant: exactly one cart write, correct source/offer linkage and no recursive upsell. Repeat bundle, strip and chat sources. Restore only known QA cart changes with guarded cleanup.
4. Block AI responses, then storage; verify honest hidden/unavailable chat states, no dead chat CTAs, retryable errors and usable cart controls. Check keyboard focus/Escape, reduced motion, real theme geometry and a slow connection.
5. Test each factual surface only after verified inputs and reserved slots exist. Check expired/missing campaign, below-minimum proof, mismatched currency and a dismissed stable notice. Never invent a promotion/count to make the live test render.
6. Inspect sanitized attribution and server-vs-local cohort metadata. Test holdout invisibility without converting a server-null offer into a fabricated counterfactual. A separate, explicitly authorized test-gateway checkout is needed for order attribution; no real payment is part of this follow-up.

Record desktop and mobile results as pass/fail/not tested, including browser/theme/version, build fingerprint and observed boundary failures. Actual Safari, physical devices, network conditions and production performance remain separate evidence; emulation cannot certify them.

## Rollback and stop conditions

If stacking, recursive offers, stale cart UI, duplicate writes, broken native controls, misleading facts or credential leakage occurs, stop the rollout at that boundary. First disable every accepted `agent_core_enabled` input for the QA target and reload; changing a global after startup does not tear down the running core. Keep holdout at its reviewed configuration; changing its percentage changes cohort membership.

The flag disables managed behavior, not a broken or incomplete asset release. For an asset failure, restore a previously reviewed **complete** theme-extension asset/block set through the normal release process. Keep the SDK, hashed core/shared/chat chunks and theme engine together; never replace only the fixed-name SDK. Preserve a version containing the cart-refresh correction: the last documented live release is not proof that the correction shipped. Recheck actual CDN hashes, then native cart behavior. Shopify extension delivery and hosted backend delivery are separate release boundaries; no backend rollback is proposed here.

## Results of this follow-up

- Source audit and the offline check against the current local build: passed locally.
- Focused release-integrity and existing size tests: **11 passed in 2 files**.
- TypeScript, changed-file ESLint, formatting, Node syntax and `git diff --check`: passed.
- Shipped runtime/blocks are unchanged in this follow-up. Existing initial JavaScript remains **169,417 raw / 46,663 gzip bytes**; combined JavaScript remains **284,142 / 85,392**. Budgets were not raised.
- The previous Phase 6 full run reported **913 unit tests**, **104 browser passes** and **2 intentional mobile skips**. Those are historical results, not a new full run in this tooling-only follow-up.
- Live store/theme/auth/model/order verification, enabling the flag, facts integration, deployment and backend repairs: **not performed**.

The next executable milestone is controlled QA once the target and release path are confirmed. Auth migration, real facts delivery and order-level experiment validation need their own authorized scope; they are not hidden prerequisites implemented by this frontend check.
