# Codex Phase 1 baseline

Recorded 5 November 2026 against checkout `ae17737` on Windows PowerShell,
Node 24.15.0 and npm 11.12.1. This phase changes reliability and hygiene only.

## Plan recorded before implementation

Establish the unchanged verification baseline before editing. Then use Shopify's
supported signature validator for the five data-only compliance/lifecycle topics,
retry the same credential pair at the durable session-storage boundary, remove
unused parent-loader catalog initialization and duplicate token writes, and add
public-entry metadata plus a variable-name-only environment example. Add regression
tests at the SDK/storage and webhook/handler boundaries. Retain the schema,
recommendations, storefront behavior, rate limits and authentication protections.

The SDK ignoring a false storage result is the main integration risk. The chosen
boundary rejects after bounded persistence retries rather than reporting false.
The unused legacy catalog initialization can be deleted because repository search
found no readers of `Shop.productCatalog`; the `Shop` model itself remains active.

## Unchanged baseline

- `npm.cmd ci --no-audit --no-fund`: sandboxed attempt stalled without output
  and was interrupted. Retried with registry/cache access and `--loglevel=info`:
  passed, 1,104 packages installed from the existing lockfile; no dependency
  versions or manifests changed. Existing dependency deprecation notices remain.
- Initial `npm.cmd run verify`: esbuild could not read parent directories under
  the filesystem sandbox. Retried with the required filesystem access.
- That retry stopped at typecheck because the clean install had only a placeholder
  Prisma client: missing `AppSettings`, `Product`, `Prisma.sql`, etc. Local client
  generation is a prerequisite because `verify` typechecks before the build's
  `prisma generate`. No application source fixes were needed.
- `npm.cmd exec -- prisma generate`: passed, generated Prisma Client 6.19.3.
  This generates local files; it does not apply migrations or connect to the
  application database.
- `npm.cmd run verify` after generation: **passed** typecheck, lint, **228 tests
  in 39 files**, SDK build, Prisma generation, and production client/server build.
  There were no remaining baseline source/test failures. Existing React Router
  future-flag and empty-route-chunk build notices were nonfatal.

Framework tools load environment configuration automatically. No credential
values were inspected, printed, logged, copied into this document, or committed.
Tests use synthetic credentials, mocked transports and an isolated PGlite database.
No production application requests, data operations, deployments or migrations
were authorized or performed.

## Phase 1 implementation and regression coverage

- `app/services/data-webhook.server.ts` and `app/routes/api.webhooks.tsx`:
  `app/uninstalled`, `shop/redact`, `customers/data_request`, `customers/redact`,
  and `app/scopes_update` use `getTokenApi().webhooks.validate()` from the installed
  Shopify API library. The returned validated shop/topic select the handler.
  Signature and required-header checks are mandatory; invalid JSON is rejected.
  Other topics retain `authenticate.webhook()` and its existing SDK behavior.
- The installed versions are `@shopify/shopify-app-react-router` **1.2.1** and
  `@shopify/shopify-api` **13.1.0**. Source inspection confirmed the former does
  offline-session refresh after signature validation and ignores a false result
  from storing the refreshed session. No private library imports or handwritten
  HMAC implementation are used in production. Test signatures use synthetic keys.
- A real-validator regression exposed another relevant issue: the migration
  helper imported Shopify's global Node `IncomingMessage` adapter, which discards
  Fetch `Request` headers. It now imports the Fetch/web-api adapter used by React
  Router. Without that change the signature tests rejected valid requests with
  HTTP 400 before reaching token refresh. Existing token-migration and
  application-only-authentication tests continue to pass.
- `app/upstash-session-storage.server.ts`: PostgreSQL gets at most three attempts
  per `storeSession` call, with 100 ms then 200 ms backoff. Every attempt retains
  the same returned credential pair. Redis is written only after durable success.
  Exhaustion emits a critical message with shop and attempt count only, then
  throws `SessionPersistenceError`; raw database errors and credentials are not
  logged. Existing legacy migration retries remain in place.
- `app/shopify.server.ts`: the admin boundary maps this persistence error to a
  retryable HTTP 503 and preserves Shopify redirects. `afterAuth` retains shop
  metadata only; credential persistence belongs to session storage. Existing
  `Shop.accessToken` values are left untouched and new metadata rows use the
  schema-required empty string. No credential is copied there.
- `app/routes/app.tsx`: authentication remains mandatory; the unused 50-product
  query, catalog mapping, `shop:init` cache and legacy upsert are removed entirely.
  Both warm and cold initialization cases make no product query or duplicate
  credential write. The durable Product/catalog-sync path is unchanged.
