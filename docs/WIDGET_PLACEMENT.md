# Storefront widget placement

The storefront SDK uses page context and safe theme boundaries before mounting an offer. If it cannot identify an appropriate location, it skips the offer without inserting anything at the top of the page or into the body.

| Widget | Automatic location |
| --- | --- |
| Bundle | Matching product page, after the complete primary purchase block and express checkout |
| Product recommendations | After the collection results/pagination or main product section; skipped when native theme recommendations already exist |
| Cart recommendations | Inline after cart items on the cart page |
| Cart goal | Inline before the cart summary |
| Product notice/social proof | After the primary purchase block; social proof must include the current product |
| Campaign countdown | Explicit merchant slot, with a future campaign end time |
| Chat | A single assistant dock on shopping pages |
| Toast/exit intent | Desktop only, with no assistant, competing overlay, open cart/modal or visible consent banner; two-minute cooldown |

Headers, footers, navigation, product cards, quick-add panels, sticky purchase bars, hidden content and ambiguous purchase forms are excluded. Inline widgets never split a form or introduce a new column into an unknown flex/grid row. Checkout, account, search and other non-shopping pages do not receive automatic widgets.

Only one merchandising block and one contextual notice are active per page. A visible offer remains stable across repeated decisions to preserve selections. Navigation removes page-specific offers; responses requested on an earlier page are discarded. Merchant settings and shopper dismissals remain authoritative.

## Deliberate placement in the theme editor

With the AOVBoost app embed enabled, add the **AOVBoost offer placement** app block to a section that supports app blocks, and select its offer type. Place it below purchase information, after a collection, or within the cart content as appropriate. Homepage recommendations and campaign countdowns require this explicit placement.

For custom themes, an empty element such as `<div data-aovboost-slot="bundle"></div>` serves the same purpose. Supported values are shown in the app block's selector. Slots must be inside the main content and outside forms, cards, hidden panels, navigation and other excluded regions. Slots choose a location; they do not override page eligibility, product relevance or widget settings, or force an offer to be generated.

Inline widgets inherit fonts and sample nearby colours and purchase button styles. Full-section placements reuse the theme's `page-width` gutters where available. Styles remain isolated in shadow DOM. Cart recommendations and goal notices render in normal flow, without a backdrop or fixed bar.

`window.AOVBoostSDK.diagnose()` includes the last placement outcome and its reason, including skipped offers. Regression tests cover representative Shopify markup; a connected storefront browser is still needed to verify a particular live theme visually.
