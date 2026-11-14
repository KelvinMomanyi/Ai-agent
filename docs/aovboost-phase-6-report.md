# aovboost Phase 6 report

13 November 2026. Phase 6 adds deterministic frontend holdout assignment, standard-event attribution/privacy checks and staged storefront performance budgets. `agent_core_enabled` remains **off by default**, and the new frontend holdout percentage defaults to **0**. No dashboard, backend endpoint, AI prompt, billing/Redis implementation, checkout extension or deployment was changed. Verification is local only.

## Result and authority rules

The read-only audit found an existing server experiment in `app/models/holdout.server.ts`. It hashes shop plus anonymous identity using SHA-256 into 10,000 buckets, stores sticky enrollment, issues signed measurement links and joins cart/order outcomes. The current frontend receives that measurement through session/config/offer responses. Replacing or adding another assignment on top of those arms would mix experiments.

The managed runtime now resolves assignment in this order:

1. **Existing server measurement:** both exposed and holdout arms remain authoritative. A server exposed arm is not moved into frontend holdout, even if the local percentage is 100.
2. **Explicit server holdout state:** existing forced holdout continues to suppress surfaces when no active measurement is available.
3. **Frontend fallback:** only when there is no authoritative server assignment, the existing anonymous storefront identity is hashed with the shop using versioned FNV-1a, modulo 100. Buckets below the configured percentage are holdout. The percentage must be an integer from 0 to 100; missing/invalid values become zero. Local assignment is disabled when analytics is disabled.

The server and frontend hash schemes are intentionally separate and labeled. The frontend does not mint a server measurement link, change an existing cart attribute or enroll visitors into the server database experiment. Assignment is recomputed when authoritative measurement changes; a later server holdout removes an already-visible provider. The local identity is the existing `SessionManager.anonymousId`, with the existing anonymous core-session ID as a fallback. No fingerprint, cookie, token or new browser-storage entry is added by assignment. Stability depends on the existing anonymous identity surviving; blocked/cleared storage cannot guarantee cross-document identity continuity.

## Configuration and diagnostics

Before the deferred SDK initializes:

```js
window.AOVBoost = {
  ...window.AOVBoost,
  agent_core_enabled: true,
  agent_holdout_percent: 10,
};
```

`agent_holdout_percent` is a new optional frontend configuration field, not a renamed merchant setting or backend schema field. It defaults to zero and is ignored when the core is off. It applies only without an active server assignment. No merchant settings UI, framework or runtime dependency was added. Keep a fixed configuration when comparing cohorts; changing the percentage moves the deterministic threshold.

Debug remains `?aov_debug=1` and `window.__AOVBOOST_DEBUG__.decisions()`. New events identify assignment using `holdout_source` (`server`, `server_setting`, or `agent`), `holdout_version` and `holdout_percent`. No raw hash input, signed link, token or visitor bucket is logged. Debug off produces no new console output.

## Holdout and counterfactual behavior

Holdout visitors mount no aovboost providers. Their ordinary theme cart/add behavior continues. The Arbiter still evaluates candidate eligibility; identical provider/offer/page counterfactual events are deduplicated in a bounded in-memory set. Real shown counters, impressions, viewed events and accepts are not manufactured for holdout visitors. Debug continues to record every evaluation.

Mobile exit observations continue in holdout so those moments can be evaluated without showing a sheet. Enabled chat can perform the existing bounded GET reachability probe in holdout, allowing its ordinary health-dependent eligibility to be evaluated. Holdout does not automatically open chat or POST a conversation. An eligible shadow toast/exit CTA does not require an actually mounted launcher, since all providers are suppressed in that arm.

**Meaning of `would_have_shown`:** it records an eligible pre-mount candidate, not a verified display. Recommendation hydration/placement/visibility are not performed by mounting hidden widgets. A PDP context-ID lookup can still occur through the existing offer request path; recommendation hydration and fallback requests are not started merely to display a holdout surface.

**Server limitation:** an existing server holdout may return `widgetType: null` with `holdout_assigned`. Without a candidate, the frontend cannot honestly infer which products/widget would have been shown. It does not bypass the server to obtain a counterfactual offer. Frontend fallback holdout can record candidates that the ordinary server path actually returns. These limitations are explicit; candidate counts are not AOV lift or completed-order measurements.

## Telemetry and attribution QA

The seven standard event names remain `impression`, `viewed`, `interaction`, `accepted`, `dismissed`, `suppressed` and `would_have_shown`. The schema retains `provider_id`, `surface_class`, `trigger_signal`, `page_type`, anonymous `session_id`, `holdout`, `ai_healthy` and `ts`, and adds:

| Field                                                  | Meaning                                                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `offer_id` plus legacy `offerId`                       | The actual offer ID when available. Both are supplied for compatibility with existing ingestion. |
| `mutation_id`                                          | The confirmed cart mutation ID for acceptance.                                                   |
| `cart_source`                                          | Existing `aov_*` source identifying the initiating provider.                                     |
| `holdout_source`, `holdout_version`, `holdout_percent` | Which assignment authority/configuration applied to the event.                                   |

Provider adapters expose their current offer ID and original trigger. A bounded in-memory offer/trigger map preserves attribution when a confirmed cart refresh arrives after the UI closes or another offer is selected. The cart completion event carries the existing `_aovboost_offer_id` from the actual outgoing line properties; no property key or cart request schema is changed. Accepted events join that ID and mutation/source after the existing section refresh and authoritative cart sync. Shopper adds, failed/unconfirmed writes and undo restoration are not counted as provider accepts. Bundle writes remain one action/acceptance, not one acceptance per line.

`trigger_signal` now retains the original offer trigger, including the existing public `cart_item_added` name, rather than reporting every mounting decision as `offer_ready`. No public trigger/event is renamed. Existing legacy widget tracking remains available. Standard `impression` and legacy `widget_impression` are separate compatibility records; do not sum them as two exposures. Existing backend offer shown/clicked updates are idempotent flags, and its existing usage path deduplicates offer IDs. Backend analytics/reporting was not rewritten.

`viewed` requires continuous >=50% intersection for a full second after the verified mount. Remaining above the threshold does not restart that timer. Hiding the document cancels it; visibility must resume for a fresh second. Unmount/disconnection and queued callbacks after cleanup cannot create a later viewed event. The existing adaptive cart's own display verification completes before the standard viewed timer begins.

The new standard provider schema is whitelisted **before EventBus records/buffers it**. Unexpected fields, shopper copy/cart snapshots and credentials are removed; standard-event URL/referrer are empty so query-string data cannot leak into this schema. Provider IDs, opaque IDs, source names, reason labels and timestamps are bounded/validated. Anonymous transport shop/session fields and existing authentication remain. Legacy events without the new provider schema retain their compatibility path; this is not a rewrite of every historical event.

Initialization and sending retain the existing consent/analytics gates. Browser QA checks the configured tracking-consent requirement against Shopify's privacy API: no session/config/offer/chat/events request before consent, then normal startup after consent. Revocation prevents a newly tracked event from being queued/transmitted. It cannot retract a request already sent. No new legal/privacy policy or consent UI was introduced.

**Acceptance is not purchase conversion.** Reaching a spend target, showing a code or clicking Review cart does not emit acceptance. This frontend does not apply a code or verify completed-order redemption. Existing signed order-webhook/authenticated checkout attribution remains the source of revenue truth. No conversion/revenue claim was added to browser telemetry.

## Performance budgets and local measurements

The existing **170,000 raw initial SDK** and **285,000 raw / 87,000 gzip combined JS** ceilings are unchanged. The checker now also gates loading stages and the lazy chat chunk. Every emitted shared/lazy artifact still counts; stale/missing artifact checks remain.

| Stage                                    | Raw ceiling | Gzip ceiling | Measured raw / gzip |
| ---------------------------------------- | ----------: | -----------: | ------------------: |
| Initial SDK, core off                    |     170,000 |       48,000 |    169,417 / 46,663 |
| SDK + eager agent entry/shared runtime   |     240,000 |       72,000 |    230,823 / 66,913 |
| SDK + agent + first chat intent          |     250,000 |       76,000 |    239,264 / 70,244 |
| Lazy conversation chunk                  |       9,000 |        3,600 |       8,441 / 3,331 |
| All JS, including adaptive theme runtime |     285,000 |       87,000 |    284,142 / 85,392 |

Exact bytes are Node `gzipSync` per artifact, compared with Phase 5:

| Artifact                     |   Phase 5 raw / gzip |   Phase 6 raw / gzip |
| ---------------------------- | -------------------: | -------------------: |
| Initial SDK                  |     168,953 / 46,517 |     169,417 / 46,663 |
| Agent entry + shared runtime |      57,824 / 19,092 |      61,406 / 20,250 |
| Lazy conversation            |        8,441 / 3,329 |        8,441 / 3,331 |
| Adaptive theme runtime       |      44,780 / 15,116 |      44,878 / 15,148 |
| **All JS**                   | **279,998 / 84,054** | **284,142 / 85,392** |

Total growth is **4,144 raw / 1,338 gzip bytes**. The adaptive runtime also includes the additive post-refresh offer-ID metadata helper, which explains its small rebuilt change; the cart-refresh algorithm is unchanged. CSS remains 27 raw / 47 gzip bytes. No runtime dependency was added and no budget was increased in this phase.

Browser checks verify these loading boundaries on desktop and Pixel 7 emulation:

