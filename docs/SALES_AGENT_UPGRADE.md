# Sales-agent widget upgrade

Implemented locally on 2026-09-06. This extends the existing AOVBoost app and theme widget; it does not replace the storefront design or deploy to the live store.

## What changed

- Shopper memory now separates budget amounts from size numbers, replaces corrected color/size choices and supports clearing an unlimited budget.
- Session updates preserve proactive limits and pending cart choices, reconcile empty cart snapshots, count product revisits and recognize checkout clicks. Session writes and proactive reservations use shop/session-scoped PostgreSQL advisory transaction locks.
- The chat route validates structured model responses and runs at most one round of up to four allowlisted read tools. Safe, message-grounded profile updates are applied. Arbitrary tools, code, URLs, GraphQL and model-generated discounts cannot execute.
- Product search, product/variant lookup, cached inventory, comparisons, related products, policies and non-discounted bundle suggestions are connected as bounded read capabilities. Context is bounded; tools do not receive unrestricted Shopify access.
- Recommendations enforce merchant exclusions, rejected products, available variants, selected-variant budget constraints and recommendation counts. Multiple colors/sizes are alternatives within the same option, not mutually mandatory values. Unmatched searches return no ranked result. Currency mismatch is handled conservatively rather than pretending to convert catalog prices.
- Ranking can use a small, smoothed historical recommendation-purchase signal, cached for ten minutes. Customer fit retains much greater weight. This is deterministic ranking, not autonomous model retraining.
- CART/CLOSING uses a separate, single-upsell result, so regular recommendations cannot crowd it out. Upsells respect exclusions, prior rejection and remaining budget against available variant prices.
- Explicit adds use shared server validation and shopper-requested quantities from 1 to 10. Pending product/options/quantity survive a missing-option question for ten minutes. Cancellation clears the pending choice.
- Explicit, unambiguous remove/update requests resolve to a verified cart line. The browser rereads the cart and checks the expected line/variant/quantity before applying the change, detecting stale multi-tab context. No automatic mutation retry occurs after an uncertain response.
- Cart confirmation happens after Shopify success and includes quantity/variant where available. Locale-aware Ajax requests use bundled theme sections for common cart containers, with a custom update event for other adapters. Section failure does not convert a successful cart write into a retry. This follows Shopify's [Cart API](https://shopify.dev/docs/api/ajax/reference/cart#bundled-section-rendering).
- Conversation persistence retains product cards and checkout CTAs, not just text.
- Required tracking consent fails closed while unavailable/denied, handles document/window consent events and is rechecked during event collection/flush. Core event ingestion, chat analytics/outcomes and order analytics honor analytics disablement. Chat carries a consent opt-out while retaining functional conversation memory.
- Event queues/batches are bounded; JSON quantity zero remains a removal. Browser events cannot attest to purchases or revenue. Provider/context/database failures produce a controlled chat error without intentionally changing the ordinary Shopify cart.
- Purchase attribution returns persisted totals on webhook redelivery, selects one eligible outcome per purchased variant, requires material interaction and chat engagement, and serializes order/session updates. Widget-added lines carry anonymous session correlation alongside existing offer tags. Linked non-assisted sessions can be marked purchased without inventing AI revenue.
- Local `shopify.app.toml` now includes the documented `write_app_proxy` scope. This prepares a configuration correction; no deployment, reauthorization or permission grant was performed.

## Architecture and files

The existing theme embed -> TypeScript SDK -> signed app proxy -> React Router chat/events/offers -> Prisma/Redis/catalog/AI pipeline remains intact.

New modules:

- `app/sales/agentOrchestrator.server.ts`: structured response validation, grounded memory application, bounded read-tool dispatch and quantity/state helpers.
- `app/sales/cartIntent.ts`: pending conversational add/options/quantity.
- `app/sales/cartLineIntent.ts`: explicit cart line removal/quantity requests.
- `app/sales/recommendationEligibility.ts`: shared merchant and variant eligibility rules.
- `app/sales/proactiveEngine.server.ts`: transactional prompt reservation.
- `app/models/commerceTransaction.server.ts`: transaction-scoped PostgreSQL locking.
- `storefront-sdk/src/consent.ts`: independently testable consent gate.
- `storefront-sdk/src/shopifyCart.ts`: locale-aware Ajax mutations and theme-section refresh.

Extended modules:

- `app/routes/api.chat.tsx`, `api.offer.tsx`, `api.webhooks.tsx`.
- `app/models/session.server.ts`, `event.server.ts`, `recommendationOutcome.server.ts`, `attribution.server.ts`, `chatResponse.ts`, `chatPrompt.server.ts`.
- `app/sales/shopperProfile.ts`, `recommendationEngine.ts`, `upsellEngine.ts`, `commerceTools.server.ts`, `proactiveEngine.ts`.
- `storefront-sdk/src/index.ts`, `eventBus.ts`, `triggerRouter.ts`, `widgets/BaseWidget.ts`, `widgets/ChatWidget.ts`.
- `shopify.app.toml` and the regenerated `extensions/aovboost-storefront/assets/aovboost-sdk.js`.

The dedicated system prompt remains `app/models/chatPrompt.server.ts`. Existing merchant settings and existing API routes are reused; no new public endpoint is required.

## Database and settings

No new schema migration was introduced. This upgrade uses the existing `ShopperSession`, `RecommendationOutcome`, `ShopperEvent`, `ChatMessage`, settings and offer tables, including their existing indexes. It assumes the previously added sales-agent migration is applied:

`prisma/migrations/20260903100000_ai_sales_agent/migration.sql`

Applied production migration state was not checked. Advisory locks require the project's existing PostgreSQL database and run within short transactions, never around an AI request.

