# Live verification: newsliderapp, 11 November 2026

Target: `https://newsliderapp.myshopify.com/`. The owner authorized live
verification and supplied storefront access. The supplied password is not
included in this report or saved in the repository. Browser cookies and signed
session values were not exported. No `.env` or credential files were read.

Story: open the installed app, sync/verify its catalog, add a product through the
storefront theme, display one verified recommendation, accept it once, and
verify the resulting test order and reporting. The run has reached offer
eligibility, where the server returns no eligible products. It is not a full pass.

## Evidence

| Boundary | Result | Observed evidence |
| --- | --- | --- |
| Storefront access | Passed | Storefront password accepted; home and product page render |
| Active theme | Observed | Velour, schema name `Velour`, theme ID `184701124911` |
| Theme embed/SDK asset | Present | Shopify CDN `ai-agent-21-85/assets/aovboost-sdk.js` returns HTTP 200 |
| SDK build comparison | Different | Published asset differs from the local SDK; a browser-only asset override successfully loads the local build. No theme release was published |
| Native cart | Passed | Native product-form adds succeed and redirect to `/cart`; `/cart.js` returns 200, correct variant and quantity, in KES. Only QA-context items were changed; the cart was cleared afterward |
| Signed storefront session | Recovered | Initially 401 `Invalid shop`; after the owner opened AOVBoost Admin, session, config and event requests return 200 |
| Runtime settings | Passed | Focused mode, cart recommendations and analytics are enabled after recovery |
| Published native-add flow | Failed | Adding the bag redirects successfully, but the SDK records a restored cart and no offer request was observed |
| Local SDK on real theme | Partial pass | A prompt native add after the initial cart baseline produces `add_to_cart`, `cart_update`, `cart_item_added` and one authenticated offer request |
| Real offer eligibility | **Blocked** | Bag and sandals tests each receive HTTP 200 with `widgetType: null`, `reasoning: no_eligible_cart_complements`; no card renders |
| Restored-cart reload | Passed for local SDK | Reload with one QA item causes zero offer requests and zero cards during a seven-second observation window |
| Public response privacy | Passed for observed responses | Browser-side serialized scans of two no-offer responses and a config response find no tested cost, margin or raw-inventory field names. This does not establish privacy of a product-bearing live offer |
| Consent gate | Not the observed blocker | Embed configuration has `trackingConsentRequired: false`; session requests are being made |
| Backend deployment | Observed | Active Vercel alias resolves to READY deployment `dpl_G5ZZuLRN649vYGMrUzf2UHK2vMJV`, commit `c89dffa54549ecdf82df754446c48437f0897ddf`, region `iad1` |
| Auth warning logs | Inconclusive | Vercel search for `AOVBoost storefront auth rejected` returned no matching logs in the inspected five-minute window |
| Shopify Admin | Passed in owner's regular Chrome | Signed-in Home, Recommendations, Product pairings, Preview, Plan & usage and Revenue analytics were inspected through Windows accessibility; no login-state transfer was used |
| App catalog readiness | Passed | Admin reports 495 storefront-ready, 495 stored, sync complete, 495 recommendation-ready |
| Merchant selection settings | Inspected | Cart recommendations on, Generic preset, zero blocked/preferred/priority products, zero excluded collections; no additional sensitive phrases |
| Pairing state | Inspected | Autopilot / Balanced / Generic; zero top-50 products covered by merchant or autopilot pairs; 14 pairs need attention; no approval/rejection/generation action was taken |
| Admin preview | **Failed** | After a full reload it displays the no-eligible-products warning, with no source-product selector, despite the ready catalog |
| Embedded internal navigation | **Failed** | Native Home and Preview link navigation produced `Application Error` / `[object Object]`; full entry through Shopify Admin loaded those pages |
| Shared usage storage | **Unavailable** | Plan page explicitly reports usage storage temporarily unavailable; exact database/Redis failure is not established |
| Billing/test entitlement | Blocked for full Pro testing | Awaiting verification, billing integration unconfirmed, paid AI paused; active Vercel target is Production, which intentionally ignores billing test mode |
| Revenue reporting | Passed for empty-data state | KES 0.00 attributed revenue, zero impressions/attributed orders, holdout off, lift says Not enough data yet; attribution and incrementality are labeled separately |
| Resource picker | Passed for open/cancel smoke | Blocked-product picker opened and was canceled without selecting products or saving configurations |
| Shopify connector catalog check | Passed | Connected domain is `newsliderapp.myshopify.com`; Admin GraphQL returns exactly 495 active products, and both tested source IDs are active |
| Development-store/test-gateway status | Partial | Shopify connector reports `Developer Preview`; test payment gateway remains unconfirmed |
| Display, acceptance, holdout, checkout, order/reporting | Not verified live | No eligible live offer was returned. Test-store/gateway status is still unconfirmed; no checkout or order was submitted |

