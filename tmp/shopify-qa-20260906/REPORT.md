# AOVBoost Shopify QA — 2026-09-06

Authenticated storefront testing found that AOVBoost is not fully working: all four tested storefront app-proxy routes return HTTP 404. Normal Shopify cart operations pass. A separate consent-handling bug is present in the deployed SDK.

## Store and theme access

- Store: `teretret.myshopify.com`, selected from `shopify.app.toml` and the existing Shopify project configuration.
- Both configured MCP endpoints responded with HTTP 200 to `tools/list`.
- `/api/mcp` exposes the store policies tool. `/api/ucp/mcp` exposes catalog, cart, checkout, and order tools.
- MCP catalog search successfully returned three snowboard products with product IDs, variants, availability, and KES prices.
- Shopify CLI's existing authenticated session successfully listed six themes and downloaded settings/layout copies for inspection.
- Current theme: `test-data`, ID `135840923713`. Its AOVBoost app embed has `disabled: false`.
- Unpublished theme: `Dawn`, ID `135840858177`. Its downloaded settings contain no AOVBoost embed.
- The user-provided store password successfully unlocked the storefront. The password and authentication cookies were used in memory only.
- The live homepage and a product page both render the AOVBoost embed, with `apiBase: "/apps/aovboost"`, currency `KES`, and `trackingConsentRequired: false`.
- The deployed SDK loads with HTTP 200 and exactly matches the local extension build: 113,571 bytes, SHA-256 `89038e460f8599ad959dd402a4b48bb7dcc1fd4d3fc36a9c39733b46d9f9b62f`.

## Verification results

| Check | Result | Limit |
| --- | --- | --- |
| Existing automated tests | PASS: 115 tests in 27 files | Local tests; not a live shopper journey |
| TypeScript / route types | PASS | `npm run typecheck` |
| ESLint | PASS | `npm run lint` |
| Deployed `/api/chat` and `/api/offer` GET | HTTP 200 with `{"ok":true}` | Health responses only; do not exercise AI or database access |
| Direct unsigned `/api/session` GET | HTTP 401 Unauthorized | Expected rejection for a request without Shopify's proxy signature |
| Live homepage and product page | PASS after password login | Both contain the app embed |
| `/apps/aovboost/session` GET | FAIL: HTTP 404, empty response | No signed storefront session is issued |
| `/apps/aovboost/chat` GET | FAIL: HTTP 404, empty response | Corresponding direct backend health route returns HTTP 200 |
| `/apps/aovboost/offer` GET | FAIL: HTTP 404, empty response | Corresponding direct backend health route returns HTTP 200 |
| `/apps/aovboost/config` POST | FAIL: HTTP 404, empty response | App configuration cannot load |
| Fresh Shopify cart | PASS | Initially empty; currency KES |
| Add variant to Shopify cart | PASS | The Complete Snowboard / Ice; quantity 1; total KES 699.95 |
| Change cart quantity | PASS | Quantity 2; total KES 1,399.90 |
| Remove test item | PASS | Cart restored to zero items |
| Visual/browser tests | Blocked | Browser discovery returned no browsers; browser selection also reported no browser available |

The previous password-gate blocker is resolved. Authenticated requests now expose the actual 404 failures. The cart checks used Shopify's Ajax API in a fresh isolated cookie session; they do not establish that AOVBoost's chat buttons or offer widgets can add items.

## Main failure: storefront app-proxy routing

The live theme points at `/apps/aovboost`, but none of the tested child routes is reachable. Session startup therefore fails before authenticated chat, offer decisions, or app configuration can work. The deployed app's direct health routes are reachable, which narrows the observed failure to the storefront proxy path or its forwarding configuration.

The configuration downloaded from Shopify contains the expected proxy destination `https://ai-agent-plum-eight.vercel.app/api`, prefix `apps`, and subpath `aovboost`. However, both this configuration and the project configuration request only `read_orders,read_products,write_discounts`.

The missing `write_app_proxy` scope is a confirmed configuration gap and a likely contributor: Shopify documents it as required for configuring an app proxy. Shopify also permits merchants to customize an installed app's proxy prefix/subpath, and changing defaults does not update an existing installation. The store-specific installed proxy URL and granted scopes were not available in these checks, so the precise reason Shopify is not serving the expected path is not conclusively established. [Shopify app-proxy configuration documentation](https://shopify.dev/docs/apps/build/online-store/app-proxies)

The next repair should verify the installed proxy path and grant the required scope, then redeploy/update the installation as appropriate. Acceptance requires `/apps/aovboost/session` to return HTTP 200 with a signed session, followed by successful configuration, chat, and offer requests.

## Reproduced issue: denied consent resumes SDK initialization

Source: `storefront-sdk/src/index.ts:154`, especially line 160.

With `trackingConsentRequired: true`, `waitForTrackingConsent()` handles the `visitorConsentCollected` event by calling `hasTrackingConsent()` with `trackingConsentRequired` explicitly overwritten to `false`. That makes the check succeed even when Shopify's `analyticsProcessingAllowed()` returns `false`.

An isolated JSDOM reproduction transpiles the actual consent functions from the current source and dispatches the event:

| Analytics consent | `hasTrackingConsent()` | Wait resolved / SDK resumes | Expected |
| --- | --- | --- | --- |
| Denied | false | true | Remain waiting |
| Granted | true | true | Resume |

Run the reproduction from the project root:

```powershell
node tmp/shopify-qa-20260906/consent-check.mjs
```

The same conditional logic is present in the built extension asset, and the deployed asset's SHA-256 exactly matches that local file. This confirms the bug is present in the deployed SDK. The current theme sets the optional consent requirement to false, so this check does not establish that tracking was performed without consent on the store.

## Remaining acceptance tests

Repair the app-proxy failure, then connect a browser with this development storefront unlocked to complete:

- Successful session/configuration requests. App embed and asset loading have already been confirmed by authenticated HTTP requests.
- Chat initialization, answers grounded in the catalog, and correct currency display.
- Product and variant selection, add-to-cart, quantity changes, and cart-aware responses.
- Bundle and upsell triggers, dismissals, and interaction with the theme's cart UI.
- Mobile layout and console/network failures.
- Checkout and post-purchase behavior using the store's test checkout setup.
- Consent granted/denied behavior in the real Shopify privacy integration.

No implementation fix or remote Shopify theme/configuration change was made. Shopify CLI temporarily regenerated the project's configuration while downloading it; its content was restored and the downloaded values were saved under `remote-config/shopify.app.toml`. Local artifacts include two theme snapshots, diagnostic scripts, and this report. The only remote test mutation was adding/changing/removing a product in a fresh cart, which was verified empty afterward. No order was placed and no storefront credentials were saved.

Reference used for MCP request structure: [Shopify Storefront MCP documentation](https://shopify.dev/docs/apps/build/storefront-mcp/servers/storefront).
