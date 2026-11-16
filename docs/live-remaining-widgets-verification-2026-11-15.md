# Live verification of the six remaining storefront widgets

15 November 2026. Store: `newsliderapp.myshopify.com`; currency: KES; theme: Velour.

**Result: the six widgets cannot yet be signed off as working end to end.** The configured bundle flow failed. Four fact-based widgets lack the live data/configuration needed for positive tests; their sampled suppression guards worked. Storefront post-purchase lacks a usable placement in the tested route, and a real completed-order flow remains unverified.

This run used the published Shopify assets and real app-proxy endpoints. No local SDK, mocked offer response or fabricated sales count was substituted. The backend remains deployment `dpl_5JascXp4HzMnNKybLvuiNvudWikd`, commit `76448abb803558495f767feb4980e039945a9813`, with Shopify extension `ai-agent-21-88`. The earlier [chat/toast repair](chat-toast-repair-2026-11-15.md) is still local and was not released during these checks.

## Results

| Widget                   | Result                                                 | Actual live evidence                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------ | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bundle                   | **Failed positive flow**                               | A temporary active bundle saved in Admin with one trigger, two available products and no discount. Initial and subsequent manual offer requests returned HTTP 200 with `widgetType: null` and **“A bundle item is excluded for this product.”** No bundle appeared, so variant selection and multi-item acceptance could not be exercised.                                                                                              |
| Countdown                | **Positive flow blocked; invalid-data guard passed**   | A past deadline returned no offer: **“A countdown requires a verified future campaign end time.”** A diagnostic future deadline produced a real `countdown_banner` response, but the frontend rejected it with `future_campaign_required`. The embed supplied no `campaign` object and the page had no reserved slot. No timer appeared; positive countdown/expiry behavior remains unverified.                                         |
| Inline alert             | **Positive flow blocked; missing-fact guard passed**   | A diagnostic `price_drop_webhook` request returned a real `inline_alert` response. The Arbiter rejected it with `supplied_alert_required`. There was no merchant-supplied stable alert payload or reserved placement. This did not establish that a real price-drop webhook reaches the widget.                                                                                                                                         |
| Discount nudge           | **Positive flow blocked; missing-reward guard passed** | A diagnostic `cart_abandoned` request returned `discount_nudge`; the frontend rejected it with `configured_reward_required`. Shopify reported **zero active discounts**; the embed supplied no verified reward configuration or reserved slot. This was an empty-cart guard test, not a populated-cart progress, reward application or redemption test.                                                                                 |
| Social proof             | **Positive flow blocked; absence appropriate**         | Real desktop startup and mobile `social_proof` requests returned no intervention. Shopify reported **one order in total** and **zero paid non-test orders**, so a product cannot meet the current minimum of five verified orders. There was also no supplied proof count/window or reserved slot. No count was invented or rounded up.                                                                                                 |
| Storefront post-purchase | **Positive flow blocked**                              | `/thank_you` returned **404**; it is not a completed-order page. A diagnostic `post_purchase_window` request returned HTTP 200 and a real product, but no storefront widget appeared and there was no explicit post-purchase slot. Source requires that slot, which the shipped placement block does not offer as a selectable type. A real order-status visit and acceptance were not certified. The checkout extension was unchanged. |

The diagnostic triggers above were sent through the public SDK to the real server. They test the response/eligibility boundary; they are not evidence of a real campaign, webhook, abandoned shopper cart or completed order.

## Configuration and delivery gaps

The live embed's configuration contained the normal shop/currency/locale/proxy settings, plus the isolated QA flag. It supplied **neither `agentFacts` nor `campaign`**. Both inspected product viewports had **zero `[data-aovboost-slot]` elements**. The current embed source likewise has no producer for these fact objects. This is an integration gap, not something resolved merely by checking a widget toggle.

The required inputs are defined in `storefront-sdk/src/agent/OfferFacts.ts`: a real campaign end time, a configured reward, product-specific alerts with stable IDs, and verified proof counts with completed time windows. The reserved placements must also be added through the app's own blocks/integration. No theme file was edited in this verification.

The bundle's first broken boundary is the server policy, before frontend mounting. `enforcePairingDecisionPolicy` in `app/models/pairingRecommendations.server.ts` produces the observed rejection when any bundle item is denied. Applying complement/near-duplicate checks to the bundle's current PDP item is a likely cause requiring a focused repair; that diagnosis is an inference from the code and response, not a newly deployed fix.

## Coverage and limits

- Desktop used a 1440-pixel viewport. The mobile PDP used Pixel 7 emulation at 412 CSS pixels and confirmed the same absent facts/slots and no social-proof intervention.
- One mobile navigation exceeded its 45-second navigation deadline. The page subsequently became usable, loaded the published core and returned the sampled offer responses. This is not a clean mobile performance sign-off.
- The captured widget checks recorded no uncaught page errors. Console silence, CLS, every keyboard control and all mobile positive flows were not re-certified in this run.
- The combined recorder captured 48 app-proxy requests, all HTTP 200, and transmitted `suppressed` events for alert, reward, countdown and post-purchase providers. HTTP success did not establish that those surfaces rendered. It captured zero cart mutation POSTs.
- No cart acceptance could be reached through the failed/blocked widgets. Every sampled cart remained empty. No order, payment, discount or fabricated proof data was created.
- The optional core flag was enabled only before initialization in isolated QA pages. This was not a store-wide rollout. Default-off behavior and the previously verified cart/strip/exit flows retain their earlier verification status.
- No local fixture suite was represented as live evidence, and no backend/widget source was changed during this run.

## Cleanup and evidence

The temporary bundle `QA live widget verification 20261115` (`cmwhyxx230011ju08c90z0soj`) was deleted, and Admin returned to its empty bundle list. Settings were restored, the Admin page was reloaded, and **all 13 saved checkbox values matched the originals**. Focused-cart mode is back on; the temporarily enabled bundles, progress nudges and post-purchase option are off. Billing QA and Shopify subscription/payment settings were unchanged.

A fresh ordinary storefront page refreshed its signed settings and confirmed **core off**, focused-cart mode on, zero visible widgets and zero cart items. It loaded only the published initial SDK, with no optional core asset. The isolated shopper browser was closed, the local observation router was restored, and the owner's existing signed-in Admin tab was left open.

Redacted JSON and screenshots are Git-ignored under `test-results/live-shopify/remaining-2026-11-15/`, including:

- `configured-bundle-fresh-offer.json` — actual bundle rejection.
- `countdown-past-deadline.json`, `countdown-future-trigger-no-campaign.json` — deadline and campaign guards.
- `inline-missing-supplied-fact.json`, `nudge-no-real-reward.json` — actual API responses and frontend suppression.
- `mobile-social-proof-no-history.json` — mobile SDK/core and no-proof result.
- `post-purchase-no-order-route.json`, `post-purchase-diagnostic-no-order.json` — 404 diagnostic and non-rendering offer response.
- `all-live-evidence.json`, `admin-original.json`, `admin-restored.json` — combined sanitized observations and restoration comparison.
- `shopify-prerequisites.json`, `restored-storefront.json` — read-only Shopify count/discount results and final ordinary shopper settings.

The next work is to repair bundle eligibility, connect authoritative campaign/reward/alert/proof configuration to the shipped embed and reserved placements, and choose a supported post-purchase delivery surface. Each positive flow needs another live test after those boundaries are implemented; passing suppression checks alone does not establish that shoppers can use these widgets.
