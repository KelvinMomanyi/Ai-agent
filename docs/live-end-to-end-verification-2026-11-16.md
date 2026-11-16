# Live end-to-end verification — 16 November 2026

## Result

**The live app is partially working. It does not pass the complete end-to-end story.**

Of the 11 listed surfaces, two sampled flows passed, two partially worked, two failed their expected flow, four were blocked/unverified, and social proof correctly remained hidden with insufficient real data. These labels describe this live run, not the earlier local test suite.

The first release blocker is a mixed deployment:

- Backend production deployment `dpl_7EmrjFgtQGNEDaZADmrBs9f22wMq` is READY on `ai-agent-dusky-nine.vercel.app`, commit `030a48be19b7f1b83c054bff2f2d87d9dab32629`. The backend target was checked again at the end and was unchanged.
- Shopify CLI listed **`ai-agent-21-88` as active** and the uploaded **`ai-agent-21-89` as inactive**. Live storefront requests throughout the run, including the final restored page, loaded version 88 assets.
- The live SDK SHA-256 was `f09e8956cb2709f6c7d466bd7df80f22a34041cbab0fd7f1808c0b10fff905d2`, which did **not** match the corrected local SDK. This is an unreleased storefront version, not evidence that refreshing the browser will install the corrections.

No app/backend/extension was deployed during this verification. The existing Chrome Shopify Admin tab was used through UI Automation; the storefront used an isolated Chrome session. No personal Chrome profile, cookies or authentication tokens were exported.

## Store and test conditions

- Store: `https://newsliderapp.myshopify.com`, Developer Preview, KES, Velour theme `184701124911`.
- Desktop viewport: 1440 × 960. Mobile layout sample: 393 × 851 in the same isolated Chrome context. This was a mobile viewport, not a native Android/device-certification run.
- Original production configuration: Focused cart recommendations on, Agent Core off, browsing/chat/prompt widgets off, analytics on.
- For the additional checks, actual Admin switches were temporarily enabled, including the real server-side Core flag. The storefront received `agent_core_enabled: true` from the backend. **No browser-only flag injection or local asset replacement was used.**
- No completed checkout/order, charge, refund, cancellation or subscription change was performed. The separate checkout post-purchase extension was not order-tested.

## Widget verdicts

| Surface | Verdict | Actual live evidence |
| --- | --- | --- |
| Chat assistant | **Partial / recommendation failure** | Launcher eventually appeared and chat opened. Both requests completed HTTP 200 SSE streams, but returned no product cards. “Show me three bags from this store with prices” returned no verified match. “Show me Amazing Aluminum Bag Collection20” instead returned “Your cart is currently empty.” That product was independently available and later added through a recommendation surface. Chat-card add/undo could not be tested. |
| Hesitation toast | **Failed expected trigger** | With chat, proactive messages, hesitation and Core enabled, more than the 20-second PDP dwell produced no toast. The old client emitted `long_product_dwell`; responses included proactive cooldown/session limits. The corrected primary-price hesitation client is not the active asset. |
| Countdown banner | **Blocked / unverified positive flow** | Admin fields exist, but campaign is off and title/message/deadline are empty. No legitimate countdown was configured. The new automatic facts client is also unreleased. No rolling or fabricated timer was supplied. |
| Inline alert | **Blocked / unverified positive flow** | Notice is off with no text or selected products. Product page had no factual placement. No synthetic notice was installed merely to claim a positive result. |
| Bundle offer | **Failed** | Created the real active no-discount bundle `QA E2E 2026-11-16 no discount`, with Bag Collection1 as trigger and Collections1/20 as its two items. Admin saved it successfully. The product's initial offer request still returned HTTP 200 with `widgetType: null` and “The configured bundle is no longer available for this product.” No bundle rendered, so cart acceptance was not attempted. The temporary bundle was deleted afterward. |
| Cart-upsell drawer | **Partial: Ajax path passes; normal form path misses** | The actual primary product button added Collection1 and redirected to `/cart`, but no upsell appeared and no offer request was recorded in that path. A separately labeled diagnostic Ajax shopper add did produce a real drawer. Clicking its real Add to cart button sent one `aov_upsell` POST, added Collection20, emitted attributed acceptance, updated the cart to two items/KES 748.73 and did not reopen the drawer. The subsequent cart page showed two editable quantities of 1 and `KSh748.73`. Do not report the normal purchase-button flow as passed. |
| Discount nudge | **Blocked; missing-reward guard works** | Merchant reward code is empty. Shopify returned **zero active discounts**. Threshold offers were suppressed with `configured_reward_required`; no fake reward was rendered. Real discount application/use remains unverified. |
| Recommendation strip | **Passed sampled desktop/mobile flow** | Natural Home initialization produced catalog-backed strips with variant pickers. Real buttons added one item on desktop and one at mobile width, each with `aov_strip`, offer/session line attribution and standard acceptance events. No upsell reopened. The standalone diagnostic `rec_strip` request on the PDP returned no deterministic match; it is not the basis for this pass. The pass is from natural Home display and actual UI acceptance. |
| Social proof | **Correctly hidden; positive display unverified** | Shopify aggregate query returned 1 total order and **0 paid non-test uncancelled orders**. Existing Core truth guards suppressed an unsupported proof decision. Below-five suppression is correct; no counts/orders were invented. |
| Exit-intent offer | **Passed sampled desktop flow** | Real mouse exit with a nonempty cart displayed one offer with an honest cart CTA. Review cart navigated to the correct two-item cart. A second exit attempt did not show another offer. Mobile exit behavior was not re-certified in this run. |
| Storefront post-order / next-cart offer | **Blocked / not live-verified** | The new order-status extension is in the uploaded inactive Shopify release. No real order-status page acceptance was tested. Do not count a guessed `/thank_you` URL, a backend catalog response, or the separate checkout extension as proof of this new flow. |

