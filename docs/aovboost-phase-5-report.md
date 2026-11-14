# aovboost Phase 5 report

13 November 2026. Phase 5 implements the storefront truthfulness guards, reward-linked progress, payload-specific notice dismissal and safe copy behind `agent_core_enabled`, which remains **off by default**. Phase 6 is not implemented. No deployment or live-store verification was performed.

## Result and audit findings

The four managed surfaces now render only from explicit factual inputs. Generated offer copy cannot establish a reward, an order count/window, a product notice or a campaign deadline. Missing or inconsistent facts suppress the offer. The existing legacy widgets remain unchanged when the flag is off.

The read-only payload audit established these limits:

| Surface        | Existing source                                                                                            | Finding that changed implementation                                                                                                                                                                                        |
| -------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Discount nudge | `discountThreshold` setting; decision payload `threshold`, `cartValue`, generated `copy.rewardDescription` | There is no real spend-reward configuration in the current settings/config response. A threshold and generated reward text cannot prove a promotion exists.                                                                |
| Countdown      | Existing `window.AOVBoost.campaign` and scheduled trigger `endsAt`                                         | This is an explicit campaign source. The renderer uses its absolute deadline and rejects a different deadline in the offer response.                                                                                       |
| Social proof   | `ProductOrderStat.orderCount`, product/affinity payload counts                                             | Counts are recorded through the order-processing path, but the models/payload provide no count window. Affinity counts can also describe co-purchases. They cannot be relabeled as a windowed current-product order count. |
| Inline alert   | Generic bodies for `low_inventory_alert` / `price_drop_webhook`, with per-offer IDs                        | These bodies have no stable notice identity or underlying inventory/price fact in the frontend payload. They are not accepted as authoritative notices by the managed path.                                                |
| Placement      | Existing app-owned `data-aovboost-slot` blocks                                                             | Default empty slots reserve no height. Automatically inserting inline content would shift theme content. Managed factual surfaces require existing reserved space.                                                         |

**Integration requirement:** this phase adds an optional, explicit frontend facts contract. It does not populate missing facts through backend endpoints or new merchant settings. Without real supplied facts, the managed discount/proof/alert surfaces stay hidden. A configured campaign can use the existing campaign object. All four also require a reserved app slot. This is frontend guard implementation, not live promotion/count verification.

## Frontend facts contract

`storefront-sdk/src/agent/OfferFacts.ts` defines the new optional `window.AOVBoost.agentFacts` interface. It is separate from merchant settings, metafields and app-proxy response schemas. Only a merchant-controlled integration backed by actual configuration/records should populate it. `configured: true` and `verified: true` are explicit assertions by that integration; the frontend cannot independently authenticate a Shopify promotion or aggregate orders.

| Field      | Required factual input                                                                                                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `version`  | Exactly `1`. Other versions provide no reward, proof or alert facts.                                                                                                                             |
| `reward`   | Stable `id`, `configured: true`, nonempty `description`, positive finite `threshold`, matching three-letter shop/cart `currency`. Optional absolute `startsAt`/`endsAt`, optional real `code`.   |
| `proof[]`  | Exact current-product GID, `verified: true`, safe integer `count >= MIN_PROOF_COUNT`, and absolute `startsAt`/`endsAt` for that count. The window must be closed, ordered and not in the future. |
| `alerts[]` | Stable public `id`, exact current-product GID and nonempty supplied `body`; optional `headline` and absolute validity dates. A changed notice identity requires a new ID.                        |

The existing campaign input remains `window.AOVBoost.campaign`: a real future `endsAt`, optional valid `startsAt`, and optional supplied `headline`/`body`. Existing `type` continues to drive the scheduled trigger. Deadlines use ISO date-times with `Z` or an explicit offset. Missing, relative, timezone-ambiguous, impossible and expired values are rejected. A missing campaign body has a factual end-time fallback; there is no rolling or evergreen countdown.

