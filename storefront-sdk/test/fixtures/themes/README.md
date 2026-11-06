# Theme regression fixtures

Dawn fixtures reduce the official Shopify/Dawn cart drawer and notification
structures retrieved 6 November 2026 (settings_schema reports Dawn 16.1.1):
https://github.com/Shopify/dawn/blob/main/snippets/cart-drawer.liquid
https://github.com/Shopify/dawn/blob/main/snippets/cart-notification.liquid
The active state is added by Dawn's JavaScript; tests supply geometry explicitly.

Custom drawer, product, redirect-product and redirect/cart-page files are synthetic structural
regressions. They do not certify another named theme. No merchant-rendered HTML
was supplied. Add sanitized rendered product/cart/open-drawer captures from the
actual pilot themes and run the live four-theme acceptance matrix before rollout.
Remove customer data, tokens and unrelated scripts from captured fixtures.

The revised Phase 4 cartFlow tests run EventBus, TriggerRouter, OfferPoller,
WidgetManager, real adapters and display verification together against these
structures. Network responses, geometry and document navigation are simulated;
these tests do not replace a live browser/theme test.