Screenshots are private, ignored artifacts under `test-results/live-shopify/`:
`homepage-initial.png`, `storefront-auth-blocked.png`,
`live-after-product-add.png` and `candidate-after-native-add.png`. They contain
storefront content only; no Admin login screen or credential values were captured.

## Initial connection blocker: recovered

The deployed `app/routes/api.session.tsx` calls `verifyAppProxyRequest`, then
returns `Invalid shop` when no shop is resolved or `isInstalledShop(shop)` is
false. The storefront embed supplies `newsliderapp.myshopify.com` and the normal
app-proxy path. This is consistent with the backend not finding the store's
installation in its configured database. The underlying reason for missing
installation state has not been proven by a direct database read.

`app/models/installedShop.server.ts` checks for a Session or legacy Shop record.
This branch does not call the Shopify Admin API, so an Admin API IP allowlist
failure is not the direct explanation for this particular response. Generic
signature rejection follows a different response path (`Unauthorized`). No
signature check, tenant guard or installation check has been disabled.

The owner subsequently opened AOVBoost in Shopify Admin. Retesting the
storefront produced successful session, config and event requests. Normal
authenticated entry resolved the observed connection problem; no installation
row, token or signature validation was manually changed.

The storefront password grants storefront access only. It cannot provide the
owner's Shopify Admin session. A visible isolated verification browser has been
opened at the normal Admin login. The owner's dashboard being open in another
browser does not give this isolated browser access to the embedded Admin UI.

## Current broken boundary: offer eligibility

The published theme asset successfully adds
`amazing-aluminum-bag-collection1` through the theme's native form and redirects
to `/cart`, but no offer request was observed. Its deployed SDK does not match
the local build.

For a separate candidate check, Playwright fulfilled only AOVBoost SDK and lazy
theme-engine asset requests from the reviewed local asset files, inside its
own browser context. Shopify's cart, app-proxy authentication and offer API
remained real. This is a client candidate test against the deployed backend,
not a deployment or verification of a fully released version.

After waiting for the initial verified cart baseline and submitting promptly,
the local SDK detects the native redirect as a confirmed add and requests an
offer. Two source products were tested separately:

- `amazing-aluminum-bag-collection1`, product `12641488175407`, variant
  `54200156684591`.
- `amazing-aluminum-sandals-collection1`, product `12641468645679`, variant
  `54200131289391`.

Both adds succeeded, and both offer responses returned
`no_eligible_cart_complements`. In current source this means
`buildOfferCandidates(..., cartOnly: true)` returned no product candidates.
Possible causes include an unsynced source product, no available synced
targets, or merchant/pairing exclusions. The exact cause has not been proven;
there was no direct database query or authenticated Admin readiness inspection.
The public product listing contains available products, which establishes
storefront availability but does not establish the app's synced catalog state.

No product, approval, exclusion, catalog guard or billing setting was changed
to force an offer. The owner subsequently confirmed 495 products are fully
synced. A successful empty offer is not a verified display.

The local SDK's restored-cart reload stayed quiet. The final QA cart was
cleared only after checking it contained the known QA variant. The asset
override was removed, and a reload of the published SDK with the empty cart
showed no cards.

## Follow-up after the owner confirmed sync completion

The Shopify connector became available and was used read-only to verify its
connected domain and shop plan, count active products, and check the two tested
product IDs. It reports the correct domain, `Developer Preview`, exactly 495
active products, and both source products as `ACTIVE`. Both products were
created in February and last updated in July 2026. The current store count
matches the owner-reported app sync count; there is no evidence here of a
missing initial sync.

A fresh isolated storefront session repeated the native bag add using only the
browser-local SDK asset override. The actual offer request contains canonical
product/variant GIDs, `cartItemCount: 1`, KES/KE context,
`trigger: cart_item_added`, `confirmed: true`, and
`source: verified_native_form_redirect`. Its response is again HTTP 200 with
`no_eligible_cart_complements`. Authentication, native-add detection and cart
ID normalization are therefore not the observed failing boundary in that
candidate run.

Two bounded public product-listing reads returned 495 products with available
variants. A local read-only diagnostic loaded the existing pure
`isSensitivePair`, `nearDuplicate` and `inPriceBand` functions against sanitized
public catalog fields, using default sensitive keywords. It found 354 possible
targets for the bag and 363 for the sandals after those general checks. This
does **not** reproduce the app's PostgreSQL records, cached candidate selection,
saved merchant keywords/exclusions, relationships or recent rejections. The
counts are diagnostic candidates, not products proven eligible in production.

