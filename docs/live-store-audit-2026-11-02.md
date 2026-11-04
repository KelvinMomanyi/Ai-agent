# AOVBoost live-store audit — 2 November 2026

Status: access-limited audit. Public browser checks, app deployment checks, and read-only database validation are complete. Shopper and embedded-admin journeys still require storefront access and the Shopify connection.

## Scope and evidence

- Production app: https://ai-agent-dusky-nine.vercel.app/.
- Vercel production deployment: `dpl_HHM6AbCNsKoRjiuEqC7qpToDCTuZ`, READY, Git commit `336aacbabde34013f92c5063477686bb9a47b161`.
- Shopify CLI authenticated successfully for the AOVBoost app. Active extension/configuration version: `ai-agent-21-83`, created `2026-11-02 13:52:53` as reported by Shopify CLI. The actual storefront SDK asset could not be fetched behind the password gates, so matching its contents to this commit remains unverified.
- Shopify MCP was offered for connection but no Shopify MCP operations became available during this audit. CLI app access does not establish merchant-store MCP access.
- Browser: actual Playwright with installed Google Chrome, isolated headless sessions, desktop viewport 1440 × 1000. Playwright tooling was installed separately from application dependencies.
- Database: bounded reads in explicitly read-only PostgreSQL transactions, with a 5-second statement timeout. Findings describe the configured app database; no separate production-environment credential comparison was performed.
- No orders, cart changes, theme changes, deployments, catalog syncs, or merchant-setting changes were performed. The Shopify app-review store was excluded from browser visits.
- Evidence files are in the adjacent `live-store-audit-2026-11-02/` directory. No browser cookies, session JWTs, access tokens, customer messages, or customer identifiers were captured.

## Public storefront results

| Installed store | Browser result | Stored products | Sync job |
| --- | --- | ---: | --- |
| teretret.myshopify.com | 200, redirected to `/password` | 25 | Complete, 4 September |
| newsliderapp.myshopify.com | 200, redirected to `/password` | 495 | Complete, 4 September |
| quickstart-f2795ad8.myshopify.com | 200, redirected to `/password` | 0 | None |
| daniel-store-wh0b7w15.myshopify.com | 200, redirected to `/password` | 0 | None |
| gilded-lily-jewelry.myshopify.com | 200, redirected to `/password` | 0 | None |
| gloria-ck6dmnrc.myshopify.com | 404, “This store is unavailable” | 0 | None |
| willardltd.myshopify.com | 200, redirected to `/password` | 0 | None |

An eighth recorded installation, the app-review store, has 15 stored products and a completed 7 September sync. Its storefront was not visited.

All six password pages lacked `window.AOVBoost`, `window.AOVBoostSDK`, and AOVBoost SDK asset/API requests. This is an expected access-gate result, not evidence that the embed is disabled inside the storefront. It prevents testing product recommendations, chat, widgets, cart actions, and idle traffic. These stores have installation records; that alone does not prove that every installation is currently active or in use.

See [public-storefront-discovery.json](live-store-audit-2026-11-02/public-storefront-discovery.json) and [storefront-access-gate.png](live-store-audit-2026-11-02/storefront-access-gate.png).

## How the app works

The theme app embed loads the storefront SDK and configures the permanent shop domain, current currency, and `/apps/aovboost` proxy. The SDK optionally waits for tracking consent, obtains a signed storefront session through the Shopify app proxy, batches browser events, and requests offers for page and shopping triggers. The server combines shopper state, merchant settings, synced product/variant data, deterministic recommendations, and budget-limited AI. Catalog guards validate product-backed responses before widgets render. Cart actions ultimately use Shopify's cart endpoints. The embedded admin supplies settings, sync controls, bundles, experiments, and analytics.

This flow was traced in source. Its authenticated shopper-to-API-to-widget path has not yet been observed in a live accessible storefront.

## Findings, in priority order

### 1. High: recorded installations can have no recommendation catalog

**Observed:** five of eight recorded installations have zero Product rows and no CatalogSyncJob. One of those five also has an unavailable storefront, so the count must not be treated as five active failing customers. These are installation/readiness gaps requiring merchant-status confirmation.

**Source cause:** `app/shopify.server.ts` persists the installation after authentication but does not start catalog sync. `getCatalogReadiness()` in `app/models/catalogCache.server.ts` sets `resyncRequired` only when `total > 0`. The dashboard's automatic repair in `app/routes/app._index.tsx` therefore does not start a first sync for an empty catalog. The merchant must use the manual Sync products action.

**Impact:** an installed app can lack the exact catalog-backed products needed for useful chat recommendations, bundles, and upsells. Enabling the theme embed does not itself populate the catalog.

**Recommended change:** make initial setup idempotently start or resume a bounded catalog job when a confirmed active installation has no catalog. Show explicit setup states for installation, catalog readiness, and embed verification. Preserve the distinction between a legitimately empty Shopify catalog and a missing initial sync; avoid repeated full syncs of empty stores.

### 2. Medium: the parent admin loader performs an avoidable product fetch

**Confirmed in source:** `app/routes/app.tsx:21` requests 50 products; the GraphQL call at line 45 occurs before the `shop:init` cache check at lines 77–78. The loader returns only the public API key. The cache suppresses a database upsert but not the preceding Shopify fetch and mapping work.

**Impact:** every execution of this parent loader, including full reloads and applicable revalidations, repeats the Shopify call even while initialization is cached. This adds server work and latency and makes admin entry depend on an extra product API request. Browser frequency and milliseconds saved were not measured because authenticated admin access was unavailable.