Reward thresholds use the existing shared cart value: **Ajax `total_price / 100`, after discounts**, in presentment currency. A source whose actual reward uses a different subtotal/tax/shipping basis must not populate this contract. The integrator must supply a real reward and matching criterion, not copy the legacy threshold into an invented promotion. Threshold/cart precision must fit the currency and existing Ajax amount representation. Invalid precision, unknown cart state, negative values or currency changes suppress progress instead of guessing or converting currencies. Shopify's [cart monetary-field reference](https://shopify.dev/docs/api/liquid/objects/cart) documents presentment currency and the post-discount cart total; this run preserves the repo's existing Ajax amount conversion.

Public IDs/codes have bounded character sets, copy has bounded lengths, and unresolved template placeholders are rejected or receive a safe generic heading where appropriate. Supplied text is escaped before rendering. At most 100 proof/notice entries are considered. No source payload, credentials, cart token, notice text or shopper message is added to storage/logs.

## Shopper behavior

- **Reward progress:** follows the core's refreshed cart snapshot, including real zero carts, additions, removals and quantity changes. It adds no cart fetch or cart interceptor. Progress is clamped to 0–100%; the gap uses `Intl.NumberFormat` with the snapshot's currency and storefront locale. A reached target says **Cart target reached**, never that a reward was earned/applied. A supplied code is shown as an instruction for checkout. The CTA is the locale-aware **Review cart** link and works without AI. No discount is created, applied or automatically accepted by this widget.
- **Countdown:** displays the configured fixed deadline and remaining time, rechecks on visibility changes and removes itself at expiry. Repeated offers cannot extend the configured deadline. It works without chat/AI and has no button pointing at an unavailable assistant.
- **Social proof:** shows one exact current-product count, with both ends of its supplied UTC window. Counts below five, fractional/unsafe counts, missing verification, wrong products or missing/future windows remain hidden. Legacy product/affinity counts are not used as a fallback. There is no rounded-up count or rotating carousel that can overwrite the window label.
- **Inline notice:** displays supplied notice text for the current product, with a safe heading fallback. Keyboard dismissal is remembered for that notice ID for the session, including page reloads and new offer IDs. Copy changes under the same ID stay dismissed. A different notice ID can appear immediately; it does not inherit the previous notice's provider-wide backoff.

All copy/templates introduced here live in `AgentVoice`. The Phase 4 identity is retained. Existing cart upsell, bundle, strip, chat, exit and post-purchase behavior is not rewritten in this phase.

## Placement, accessibility and lifecycle

The four managed surfaces require an existing app-owned slot outside the purchase form. The renderer does not use the older automatic inline insertion fallback for these surfaces. Minimum reserved dimensions are named constants:

| Provider       |  Width | Reserved height |
| -------------- | -----: | --------------: |
| Countdown      | 240 px |          144 px |
| Discount nudge | 240 px |          160 px |
| Social proof   | 240 px |          112 px |
| Inline alert   | 240 px |          136 px |

Reserve the space in the app's own markup/CSS before offers arrive. For example, an app-owned placement may have a fixed/minimum height and full available width; the default empty placement block does not do this automatically. No external theme file or block setting/label was edited. Taller space can improve readability on mobile; bounded internal scrolling keeps long supplied text accessible without moving surrounding content.

The Shadow DOM host fills that reserved space with absolute positioning. Mount, update, expiry and dismissal retain the slot's outer geometry. The renderer uses theme CSS variables, keyboard-reachable dismiss/scroll controls, a live body status and an accessible progress bar. The countdown timer avoids second-by-second live announcements. Reduced motion is honored; the new surfaces introduce no animation.

Cart updates change existing text/progress without replacing focused controls. Timers, signal subscriptions, visibility listeners and resize observers are cleaned up on removal. A slot that becomes too small causes suppression. If the renderer temporarily makes an app slot relative, it restores that inline position on removal. A provider update failure removes the surface, disables that provider for the session and uses the existing flagged debug/decision path; the page continues working.