At that stage, the remaining distinction was within AOVBoost's saved selection state. The
Shopify connector cannot read AOVBoost's own database or authenticate its
embedded Admin UI. A visible verification browser was opened at AOVBoost's
normal Admin entry, which redirected to Shopify login. The owner has been
asked to sign in interactively there so the synced product data, exclusions and
read-only offer preview can be inspected without exporting credentials or
bypassing authentication.

The owner then reported that Sign in did not proceed after entering an email
in the Chrome verification window. By the time of inspection, that controlled
context had no open tabs, so no error, failed login request or challenge could
be inspected. The cause is unconfirmed; automated-browser blocking is not an
established diagnosis. AOVBoost's Admin link was opened in regular Chrome for
a manual comparison. That regular browser is not attached to Playwright, and
opening it does not establish authenticated verification access. No Chrome
profile, login field values or account cookies were read or copied.

Authenticated access was subsequently established through Windows accessibility
against the owner's regular Chrome window. The current findings below supersede
the earlier access limitation; another login is not needed for this inspection.

Private helper scripts and sanitized catalog data remain ignored under
`test-results/live-shopify/`. The local diagnostic explicitly disables Vite
environment-file loading; it makes no database or AI calls. Its first sandboxed
bundler run was denied filesystem access; the approved rerun succeeded. The
follow-up cart was cleared after validating it contained only the known QA
variant, and the browser-only asset override was removed.

## Signed-in Admin findings

The owner's already-authenticated AOVBoost window was inspected using supported
Windows accessibility interfaces and app-viewport-only screenshots. The regular
Chrome profile was neither opened from disk nor imported into Playwright.
Native Chrome menus/window metadata were used only to locate the target app.
Opening the standard Microsoft accessibility interface exposed its embedded
app document for scoped reading and navigation.

Home confirms 495 storefront-ready products, 495 stored products and a complete
sync. Recommendations settings show Generic, cart recommendations enabled, and
zero blocked, preferred, priority or excluded-collection selections. Product
pairings shows Autopilot / Balanced / Generic, an empty additional-sensitive-
phrases field, zero live top-50 coverage, and 14 pairs awaiting review. Observed
suggestions have confidence 0.80, below the named balanced approval threshold;
they were not approved merely to force an offer. The catalog fallback is still
expected to serve independently eligible products.

The read-only preview initially produced `Application Error` / `[object Object]`
when opened using its in-app link. A full reload through the Shopify Admin URL
loaded Preview, but it showed the no-eligible-products warning and no source
selector. Accessibility inspection confirmed zero combo boxes in the preview.
In `getAdminOfferPreview`, that selector depends on the eligible catalog source
list. Together with the readiness counts and zero merchant exclusions, this
points to an empty/unusable retrieval snapshot or stale availability at the
cache/retrieval boundary, before cart ranking. The production snapshot itself
was not read directly, so its exact failure mode remains unconfirmed.

Following the preview's Home link reproduced the object error. Chrome Network
showed an app document request with HTTP 200, not an established HTTP 500. A
response-only scan returned predefined markers for Shopify App Bridge bootstrap
markup; no response body, API-key value, request headers, cookies, authorization
values or signed tokens were printed or saved. The root error boundary renders
non-Error objects with `String(error)`, explaining the unhelpful visible
`[object Object]`. Investigate embedded navigation/context and bootstrap-response
handling separately from catalog eligibility. No authentication guard was changed.

Plan & usage reports both Awaiting verification and usage storage temporarily
unavailable. In source, `getUsage` can return unavailable after either a failed
durable `MonthlyUsage` read or a failed/invalid shared Redis usage operation.
Therefore this observation does **not** prove that a Redis credential is wrong
or that Redis alone caused the outage. Catalog fills also require a distributed
Redis claim and can return an empty snapshot when no previous snapshot exists;
that is a plausible shared-dependency explanation for the preview/storefront
symptoms, not a confirmed root cause. The fail-closed behavior was preserved.

Vercel metadata confirms that `UPSTASH_REDIS_REST_URL`,
`UPSTASH_REDIS_REST_TOKEN` and `DATABASE_URL` are encrypted variables assigned to
both Production and Preview. They predate the active deployment. Decryption was
explicitly disabled; only names, targets and timestamps were inspected. Variable
presence does not prove valid credentials, service availability, quota, Lua
support, deployed database schema or successful runtime connections.

The live alias still targets READY Production deployment
`dpl_G5ZZuLRN649vYGMrUzf2UHK2vMJV`, commit
`c89dffa54549ecdf82df754446c48437f0897ddf`, region `iad1`. The checkout's HEAD
matches that commit. `billingSource` remains `unconfirmed`. Although the
repository's `billingTestMode` is true, its documented environment guard
intentionally refuses Production. A Shopify Developer Preview store does not
make its backend a Vercel Preview deployment. This instance is consequently
not an all-features Pro test environment.