No new merchant settings were added. Existing enablement, analytics, consent, proactive limits, exclusions, recommendation limits, upsell intent/budget and bundle controls are reused. Discount execution remains unsupported in conversation; the agent must not claim it applied a code.

## Verification

Local checks used:

- Final regression suite: **131 tests passed in 30 files** (16 more tests than the audited baseline).
- TypeScript and ESLint: passed.
- Production build: passed; SDK regenerated. No migration or deployment was run.

```powershell
npm test
npm run typecheck
npm run lint
npm run build
```

Regression coverage was added/extended in:

- `app/sales/salesAgent.test.ts`: profile correction, budget/size separation, no-match/rejection/exclusion filters, selected-variant prices, currency mismatch, structured output, grounded profile updates, bounded tools, invalid quantities, pending variant resolution, cancellation/expiry and explicit line mutations.
- `app/models/sessionSales.test.ts`: proactive state retention, revisit counts, zero/empty cart snapshots and checkout clicks.
- `app/models/recommendationOutcome.server.test.ts`: duplicate delivery stability, single-outcome grouping and linked unassisted purchases. Database calls are mocked; a real PostgreSQL concurrency test is still a release check.
- `storefront-sdk/src/consent.test.ts`: denial does not resume tracking; required consent fails closed and revocation is recognized.
- `storefront-sdk/src/eventBus.test.ts`: successful zero-quantity cart removal.
- `storefront-sdk/src/widgets/ChatWidget.test.ts`: retained cards across widget recreation, plus existing streaming/accessibility/variant-add coverage. Tests now isolate sessionStorage.
- `storefront-sdk/src/shopifyCart.test.ts`: locale-aware URLs, returned theme section updates, null-section success and failed cart responses.

The built storefront asset is approximately 116.24 KB uncompressed / 30.88 KB gzip (prior audited asset: 113.57 KB uncompressed). These are build sizes, not measured Core Web Vitals. Production build emits existing React Router future-flag warnings.

The earlier audit probes under `tmp/shopify-qa-20260906/` are historical diagnostic artifacts, not the maintained regression suite; their original source-loader stubs do not represent the new transaction/consent modules. Use `npm test` for current verification.

## Deployment and remaining limitations

**No live-store deployment, real checkout, order placement or database migration was performed.** The earlier authenticated storefront test found HTTP 404 from the configured app proxy. Updating local scope configuration alone does not prove that the installed store's proxy path/granted scopes are repaired. Shopify documents the scope requirement and installed-path behavior in [App proxies](https://shopify.dev/docs/apps/build/online-store/app-proxies).

Before deploying, review pending migrations against the intended database:

```powershell
npx prisma migrate status
```

Only with the correct database environment and deployment approval, apply existing pending migrations and deploy using the project's established backend workflow:

```powershell
npx prisma migrate deploy
npm run build
npm run deploy
```

`npm run deploy` publishes Shopify app configuration/extensions; it does not by itself deploy the Vercel backend. Deploy the backend through its configured Vercel workflow as well. Complete Shopify reauthorization if the changed app-proxy scope requires it, and verify the installed app proxy path. Do not use database reset commands.

Important remaining limits:

- Live storefront/UI/mobile/cart-drawer behavior is not verified: no browser surface was available during the investigation. Bundled section support is best effort for common theme IDs; arbitrary themes can use `aovboost:cart-updated` to integrate their own renderer.
- Inventory remains a catalog snapshot; Shopify is authoritative at mutation time. The agent does not have a live per-turn inventory query or market-aware currency conversion. Catalog recommendations are withheld when active storefront and store catalog currencies differ.
- No new comparison-card component, review-provider integration, selling-plan-aware conversation, automatic discounted bundle execution or conversational discount application was added. Existing bundle discount/Post-purchase extensions are preserved.
- Complete attribution for chat-advised products later purchased exclusively through ordinary theme controls still needs robust cart/session/order correlation. Non-AI session conversion denominators remain incomplete for unlinked purchases; do not claim causal incremental revenue from these metrics.
- Read-tool dispatch and deterministic cart transactions are bounded capabilities, not unrestricted autonomous purchasing. No checkout/payment action is automated.
- Full browser journeys, real PostgreSQL concurrency/failure tests, privacy-export/redaction workflow review and measured Core Web Vitals remain release tasks. This is a substantial hardening increment, not certification that every item in the original 38-section specification is finished.

## Manual acceptance checklist

1. Confirm session/config/chat/offer paths through the actual store proxy, not only direct backend health URLs; verify the embed and deployed asset version.
2. Browse -> contextual prompt -> state need/budget/color/size -> receive a small eligible recommendation set -> correct a preference and verify the old value no longer constrains results.
3. Ask to add two units, answer a missing option, verify exact variant/quantity in the Shopify cart; cancel a pending request and confirm it cannot execute later.
4. Remove/change one named cart line; change the cart in another tab before execution and confirm stale actions fail safely. Check native cart totals/drawer on the actual theme.
5. Trigger hesitation and dismiss proactive help; navigate/reload/repeat requests, checking count/cooldown/dismissal behavior. Test required consent denial/revocation and analytics-disabled settings.
6. Reject an upsell, request an excluded/unavailable/over-budget/unmatched product, and confirm the agent does not repeat or substitute an invalid recommendation.
7. Ask factual shipping/returns/comparison questions; verify tool-backed answers and absence of invented discounts, live stock counts or urgency.
8. Use approved test checkout only; verify order attribution and duplicate webhook stability. Test an unassisted linked purchase and document unlinked baseline limitations.
9. Simulate provider timeout, invalid JSON, database failure and a Shopify 422 response in a test environment; verify ordinary browsing/cart remains usable and no unconfirmed success is claimed.
