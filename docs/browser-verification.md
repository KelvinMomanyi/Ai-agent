# Browser simulation and live Shopify verification

Prepared 10 November 2026. The story under test is: a shopper adds a product,
Shopify confirms the cart change, AOVBoost requests an eligible offer, a verified
card appears, and accepting it adds the complementary variant once without
triggering another offer. Holdout shoppers retain cart measurement linkage
without seeing a card.

## What MCP and Playwright each do

[Shopify's Dev MCP](https://shopify.dev/docs/apps/build/ai-toolkit#install-with-the-dev-mcp-server)
supplies developer documentation, API schemas and code validation. It does not,
by itself, authenticate the app to a merchant store or operate its admin UI.
The Shopify plugin can provide additional authenticated store tools after the
owner connects the intended test store. Neither is connected automatically by
adding a package to this app.

[Playwright MCP](https://playwright.dev/mcp/installation) lets an assistant drive
a browser interactively. The repeatable suite in this repository uses
`@playwright/test` directly; it does not require an MCP client or put a browser
agent in the shopper request path. No production application integration or
global MCP/client settings are changed.

## Local browser simulation

Run `npm run test:browser`. It rebuilds the SDK, starts a loopback-only fixture
server, and runs desktop and mobile Chromium tests. On Windows, an installed
Microsoft Edge at its standard Program Files path is used. Otherwise install
Chromium once with `npx playwright install chromium`.

Use `npm run test:browser:report` to open the local HTML report. Failure
screenshots and reports are ignored by Git. Traces, video and persisted login
state are disabled. The suite uses fresh anonymous browser contexts and no real
credentials, databases, Redis, AI providers or Shopify endpoints. Browser traffic
outside `http://127.0.0.1:4179` fails the test. It never reads `.env`.

The fixture server uses the existing reduced Dawn/cart-page/form HTML fixtures,
synthetic catalog and signed-session-shaped responses (not cryptographic tokens),
an in-memory cart, and a deterministic synthetic offer. These are stand-ins for
Shopify and the app's server, not tests of real authentication or ranking.

Each scenario runs on desktop and mobile:

- Confirmed product add, one drawer card, verified displayed impression,
  recommendation acceptance and no recursive offer.
- Reload of a restored cart stays quiet.
- Native popup blocks the floating card until the popup closes.
- Native form POST redirects to cart, mounts inline once, then reload stays quiet.
- Escape closes a floating card and returns keyboard focus.
- Holdout sees nothing and still links cart measurement metadata.
- Offer endpoint outage preserves the original successful cart add.
- A variant that becomes unavailable in the storefront is not rendered.

## Live development-store run

A full integration result still requires a confirmed development/test store,
the intended local/preview app installation and theme embed, test database/Redis,
configured providers, and an authenticated admin browser session. The owner logs
in interactively; never paste passwords, tokens, cookies or login-state files.
Browser sessions and any credential-bearing artifacts must remain private and
outside committed reports. The billing override is accepted only in the allowed
development/preview environments described in `docs/billing-test-mode.md`.

Verify each boundary with real browser/network evidence and stop at the first
broken boundary:

| Flow                  | Evidence required                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------- |
| Admin authentication  | Embedded admin opens, offline token lifecycle succeeds, no auth redirects or API 403 errors                   |
| Catalog setup         | First sync completes, durable progress survives return, real products appear                                  |
| Pairings              | Autopilot/review state matches settings; reject removes the pair from subsequent offers                       |
| Storefront connection | Theme embed loads the current bundle, signed session succeeds, correct shop/theme/settings                    |
| Confirmed cart add    | Original add succeeds independently, one current offer, no page-load/restored-cart offer                      |
| Placement             | Correct drawer/inline/floating location, verified display, keyboard/mobile behavior                           |
| Acceptance            | Exact selected variant/quantity added once, no recommendation loop                                            |
| Failure fallback      | AI unavailable/capped and offer/storage failure leave the cart usable                                         |
| Measurement           | Display/click/confirmed-add events have the correct owned offer/session; holdout remains invisible and linked |
| Test order            | Authorized test-checkout order reaches webhook and reporting with the correct attribution arm                 |
| Reporting             | Attributed revenue labels and low-sample lift gating remain honest                                            |
| Plan                  | Test Pro state, caps and normal billing behavior when the override is off                                     |

The app uses server-side Admin API calls, so its local/preview host must satisfy
the Shopify IP allowlist (or the applicable dev-preview exemption). A successful
fixture simulation cannot establish this.

Do not use an existing live merchant store or real payment to complete this
matrix. Do not seed or modify a real merchant catalog, deploy extensions,
perform production migrations, rotate tokens or change billing as part of a
browser simulation. A test checkout requires a development store with a test
gateway; do not configure a live payment gateway. Real incremental revenue
requires sufficient live holdout data, not simulated orders.

## Current evidence

The first browser run reproduced a real SDK measurement bug: the cart router
called `EventBus.track("cart_update", originalAddPayload)`, and the original
payload's `type: "add_to_cart"` overwrote the derived event's name. The cart
measurement listener only consumes `cart_update` and `cart_restored`, so a new
holdout cart could remain unlinked even though the add succeeded and no offer
was shown. `EventBus.track` now keeps its explicit event name authoritative.
The new unit regression passes, and the previously failing compiled-SDK
holdout browser scenario now passes without altering the synthetic server.

The native form browser scenario also required a test precondition: wait for
the SDK's initial cart-read event before submitting. The SDK deliberately needs
that baseline to distinguish a confirmed new add from a restored cart. No cart
mutation or native-form SDK logic was changed for that test correction.

`npm run test:browser` passed all 16 scenarios (eight on desktop Chromium and
eight on mobile Chromium emulation). Successful desktop and mobile card
screenshots are attached to the HTML report and stored under
`test-results/browser/`. These are synthetic fixture screenshots, not merchant
store screenshots. The focused SDK regression command passed 23 tests in four
files. `npm run verify` passed typechecking, lint, all 733 Vitest tests in 93
files, SDK build/size checks, Prisma client generation and the production build.
`node --check scripts/browser-fixture-server.mjs` and `git diff --check` passed.
The final SDK size is 158,670 bytes for the main bundle, 210,625 bytes with the
theme engine, and 58,599 bytes compressed; the size budget passes.

Files changed:

- `playwright.config.ts`, `scripts/browser-fixture-server.mjs`,
  `tests/browser/cart-flow.spec.ts`: local browser runner, loopback fixture and
  eight scenarios with desktop/mobile coverage; stop after the first failure.
- `package.json`, `package-lock.json`: development-only Playwright dependency and
  `test:browser` / `test:browser:report` commands.
- `.gitignore`: browser reports, results and authentication state exclusions.
- `storefront-sdk/src/eventBus.ts`,
  `storefront-sdk/src/measurementCartLink.test.ts`: authoritative event-name fix
  and regression.
- `extensions/aovboost-storefront/assets/aovboost-sdk.js`: regenerated bundle.
- This verification report and live-store checklist.

No migrations, deployment, production operations, live token exchange, real
order or payment were performed. To apply the SDK repair to an installed store,
the owner must review the diff and deploy the Shopify theme extension through
the normal release process. The Playwright suite is an additional explicit
browser check; the existing `npm run verify` command remains unchanged and does
not silently require downloading a browser in every CI build.

The later live run against the owner-authorized store is recorded in
[live-store-verification-2026-11-11.md](live-store-verification-2026-11-11.md).
Storefront authentication recovered after the owner opened Admin. Real native
cart adds succeed, and the browser-only local SDK reaches the real offer API,
but that API returns no eligible complements. Signed-in Admin inspection later
confirmed 495 storefront-ready products, zero merchant exclusions, an empty
preview source list, a shared-usage-storage warning, unconfirmed billing and
in-app navigation errors. Product-picker open/cancel and honest empty analytics
presentation passed. The focused catalog/preview/entitlement/usage suite passed
45 tests in four files. A full live pass and test-order attribution remain
outstanding. Inventory/reorder features remain unimplemented and outside this
verification scope.
