# Live-store verification — 12 November 2026

Latest status after the owner's extension deployment: **the published SDK now
detects the native cart add and requests an offer, but the live offer endpoint
returns HTTP 500 through Shopify's app proxy**. No recommendation card renders.
Production logs correlate that request with Redis DNS failures. This is not a
complete end-to-end pass. The earlier run below is preserved as historical
evidence and is superseded by the post-deployment retest at the end.

Story: open AOVBoost in Shopify Admin, verify setup and catalog, add a product
through the real storefront theme, see and accept one recommendation, and verify
the resulting authorized test order in reporting.

## Current live target

- Connected store: `newsliderapp.myshopify.com`. A fresh authenticated Admin API
  query reports `partnerDevelopment: true` and public plan `Development`; currency
  is KES. Test payment gateway status remains unconfirmed.
- Production app: `https://ai-agent-dusky-nine.vercel.app`.
- Fresh Vercel inspection: READY Production deployment
  `dpl_Hf4hrRmyBs1TEaSM55hcKi7cfNPK`, commit
  `f7ea4ac5ec4dd5596ef014685598699fb7904ddd`, matching repository HEAD.
  This includes the local remediation from the previous turn.
- Published Shopify SDK: CDN version `ai-agent-21-85`, HTTP 200. Its bytes still
  differ from the reviewed local `aovboost-sdk.js`. No browser asset overrides
  were used in this run.
- Browser: isolated visible Google Chrome driven by Playwright. No regular
  browser profile, account cookies, login state or session token was imported,
  printed or saved. The owner unlocked the storefront through the normal page.

## Observed flow

| Boundary | Result | Fresh evidence |
| --- | --- | --- |
| Public app root | Passed | HTTP 200 with AOVBoost content |
| Unauthenticated API checks | Rejected as expected | GET `/api/session` and empty POST `/api/offer` returned HTTP 401; this checks only those rejection paths |
| Storefront entry | Passed | Owner unlocked the password page; homepage rendered with Velour theme ID `184701124911` |
| Embed and SDK | Present, stale release | SDK loads from Shopify CDN, but byte comparison does not match the local build |
| Storefront authentication | Passed | Real app-proxy `/apps/aovboost/session` returned 200 |
| Runtime configuration and events | Passed for observed requests | `/apps/aovboost/config` and `/apps/aovboost/events` returned 200; focused mode, upsells and analytics are enabled |
| Native cart add | Passed | Product-form add redirected to `/cart`; `/cart.js` returned one unit of variant `54200156684591` for product `12641488175407`, in KES |
| Recommendation trigger | **Failed** | No offer API request and no card during the eight-second observation after the confirmed native add |
| Restored cart reload | Passed for observed window | Seven seconds after reload: zero offer requests and zero cards |
| QA cart cleanup | Passed | Guard confirmed the cart contained only the known QA variant at quantity one; removing that line returned HTTP 200 and zero remaining items |
| Catalog and saved settings | Verified in production data | Read-only query: sync complete at 495 products; focused cart recommendations and analytics enabled; zero blocked, preferred, priority or excluded-collection entries; holdout off |
| Embedded Admin | Awaiting login | The separate test tab redirects to `accounts.shopify.com/lookup`; no authenticated app screen has been read in this run |
| Offer display/acceptance and no-recursion | Blocked | Published trigger does not request an offer |
| Live holdout and conversion/reporting | Not verified | No eligible displayed offer or test order exists from this run |
| Checkout/test gateway | Not verified | No checkout, order or payment was submitted |

The source product was checked through the connected Shopify product tool and
is currently ACTIVE. Its selected variant is the same variant observed in the
real Shopify cart. No product or merchant recommendation setting was changed.

## Confirmed infrastructure failure

The read-only health script again found a reachable configured PostgreSQL
database, the expected `MonthlyUsage`, `EntitlementSnapshot` and `Product` tables,
and 495 tenant-scoped product records. Its Redis connection failed with
`ENOTFOUND`. A subsequent credential-preserving comparison confirmed that the
configured database connection matches the current Vercel Production variable.
Neither connection string nor comparison fingerprint was printed or saved.

A read-only transaction in that confirmed database verified the saved settings
and completed 495-product sync. In the inspected 30-minute window there were
cart-update/restored-cart events and **zero offer records**; no `add_to_cart`
event was returned by the aggregate. These are shop-wide aggregate counts in
the test window, not an exported shopper/session timeline. No durable monthly
usage row existed for the current month. This does not imply shared Redis usage
was available or establish a verified zero billable total.

