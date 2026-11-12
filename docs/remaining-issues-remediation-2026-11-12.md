# Remaining live issues: corrections and account dependencies

The cart correction and Redis connection support are implemented locally.
This report does not claim a new production release or restored external Redis
service. The previous live run remains the production baseline: recommendations
and acceptance worked, but Velour's cart display was stale until reload.

## Cart refresh correction

Read-only access to the active theme `184701124911` confirmed that Velour uses
`sections/cart.liquid` through its JSON cart template, dynamic section-wrapper
IDs, a `[data-cart-count]` badge, and a `shopify:section:load` listener that binds
quantity inputs. The old adapter requested only Dawn's fixed section IDs.

The corrected storefront SDK:

- Discovers the section that owns the real cart form and the section containing
  its header badge, including dynamic IDs. Requests at most five sections in the
  same successful Shopify Ajax cart mutation.
- Refreshes cart lines and server-calculated prices, discounts and totals.
  Refreshes the badge without replacing the header's navigation or modal controls.
- Preserves unsaved notes/attributes, the existing recommendation shadow root,
  acceptance state and keyboard focus during section replacement. The existing
  confirmed-cart-mutation handler subsequently retires the accepted offer, as
  before. App cards stay outside native forms/tables.
- Notifies the theme after replacing cart content so Velour binds the new
  quantity controls. It does not execute returned script tags.
- Retries missing section HTML with a read only. It never repeats an accepted
  cart-add POST when section rendering fails.

References: Shopify's [bundled cart section rendering](https://shopify.dev/docs/api/ajax/reference/cart#bundled-section-rendering)
and [dynamic section IDs](https://shopify.dev/docs/api/ajax/section-rendering).

## Redis configuration correction

Cache, shared billing/usage/claims and Shopify session storage now use a common
connection selector. It supports either the direct `UPSTASH_REDIS_REST_URL` /
`UPSTASH_REDIS_REST_TOKEN` pair or Marketplace's `KV_REST_API_URL` /
`KV_REST_API_TOKEN` pair. It refuses partial/mixed pairs, unknown sources,
malformed/insecure REST URLs and substitution of a read-only token.

`AOVBOOST_REDIS_SOURCE=vercel_kv` explicitly selects the Marketplace pair when
an older direct endpoint remains configured. The default `auto` preserves the
existing direct pair; it uses Marketplace only when direct credentials are
absent. Selecting `upstash` requires the direct pair. Session-cache requests also
have a bounded timeout; rotating offline credentials remain durable in PostgreSQL.
Production quotas, provider limits and delivery claims still require a healthy
shared service. No per-instance quota substitute or billing test bypass was added.

The health command uses the same selector and also reports missing billing
configuration. Its billing result is configuration readiness, explicitly not
subscription verification. It never changes usage counters or subscriptions.

## External account work still required

The connected Vercel team is `bostone339-6995`, project `ai-agent`
(`prj_eKfMXvc2E0kQosLSFnKBlszk6zQE`). The connected account has no installed
Redis integration. The local CLI is authenticated to another account and cannot
access this team; it was not relinked and no resources or variables were changed.
The scoped Marketplace response confirms a Free Upstash Redis plan exists.

1. Restore the configured Upstash database, or connect a replacement through the
   intended team's [Storage page](https://vercel.com/bostone339-6995/~/stores).
   If Marketplace supplies the KV pair while the old direct pair remains, set
   `AOVBOOST_REDIS_SOURCE=vercel_kv` in the intended deployment environment.
   Keep production and non-production credentials scoped separately. Preserve
   existing durable usage; no quota/counter reset is authorized by this repair.
2. Confirm the app's actual pricing source in the Shopify Partner Dashboard.
   `admin_api` and `shopify_app_pricing` are different verified billing paths.
   For Shopify App Pricing, provision the Partner organization/app credentials
   and configured plan item handles described in
   [the billing configuration notes](audit-remediation-2026-11-12.md#billing-configuration).
   An empty Admin subscription response cannot establish managed-plan access.
   No billing source or plan was guessed or enabled.
3. Publish the rebuilt storefront extension and deploy the backend configuration.
   This repair changes both the SDK and its hashed theme engine; a backend-only
   deployment cannot update the already-published SDK. No schema migration.
4. Repeat the native add, acceptance, visible two-line cart and quantity-change
   checks with the published assets. Authenticated Admin, shared usage, actual
   billing verification and test-gateway order attribution still need live checks.

The owner has been asked for the billing-source choice and the Redis account
connection while independent code work continues. Tokens should be entered only
in the relevant provider's secret settings, not pasted into chat.

A fresh execution of `npm run health:check -- newsliderapp.myshopify.com`
confirmed a reachable PostgreSQL database and 495 products, selected Redis source
`upstash` with `ENOTFOUND`, and billing source `unconfirmed`. Its expected failure
exit preserves these unresolved conditions instead of treating a successful build
as operational recovery.

## Verification

- `npm run verify`: TypeScript, ESLint, **781 tests in 100 files**, Prisma
  generation, SDK size checks and production build passed.
- Generated SDK main: 161,181 bytes; combined SDK and hashed theme engine:
  216,598 bytes, gzip 60,350 bytes, within the existing budgets.
- Focused Velour browser regression passed: visible two-line cart, $32 synthetic
  subtotal, badge count two, preserved notes, one add request, zero reloads,
  successful telemetry, no recursive offer, and a working native quantity control.
- `node --check` passed for the connection selector and health/fixture scripts;
  `git diff --check` passed.

- Complete desktop/mobile browser suite: **18 passed** against the rebuilt SDK.
  This includes the Velour cart correction, original Dawn drawer flow, native
  redirect, restored-cart silence, popup dismissal, holdout, unavailable products
  and offer-outage behavior.

Local browser tests are explicitly synthetic and do not establish a production
pass. Both generated extension assets are ready to publish. The proposed release
is `shopify.cmd app deploy --version cart-refresh-20261112 --allow-updates --no-input`.
It uploads this app's configuration and all local extensions to AOVBoost
(`ai-agent-21`) and releases a new Shopify version. It does not deploy Vercel.
No release command has been executed; explicit CLI-release confirmation is pending.