**Recommended change:** check initialization before fetching, or remove this legacy catalog initialization after confirming its consumers. Keep the paginated sync pipeline as the catalog source. No paid infrastructure is needed for this optimization.

### 3. Medium: sync continuation depends on the admin browser, and its visible progress expires

**Confirmed in source:** `app/routes/app._index.tsx:107` submits the next sync chunk from a browser timer after 1.5 seconds. The job state is durable in PostgreSQL, but the dashboard loader reads sync progress from Redis. `app/jobs/aovboost.server.ts` expires that progress after 3,600 seconds.

**Reproduction scenario inferred from code:** start a multi-chunk sync, close the page before completion, and return after the progress key expires. If the partially synced products have valid variants, readiness alone may not request repair. The dashboard can fail to recognize and resume the still-incomplete durable job. This interruption scenario was not induced against a live merchant store.

**Impact:** partial catalogs, manual restart work, and avoidable repeated Shopify/database processing. Existing per-shop leases reduce concurrent processing but do not independently schedule continuation.

**Recommended change:** load durable job progress on admin entry and resume incomplete jobs from their existing cursor. Add a bounded dispatcher only if sync must continue while the browser is closed; evaluate its invocation budget first. Do not replace resumable jobs with repeated full restarts.

### 4. Investigation needed: catalog freshness has not been established

**Observed:** the three populated catalogs' latest product updates and completed full syncs are dated September. Running the app's exact readiness SQL against them produced:

| Store | Stored | Available in stored data | Actionable variants | Missing variant data |
| --- | ---: | ---: | ---: | ---: |
| newsliderapp | 495 | 495 | 495 | 0 |
| teretret | 25 | 24 | 24 | 0 |
| app-review store | 15 | 13 | 13 | 0 |

The readiness query correctly recognizes this stored variant data. Old timestamps do not prove missed webhooks: the products may simply be unchanged. Conversely, a fresh database read does not establish current Shopify inventory or publication status. Stored `onlineStorePublished=false` flags are not proof of unavailable Online Store products; the mapping code explicitly warns that `onlineStoreUrl` is unreliable across storefront channels.

**Next validation:** once a store is accessible, compare representative product prices, variants, and availability with Shopify; verify the product-update webhook path and then confirm the corresponding offer changes. Do not initiate a full resync merely to test this hypothesis.

### 5. Low: public app entry has no document title

**Observed in Playwright:** the public production root returned 200, rendered the AOVBoost login/marketing page, and had `document.title === ''`. See [app-public-entry.png](live-store-audit-2026-11-02/app-public-entry.png).

**Recommended change:** add a descriptive title and metadata. This is a public-entry quality issue; it does not establish a problem inside the embedded admin or storefront widget.

## Positive checks and limits

- The performance-index migration `20261102150000_performance_indexes` is applied, finished `2026-11-02T13:48:41.688Z` in the configured database.
- The Vercel runtime-error query returned no error clusters for the selected 30-minute window at the beginning of the audit. Low or absent shopper traffic means this is not proof that all flows work.
- An unsigned GET to the production `/api/session` returned 401 with `{"error":"Unauthorized"}`. This verifies this one authentication rejection, not overall security.
- The code includes batched events, activity-aware heartbeat behavior, optional live updates, bounded catalog/cache reads, shared AI budgets, and deterministic fallbacks. Their actual request volume, fallback rate, and shopper experience remain unmeasured in this audit.
- Both a ready Vercel deployment and an active Shopify app version exist. Published widget bytes, enabled theme embeds, and current public settings still need storefront verification.
- Missing custom merchant knowledge is not automatically a chat defect: the code also loads published Shopify shop policies. Actual answers were not tested.
- Expired stored access-token timestamps are not, by themselves, authentication failures: the app contains automatic offline-token refresh handling. Refresh was not forced by this audit.
- No live-store latency percentiles, conversion uplift, billing projection, or free-tier safety guarantee can be derived from password-page visits. There was no AOVBoost shopper API traffic to measure on those pages.

## Required access to finish

Provide one intended storefront URL and its storefront access password, or an accessible store URL, and complete the offered Shopify connection. A Shopify account password is not needed.

Then run desktop and mobile tests for: actual embed/SDK version; session and proxy requests; product and cart placements; variant selection and add/remove cart actions in an isolated browser session; recommendation relevance and exclusions; multi-turn chat accuracy, policies, pricing and currency; dismissal behavior; consent transitions; and visible/idle/hidden-tab request counts. Correlate these requests with Vercel logs and inspect the merchant admin's onboarding, settings, sync, and analytics. No checkout purchase is needed.

## Evidence files

- `public-storefront-discovery.json`: seven public browser visits, sanitized request summaries, SDK presence checks.
- `installation-readiness.json`: read-only aggregate installation/catalog status, without credentials or customer data.
- `catalog-readiness.json`: exact application readiness-query results against stored products.
- `public-browser-checks.json`: public app entry and unsigned session response.
- `storefront-access-gate.png` and `app-public-entry.png`: inspected browser screenshots.
- `scripts/`: the read-only scripts used for this audit. Run from the repository root. They require the app's existing Prisma/dotenv dependencies and a separately installed `playwright-core` available to the script directory; use the installed Chrome executable rather than downloading another browser.

Application source and merchant data were not modified by this audit.