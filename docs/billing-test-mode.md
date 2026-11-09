# Billing test mode

Implemented 9 November 2026. The boolean `billingTestMode` in
`app/config/plans.json` enables testing of the implemented Pro features without a
Shopify subscription. It is currently `true`. Set it to `false` and restart or
rebuild to restore normal billing verification.

Keep `billingSource` as a string describing the actual billing integration
(`unconfirmed`, `admin_api`, or `shopify_app_pricing`). It does not become a
boolean, and enabling test mode does not configure production billing.

The override is accepted only in:

- Local development or automated tests (`NODE_ENV=development` or `test`), when
  no Vercel deployment metadata is present.
- Vercel Preview or Development environments (`VERCEL_ENV=preview` or
  `development`), including their production-mode builds.

Production deployments, unknown/custom Vercel environments, Vercel deployments
with missing environment metadata, and standalone production-mode servers ignore
the override. Production continues using the existing subscription mapping,
cache and outage grace period. Vercel documents its environment identifiers in
[System environment variables](https://vercel.com/docs/environment-variables/system-environment-variables).

The override returns an uncached `Pro (test mode)` entitlement, enables the Pro
feature flags and allowances, and shows a test-mode notice on Home and Plan &
usage. It never writes a synthetic subscription to Redis or PostgreSQL and
blocks subscription creation and hosted upgrade redirects while active. Turning
the switch off immediately restores normal entitlement lookup without a test
plan lingering in the cache.

Monthly Pro AI limits, existing per-shop/global daily caps, concurrency limits,
Redis fail-closed behavior, authentication, catalog validation, and merchant
recommendation settings still apply. AI providers and the existing database and
Redis services must be configured in the test environment. No credentials are
added or changed by this switch. Inventory and reorder features remain
unimplemented and disabled.

Use a development store and test database/Redis for testing: this override changes
plan access, and ordinary app activity still records real events and usage in the
environment's configured services. Restart local development or rebuild a
preview after editing the JSON switch. No migrations are required.

Files changed:

- `app/config/plans.json`: enabled boolean test switch.
- `app/models/entitlements.server.ts`: environment guard and uncached test plan.
- `app/models/usage.server.ts`: Home test-mode notice.
- `app/models/upgrade.server.ts`: suppress subscription actions in test mode.
- `app/routes/app.plan.tsx`: test banner and hidden upgrade controls.
- `app/models/entitlements.server.test.ts`, `app/models/usage.server.test.ts`,
  `app/plan-routes.test.ts`: 19 new regression cases covering allowed and refused
  environments, boolean validation, immediate restoration, no subscription or
  cache writes, billing action suppression, and retained shared AI limits.
- This document: activation, environment requirements and verification results.

Validation on 9 November 2026:

- `npm.cmd test -- app/models/entitlements.server.test.ts app/models/usage.server.test.ts app/plan-routes.test.ts`:
  42 tests passed in three files. The initial sandbox invocation could not resolve
  the Vite configuration; the approved run outside the sandbox passed.
- `npm.cmd run verify`: passed typechecking, lint, all 732 tests in 93 files,
  SDK build and size checks, Prisma client generation, and production build.
- `git diff --check`: passed.

The SDK rebuild produced no asset changes. No dependencies, environment files,
Prisma schema or migrations were changed. No deploy, production migration,
subscription mutation or production data operation was run. Live storefront
testing remains a manual step in the configured test environment. Inventory and
reorder work remains outside this billing override's scope.