- Core off, even with local percentage 100: only the initial SDK JS loads.
- Quiet managed launcher: SDK plus agent entry/shared module, each once; no conversation or adaptive theme module request.
- First chat gesture: exactly one conversation module request; existing modules are not requested again. Following theme content retains its geometry, and local CLS is gated at <=0.01.

Request names/counts are observed in the browser; stage bytes come from the served build artifacts. The loopback fixture does not emulate CDN compression, so gzip figures are artifact estimates, not measured live network transfer. Performance attachments are `sdk-performance.json` in the local Playwright report/test output. There is no production LCP/INP/CPU, real mobile-radio or theme-wide CLS certification.

## Files changed in this phase

| File                                                                                                     | Phase 6 change                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `storefront-sdk/src/agent/Holdout.ts`                                                                    | Pure deterministic bucket assignment, validated percentages, server precedence and safe assignment metadata.                                                 |
| `storefront-sdk/src/agent/AgentCore.ts`                                                                  | Supplies assignment to context, reacts to authoritative changes, installs safe telemetry projection and carries confirmed offer/mutation/source attribution. |
| `storefront-sdk/src/agent/Telemetry.ts`                                                                  | Whitelisted standard schema, anonymous cohort tags, offer-trigger history, bounded counterfactual dedupe and continuous visibility cleanup.                  |
| `storefront-sdk/src/agent/providers.ts`, `types.ts`                                                      | Optional provider attribution hook and shadow assistant eligibility without a mounted launcher.                                                              |
| `storefront-sdk/src/agent/MobileExitSignals.ts`                                                          | Allows counterfactual mobile moment observation during holdout; the Arbiter still mounts nothing.                                                            |
| `storefront-sdk/src/agent/constants.ts`                                                                  | Named telemetry history/dedupe bound.                                                                                                                        |
| `storefront-sdk/src/index.ts`                                                                            | Optional frontend percentage type, existing anonymous/server/analytics getters and flag-only telemetry installation.                                         |
| `storefront-sdk/src/eventBus.ts`                                                                         | Optional projection before standard events reach session recording/network buffering; legacy/off paths remain.                                               |
| `storefront-sdk/src/shopifyCart.ts`                                                                      | Additive offer-ID completion metadata read from existing outgoing line properties after refresh. No request/property/attribute rename.                       |
| `scripts/check-sdk-size.mjs`                                                                             | Staged raw/gzip budgets and reusable size measurements while keeping existing ceilings.                                                                      |
| `storefront-sdk/src/agent/Holdout.test.ts`, `Telemetry.test.ts`, `storefront-sdk/src/theme/size.test.ts` | Assignment, privacy, correlation, dedupe, visibility/cleanup and staged budget coverage.                                                                     |
| `scripts/browser-fixture-server.mjs`                                                                     | Optional absent server measurement and additive safe event metadata for local QA. Existing default fixture behavior remains.                                 |
| `tests/browser/measurement.spec.ts`                                                                      | Actual cart attribution, local/server assignment precedence/transitions, counterfactuals and consent checks on desktop/mobile.                               |
| `tests/browser/performance.spec.ts`                                                                      | Actual loading-stage request boundaries, dedupe, geometry/CLS assertions and attached size data.                                                             |
| SDK, hashed agent/theme assets                                                                           | Rebuilt delivery artifacts.                                                                                                                                  |

Previous phase reports remain historical snapshots. The existing `docs/widget-behavior-and-verification.md` was not edited. No backend/shared holdout implementation, merchant-facing label, cart key, metafield schema, checkout extension, external theme file or AI/system prompt was changed.

Compatibility additions are the optional provider attribution hook, `offer_id` with retained `offerId`, completion-event `offerId`, and cohort/mutation/source fields. There are no renamed public events and no changed existing cart attribute/property keys. The server's `__aovboost_measurement__` linkage is retained exactly.

## Verification

- Full Vitest suite: **913 passed in 108 files**.
- TypeScript (`npx.cmd tsc --noEmit`), changed-file ESLint and SDK/staged-size build: passed.
- The full run includes **14 passing Phase 6 checks** across desktop/mobile.
- Final complete browser suite: **104 passed, 2 skipped**. The skips are the two desktop-only toast checks on mobile. Existing cart-refresh, no-recursion and widget flows passed alongside the new measurement/performance checks.
- No deployment, live AI/store, actual code redemption, real completed-order conversion or physical-device verification.

Commands run: `npm.cmd run build:sdk`; `npx.cmd vitest run --config vitest.config.ts`; `npx.cmd playwright test --max-failures=3`; `npx.cmd tsc --noEmit`; changed-file `npx.cmd eslint ...`. The browser server and all responses are synthetic and loopback-only; the broader unit/integration suite uses its existing local test infrastructure.

### Original section 14 checklist

