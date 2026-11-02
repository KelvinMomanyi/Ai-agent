# AOVBoost: Vercel Hobby capacity review

Reviewed November 1, 2026 against local commit `a776b32` and current Vercel documentation. This is a source-code review, not a measured production capacity test. No application code or hosting settings were changed.

The Vercel connector authenticated successfully, but the available account exposes only the Bowstone team and its `carousel-clone` project. Project searches did not find AOVBoost, and lookup of `ai-agent-dusky-nine.vercel.app` returned 404 through that connection. Production usage, current plan, deployed commit, region, Node version, Fluid Compute setting, environment flags, and error rates could not be verified. This does not establish that the public site itself is unavailable.

**Main finding:** recurrent storefront requests create a baseline invocation load, while synchronous catalog/affinity work and whole-dataset analytics are the main CPU, memory, database, and timeout risks. None of these findings proves that the live project has exceeded a limit.

Hobby is restricted to personal, non-commercial use. A merchant-facing deployment intended to generate revenue should use a commercial plan even if traffic fits the resource allowances. This is an application of Vercel's published eligibility rule, not a measurement of AOVBoost's billing status. [Vercel fair-use policy](https://vercel.com/docs/limits/fair-use-guidelines#commercial-usage)

## Relevant allowances

| Resource | Hobby allowance / limit |
| --- | --- |
| Function invocations | 1,000,000 per month |
| CDN requests | 1,000,000 per month |
| Active CPU | 4 CPU hours per month |
| Provisioned memory | 360 GB hours per month |
| Fast Data Transfer | 100 GB per month |
| Fast Origin Transfer | 10 GB per month |
| Function memory / CPU | 2 GB / 1 vCPU |
| Function duration with Fluid Compute | 300 seconds default and maximum |
| Function request / response payload | 4.5 MB |
| Cron scheduling | Each job at most once daily; timing is not minute-precise |

These are account/team allowances rather than a separate allowance per merchant installation. Usage by other projects can consume the same allowance. Exceeding Hobby allowances can make features unavailable until their usage window resets. [Hobby plan](https://vercel.com/docs/plans/hobby), [function limits](https://vercel.com/docs/functions/limitations), [cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing)

The local `vercel.json` selects React Router and the build command but does not declare Fluid Compute, duration, or region. Dashboard settings and the deployed function output must be checked before asserting effective runtime settings. A missing `maxDuration` setting alone is not a defect: Fluid Compute already defaults to 300 seconds.

## Findings and recommended order

| Priority | Area | Code evidence | Impact | Recommended change |
| --- | --- | --- | --- | --- |
| High | Session heartbeats and event ingestion | `storefront-sdk/src/sessionManager.ts:97,373`; `storefront-sdk/src/eventBus.ts:145`; `app/routes/api.events.tsx:42`; `app/models/event.server.ts:11` | A heartbeat POST every 30 seconds is separate from event batches flushed after two seconds of queued activity. Heartbeats perform installation checks, settings reads, a session transaction, and event insertion when analytics is enabled. Hidden-tab/idle suppression is absent from the heartbeat code. | Combine heartbeats with event batches, send changed state only, pause nonessential activity on hidden/idle tabs, and resume when needed. Preserve final delivery of important cart/checkout/conversion-related signals. |
| High when enabled | Live-event polling | `storefront-sdk/src/liveUpdates.ts:3,45`; `storefront-sdk/src/index.ts:119`; `app/models/settings.server.ts:59`; `app/models/liveEvents.server.ts:30` | Opting in adds approximately six requests per minute per open storefront session. Requests use rate-limit storage and can query session, navigation and event data even when nothing changed. Page lifecycle handling does not provide explicit `visibilitychange` suppression or adaptive idle backoff. | Keep opt-in off when unnecessary; otherwise back off empty polls, restrict polling to relevant product/cart contexts, and pause hidden tabs. |
| High | Product webhooks rebuild whole catalogs | `app/routes/api.webhooks.tsx:28,70,212`; `app/models/catalogCache.server.ts:93` | Each accepted product create/update/delete can fetch every product, build full and hot snapshots, and serialize/write current, stale and hot caches before returning. Updating U products in an N-product store repeatedly processes the whole catalog, roughly O(U × N), with repeated cache writes. | Update/invalidate only affected cache entries; coalesce rebuilds per shop and process rebuilds through a durable worker with bounded batches. Keep webhook acknowledgement work small after durable acceptance. |
| High | Order affinity recomputation | `app/routes/api.webhooks.tsx:97`; `app/models/product.server.ts:238,256,410` | An order recomputes affinities for each known purchased product. Each recomputation fetches all other products, then uses an unbounded `Promise.all` for per-target reads and possible upserts. Four purchased products may run recomputations concurrently. For four products in a 5,000-product catalog, this is roughly 20,000 target lookups plus possible writes, excluding other order work. | Bound concurrency, update changed co-purchase pairs incrementally, restrict candidate targets, and move expensive recomputation out of the acknowledgement path. Use durable idempotent work rather than an unawaited background promise. |
| High as history grows | Dashboard and sales analytics load raw datasets | `app/models/analytics.server.ts:75,96,570`; `app/models/salesAnalytics.server.ts:39`; `app/routes/app.analytics.tsx:26` | Several `findMany` queries retrieve whole reporting windows without row bounds, then aggregate in application memory. The analytics route runs revenue and sales reports together, reading some overlapping data. A 30-day time filter does not bound row count. Larger merchants can consume CPU, memory and database connections on every dashboard load. | Aggregate in SQL, maintain daily rollups, select only needed fields, cache report summaries briefly, and paginate detail views. |
| Medium to high | Chat retains functions during external AI calls | `app/routes/api.chat.tsx:195,568,701,743`; `app/ai/client.server.ts:37,43,148` | Chat can make an initial AI call and a second call after read tools. Default total budgets are 5 seconds and 4.8 seconds for those calls, before other route work. The limit is per session (12/minute), not a shared shop/day budget. Client cancellation is not forwarded into the AI request's timeout signal. | Add shop/global AI budgets and concurrency limits, propagate disconnect cancellation, keep bounded deterministic replies for simple questions, and record total route/AI duration. Retain the existing timeouts. |
| Medium; severe during cache outages | Cache and rate-limit fallbacks are instance-local | `app/redis.server.ts:11,129,204`; `app/db.server.ts:11` | Missing or failing Redis falls back to a local Map for ordinary caches and counters. Counters are not shared across scaled instances; cold starts multiply cache misses and database work. Expired fallback entries are removed when read, with no overall capacity bound. Each process also has its own Prisma connection pool. | Verify production Redis health, alert on fallback, use a deliberate production policy for costly endpoints when distributed limits fail, bound fallback memory, and verify pooled database URLs and connection budgets. Database/Redis provider quotas are separate from Vercel quotas. |
| Medium | Catalog sync is advanced by the dashboard | `app/routes/app._index.tsx:78`; `app/routes/api.sync.tsx:23`; `app/jobs/aovboost.server.ts:35`; `app/models/catalogCache.server.ts:64` | Chunking and a durable lease are good safeguards, but the next chunk is submitted by the browser. Closing the dashboard can leave sync paused. Every sync response also recomputes catalog readiness across all product metadata. No Vercel cron is configured. | Use a durable dispatcher for continued chunks and maintain readiness incrementally. A daily Hobby cron would not provide prompt job continuation. |

Active CPU excludes time spent waiting on a database or model API; provisioned memory and invocation usage still matter while work is in flight. At 2 GB, 360 GB hours corresponds to about 180 busy instance-hours. Fluid Compute can share instances across concurrent requests, so summing individual request wall times is not an accurate memory-billing calculation. [Function compute model](https://vercel.com/docs/functions/limitations#cost-and-usage)

There is also a concrete fallback counter defect: `redis.incr` calls `setMemoryValue` without preserving `expiresAt` (`app/redis.server.ts:47`). `incrementRateLimit` only sets expiry on the first increment. A second increment before expiry therefore removes the fallback counter's expiration, potentially keeping a legitimate session throttled until that process restarts. This is separate from the failure to share counters across instances. Both findings come from source inspection; production fallback behavior was not exercised.

## Illustrative request budget

Assume a single storefront tab remains open for five minutes, requests are fast, and the SDK has consent/authentication. The 30-second heartbeat produces about ten calls. Enabling live events adds about thirty live calls. The following counts exclude bootstrap/config requests, behavior event batches, offer requests, chat, webhooks, dashboard requests, retries and static requests.

| Monthly five-minute visits, across all stores | Heartbeats only | Heartbeats plus enabled live polling |
| ---: | ---: | ---: |
| 10,000 | ~100,000 | ~400,000 |
| 25,000 | ~250,000 | ~1,000,000 |
| 50,000 | ~500,000 | ~2,000,000 |

This is a scenario estimate, not a safe visitor limit. With live polling enabled, around 25,000 such visits could use the invocation allowance through these two mechanisms alone. With live polling off, the heartbeat alone approaches one million calls around 100,000 such visits; the other request sources make the practical threshold lower. Multiple tabs, page navigation, actual response times, browser throttling and visit length change these estimates.

CPU can bind earlier: one million invocations averaging just 14.4 milliseconds of active CPU consume four CPU hours. At an illustrative 50 milliseconds average, four CPU hours is about 288,000 invocations. Actual CPU usage requires production measurements.

## Existing safeguards and lower concerns

- Live events require the exact server flag `AOVBOOST_ENABLE_LIVE_EVENTS=true` and the corresponding client setting. They are off by default. Production's flag was not accessible.
- The offer poller supports an optional timer, but the SDK does not pass `pollMs`; the current default path uses startup/navigation/behavior triggers. It should not be described as continuous offer polling.
- Offers have a 30-second decision cache and cached settings. Recommendation candidates use a 500-product hot cache and bounded category cache. Chat still loads the full catalog snapshot through `chatContext.server.ts:283`, so those offer-side bounds do not protect the chat path.
- AI provider attempts and total calls have timeouts and fallback replies. The default call budgets are far below the 300-second Fluid Compute cap; request frequency and memory time are more likely concerns than one model call hitting that cap.
- Live updates use completed polling requests, not a permanently open SSE connection. Chat uses a finite streaming response.
- The storefront SDK asset is loaded using Shopify theme extension `asset_url` (`extensions/aovboost-storefront/blocks/aovboost.liquid:18`). Do not assume every SDK download or product image is Vercel bandwidth.
- Event batches are capped at 100 items and approximately 128 KB. No evidence in this review makes the 4.5 MB Vercel HTTP payload cap the primary bottleneck.
- Catalog sync uses pages, a durable job record, a lease, a 500-product initial-affinity bound and 20 source products per affinity chunk. The unbounded recomputation finding concerns the order path, not this bounded initial-affinity path.

## Production evidence needed to complete the audit

Reconnect the Vercel account/team that owns AOVBoost, or provide its team and project identifiers so access can be checked. Then inspect:

1. Team-wide current-window consumption: invocations, CDN requests, active CPU, memory, transfer, and remaining allowance, including other projects.
2. Project and generated-function settings: deployed commit, Node runtime, Fluid Compute, effective duration, region, memory, and bundle size.
3. Per-route count, duration, CPU/memory where available, and response codes for `/api/events`, `/api/live`, `/api/offer`, `/api/chat`, `/api/webhooks`, `/api/sync`, and dashboard loaders. Shopify's app proxy changes the browser-visible route; use backend route names when investigating.
4. Recent timeout, memory, database-pool and rate-limit failures. Hobby retains only one hour of runtime logs, so inspect promptly or add appropriate durable summaries. [Hobby observability retention](https://vercel.com/docs/plans/hobby)
5. Production Redis configuration/health, database pooling and region proximity, live-event flag, daily chat demand, average session duration, product counts, order line counts and product-webhook volume.

The first implementation work should reduce recurrent storefront requests, remove full-catalog work from webhook acknowledgements, and replace raw analytics scans. These improvements remain useful on a commercial plan; upgrading alone does not fix unbounded database fan-out.