Crucially, fresh **production runtime logs** now independently report:

```text
AOVBoost dependency unavailable { operation: 'redis_claim', reason: 'dns_failure' }
AOVBoost dependency unavailable { operation: 'redis_guarded_operations', reason: 'dns_failure' }
AOVBoost dependency unavailable { operation: 'redis_cache_fallback', reason: 'dns_failure' }
```

These occurred during real session/event traffic on deployment
`dpl_Hf4hrRmyBs1TEaSM55hcKi7cfNPK`. Vercel metadata still lists the Redis/database
variables with their previous timestamps and no billing-source/Partner overrides.
No credentials or environment settings were changed.

The current native-add failure is observed before any offer request. Redis is a
separately confirmed production problem that must be fixed before downstream
catalog/usage operations can be relied on. This run does not claim that an offer
request returned the new `catalog_temporarily_unavailable` response: no such
request was made by the published SDK.

## Evidence and next steps

Sanitized scenario JSON and a storefront-only screenshot are ignored artifacts
under `test-results/live-shopify/2026-11-12/`. No login screenshots, request
credentials, full private response bodies or browser-storage exports were saved.

The owner has been asked to sign in to the open Admin tab, and separately asked
to approve `shopify app deploy --version audit-fixes-20261112`. That command
uploads the reviewed AOVBoost app configuration and all local extensions and
activates a new version. No deployment command has been executed.

To complete the live story: finish Admin login, restore/replace the active Redis
connection, release the reviewed SDK, verify a real eligible displayed offer and
its single acceptance, then verify a test-gateway order and reporting. Billing
source/configuration remains unconfirmed; the Production deployment intentionally
does not grant the repository's Preview/Development test-mode entitlement.

## Retest after the owner's Shopify extension deployment

The owner reported deploying the new version. A fresh native-add run used the
published CDN asset exclusively, with no overrides. It waited for the SDK's
verified initial cart-read event before submitting the theme's native form.

| Boundary | New result | Evidence |
| --- | --- | --- |
| Published SDK version | **Updated and matched** | `ai-agent-21-86/assets/aovboost-sdk.js`, HTTP 200; SHA-256 matches the reviewed local build on both product and cart pages |
| Backend deployment | Unchanged | Production remains READY `dpl_Hf4hrRmyBs1TEaSM55hcKi7cfNPK`, commit `f7ea4ac5ec4dd5596ef014685598699fb7904ddd` |
| Native product add | Passed | Shopify cart contains exactly one unit of QA variant `54200156684591`, in KES |
| Confirmed-add recommendation trigger | **Recovered** | The published SDK now makes POST `/apps/aovboost/offer` after the native redirect |
| Configuration and telemetry | Passed for observed requests | App-proxy configuration and event requests return HTTP 200 |
| Live offer response | **Failed** | Browser receives HTTP 500 through the app proxy; no parseable JSON offer was captured and zero cards render |
| Browser runtime | No observed page errors | Zero `pageerror` events in the scenario |
| Restored cart and cleanup | Passed | Seven-second reload window: zero offer requests and zero cards. Guarded removal of the single QA line returned HTTP 200 and left the cart empty |
| Acceptance, checkout and attributed order | Blocked | No displayed eligible recommendation exists from this run; no order or payment was submitted |

The associated production request was
`g2fwf-1794456086008-1b3da8f93aab`, on POST `/api/offer` at approximately
`2026-11-12T04:01:28Z`. Its logs explicitly report:

```text
AOVBoost dependency unavailable { operation: 'redis_cache_fallback', reason: 'dns_failure' }
AOVBoost dependency unavailable { operation: 'billing_verification', reason: 'unavailable' }
AOVBoost dependency unavailable { operation: 'redis_guarded_operations', reason: 'dns_failure' }
AOVBoost dependency unavailable { operation: 'redis_claim', reason: 'dns_failure' }
```

These are real deployed runtime logs associated with the observed offer
request. They establish that the Redis dependency remains broken in production;
they do not establish why Shopify exposes HTTP 500 rather than the application's
intended retryable HTTP 503 response. No successful empty offer or product-bearing
response was observed, so product-response privacy is not claimed as verified.

The active SDK mismatch and native-add detection blocker are now resolved.
The next required repair is the configured Redis service/connection, followed
by a new live offer test. Billing verification is also still unavailable. The
isolated Admin tab remains at Shopify login. Evidence for this retest is in
`test-results/live-shopify/2026-11-12/post-deploy-native-add.json` and the matching
storefront-only screenshot; the guarded cleanup result is recorded separately.
