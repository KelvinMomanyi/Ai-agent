# Production QA with app billing paused

Implemented 15 November 2026. This is an owner-controlled deployment mode for
testing the existing live app before onboarding real merchants. Both switches
default off and accept only the exact string `true`. They cannot be enabled by a
storefront request, URL parameter or merchant setting.

## Enable on the live app

1. Push this change through the app's normal deployment process.
2. In the app's Vercel project, add these environment variables to **Production**:

   ```dotenv
   AOVBOOST_BILLING_PAUSED=true
   AOVBOOST_QA_LOCAL_AI_LIMITS=true
   ```

3. Redeploy Production after saving the variables. Environment changes do not
   update an already-running deployment. No new database migration, dependency,
   theme extension release or Shopify pricing configuration is required by this
   change. Keep the existing app URL, Shopify credentials and database.
4. Open AOVBoost in Shopify Admin. Home should say **Billing is paused for QA**;
   **Plan & usage** should show **Billing paused for QA**, the local-limit notice,
   and **Paused for QA** in the monthly usage table. Upgrade controls are hidden.
5. Ensure at least one existing AI provider credential is configured and valid.
   Keep `AOVBOOST_DISABLE_AI` unset or `false`. This mode does not create provider
   credentials or make paid provider requests free.
6. For storefront chat testing, use Recommendations settings to turn off focused
   cart mode and enable AI Assistant. The last live verification found focused
   cart mode on and chat off on `newsliderapp.myshopify.com`. This code deliberately
   preserves those merchant settings. Keep the app embed enabled, then reload the
   storefront to obtain fresh settings and a signed storefront session.

Use the first switch alone if Redis is healthy and distributed AI limits should
remain enforced. The second switch has no effect without the first. The older
`billingTestMode` JSON flag still works only in its original local/preview
environments; this explicit server environment override also works in Production.

The flags apply to every installed shop served by this deployment. Use them only
while this is a QA environment without real merchants. Ordinary analytics,
sessions, cart actions and test orders still use the configured services; this is
not a separate database or a mock storefront.

## What pauses, and what still runs

| Area                     | Behavior during QA pause                                                                                                                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plan access              | Uncached Pro test entitlement; no synthetic Shopify subscription or verified snapshot is saved.                                                                                                      |
| New app subscriptions    | Manual Billing API upgrade actions and links to hosted pricing are blocked after Admin authentication. Refresh plan is a harmless success.                                                           |
| Monthly billing counters | Display reservations, displayed-offer billing increments and monthly AI usage checks/writes are skipped. Admin does not read or flush current/previous monthly totals. Existing totals are retained. |
| Other telemetry          | Existing impression, acceptance and AI gateway telemetry continues; QA activity can appear in analytics.                                                                                             |
| AI execution             | Existing provider client, models, prompts, grounding, timeouts, fallbacks and merchant settings stay in use.                                                                                         |
| Request authentication   | Shopify Admin authentication, installed-shop checks and signed storefront sessions remain required.                                                                                                  |
| Request rate limits      | Existing rate limits remain, including their existing local cache fallback.                                                                                                                          |
| AI operational limits    | Redis remains required unless both flags above are enabled. With both flags, attempts are limited in process memory instead.                                                                         |
| Distributed claims       | Webhook deduplication, job locks and delivery/idempotency claims retain their existing behavior. QA does not bypass them.                                                                            |

This pauses the app's subscription enforcement and new subscription actions. It
**does not cancel, freeze or refund an existing Shopify subscription**, change a
merchant's Shopify plan, or pause bills from AI providers, hosting, Redis or the
database. Existing subscription contracts must be handled separately in Shopify.
No subscription mutation, environment change or deployment was performed while
implementing this code.

## Redis-independent AI limits

With both flags enabled, the AI gateway uses the existing configured limits:

| Variable                         |                        Default |
| -------------------------------- | -----------------------------: |
| `AOVBOOST_AI_GLOBAL_DAILY_LIMIT` |        1,000 provider attempts |
| `AOVBOOST_AI_SHOP_DAILY_LIMIT`   | 200 provider attempts per shop |
| `AOVBOOST_AI_GLOBAL_CONCURRENCY` |              8 active attempts |
| `AOVBOOST_AI_SHOP_CONCURRENCY`   |     2 active attempts per shop |

