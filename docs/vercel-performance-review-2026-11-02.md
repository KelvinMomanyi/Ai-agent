# AOVBoost Vercel performance and Hobby usage review

Reviewed November 2, 2026. This supplements `vercel-hobby-audit.md`; that earlier report is preserved. Application code and Vercel configuration were not changed.

## Result

The application has avoidable recurring requests and operations whose cost grows with the entire catalog or reporting history. The first changes should consolidate storefront telemetry and bound webhook work. Moving to a larger plan alone would leave those inefficiencies in place.

**Team authorization succeeded on November 2, 2026; the account is confirmed on Hobby.** Scoped project/deployment reads and runtime logs now work. The remaining metrics restriction is a `402 payment_required` response: Vercel requires Observability Plus for the detailed query API, which is unavailable on Hobby. This review therefore combines verified source findings, deployment metadata and limited runtime evidence; it does not provide a measured resource ranking or remaining quota percentage. Do not interpret unavailable metrics as zero usage.

## Deployment evidence

| Item | MCP result |
| --- | --- |
| Project | `ai-agent` / `prj_eKfMXvc2E0kQosLSFnKBlszk6zQE` |
| Owning account | `team_cRkjburR63WK9vk3G4Yey0gh` / scope `bostone339-6995` |
| Account plan | `hobby`, confirmed by the authorized Git deployment context tool |
| Production alias | `ai-agent-dusky-nine.vercel.app` |
| Production deployment | `dpl_C2r7UBgsLgJVKRxKkonWF9ZFWxkK`, `READY` |
| Source | GitHub `KelvinMomanyi/Ai-agent`, `main` |
| Deployed commit | `a776b32c831dd688bdaf5b58668b03359af44ff7`, matching local HEAD |
| Deployment region metadata | `iad1`; one recent invocation log instead identifies `cle1` |
| Project Node setting | `26.x` |
| Observed runtime | `nodejs26.x`; Shopify API startup log reports Node `v26.13.0` |
| Framework | React Router |

The effective Fluid Compute setting, function memory, function maximum duration, generated function layout, database/Redis locations and production feature flags were not exposed by the metadata response. A ready deployment does not prove healthy application requests. The observed Node version establishes the runtime of the sampled invocation, not every deployed function. The difference between deployment region metadata and the sampled invocation region remains unexplained; neither establishes database proximity.

## Authorized production observations

Collected approximately 11:40-11:44 UTC on November 2, 2026 (14:40-14:44 in Nairobi), against the exact team and project above.

| Check | Observed result | Interpretation |
| --- | --- | --- |
| Scoped project/team access | Successful | The earlier `403` authorization problem is resolved. No new team consent is needed. |
| Team deployment context | Plan `hobby`; projects `ai-agent`, `smart-bill-self`, `treadora-docs` | Other projects exist under the same account; no usage attribution or allowance consumption was returned. |
| Function invocation query | `402 payment_required`, Observability Plus required | A valid scoped query for `vercel.function_invocation.count`, aggregation `sum`, grouped by `route`, from November 1 00:00 to November 2 11:40 UTC could not run on this plan. No invocation count was obtained. |
| Production logs, 10:51:46-11:41:46 UTC | One returned info record for POST `/api/webhooks` at 11:31:42.561 UTC | The line reports Shopify API initialization, not webhook topic, completion status, duration, CPU or memory. One log record is not one total request. |
| Production warning/error/fatal logs, 10:53:12-11:43:12 UTC | No matching records returned | No such retained log lines were found in this short window. This is not a full error-rate or health measurement. |
| Runtime errors, requested lookback 24 hours | One group, count 1, GET `/internal/token-migration`, November 1 at 15:37:44 UTC | React Router reports a GET to a route without a loader. The source exports only an action. This is a concrete method-handling issue, not evidence of an expensive migration job. |
| Billing charges, October 3-November 3 UTC | `404 costs_not_found` | A charge feed is not the same as free-tier resource usage. This response establishes neither zero resource usage nor remaining allowance. |
| CLI fallback | No installed `vercel` command or existing authentication files found in the checked standard locations | No authenticated CLI fallback was available; no login, linking, token creation or installation was performed. |
| Free usage dashboard | Browser opened Vercel login instead of the dashboard | MCP consent does not sign this separate browser into the dashboard. The user was asked to paste its date range and basic resource totals. No login or paid upgrade was performed. |

