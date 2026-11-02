# Performance implementation

Implemented November 2, 2026 against the findings in [the Vercel review](vercel-performance-review-2026-11-02.md). These are repository changes. They have not been deployed to Vercel or published as a Shopify extension, and no production database migration was run.

## Changes

| Audit area | Implemented behavior |
| --- | --- |
| Session heartbeats | SessionManager collects state without making its own recurring requests. EventBus attaches a snapshot after ordinary events in the same request. A quiet but active visible session can send a heartbeat after approximately 120-150 seconds without a recent batch. Hidden/idle tabs do not send periodic heartbeats. |
| Event delivery | Noncritical events batch for five seconds; cart/checkout/click signals flush after 100 ms. Final page/visibility flushes remain. Requests have an eight-second timeout, bounded buffering and Retry-After/backoff. Session snapshots update the session but are no longer inserted as separate raw analytics rows. |
| Bootstrap/config | Fresh bootstrap settings eliminate the extra config request. Settings stored with a signed session are reused for up to a minute, then refreshed on initialization. Installation checks and public settings have short caches; settings saves and uninstall handling invalidate them. |
| Product webhooks | Product writes persist, then invalidate a catalog generation. They do not read, rank or serialize the whole catalog. Bounded hot/category caches fill on demand. A distributed five-second fill lease coalesces bursts; another request can use the previous bounded snapshot or return no product offer while the first fill completes. |
| Catalog correctness | Old fills write to their own generation keys. Cached catalogs store each product once and rebuild lookup indexes after reading. Before rendering an offer, referenced products are checked against fresh, tenant-scoped database rows, including price and availability. |
| Order affinities | One idempotent transaction bulk-updates product/variant counts and only co-purchased pairs. Each source has at most 20 co-purchase neighbors per order. Pair counts and scores commit together with the order marker; a failure rolls back and can retry. Cost depends on order size, not all catalog products. Standalone similarity recomputation also has a 100-candidate/four-concurrent-write bound. |
| Live polling | Still opt-in. Polls run only on product/cart pages, pause while hidden, skip inactive sessions and back off successful empty results/errors up to two minutes. Delivery deduplication memory is bounded. |
| Analytics | Revenue/dashboard and sales loaders aggregate in PostgreSQL and cache tenant-scoped summaries for 30 seconds. Warm duplicate loads coalesce. Experiment statistics aggregate in SQL rather than loading all historical offers. Experiment lists/rows are capped at 100; offer summaries remain top 10. Existing attribution and action-date calculations are preserved. |
| Chat retrieval | Database-ranked retrieval returns up to 60 matches plus bounded current/cart/recent product context. It does not download a complete catalog snapshot. Rare older matches are ranked before the result limit. |
| Variant-only carts | Canonical variant IDs resolve through a parameterized JSON containment query and a GIN expression index. Product metadata is not transferred wholesale to the function. |
| AI calls | Shared per-shop/global daily attempt and concurrency caps apply before each provider request. A widget decision makes one provider chain; its wording uses deterministic copy when the decision already attempted AI. Reusable copy is cached by shop, tone and product/offer content. Disconnect/stream cancellation propagates into provider requests, and canceled calls do not start another provider. Existing deterministic fallbacks remain. |
| Redis/pools | Rate-limit increment/expiry is atomic in Redis; fallback increments preserve TTL. Fallback entries have expiry, a 1,000-entry cap and a per-string size cap. Redis requests have timeouts, limited retry and an outage circuit. Prisma's pool is reused in production. |
| Sync/method handling | Catalog readiness aggregates in SQL and caches briefly. Dashboard chunk continuation is paced at 1.5 seconds with effect cleanup. GET/HEAD on the POST-only token migration route return 405 with Allow: POST and no-store. |

The existing initial catalog sync remains a durable, resumable chunked job driven by the admin dashboard. Closing the dashboard pauses continuation until it is opened again. Expensive product/order webhook recomputation has been removed, so no new queue service or recurring server poller was added for that work.

## AI defaults and failure behavior