- `app/routes/_index/route.tsx`: adds a document title and description, with
  revenue described as attributed. JSX, hooks and interactive behavior are
  unchanged; the React best-practices review found no new component concerns.
- `.env.example` lists names with empty assignments, grouped by requirement and
  purpose. Optional assignments are commented so copying the example does not
  override defaults with empty strings. `.gitignore` permits this one example
  while still ignoring real env files. No new environment variable is required
  for this change.

Tests cover actual SDK invalid-refresh HTTP 500 reproduction; valid uninstall and
shop/redact HTTP 200 with all purge queries scoped to the authenticated shop;
missing sessions; customer and scope webhooks; forged/missing/tampered signatures;
required headers; malformed JSON; methods; and SDK delegation for other topics.
SDK integration also reproduces ignored false storage results, then proves
same-pair persistence retries and rejection on permanent failure without another
token exchange. Storage tests check bounded backoff, cache ordering and sanitized
logs; admin tests cover HTTP 503, preserved redirects and metadata-only writes.

Targeted suite: **58 tests passed in 6 files**. New files are
`app/services/data-webhook.server.test.ts` and `app/admin-loader.test.ts`;
session-storage and Shopify-boundary tests were extended. Full final verification
is recorded below.

## Environment configuration

Populate private environment configuration through the existing deployment
process; `.env.example` intentionally provides no sample values. `SCOPES` is a
comma-separated list aligned with `shopify.app.toml`: currently `read_orders`,
`read_products`, `write_discounts`, and `write_app_proxy`. This phase changes no
scopes or webhook subscriptions. Keep PostgreSQL URLs and Upstash REST credentials
configured; production Redis protections continue to fail closed.

AI providers remain optional. The existing chain uses Google, Mistral, Groq and
DeepSeek, with optional model overrides. `AOVBOOST_DISABLE_AI` disables AI only
when set to the string `true`. Existing limits read by `app/redis.server.ts` and
`app/ai/client.server.ts` are:

| Variable | Existing default | Purpose |
| --- | ---: | --- |
| `AOVBOOST_AI_GLOBAL_DAILY_LIMIT` | 1000 | Global daily AI reservations |
| `AOVBOOST_AI_SHOP_DAILY_LIMIT` | 200 | Per-shop daily AI reservations |
| `AOVBOOST_AI_GLOBAL_CONCURRENCY` | 8 | Global simultaneous AI reservations |
| `AOVBOOST_AI_SHOP_CONCURRENCY` | 2 | Per-shop simultaneous AI reservations |
| `AOVBOOST_AI_TIMEOUT_URGENT_MS` | 2500 | Per-provider urgent timeout |
| `AOVBOOST_AI_TIMEOUT_NORMAL_MS` | 3500 | Per-provider normal timeout |
| `AOVBOOST_AI_TIMEOUT_RELAXED_MS` | 5800 | Per-provider relaxed timeout |
| `AOVBOOST_AI_TOTAL_TIMEOUT_URGENT_MS` | 4800 | Total urgent request budget |
| `AOVBOOST_AI_TOTAL_TIMEOUT_NORMAL_MS` | 5000 | Total normal request budget |
| `AOVBOOST_AI_TOTAL_TIMEOUT_RELAXED_MS` | 8000 | Total relaxed request budget |

Daily limits use the existing UTC date key and reservation behavior, not a billing
meter. Budget/concurrency values are nonnegative integers capped at 1,000,000;
zero prevents reservations. Leave optional variables unset to retain defaults:
an empty budget/concurrency assignment is parsed as zero. These limits, provider
ordering, fallback behavior and concurrency machinery were not changed.

The two token-migration endpoints use different optional secret names:
`OFFLINE_TOKEN_MIGRATION_SECRET` for `/internal/token-migration` and
`SHOPIFY_TOKEN_MIGRATION_SECRET` for `/api/migrate-offline-tokens`.
`SHOPIFY_KEY_ID` and `SHOPIFY_PRIVATE_KEY` enable existing optional
application-only access. The storefront session secret falls back to the Shopify
API secret. The unsigned-proxy switch is for local development only and remains
ineffective in production. Hosting normally supplies `NODE_ENV` and `VERCEL`;
the CLI may supply `HOST`, `PORT` and `FRONTEND_PORT`.

## Legacy models and a later removal plan

Repository search covered runtime TypeScript, SQL aggregates and scripts. This
establishes code usage, not whether a table has production rows or external users.