## File changes

| File                                              | Phase 5 change                                                                                                                                           |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storefront-sdk/src/agent/OfferFacts.ts`          | New typed optional frontend facts boundary; campaign/reward/proof/notice validation, exact fact views and anonymous notice keys.                         |
| `storefront-sdk/src/agent/FactSurfaces.ts`        | Four managed reserved-slot renderers; live progress, real expiry, safe copy, accessibility, cleanup and update failure isolation.                        |
| `storefront-sdk/src/agent/AgentCore.ts`           | Connects factual renderers, pins their factual identity, supplies shared cart/context updates and marks malformed cart amounts unknown.                  |
| `storefront-sdk/src/agent/providers.ts`           | Enforces factual eligibility before mounting; removes AI dependency for countdown/progress and provides notice-specific dismissal identity.              |
| `storefront-sdk/src/agent/Arbiter.ts`, `types.ts` | Optional provider dismissal key; frequency/backoff remains unchanged for providers that use their stable provider ID.                                    |
| `storefront-sdk/src/agent/AgentVoice.ts`          | Safe campaign/notice/reward/proof templates, exact UTC windows and shop-currency gap formatting.                                                         |
| `storefront-sdk/src/agent/constants.ts`           | Named minimum proof count, bounds, tick rate and reserved slot dimensions.                                                                               |
| `storefront-sdk/src/widgets/placement.ts`         | Requires a measurable reserved app slot for managed factual surfaces; preserves legacy placement when off.                                               |
| `storefront-sdk/src/index.ts`                     | Type declaration for optional `agentFacts` and the existing campaign input; no new backend request.                                                      |
| `storefront-sdk/src/agent/OfferFacts.test.ts`     | 49 tests for missing/invalid facts, dates, precision/currency, proof/window/count guards, notice identity, expiry, safe rendering and failure isolation. |
| `storefront-sdk/src/agent/Arbiter.test.ts`        | A dismissed notice backs off while a different payload can appear immediately.                                                                           |
| `scripts/browser-fixture-server.mjs`              | Synthetic reserved slots, currency and factual-widget mode; existing defaults remain.                                                                    |
| `tests/browser/offer-facts.spec.ts`               | 20 desktop/mobile checks for incomplete data, real expiry, proof, notice persistence, progress, reserved placement and flag-off parity.                  |
| `scripts/check-sdk-size.mjs`                      | Explicit combined budget update; all shared/lazy assets still count and the initial SDK ceiling is unchanged.                                            |
| SDK and hashed agent assets                       | Rebuilt artifacts. Theme runtime/CSS behavior and content remain unchanged.                                                                              |

The Phase 0/2/3/4 reports remain historical snapshots. The previously present `docs/widget-behavior-and-verification.md` was not edited. No backend endpoint, AI prompt, billing/Redis implementation, checkout extension, merchant setting label, metafield schema, existing cart property/attribute key or external theme file was changed. The storefront post-purchase widget still adds to a cart; it does not modify a completed order.

## Enable, compatibility and debug

Enable the existing `agent_core_enabled` flag before SDK initialization as described in Phase 4, and supply actual `agentFacts`/campaign inputs plus reserved slots. The flag remains off by default. No merchant flag UI, runtime dependency or framework was added.

Debug remains `?aov_debug=1`, with `window.__AOVBOOST_DEBUG__.decisions()` for candidates and rejection reasons. New reasons include `configured_reward_required`, `reward_currency_mismatch`, `reward_threshold_mismatch`, `future_campaign_required`, `campaign_end_mismatch`, `verified_proof_window_required`, `supplied_alert_required`, `alert_payload_dismissed`, `fact_requires_reserved_slot` and `fact_slot_not_reserved`. With debug off, the new code writes no console output.

No public event is renamed. Existing impression/viewed/interaction/dismissal plumbing is retained. Discount progress keeps the existing `view_cart_goal_picks` click action while its managed CTA goes to the cart. Notice dismissals add a hashed `inline_alert:<hash>` entry to the existing session dismissal map; they do not store the raw ID/body or rename old keys. Other providers keep their existing backoff keys. No compatibility shim is needed. Actual code-use/discount attribution is not inferred from reaching a target or clicking a link; Phase 6 telemetry QA remains deferred.

## Local verification

- Full Vitest suite: **897 passed in 107 files**.
- TypeScript (`npx.cmd tsc --noEmit`), changed-file ESLint and SDK build/size check: passed.
- The full run includes **20 passing Phase 5 browser checks** across desktop/mobile.
- Full final browser suite: **90 passed, 2 skipped**. The skips are the two desktop-only toast checks on mobile. Existing cart-refresh, no-recursion, chat/exit and recommendation paths all passed.
- No real Shopify promotion application, live count source, checkout, physical-device or live-store verification.

Commands: `npx.cmd vitest run --config vitest.config.ts`, `npx.cmd playwright test --max-failures=3`, `npx.cmd tsc --noEmit`, changed-file `npx.cmd eslint ...`, and `npm.cmd run build:sdk`. Tests use synthetic app-proxy/cart responses; existing backend unit/integration tests use their local test infrastructure, not a production migration/deployment.

### Original section 14 checklist

| #   | Result                                    | Evidence / limit                                                                                                                                                                                                               |
| --- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Pass for exercised paths                  | New flag-off notice test and existing product/cart regressions preserve legacy behavior and make no agent asset/health requests when off. Collection live parity is unverified.                                                |
| 2   | Pass in the full browser run              | Quiet launcher behavior remains unchanged. Configured factual ambient surfaces can appear in their reserved slots.                                                                                                             |
| 3   | Pass in the full browser run              | Desktop toast/handoff unchanged; toast remains desktop-only.                                                                                                                                                                   |
| 4   | Pass in the full browser run              | Toast dismissal/session silence unchanged; notice IDs have separate ambient dismissal state.                                                                                                                                   |
| 5   | Pass in the full browser run              | Confirmed shopper add, one acceptance, no recursion and the cart-refresh correction remain in the full suite.                                                                                                                  |
| 6   | Pass in the full browser run              | Existing bundle/strip/chat source and no-recursion checks remain.                                                                                                                                                              |
| 7   | Pass in the full browser run              | Existing active-chat exit suppression remains.                                                                                                                                                                                 |
| 8   | Pass in the full browser run              | Existing once-per-session desktop/mobile exit checks remain.                                                                                                                                                                   |
| 9   | Pass in the full browser run              | Existing local checkout-start suppression remains. Actual checkout was not opened or modified.                                                                                                                                 |
| 10  | Pass for new factual surfaces             | New countdown/progress tests run with chat disabled/unhealthy and have no assistant-dependent CTA. Existing AI failure/retry/fallback checks remain in the full run.                                                           |
| 11  | Pass locally                              | Missing/past/ambiguous/impossible campaign dates suppress; a real configured deadline expires without moving the reserved slot and cannot be extended by a new offer.                                                          |
| 12  | Pass locally                              | Counts below five, missing verification/window, fractional/unsafe counts and wrong products suppress. Valid current-product proof displays the exact count and supplied UTC window.                                            |
| 13  | Existing coverage / no new storage access | New fact readers/renderers use memory; notice hashes use the existing guarded store. Existing blocked-storage cart/chat checks remain in the full run. Persistent dismissal across reload is exercised with available storage. |
| 14  | Pass for new notice control               | Keyboard focus/Enter dismisses a notice; scroll and progress controls are accessible. Existing drawer/chat Escape/focus checks remain. A physical assistive-technology audit was not run.                                      |
| 15  | Code and existing browser coverage        | New factual surfaces contain no animation and honor reduced motion. Existing chat/cart reduced-motion checks remain in the full run.                                                                                           |
| 16  | Pass for local reserved-slot behavior     | Countdown expiry and progress updates retain following-content geometry; a countdown test checks zero fixture CLS. Unreserved slots suppress. This is not a live theme-wide CLS/bandwidth result.                              |
| 17  | Existing coverage                         | Decision logging remains; new suppression reasons are included. No shopper debug overlay was added.                                                                                                                            |
| 18  | Pass in unit/local fixtures               | KES progress uses `Intl` and a live matching cart currency; JPY precision/formatting is covered in unit tests. Currency changes hide the mismatched reward. Live multi-market behavior remains unverified.                     |

## Bundle sizes

Exact bytes use Node `gzipSync` separately per JS artifact. Phase 4 is the baseline.

| Artifact                     |   Phase 4 raw / gzip |   Phase 5 raw / gzip |
| ---------------------------- | -------------------: | -------------------: |
| Initial SDK                  |     168,238 / 46,277 |     168,953 / 46,517 |
| Agent entry + shared runtime |      46,600 / 15,550 |      57,824 / 19,092 |
| Lazy conversation            |        8,441 / 3,331 |        8,441 / 3,329 |
| Theme runtime                |      44,780 / 15,116 |      44,780 / 15,116 |
| **All JS**                   | **268,059 / 80,274** | **279,998 / 84,054** |

Growth: **11,939 raw / 3,780 gzip bytes**. Standalone CSS is unchanged at 27 raw / 47 gzip bytes; the new isolated surface styles are counted in JS. The conversation source is unchanged; its small gzip difference comes from rebuilt shared-chunk references.

The initial SDK ceiling stays **170,000 raw bytes**. The combined ceiling is explicitly raised from **275,000 raw / 82,000 gzip** to **285,000 raw / 87,000 gzip** for the factual validation/rendering path. No emitted chunk is excluded. The core remains flag-only and conversation presentation remains lazy. No runtime dependency was added.

## Open issues, ranked

1. **Verified fact integration is still required.** The current backend supplies neither a reward configuration nor windowed proof nor stable factual notice IDs. A merchant-controlled integration must supply actual records/configuration. The frontend cannot independently certify promotions/counts, and the boolean assertions must never be populated from AI copy. Missing data stays hidden; this run does not claim these surfaces work live.
2. **Default placement blocks do not reserve height.** The managed factual surfaces deliberately suppress in empty/unreserved blocks. Provide reserved space in app-owned placement markup/CSS before rollout and check real theme/mobile readability. No external theme file was changed to force a placement.
3. **Reward application and eligibility are external.** This widget does not create/apply discounts or verify Shopify's complete eligibility rules. Only a matching currency/threshold using the supported cart-value basis is accepted; it never claims application. Actual discount creation, redemption validation, shipping rules and reporting require separately authorized backend work.
4. **Live reliability and integration remain unverified.** AI reachability is still transport-level until a real reply; billing/Redis issues are unchanged. Real theme focus/layout, Safari/touch, live Ajax amounts and live proof source quality need QA.
5. **Phase 4 backend gaps remain.** Visible transcript replay after a full reload is memory-limited, and the server does not consume selected-variant context for model behavior. No backend/history/prompt work was added.
6. **Phase 6 remains outstanding.** Deterministic holdout assignment, end-to-end telemetry/accepted attribution QA and final real storefront performance budgets are not implemented here. Existing holdout and attribution behavior is retained. The initial SDK has limited remaining size headroom.

## Recommended Phase 6 starting point

Review existing anonymous visitor/session identity, server holdout authority and event acceptance/storage before adding deterministic percentage assignment. Keep existing server plan/holdout decisions authoritative, use the current standard telemetry schema and test exposed/holdout visitors against real accepted cart/code outcomes. Include undo, factual-surface suppression and anonymous payload checks. Then measure actual loaded bytes, request timing and CLS on representative themes without changing the default-off flag or deploying automatically.