## Admin and backend boundaries

| Area | Result and limit |
| --- | --- |
| Recommendations settings | Loaded, saved temporary switches, and delivered their changed values to the live storefront. After cleanup, all **13 original toggle values matched** again after fresh Admin navigation. |
| Storefront offers settings | New page loaded. Core could be saved on and then off; the live signed session reflected both states. Original campaign/notice/proof-off and automatic-placement-on configuration was retained. Positive campaign/notice/reward submission was not exercised because the active frontend release is already a blocker. |
| Bundle CRUD | Temporary bundle creation/listing/deletion worked. Storefront bundle eligibility failed as described above. Bundle CRUD success is not widget success. |
| Plan & usage | Loaded and explicitly showed **Billing paused for QA**, Pro access and paused new subscriptions/monthly counters. No billing configuration or subscription was changed. Provider usage can still incur costs. |
| Product pairings | Page loaded; showed Autopilot with 0 of the top 50 products paired and 14 pairings needing attention. Generation, bulk approval and preference changes were not run. |
| Revenue analytics | Page and engagement/funnel sections loaded. This does not certify signed-order conversion attribution, incremental revenue or a completed purchase. |
| New facts API | A clearly labeled diagnostic signed `/apps/aovboost/experience` call returned HTTP 200, version 1, automatic placements true, no campaign and an empty offer list. This confirms the deployed endpoint/auth path for the empty configuration; it does not certify automatic client delivery or positive fact rendering. |

The read-only Shopify aggregate query returned exact counts: 1 total order, 0 eligible paid non-test orders, 0 active discounts. It did not retrieve customer records or modify orders.

## Tracking and cart evidence

The collected evidence contains **84 app-proxy responses, all HTTP 200**, with zero uncaught page errors and zero console-error messages in the observed session. Four warnings and debug output were counted; debug was enabled during diagnostics. HTTP 200 is not a functional success for the failed chat/bundle responses.

Captured Ajax adds were one shopper diagnostic add, one `aov_upsell` acceptance and two `aov_strip` acceptances. Standard acceptance events were received for the cart provider and both strip offers, alongside existing legacy events. Offer/session line properties were present on the accepted recommendation items. No completed-order revenue claim was made.

The ordinary native form redirect and the separately exercised Ajax path are intentionally distinguished. The Ajax pass must not hide the native-path failure.

Evidence is stored under `test-results/live-shopify/2026-11-16/`, including:

- `baseline-cart-add-desktop.json`: normal product button → cart, no upsell.
- `chat-recommendations-desktop.json`, `chat-specific-product-desktop.json`: actual replies and absent cards.
- `configured-bundle-desktop.json`: saved bundle still rejected.
- `upsell-accepted-desktop.json`, `exit-cart-cta-desktop.json`: source attribution, exact cart and visible total.
- `exit-second-attempt-desktop.json`: no repeat exit offer.
- `home-strip-desktop.json`, `strip-accepted-desktop.json`, `mobile-home.json`, `strip-accepted-mobile.json`: natural strips and actual UI adds.
- `signed-facts-endpoint-desktop.json`: diagnostic endpoint result.
- `summary.json`, `final-evidence.json`, `restored-storefront.json`: aggregate results and restored state.

## Cleanup and remaining work

Cleanup completed: the named temporary bundle was deleted, the isolated test cart was emptied, all 13 original switches were restored and verified, Core was restored off, Focused mode was restored on, the original observation helper was restored, and the isolated Chrome browser was closed. The signed-in user Chrome tab remains on Recommendations. QA session/impression/acceptance records remain in the configured app database; they are test traffic, not customer orders.

Priorities:

1. Resolve the mixed release: version 89 was uploaded but not activated. Confirm the actual corrected storefront assets and new order-status block are released before calling their fixes live.
2. Reproduce and resolve the bundle rejection with the real saved-bundle payload and current client/server contract. Its successful Admin save is not sufficient.
3. Resolve chat recommendation routing/matching: both the broad catalog query and an exact available-product query failed their intended result. Do not describe this as a successful AI recommendation flow merely because SSE returned 200.
4. Resolve the native purchase-form redirect → upsell continuation. Preserve the passing Ajax acceptance/cart-refresh/no-loop path.
5. Recheck the real desktop price-hesitation toast with the corrected released client and actual frequency/cooldown rules.
6. Supply legitimate merchant campaign/notice/reward data, retain proof suppression until real eligible orders exist, activate the order-status placement, and run the remaining positive flows. No completed checkout/order or comprehensive all-theme/accessibility/mobile-device sign-off is claimed here.

**The local repair suite remains useful regression coverage; it is not a substitute for these live outcomes.**