Revenue analytics loads and reports KES 0.00 attributed revenue, zero offer
impressions and zero attributed orders. Holdout is off; lift is Not enough data
yet. It states that generated decisions are not impressions, groups by pairing
origin/placement are descriptive, and attributed revenue is not incremental.
This verifies the empty-data presentation, not real conversion/order attribution.
The monthly summary correctly renders without a plan price.

The product resource picker opened through App Bridge and exposed its normal
Cancel/Select controls. It was canceled without choosing products or saving
the form. The initial helper attempt used the visible button text instead of
its accessible name; the corrected selector was `Choose blocked products`.
Modal loading also required waiting beyond the initial short observation.
Neither helper issue was classified as an application defect.

The signed-in Admin remains open on Recommendations, with the picker closed
and zero product/collection exclusions still shown. No merchant configuration, pairing, subscription,
product, theme or security setting was changed. Normal Admin reads may perform
the app's ordinary cache/usage bookkeeping; no direct database or Redis command
was run. Request credentials and browser login state remain private.

## Remaining checks

1. Identify why usage initialization is unavailable: check runtime database
   schema/`MonthlyUsage` access and Upstash connectivity, authentication, quota
   and Lua operations using the normal operational dashboards. Check catalog
   fill claims and snapshot reads/writes. Do not infer missing variables, clear
   merchant exclusions or bypass the distributed safeguards to hide the failure.
2. Fix and regression-test embedded internal navigation and bootstrap-response
   handling. The generic object error and the empty catalog preview are separate
   observed failures until a common cause is demonstrated.
3. Configure the real billing integration for normal operation. For full Pro
   testing, use the documented Vercel Preview/Development environment with test
   database/Redis; Production intentionally ignores the test switch.
4. Review and publish the regenerated storefront extension through the normal
   release process when ready. Its currently published asset differs from the
   candidate tested locally. This verification does not deploy it.
5. Repeat displayed offer, acceptance, no-recursion, placement/mobile/keyboard,
   holdout linkage and order/reporting checks after the upstream failures are
   repaired. Confirm a test payment gateway before any completed order. The
   existing local browser simulation does not replace these live checks.

## Shopify plugin and operational access

The installed Shopify skill was read, official API 2026-07 documentation was
searched, and this read-only operation was schema-validated successfully:
`AOVBoostLiveVerification` reads the shop domain, development-plan flags and
five product IDs/handles. The validator requires `read_products`.

The owner has been shown the exact `shopify store auth` and `shopify store
execute --version 2026-07` commands and asked to approve that optional Admin
metadata check, as the skill's CLI guide explicitly requires a separate
confirmation before authentication or transmitting a store query. Neither
command has been executed. They are no longer necessary for the catalog
metadata check because the connected Shopify tools became available.

The connector's `get_shop_info`, `graphql_schema` and `graphql_query` tools were
used for the follow-up. `AOVBoostCatalogCheck` reads the active-product count
and two source products' ID, handle, status and timestamps. The tool validated
and executed the query successfully; a separate API 2026-07 validator run also
passed with required scope `read_products`. An initial PowerShell invocation
lost GraphQL quoting and failed syntax validation; passing the unchanged
operation through Node argument arrays corrected the transport. No Shopify
write operation or new CLI scope grant was made.

Toolkit instrumentation was disabled for helper commands. The earlier browser
request failed under sandbox network restrictions; the approved browser run
outside that restriction reached the store normally. The temporary browser
helper passed `node --check` and remains under ignored `test-results/`.

Only isolated-browser QA cart adds/cleanup and ordinary authenticated Admin
inspection were performed. No product
edits, orders, payments, app-setting changes, direct database operations, token
migrations, scope changes or deployments were performed. Existing local
Playwright work and the SDK repair were preserved. No application source was
changed during this dashboard-follow-up investigation. `git diff --check`
passed. No migrations or application tests were added in this Admin follow-up.
The focused command below passed all 45 tests in four files:

```text
npm.cmd test -- app/models/catalogFill.server.test.ts app/models/offerPreview.server.test.ts app/models/entitlements.server.test.ts app/models/usage.server.test.ts
```

Its first sandboxed invocation failed during bundler startup before tests ran;
the approved rerun passed. Persistence-failure warnings in the test output are
intentional fixtures, not live-store logs. The previously recorded full verify
(733 tests in 93 files, build/SDK checks) and 16 simulated browser tests were
not rerun: this follow-up changed documentation and ignored verification helpers,
not application source. A green mocked suite does not establish live dependency
health or make this verification a full pass.