The free observability experience and short runtime logs remain available, but detailed query access and route breakdowns require Observability Plus. This is a plan restriction, not another failed authorization. [Vercel observability limits](https://vercel.com/docs/observability/observability-plus#limitations)

For the token-migration error, a small follow-up fix is to export a loader that returns HTTP 405 (with `Allow: POST` and `Cache-Control: no-store`) so incidental GET/HEAD requests are rejected deliberately. Keep migration execution behind its existing authenticated POST action. A single observed error makes this lower priority than reducing recurring telemetry and webhook fan-out. Application code was not changed during this audit.

## Relevant Hobby allowances

Vercel's current official pages list these allowances for Fluid Compute. The account is confirmed on Hobby; its actual usage window and effective compute settings still need verification.

| Resource | Included usage |
| --- | ---: |
| Function invocations | 1,000,000 / month |
| Active CPU | 4 CPU hours / month |
| Provisioned memory | 360 GB hours / month |
| CDN requests | 1,000,000 / month |
| Fast Data Transfer | 100 GB / month |
| Fast Origin Transfer | 10 GB / month |

Sources: [Function pricing](https://vercel.com/docs/functions/usage-and-pricing), [pricing](https://vercel.com/pricing), [fair-use guidelines](https://vercel.com/docs/limits/fair-use-guidelines).

CPU time excludes waiting for network/database/model responses. Those waits still keep memory allocated. Fluid Compute can share an instance among concurrent requests, so adding up all request wall times overstates billable memory time when requests overlap. At 2 GB, 360 GB hours represents 180 busy instance-hours; this is an illustration, not a measured application capacity. [Compute billing model](https://vercel.com/docs/functions/usage-and-pricing#resource-details)

Hobby also restricts usage to personal, non-commercial projects. A production merchant-facing app used to increase sales needs an eligible commercial plan even if its resource consumption fits the free allowances. Development/prototype use and a commercial deployment are different cases. [Commercial usage policy](https://vercel.com/docs/limits/fair-use-guidelines#commercial-usage)

## Prioritized findings

### 1. Separate 30-second session heartbeats add baseline traffic

Evidence: `storefront-sdk/src/sessionManager.ts:90-98,373-408`, `storefront-sdk/src/eventBus.ts:99-177`, `app/routes/api.events.tsx:42-102,141-151`, `app/models/event.server.ts:16-51`, `app/models/session.server.ts:64-99`.

Each initialized storefront tab schedules a session-sync POST every 30 seconds and another on page exit. This is independent of EventBus, which sends queued behavior in batches after two seconds. The heartbeat has no visibility/idle guard or change detection. If credentials are unavailable, its timer can instead retry authentication.

An accepted heartbeat runs two installation lookups, distributed rate limiting, an analytics setting lookup, a session transaction and an event insert when analytics is enabled. Disabling analytics only returns from ingestion after the earlier request/authentication/installation/rate-limit work. Merely returning quickly on the server still consumes a function invocation.

Recommended implementation:

- Use one telemetry queue/scheduler and attach the latest session snapshot to an ordinary event batch.
- Pause nonessential telemetry in hidden tabs; use a bounded idle policy and record active-visible duration deliberately so analytics semantics remain correct.
- Retain a low-frequency heartbeat only where freshness is needed, and coalesce multiple tabs if practical.
- Send important cart/checkout/offer signals promptly and flush remaining telemetry at page exit. Keep Shopify's verified purchase attribution intact.
- Avoid redundant config bootstrap calls if session bootstrap already supplies current settings.

Expected direction: fewer invocations, Redis operations, database writes and stored session-sync events. Moving a standalone heartbeat from 30 to 120 seconds reduces that timer's steady-state request rate by 75%; merging it into existing batches can save more. Neither figure predicts total app savings.

### 2. Product webhooks rebuild the whole catalog

Evidence: `app/routes/api.webhooks.tsx:28-82,212`, `app/models/catalogCache.server.ts:93-110`.

A product create/update/delete can synchronously load all shop products, include order statistics, rank the catalog twice, build full and hot snapshots and serialize/write current, stale and hot caches. Updating U products in an N-product shop can repeat O(U x N) catalog processing. Concurrent updates can overlap these rebuilds.

Recommended implementation:

- Persist the product change and a durable refresh task, then acknowledge the webhook.
- Coalesce pending refreshes per shop using a distributed lease and a version/dirty marker so updates arriving during a rebuild are not lost.
- Prefer targeted invalidation or per-product cache updates; retain full rebuilds for actual bulk reconciliation.
- Reuse the ranked result rather than sorting twice.
- Make task acceptance/idempotency durable before acknowledging. An unawaited promise alone is not a safe background worker on serverless hosting.

This should reduce CPU, serialized bytes, database reads and overlapping memory allocations during imports/inventory updates. The frequency of live product webhooks is not measured.

### 3. Order affinity updates fan out across all products

Evidence: `app/routes/api.webhooks.tsx:86-98`, `app/models/product.server.ts:238-301,304-415`.

After incrementing order statistics, each purchased known product is compared with every other product. For each target there is an individual affinity lookup and potentially an upsert. Four source products can run together, and each source uses an unbounded `Promise.all` over targets.

Illustration: four known purchased products in a 5,000-product shop produce about 19,996 target lookups, plus possible writes and earlier order work. This describes the code's operation count, not a measured production incident. Initial catalog affinity building has separate bounds; this finding concerns order processing.

Recommended implementation:

- Update the co-purchased pairs incrementally and restrict additional similarity candidates by category or a fixed top-K.
- Fetch existing affinities in batches and bulk-write changed results.
- Bound concurrency across targets and jobs, not just across the four source products.
- Move expensive recomputation into a durable resumable task. Preserve order idempotency and task retry state separately: the order marker is committed before the later recomputation, so a failed recomputation needs its own retry record.

This is the largest obvious database fan-out risk in the source and should be addressed before onboarding large catalogs.

### 4. Enabled live updates add six requests per minute per open tab

Evidence: `storefront-sdk/src/liveUpdates.ts:3-5,44-140`, `storefront-sdk/src/index.ts:119-120`, `app/models/settings.server.ts:54-60`, `app/routes/api.live.tsx:82-117`.

Live updates use completed polls approximately every ten seconds, after an initial 2.5-second delay. They require the exact server flag `AOVBOOST_ENABLE_LIVE_EVENTS=true`; the source default is off. The production flag is unknown. The client handles pagehide/pageshow but does not explicitly suppress hidden-tab polling or back off successful empty results. There is already a longer retry on HTTP 429.

Keep the feature off if it is unnecessary. If needed, poll only for relevant product/cart contexts, pause hidden/idle tabs, and back off empty/error responses with jitter and a sensible cap. Reset the delay on visible user activity. Delivery deduplication and price/inventory correctness must survive these changes.

If currently disabled, disabling it again saves nothing. Do not describe this as confirmed live traffic.

### 5. Analytics loaders retrieve whole datasets and aggregate in Node

Evidence: `app/models/analytics.server.ts:75-130,570-598`, `app/models/salesAnalytics.server.ts:39-100`, `app/routes/app.analytics.tsx:25-35`.

Revenue and sales reports read raw sessions, offers, events and outcomes. Several datasets overlap across the two reports loaded together. A 30-day filter does not bound row count. Experiment analytics reads all experiment offers and repeatedly filters them per experiment.

Recommended implementation:

- Compute counts/sums/grouping in the database and maintain daily shop/widget/experiment rollups for charts.
- Briefly cache tenant-scoped summaries, with clear invalidation or accepted reporting delay; keep detailed views paginated.
- Share common reporting inputs rather than loading them twice.
- Verify query plans for candidate indexes such as `Event(storeId,event,timestamp)`, `Offer(shop,createdAt)` and `RecommendationOutcome(shop,shownAt)`. Current schema indexes do not directly cover all these filters. Indexes need database evidence; adding them blindly increases write/storage cost.

This risk grows with merchant history even if dashboard request counts stay low.

### 6. AI and full-catalog chat context multiply per-request work

Evidence: `app/routes/api.chat.tsx:195,568,701,743`, `app/ai/client.server.ts:37-46,148-173`, `app/models/chatContext.server.ts:279-283`, `app/ai/decisionEngine.server.ts:124-147,186-204`, `app/ai/copyWriter.server.ts:24-47`.

Chat can make a second AI call after tools. Some offer triggers also make separate AI calls for deciding a widget and writing its copy. Initial/navigation/cart-add paths already opt out of AI copy generation, so they should not be counted as universally making two AI calls. Existing AI timeouts and deterministic fallbacks are useful safeguards.

Chat loads a full catalog snapshot before selecting relevant context. A cache hit still transfers/parses that snapshot; on a miss it can trigger a full rebuild. The 500-product offer hot-cache limit does not protect this chat path. Model API charges and Redis/database charges are separate from Vercel usage.

Recommended implementation: use bounded product retrieval/search for chat; cache reusable non-personal copy by shop/config/catalog version; combine decision and wording where both genuinely need AI; prefer existing deterministic paths for straightforward triggers. Add shared shop/day and global AI budgets/concurrency limits, and propagate client cancellation to provider calls. Preserve product validation, permissions and per-shop isolation.

### 7. Variant-only cart resolution can scan every product before the offer cache

Evidence: `app/routes/api.offer.tsx:96-121,441-466`.

When direct cart product IDs are absent but variant IDs exist, the route loads every product's metafields and filters in Node to resolve product IDs. This happens before the offer decision cache lookup. The standard SDK supplies product IDs, so this is a conditional compatibility/fallback path, not every offer request.

Maintain a variant-to-product lookup indexed by shop and variant ID, or query only the relevant persisted variant mapping. Keep direct IDs in SDK requests. A decision cache does not avoid expensive work performed before its lookup.

### 8. Redis fallback weakens distributed protection and contains a TTL defect

Evidence: `app/redis.server.ts:11,42-50,129-137,204-217,233-238`.

Ordinary cache/rate-limit operations fall back to an instance-local Map if Redis is missing or fails. Multiple Vercel instances then have separate limits and separate cache misses. The map has no overall capacity bound, and expired entries are removed only when read.

The fallback `incr` overwrites a counter without preserving its expiry; expiry is assigned only on count 1. A second increment can remove expiration and keep that instance's session counter throttled indefinitely. Distributed live-delivery claims already use a stricter fail-closed production policy, so the weakness does not apply uniformly to every Redis helper.

Verify production Redis health and pooled database connections. Preserve counter TTL, bound fallback memory and define an explicit failure policy for expensive AI endpoints. An in-function rate limit can prevent downstream work but cannot undo the invocation that reached it; use supported platform rules for abusive traffic where appropriate. No firewall settings were changed.

## Illustrative request budget

Assume authenticated five-minute storefront visits and fast responses. A standalone 30-second heartbeat makes roughly ten calls per visit. Enabled ten-second live polling adds roughly thirty. Counts below exclude bootstrap/config, normal event batches, page-exit calls, offers, chat, webhooks, dashboard, retries and static requests.

| Monthly five-minute visits across all merchants | Heartbeats | Heartbeats plus enabled live polling |
| ---: | ---: | ---: |
| 10,000 | ~100,000 | ~400,000 |
| 25,000 | ~250,000 | ~1,000,000 |
| 50,000 | ~500,000 | ~2,000,000 |

These are scenarios, not safe visitor limits or forecasts. Multiple tabs/navigation and visit length change the totals. Live polling is disabled by default.

CPU can bind before invocations: four CPU hours = 14,400,000 milliseconds, or only 14.4 ms of active CPU per invocation at one million invocations. At an illustrative 50 ms average, four CPU hours supports about 288,000 invocations. Use measured CPU, not latency, for this calculation.

## Implementation order and acceptance checks

1. Consolidate telemetry, add visibility/idle suppression and retain important final events. Compare `/api/events` calls and rows per active-visible visitor-minute, and verify session duration, cart state and conversion attribution.
2. Remove whole-catalog rebuilds and unbounded affinity fan-out from webhook acknowledgement paths. Verify bounded query counts at 500/5,000 products, duplicate webhook handling, concurrent updates and durable retry after failure.
3. Make reporting database-aggregated/cached and replace variant fallback scans. Verify identical totals and recommendations using realistic catalog/history sizes.
4. Bound chat retrieval and shared AI budgets; verify fallback, cancellation, product accuracy and tenant isolation.
5. Enable live polling only when needed, with adaptive scheduling; verify hidden tabs stop nonessential calls and relevant alerts still arrive after resume.

Avoid indiscriminately CDN-caching authenticated shopper/chat responses, raising maximum duration to hide slow queries, replacing every bounded retry with a new paid service, or changing database indexes/region without measurement. Static SDK assets referenced through Shopify `asset_url` and Shopify-hosted product/cart requests are not automatically Vercel transfer.

## Remaining production measurement

Team access and the Hobby plan are now confirmed. Remaining free-tier capacity still needs the exact usage window and totals from the [account Usage dashboard](https://vercel.com/bostone339-6995/~/usage). The MCP connector exposes no equivalent basic quota-total tool, its query API requires Plus, and the separate browser is not signed in. Collect Function Invocations, Active CPU, Provisioned Memory and CDN Requests first; include transfer totals if available. Account-level totals include other projects, so do not treat them as this app's traffic. No paid upgrade is needed just to read basic dashboard usage.

For `ai-agent`, compare `/api/events`, `/api/live`, `/api/offer`, `/api/chat`, `/api/webhooks`, `/api/sync` and admin loaders by invocation count, active CPU sum, wall-time p50/p95, errors/timeouts and transfer. Check generated function grouping because multiple React Router routes can share one function; a function total is not automatically a single route's cost. Inspect the metric schema before querying dimensions and aggregations.

Check production Redis availability, database pooling and region proximity, live-event flag, cache hit/miss rates, catalog size and webhook topic volume. Do not retrieve or publish credential values to do this. Hobby's short runtime-log retention can leave no current samples; historical logs being unavailable is not proof of no errors. [Hobby plan](https://vercel.com/docs/plans/hobby)

Earlier query-shape errors (`400`) and the former authorization error (`403`) provided no performance evidence. The corrected authorized metrics request now reaches the plan restriction (`402`). No claim about actual quota exhaustion, verified savings or production latency is made in this report. Do not request team consent again to resolve this metrics restriction, and do not upgrade the account automatically.