| Optional server environment variable | Default |
| --- | ---: |
| `AOVBOOST_AI_GLOBAL_DAILY_LIMIT` | 1,000 provider attempts per UTC day |
| `AOVBOOST_AI_SHOP_DAILY_LIMIT` | 200 provider attempts per shop per UTC day |
| `AOVBOOST_AI_GLOBAL_CONCURRENCY` | 8 provider requests |
| `AOVBOOST_AI_SHOP_CONCURRENCY` | 2 provider requests per shop |

Each failover/tool-result call consumes its own attempt. Zero disables capacity; invalid values use the documented defaults. Shared Redis leases release on completion and expire after interruptions. Provider attempts are capped at ten seconds, and a provider chain at fifteen seconds; existing lower configured defaults still apply.

Production provider calls require healthy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` configuration and a shop context. When distributed limits are unavailable or a cap is reached, the app uses deterministic fallback responses. Distributed catalog fills also fail closed when coordination is unavailable; previously cached bounded data may remain usable, with fresh product validation at rendering. Development retains bounded local fallbacks.

Chat and offer route exports explicitly enable Vercel's Node request cancellation, so disconnected requests can stop provider work. Offer fetches abort on navigation, page exit and SDK destruction and are skipped while hidden. [Vercel cancellation configuration](https://vercel.com/docs/functions/functions-api-reference#cancel-requests)

`AOVBOOST_ENABLE_LIVE_EVENTS` remains off unless explicitly set to `true`. There is no need to enable it for the other optimizations.

## Database and release

The migration `20261102150000_performance_indexes` adds indexes for reporting windows, shop/session lookup, recent/category/handle product retrieval, and canonical JSON variant containment. The GIN expression index is maintained in migration SQL because Prisma cannot represent expression indexes directly.

1. Apply the included migration through the normal release process. The existing Vercel `vercel-build` command already runs `prisma migrate deploy` before building. Index creation can take longer on a large database; schedule the release accordingly.
2. Deploy the server changes with the existing production database/Redis credentials. Use a pooled `DATABASE_URL` appropriate for serverless connections; retain the direct URL for migrations. No secret values are changed by this implementation.
3. Publish the rebuilt Shopify storefront extension asset through the existing Shopify release flow. The generated `extensions/aovboost-storefront/assets/aovboost-sdk.js` is included; the telemetry savings require the updated SDK to reach storefronts.
4. Compare the same Usage dashboard window after release. Track function invocations, Active CPU, provisioned memory and transfer, plus Redis fallback logs and webhook failures. Detailed Vercel query metrics remain subject to the account plan.

No automatic production deployment, paid upgrade, new service, database data cleanup or firewall change was performed. The code reduces avoidable work; actual traffic still determines whether a hosting allowance is sufficient.

## Verification

Completed: `VERCEL=1 npm run verify` passed type checking, lint, all 228 tests in 39 files, and the Vercel-preset production build. Generated metadata has two server bundles and enables cancellation only for `routes/api.chat` and `routes/api.offer`. The ordinary production build and local HTTP/browser smoke checks also passed. `git diff --check` is clean.

The regression suite includes an isolated PostgreSQL instance generated from the current Prisma schema. It applies the new index migration and checks:

- Revenue/sales report parity with the existing reducers, action dates, empty reports and tenant isolation.
- Readiness aggregation and canonical variant lookup.
- Database ranking before the chat limit, using a 1,001-product fixture.
- Idempotency and rollback/retry of co-purchase updates with a 5,000-product fixture.
- Fresh price/availability validation and shared cache fill behavior.
- Client batching, important-event delivery, Retry-After, idle/hidden duration, live polling and provider cancellation.
- Redis counter expiry, bounded memory, shared budget semantics and production fail-closed behavior.

PGlite is a development-only test dependency and is not imported by runtime routes.

The built local server was also checked through HTTP and a browser: GET/HEAD migration requests returned 405, unauthenticated migration POST returned 401, and unauthenticated event ingestion returned 401 before database work. Authenticated Shopify flows were covered with the regression fixtures rather than production writes. Type checking, lint and production build are part of the closing verification.