| #   | Local status            | Evidence / limit                                                                                                                                                                  |
| --- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Pass locally            | Legacy product/cart behavior and no-agent-request checks remain; new performance check also uses local percentage 100 with core off. Live collection/theme parity is unverified.  |
| 2   | Pass locally            | Quiet launcher and no pre-intent conversation chunk are checked. Eligible configured ambient facts may occupy reserved slots.                                                     |
| 3   | Pass locally            | Desktop dwell/toast/product handoff retained; toast remains explicitly desktop-only.                                                                                              |
| 4   | Pass locally            | Existing two-dismissal session silence/backoff test retained.                                                                                                                     |
| 5   | Pass locally            | Shopper acceptance, one attributed app acceptance, no recursion and the cart-refresh correction retained. New telemetry test joins the confirmed mutation to its offer.           |
| 6   | Pass locally            | Bundle/strip/chat source tests and undo remain. Undo restoration exclusion also has unit coverage.                                                                                |
| 7   | Pass locally            | Active-chat exit suppression retained.                                                                                                                                            |
| 8   | Pass locally            | Once-per-session desktop/mobile exit retained. Holdout mobile signals never mount a sheet.                                                                                        |
| 9   | Pass locally            | Local checkout-start suppression retained; actual checkout unchanged/unopened.                                                                                                    |
| 10  | Pass locally            | Existing bounded error/retry and approved-catalog fallback checks retained. Reachability still does not establish provider/billing/Redis health.                                  |
| 11  | Pass locally            | Configured absolute countdown expiry/invalid-date guards retained.                                                                                                                |
| 12  | Pass locally            | Exact proof minimum, current product and closed window guards retained. Live proof data remains unavailable without integration.                                                  |
| 13  | Existing local coverage | Blocked-storage cart/chat tests retained; holdout assignment adds no storage access. Cross-document identity remains dependent on existing storage/auth continuity.               |
| 14  | Pass locally            | Existing keyboard dismissal, Escape/focus and notice controls retained. No physical assistive-technology audit.                                                                   |
| 15  | Pass locally            | Existing reduced-motion checks retained.                                                                                                                                          |
| 16  | New tests pass locally  | Staged budgets and request loading boundaries pass; fixture geometry/CLS checks pass. Final full suite includes delayed module/coalescing tests. No production performance claim. |
| 17  | Pass locally            | Existing candidate/rejection decision log retained; cohort source is inspectable in new safe event fields.                                                                        |
| 18  | Existing local coverage | KES/JPY/currency mismatch tests retained. New telemetry does not introduce currency/revenue calculations. Live multi-market behavior remains unverified.                          |

## Open issues and rollout limits, ranked

1. **Frontend cohort is not a completed-order experiment.** The new fallback is separately tagged and has no new signed order linkage. Only the existing server experiment has its established cart/order enrollment path. Do not combine cohort authorities or claim revenue/AOV lift from browser accepts/candidate events. A real order-level validation requires separately scoped backend/analytics work and live data.
2. **Pre-existing storage/privacy debt remains.** `SessionManager` currently caches signed storefront credentials in localStorage, and legacy events can contain URLs/referrers. This phase introduces no such storage and sanitizes the new provider schema before buffering. It does not certify the entire old app as credential/PII-free. Removing the old credential cache would affect signed session renewal/sticky enrollment: `renewalSessionId` currently relies on the bearer token. A safe auth/privacy migration needs separate backend scope and compatibility review.
3. **Server-null counterfactuals are unavailable.** A server holdout that returns no offer cannot provide product-level `would_have_shown` evidence to this frontend. No shadow offer request bypass or fabricated exposure was added. Even supplied candidates are pre-mount opportunities, not verified visibility.
4. **Performance is local and headroom is small.** Real storefront/theme/region/mobile-radio CLS and runtime timing still need QA. Initial raw headroom is 583 bytes; combined raw headroom is 858 bytes. Future changes must fit or justify a reviewed budget decision; no limits were silently relaxed here.
5. **Phase 5 integrations remain required.** Real reward facts, verified count windows, stable notices and reserved app slots are not populated by the existing backend. Invalid/missing data stays hidden. Discount application/eligibility remains external.
6. **Backend AI and checkout limits remain.** Billing/Redis/model reliability was not changed. The storefront post-purchase action still adds to a cart, not a completed order. The checkout extension was not modified.
7. **Phase 4 chat gaps remain.** Visible transcript replay after a full document reload is memory-limited; server model context does not consume the selected-variant metadata. No history endpoint or prompt change was introduced.

## Next work

Phases 0–6 now have local frontend implementation/report coverage. Keep the core off while reviewing the remaining integration/auth/measurement limits. A separately authorized follow-up can plan controlled live QA on representative themes, supply verified facts/reserved placements and validate the existing server experiment against signed order outcomes. No deployment, dashboard, backend migration or additional numbered phase is implied by this report.