These are counts of provider attempts, including failures and provider fallbacks;
they are not dollar budgets. Limits reset at UTC midnight. Capacity leases expire
after 30 seconds and are released after completion. Setting a limit to `0`
disables new attempts under that limit. The existing numeric validation and upper
bound remain in use.

QA memory holds at most 1,000 shop counters and 1,000 active leases. New capacity
is denied rather than evicting live counters. Counters contain only shop scope,
counts and timestamps; no customer identity, message content or credentials are
stored. Leases use random internal IDs.

These limits are **per server instance**, including the nominal "global" limit;
they reset on cold starts/restarts and do not synchronize across Vercel instances
or deployments. They are a bounded QA aid, not production spend protection. This
option deliberately uses local limits even if Redis recovers. Set it to `false`
and redeploy to return to distributed operational limits.

Redis health reports can still show a real outage. Jobs that require distributed
locks, live delivery or webhook processing can still fail during that outage.
Repair Redis before claiming full background-job or checkout-attribution
verification. The previously reported order-affinity/Prisma webhook failure in
`docs/live-store-verification-2026-11-15.md` is separate and remains unresolved by
this billing change.

## Verify after deployment

These live checks have **not** been run against this change:

1. Confirm the QA banners and monthly table in Admin; a direct upgrade POST must
   return 409 rather than create a subscription or redirect to pricing.
2. Enable chat in merchant settings, open the storefront, ask about a real catalog
   product and check that the reply is from the configured provider. An honest
   deterministic fallback alone does not prove AI is functioning.
3. Select a valid variant in chat, add it and confirm the cart refreshes without
   recursively opening an upsell. Verify normal shopper add/upsell acceptance too.
4. Exercise Admin AI pairing/setup flows. Investigate distributed-job/Redis errors
   independently of billing. The QA flags do not assert that those jobs succeeded.
5. With low temporary operational limits, confirm excess requests fall back or
   rate-limit. Restore the intended QA caps and redeploy afterward.
6. Confirm missing/invalid provider credentials produce the existing retry/fallback
   behavior and are not mistaken for a billing or successful AI result.

Local regression coverage includes the real AI gateway, monthly usage and
operational limiter together with a **mocked provider** and unavailable Redis.
It proves the QA wiring reaches the provider client and retains caps; it does not
prove live provider availability or an entire checkout-to-analytics flow.

## Resume normal billing

Set both variables to `false` (or remove them) in Production, then redeploy. The
uncached QA entitlement disappears and the app resumes the existing subscription
verification, monthly counters and distributed operational limits. No cleanup
query or cache reset is needed. Original quotas are preserved; QA usage is not
backfilled into billing totals. Configure the actual billing integration and
repair Redis before admitting real merchants; switching QA off does not itself
complete that setup. Older deployments, preview URLs and already-running requests
retain their own environment until they are replaced or finish.

## Implementation and local validation

- `app/qa-mode.server.ts`: strict, server-only flags.
- `app/qa-ai-limits.server.ts`: bounded QA attempt budgets and concurrency leases.
- `app/redis.server.ts`: explicit local QA branch for AI attempts only.
- `app/models/entitlements.server.ts`: temporary Pro access and no pricing links.
- `app/models/usage.server.ts`: preserve monthly billing totals during QA; Home notice.
- `app/models/upgrade.server.ts`: block subscription actions during QA.
- `app/routes/app.plan.tsx`: truthful QA status and usage table.
- `.env.example`: both switches documented with default `false`.
- Tests cover flags, capacity/expiry, tenant isolation, unchanged normal billing,
  immediate restoration, upgrade suppression and a mocked-provider Redis outage.

Validation on 15 November 2026:

- Focused billing/QA/Redis regression run: **79 tests passed in 8 files**.
- Full `npx.cmd vitest run --config vitest.config.ts`: **945 tests passed in 112
  files**, including the existing storefront cart-refresh tests.
- `npm.cmd run typecheck`: passed route type generation and TypeScript checks.
- ESLint on all changed TypeScript/TSX files: passed.
- `npx.cmd react-router build`: passed both client and server production builds.
  Non-blocking dependency annotation, route future-flag and mixed-import warnings
  remain. This command does not deploy or run migrations.
- Prettier and `git diff --check`: passed.

Vite/esbuild could not read ancestor directories inside the Windows sandbox;
tests, type generation and the production build ran successfully with approved
execution outside the sandbox. No real AI provider was called, browser suite was
run, or live app was modified during this implementation. Storefront SDK assets,
public events, cart properties and checkout extension code are unchanged. No live
verification is claimed.