| Model/field | Verified repository usage | Later removal status |
| --- | --- | --- |
| `Shop.productCatalog` | No readers; former parent-loader writer removed | Stop-writes step complete; retain column |
| `Shop.accessToken` | No runtime readers; live token writes removed from loader and afterAuth | Stop-writes step complete; retain column and existing values |
| `Shop` | Installation checks in `installedShop.server.ts` and `storefrontSessionRecovery.server.ts`; metadata/scopes and purge | Active; retain |
| `Event` | Order/product webhook writes; analytics SQL and live-events reads | Active; retain |
| `VisitorSession` | Purge only; no runtime readers/writers found | Candidate for later removal, after external-usage review |
| `CrossStoreInsight` | No runtime readers/writers found; global aggregate schema without a shop key | Candidate for later removal, after external-usage review |
| `ShopConfig` | Chat configuration and post-purchase offer creation; purge | Active; retain |

Do not drop any of these in Phase 1. A later release must first confirm all writers
are stopped and all consumers have migrated; only a separate subsequent release
may drop reviewed columns/tables through an additive-safe release plan. No schema
or migration file changed here.

## Shopify deadline verification

Checked 5 November 2026 against Shopify's current
[expiring offline token migration guide](https://shopify.dev/docs/apps/build/authentication-authorization/migrate-to-expiring-offline-access-tokens):
public apps still using non-expiring offline tokens are delisted and blocked from
new installs January 1, 2027; merchant warnings begin January 15; both GraphQL
**and REST** Admin API requests using these tokens are rejected April 1, 2027.
The prompt's GraphQL-only wording omits REST. New public apps already cannot use
non-expiring tokens. The requirement to use **expiring**, not non-expiring, tokens
is what is enforced. No Partner Dashboard compliance status was checked.

## Release and limits

No migrations, new scopes, Shopify extension changes or new services are needed.
The existing quality gate rebuilds the SDK, but its source and generated bytes
are unchanged. A server release is required for these fixes to become live; the
merchant owns that release. Do not run `vercel-build` locally against production:
it includes `prisma migrate deploy`. No deployment or Shopify release ran here.

Before release, review this diff and rotate credentials shared in the repository
archive through their respective provider dashboards. This session did not inspect
or rotate them. After release, validate a signed uninstall and the compliance
topics in a development store, including an invalid refresh token. Local tests
prove the code path with fake credentials and mocked tenant persistence; they
do not prove a production webhook delivery or dashboard compliance status.

Later phases, billing, inventory/reorder features, catalog-sync behavior and
recommendation/AI/widget/SDK logic were deliberately left unchanged. All legacy
tables and columns remain.

## Final verification

- Final `npm.cmd run verify`: **passed** typecheck, lint, **255 tests in 41
  files**, SDK build, Prisma Client generation and production client/server
  build. This adds 27 tests across two new test files and two extended files.
- Intermediate post-change runs caught a regression-fixture parameter type and
  the loader test accidentally being discovered as a route. The type was made
  explicit and the test moved outside `app/routes`; the final gate passes.
- `git diff --check`: passed. Git's existing LF/CRLF notices are nonfatal.
- Environment-name scan: **40 referenced names, 40 example names, zero missing,
  zero unused, zero populated assignments**. This includes dynamic AI-limit
  lookups and both Prisma datasource environment names; no private env was read
  by this scan.
- `git diff --exit-code -- extensions/aovboost-storefront/assets/aovboost-sdk.js
  extensions/aovboost-storefront/assets/ai-agent.css package-lock.json package.json
  prisma/schema.prisma prisma/migrations`: passed, confirming unchanged SDK
  assets, dependency manifests, schema and migrations.

Changed files: `.gitignore`, `.env.example`, `app/routes/_index/route.tsx`,
`app/routes/api.webhooks.tsx`, `app/routes/app.tsx`,
`app/services/data-webhook.server.ts`,
`app/services/offline-token-migration.server.ts`, `app/shopify.server.ts`,
`app/upstash-session-storage.server.ts`, `app/admin-loader.test.ts`,
`app/services/data-webhook.server.test.ts`, `app/shopify.server.test.ts`,
`app/upstash-session-storage.server.test.ts`, and this document.

Migrations added: **none**. Manual work remains the reviewed server release and
development-store webhook validation described above. A permanent PostgreSQL
outage can still prevent saving a rotated pair after the bounded retries; the
request then fails visibly and recovery may require normal merchant
reauthentication after database service is restored.
