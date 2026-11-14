# AOVBoost widgets: behavior and verification status

Verification snapshot: **12 November 2026**.

The app implements **11 widget types**, but all 11 have not been verified end to
end on the live store. In the last tested configuration, **focused mode allowed
only the cart-upsell widget to display**. The other ten were intentionally
suppressed; being disabled does not establish that a widget is broken.

The explanations below describe the existing implementation. “Not verified live”
means that the complete shopper journey has not been demonstrated on the live
store; automated tests alone do not establish that result.

| Widget | How it works | What we have verified |
| --- | --- | --- |
| **1. Chat assistant** | A floating conversation window answers store and product questions, recommends products and supports cart actions. It needs chat enabled and functioning AI access. | Automated tests passed; live conversations remain unverified. The last observed billing and Redis issues affect AI access. |
| **2. Toast notification** | A small, temporary desktop message nudges shoppers toward help, for example after price hesitation. Its button opens the assistant, and it disappears after about nine seconds. | Implemented; not verified live. Its action depends on the assistant being available. |
| **3. Countdown banner** | Displays a campaign message and counts down to a supplied end time. It requires a designated placement and a genuine future expiry, then disappears when time runs out. | Implemented; no live campaign verified. |
| **4. Inline alert** | Places a small product notice near the purchase area, such as a supplied price-change or inventory update. Shoppers can dismiss it. | Implemented; live triggering and accuracy of the underlying updates remain unverified. |
| **5. Bundle offer** | Shows related products together, lets shoppers choose variants and adds the selected items in one action. Configured bundle discounts can provide savings. | Automated tests passed; live bundle addition and checkout discount application remain unverified. |
| **6. Cart-upsell drawer** | After a confirmed product addition, recommends complementary products beside the cart or in a floating card. Shoppers select a variant and add it without triggering another recommendation loop. | **Live display, acceptance and tracking passed.** The cart-refresh correction passed local browser tests; its release and subsequent live verification have not been confirmed in this snapshot. |
| **7. Discount nudge** | Shows progress toward a cart spending target, for example “KSh 500 to go.” It updates the progress display and can direct shoppers toward more products. **The bar itself does not create or apply a discount.** | Implemented; live progress updates and any associated reward remain unverified. |
| **8. Recommendation strip** | Displays a horizontal row of suggested products with prices, variant choices and add-to-cart buttons. It uses suitable product or collection placements and avoids duplicating existing theme recommendations. | Implemented; not verified live. |
| **9. Social proof** | Displays messages based on supplied order counts, such as how many verified orders included a product. It hides itself when there are no qualifying counts. | Implemented; live data accuracy and display remain unverified. |
| **10. Exit-intent offer** | Shows a desktop message when a shopper appears to leave, at most once per session. Its action leads to the cart or assistant; it may display a supplied discount code. | Implemented; the actual exit-triggered offer remains unverified live. |
| **11. Post-purchase offer** | Intended to recommend an additional product after checkout. The repository has a separate Shopify checkout extension for changing the order. **The storefront widget currently adds to the cart, rather than modifying the completed order.** | No completed-order acceptance or attribution has been verified. This distinction needs attention before calling it fully working. |

## What the passing tests establish

The latest correction passed **781 tests in 100 files**, type checks, lint and
the production build. The **18 passing desktop/mobile browser tests primarily
validate the cart journey and its safeguards**, including the cart-refresh
correction, acceptance without recursion, restored-cart silence, dismissal,
holdout behavior, unavailable products and offer outages.

Those tests do not establish that all 11 widgets are operational on the live
store. A complete live pass requires enabling the relevant feature, configuring
its real data and placement, triggering it through a normal shopper action, and
checking both its visible result and saved events. Bundle discounts and
post-purchase order changes also require verification at checkout or order level.

## Supporting evidence and implementation

- [Live-store verification](live-store-verification-2026-11-12.md)
- [Correction report and remaining account dependencies](remaining-issues-remediation-2026-11-12.md)
- [Widget registry and feature gates](../storefront-sdk/src/widgets/widgetManager.ts)
- [Widget implementations](../storefront-sdk/src/widgets/)
- [Placement rules](../storefront-sdk/src/widgets/placement.ts)
- [Shopper trigger routing](../storefront-sdk/src/triggerRouter.ts)
- [Separate post-purchase checkout extension](../extensions/post-purchase-upsell/src/index.jsx)
