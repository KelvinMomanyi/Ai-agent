# Catalog recovery after the live offer failure — 12 November 2026

The backend corrections are implemented locally and verified. They have not
been deployed. The already-published Shopify extension `ai-agent-21-86` does
not need rebuilding or republishing for this backend change. No database
migration, product edit, pairing change or billing change is required.

## Corrected behavior

The live test reached a genuine native cart add and offer request, then failed
because an unavailable Redis cache-fill claim prevented reading the healthy
PostgreSQL catalog. The backend now distinguishes an optional catalog cache
from the shared reservations used for quotas and delivery guarantees.

- During a Redis outage, the hot catalog uses a PostgreSQL transaction-level
  advisory lock and a tenant-scoped query capped at 500 products. Popularity,
  recent updates and the complete product count are read together. The batch
  transaction is read-only, with a 2.5-second SQL statement timeout.
- Competing fills cannot independently enter the guarded product query while
  its lock is held. The lock is released by transaction completion or failure;
  it does not require session affinity through a pooled database connection.
  This follows PostgreSQL's [transaction advisory lock semantics](https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS).
- A five-second local snapshot cache reduces repeated fallback queries. It is
  limited to 20 shops and 8 MB of serialized snapshot data per process, including
  indexes. Oversized results are usable but are not retained. Invalidation clears
  the local fallback; other instances' entries expire within five seconds.
- Product/variant, source ownership, pairing, rejection, merchant exclusion,
  price and availability checks still run. The fallback supplies candidates,
  not permission to display unavailable or disallowed products.
- Merchant settings and public settings require the shared cache or a fresh
  database read. They cannot remain stale for an hour in an isolated memory
  cache when shared invalidation is unavailable.
- Once Redis fails, cache, billing and distributed claim operations share a
  30-second retry pause. Billing and delivery reservations remain unavailable
  during that pause; no local quota or at-most-once reservation is substituted.
- If both catalog retrieval paths fail, the offer route returns the normal
  no-card JSON shape, `catalog_temporarily_unavailable`, with no-store. It no
  longer deliberately emits the HTTP 503 that coincided with an opaque HTTP 500
  through Shopify's proxy. This keeps dependency failures separate from a
  successful Shopify cart mutation; it does not claim products were eligible.

## Verification

`npm run verify` passed TypeScript, ESLint, **774 tests in 99 files**, SDK
size/build checks, Prisma generation and the production build. Tests cover:

- Actual PostgreSQL-engine execution of the fallback SQL, the read-only batch,
  the 500-product bound, a full 505-product count, popularity ordering, empty
  catalogs and identical product IDs in different shops.
- Distributed-lock failure, database failure, fallback reuse, expiry,
  invalidation and tenant separation.
- Redis circuit opening and recovery, no local billing counters, and refusal
  to use a local fallback for merchant settings.
- The proxy-safe no-card response when neither catalog path is available.

The corrected code was also exercised locally against the previously confirmed
production-configured database for `newsliderapp.myshopify.com`. No merchant
product, setting, subscription, order or payment was changed. The preview path
returned two eligible recommendations for each previously tested bag/sandals
source, after actual saved merchant/pairing rules and fresh product validation.
The cart-decision path returned `upsell_drawer`, two products and provider
`heuristic`, with a synthetic cart context and AI explicitly disabled for that
diagnostic. Tested private-field scans found no matching cost, margin or raw
inventory names in those results. No offer or impression was created by the
diagnostic.

These are **candidate-code checks against real synced data**, not a successful
deployed shopper journey. Local remote-database timings were approximately
11–19 seconds for preview and 13.3 seconds for the cart decision. They do not
establish deployed latency or compliance with the storefront SDK's eight-second
request timeout. Production response timing, visible display, one acceptance,
no recursion and reporting still require a deployed browser test.

## Release and remaining operational work

Redeploy the reviewed backend to the existing `ai-agent` Vercel project, then
repeat the real `newsliderapp` native-add test using the published SDK. No
Shopify extension deployment or migration is needed for these corrections.

The external Redis endpoint itself still needs restoration/replacement for
normal shared usage/AI operations. Existing verified Free-plan caps continue
to fail closed when usage cannot be checked; paid AI and billing access are
not enabled by this catalog fallback. Billing source remains unconfirmed until
the owner supplies the actual configured integration. Those dependencies have
not been marked repaired or silently bypassed.
