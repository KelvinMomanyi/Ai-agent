# Chat widget sales-agent architecture audit

Date: 2026-09-06. Scope: compare the existing implementation against the supplied 38-section specification, inspect the real integration paths, and verify safely. This was an audit, not authorization to implement the pasted specification or deploy changes.

## Verdict

**Partially implemented, with a substantial existing foundation. Not complete or verified end to end.** All eleven requested logical areas have corresponding code, but some are only helpers/contracts, some are incompletely connected, and several integration defects undermine the intended behavior. Reuse this implementation; a rewrite is unnecessary.

The immediate live blocker is separate from the architecture gaps: after successfully unlocking `teretret.myshopify.com`, the storefront's `/apps/aovboost/session`, `/chat`, `/offer`, and `/config` paths returned HTTP 404. Consequently the live widget cannot complete its normal session/chat flow. Direct backend health responses do not establish working AI conversations.

Evidence levels throughout this report:

- **Live:** authenticated HTTP, MCP catalog, downloaded theme, and isolated Shopify Ajax cart checks.
- **Source:** local repository implementation and call-site inspection; deployed backend equivalence and migration state were not established.
- **Probe:** actual TypeScript functions executed locally, with database access stubbed and no network requests.
- **Unverified:** visual/mobile behavior, theme-native cart rendering, actual checkout/order conversion, deployed migrations, real conversational AI responses.

## 1. Architecture found

| Area | Existing implementation |
| --- | --- |
| Storefront embed | `extensions/aovboost-storefront/blocks/aovboost.liquid`; body-target theme embed initializes `window.AOVBoost` and loads the SDK with `defer`. |
| Widget and state | `storefront-sdk/src/index.ts`, `sessionManager.ts`, `widgets/widgetManager.ts`, `widgets/ChatWidget.ts`, `widgets/BaseWidget.ts`. Vanilla TypeScript and Shadow DOM; local widget state and sessionStorage, not a new React storefront. |
| Behavior and proactive routing | `storefront-sdk/src/eventBus.ts`, `triggerRouter.ts`, `offerPoller.ts`, `liveUpdates.ts`; server `/api/events` and `/api/offer`. |
| Chat entry point | `app/routes/api.chat.tsx`; signed session/authentication, rate limit, session/profile update, context retrieval, ranking, prompt, provider call, response validation, SSE/UI actions, persistence. The route remains roughly 950 lines. |
| AI provider abstraction | `app/ai/client.server.ts`: configured Gemini/Mistral/Groq/Deepseek providers, timeout/fallback behavior and JSON parsing. |
| Store/catalog data | `app/models/catalogCache.server.ts`, `product.server.ts`, `productCatalogMapping.ts`, `storeKnowledge.server.ts`; existing Shopify Admin integration, cached structured products/variants, published policies and merchant knowledge. |
| Cart | Shopify Ajax cart in the storefront; live cart snapshot sent with chat. Server validates the supported AI add action, with an alternate deterministic path described below. |
| Persistence | Prisma/PostgreSQL in `prisma/schema.prisma`; existing shoppers, events, messages, offers, products, affinities, bundles and settings. Redis cache/live-event infrastructure is reused. |
| Analytics and webhooks | `recommendationOutcome.server.ts`, `salesAnalytics.server.ts`, existing attribution/analytics models, `api.webhooks.tsx`, and merchant analytics UI. |
| Merchant app | Existing React Router/Polaris settings UI at `app/routes/app.settings.tsx`; Shopify app authentication. No subscription/billing workflow identified in the inspected app routes/configuration. |
| Other commerce extensions | Existing bundle discount Shopify Function and post-purchase upsell extension; neither proves conversational bundle/tool integration. |

Actual chat path:

```text
Theme embed -> SDK/session -> /apps/aovboost/chat -> /api/chat
  -> authenticate / limit -> update shopper session and regex profile
  -> retrieve cached catalog, policies, conversation, behavior and live cart
  -> rank recommendations and upsells -> build sales context and prompt
  -> deterministic cart shortcut OR AI JSON response
  -> legacy response/product validation -> SSE text/cards/add action
  -> storefront Ajax cart -> event and recommendation persistence
```

The advertised `toolCalls` contract does not have a corresponding execution loop in this path.

## 2. Requested modules A-K

| Module | Implementation and integration status |
| --- | --- |
| A. Shopper Behavior Engine | Event bus and trigger router are connected. Cart-removal parsing, revisit counting and checkout signal propagation need correction. |
| B. Shopper Profile / Session Memory | Server-persisted anonymous session and separate profile JSON are connected. Regex extraction and correction semantics are unreliable; some context is lost during updates. |
| C. Sales State Machine | Explicit deterministic states are implemented and injected into prompts. Server-side action restrictions are incomplete. |
| D. AI Sales Orchestrator | Chat route integrates context/ranking/prompt, but does not consume structured profile updates or execute the advertised tool-call contract. |
| E. Commerce Tool Layer | Allowlisted helpers exist; chat uses only `validateAddToCart`. Other tool helpers are not a working conversational execution layer. |
| F. Recommendation Engine | Real retrieval/filter/rank module is called. Later candidate selection and validation can bypass its constraints. |
| G. Upsell Engine | Dedicated one-result affinity-based ranker is called. Candidate concatenation can drop the upsell; other offer surfaces use the older decision engine. |
| H. Objection Handling | Deterministic classifier, stored objection, prompt guidance and price-sensitive path exist. Verified tool-driven resolution is partial. |
| I. Hesitation Detection | Weighted hesitation score and proactive rules are integrated. Server cooldown/count state is lost on subsequent session updates. |
| J. Analytics / Attribution | Schema, event processing, order webhook and dashboard formulas exist. Attribution/idempotency/cohort gaps prevent trustworthy completeness claims. |
| K. Merchant Configuration | Settings are stored and exposed in the UI. Some controls, notably analytics enablement and recommendation limits, are not consistently enforced. |

## 3. Highest-priority findings

### P0: live storefront app proxy is unavailable

Authenticated requests to all four tested app-proxy paths returned 404; the theme embed is enabled and the SDK loads. Local and CLI-downloaded app configuration omit `write_app_proxy`. Shopify's [app proxy documentation](https://shopify.dev/docs/apps/build/online-store/app-proxies) requires that scope and notes that installed shops can customize proxy paths independently of defaults. The scope omission is a confirmed configuration gap and plausible contributor, **not a proven sole cause**. Installed proxy path and granted scope state still need inspection.

See [the live QA report](REPORT.md) for exact requests, results and limits. No configuration repair or deployment was performed.

### P1: structured AI orchestration is incomplete

`app/models/chatPrompt.server.ts:74` advertises `profileUpdates`, `toolCalls`, `recommendations`, objection and proactive fields. `app/sales/types.ts` defines the contract. However, the chat route parses the narrower `GroundedAiChatResponse` and consumes legacy `message/productIds/action/followUpQuestion` fields. Repository call-site inspection finds no `toolCalls` execution loop or model `profileUpdates` application.

`app/routes/api.chat.tsx:421` constructs the commerce layer; its only route invocation is `validateAddToCart` at line 626. Product/variant/inventory/comparison/policy/bundle helpers are not callable through the advertised conversational tool flow. Ignoring an AI-proposed sales state is appropriate for deterministic control; the defect is advertising capabilities and updates that are never executed.

### P1: shopper memory can corrupt the intent being remembered

Actual-source probes of `app/sales/shopperProfile.ts` reproduced:

- `My budget is under 100.` also stores preferred size `100`.
- `I need size 43 with a budget under 5000.` stores budget maximum `43`, not `5000`.
- Changing from black to `Actually blue instead of black.` retains both black and blue.

The size expression accepts bare numbers; budget extraction takes the first numbers anywhere in the message. Array-union merging has no correction/removal semantics. The recommendation filter then requires every stored color/size on one variant, so these errors can eliminate valid matches. Brand extraction is not implemented beyond storage/normalization.

### P1: proactive limits do not survive normal session updates

`api.offer.tsx:277` stores `proactivePromptCount` and `lastProactivePromptAt` in session context. `app/models/session.server.ts:459` reconstructs that context without preserving those fields. A probe starting at the two-prompt limit, followed by one `page_view`, lost the count and allowed another proactive message.

Additionally, `api.offer.tsx:120` returns cached offers before the current dismissal/state/proactive checks. Client-side session dismissal protection exists and mitigates repeat display in the same tab; this is not proof that dismissed shoppers were interrupted live. Server guarantees and cross-request consistency are nevertheless broken.

### P1: recommendation constraints are not enforced at the final boundary

`api.chat.tsx:327` calls the constrained ranker, but line 353 expands the AI catalog slice to 12 products from bundles/history/views/search. The expansion and response validation do not reapply all budget, excluded-collection, rejection and recommendation-count constraints. `chatResponse.ts:553` and line 572 cap at four, independent of the merchant's lower configured maximum.

The ranker uses base product price rather than selected variant price for budget eligibility; budget currency is not reconciled. Intended use is a score, not a hard fit requirement. Probes found an unrelated product returned for an unmatched query and a strongly scoring rejected product still returned. Normal recommendation rejection is a penalty, whereas upsell rejection is a hard exclusion. This conflicts with the prompt's no-repeat guarantee.

`recommendedVariantId` produced by ranking is not forwarded into normal cards; only a resolved cart action supplies selected-variant overrides. Therefore the profile-matched variant is not guaranteed to be preselected.

### P1: cart actions are only partly implemented and events can misreport removal

The deterministic add shortcut at `api.chat.tsx:495` resolves product/variant, emits a cart action with `quantity: 1` at line 510, and bypasses the commerce validation helper used by the AI branch. It is not a complete implementation of requests such as adding two items or a maintained multi-turn missing-option transaction. The product helper does check negative/explicit intent and cached availability; it is not unrestricted Admin access.

Conversational remove/update/discount/selling-plan execution was not found. `validateRemoveFromCart` and `validateUpdateCartLine` are validators, not connected mutation implementations.

`storefront-sdk/src/eventBus.ts:581` parses JSON quantity with `||`, turning quantity `0` into `1`. The actual-source probe reproduced this. The intercepted cart change can therefore be classified as `quantity_changed` instead of `remove_from_cart`; trigger routing does not reconcile every quantity-change event. Immediate native theme cart-drawer/counter updates remain visually unverified.

### P1: order attribution is not idempotent and does not cover the specified cohorts

`recommendationOutcome.server.ts:153` updates only outcomes where `purchasedAt` is null. On a repeated delivery it returns zero newly attributed revenue. `api.webhooks.tsx:130` then overwrites the existing conversion event with that zero and `aiAssisted: false`. A source-function probe with a stubbed database demonstrated first delivery `{outcomeCount:1, attributedRevenue:50}` and repeat `{outcomeCount:0, attributedRevenue:0}`. The overwrite is established by the webhook caller; this was not tested against production orders.

Attribution gets eligible session IDs only from known offer IDs carried on order lines. A shopper who gets meaningful chat advice and then buys through ordinary theme controls can be missed. Outcome matching is product-level, not variant-level, and can credit multiple recommendation records for the same purchased line. Session purchase completion is updated only when eligible outcomes are found, leaving the non-engaged session conversion baseline incomplete. Simply having dashboard formulas does not make the underlying metrics reliable.

### P1: consent and merchant analytics controls need runtime enforcement

The earlier deployed-SDK consent probe found that `storefront-sdk/src/index.ts:154` resumes when the consent-change event reports analytics denied, because the handler checks with `trackingConsentRequired: false`. The live SDK hash exactly matches this local build. The tested store currently sets consent-required false, so actual denied-consent tracking was not observed live.

`analyticsEnabled` is persisted, configured and exposed in types/public settings, but call-site inspection finds no runtime gate in event collection, ingestion or chat/outcome analytics. The server chat route also lacks an agent-enabled rejection even though UI/proactive controls use that flag.

`ShopperSession.customerId` can be stored, but customer data request/redaction webhooks at `api.webhooks.tsx:165` return OK with an obsolete comment claiming no customer IDs are stored. The data-handling implementation should be brought into agreement with what is actually persisted.

### P2: upsell, salesperson messaging and feedback need completion

At `api.chat.tsx:348`, normal recommendations are concatenated before upsells and then sliced to the recommendation limit. With three normal results and a limit of three, the upsell disappears. The upsell ranker has no excluded-collection or hard remaining-budget filter.

The sales prompt asks for a confident best-fit explanation, but `chatResponse.ts:541` replaces product-bearing model text with `buildGroundedProductLead`. This improves factual control but commonly produces generic canonical product text; comparisons are mostly prices/options, not need-specific structured differences. The prompt also contains conflicting instructions to show two to four examples on broad discovery and to prefer one product under the merchant maximum.

Recommendation outcomes are stored and same-session rejections are consulted. Aggregate accepted/rejected/purchased recommendation performance is not fed back into ranking. The `historicalConversion` score is derived from product order count, not outcome conversion data. Existing order affinities provide useful historical sales signals, but this is only a partial implementation of learning from recommendation outcomes.

## 4. Coverage against the numbered specification

| Sections | Status | Evidence / remaining work |
| --- | --- | --- |
| 1-2: audit, separated architecture | Substantial | Existing modules mapped above. Orchestration and enforcement still concentrated in the chat route. |
| 3: shopper session | Partial | Most requested fields exist directly or in context JSON; anonymous identity and server persistence exist. Context loss, stale cart state and incomplete order linkage remain. |
| 4: sales states | Partial | All nine core states plus HESITATING/OBJECTION/ABANDONED exist. Prompt guidance is stronger than executable action restrictions. |
| 5: behavior events | Partial | Broad page/product/search/variant/cart/scroll/idle/chat/recommendation/upsell tracking exists. Revisit counts, zero-quantity removal and checkout propagation have gaps. |
| 6: contextual welcome | Partial | Deterministic product/collection/comparison/hesitation/returning messages exist. Cooldown persistence and cache eligibility are faulty. |
| 7: discovery | Partial | Single-question prompt plus regex extraction. Budget/size/corrections are unreliable; structured model updates are ignored. |
| 8: purchase intent | Implemented, integration gaps | Configurable weighted server module, diminishing returns, negative/hesitation signals and 0-100 score. Browser trigger formulas duplicate some logic. |
| 9: product/commerce tools | Partial | Allowlisted helper layer and actual catalog/policy/cart data exist; most conversational tools are not executed. Inventory checks use a cached snapshot. |
| 10: recommendations | Partial | Retrieve/filter/rank and primary/value/premium selection exist; final AI selection can bypass constraints and no-match/rejection handling is weak. |
| 11: recommendation format | Partial | Images, prices, compare-at price, variants, availability, reasons and CTAs exist. Best-fit narrative and ranked variant are not consistently retained. |
| 12: AI add-to-cart | Partial | Explicit add path, variant options and Ajax success/error UI exist. Quantity-one shortcut and missing multi-turn cart transaction/tool integration remain. |
| 13: upsells | Partial | Dedicated single-result affinity ranker with intent/objection/rejection rules. Route can discard its result; budget/collection controls incomplete. |
| 14: bundles | Partial | Existing bundles/Shopify discount Function reused; suggestion helper exists but is not connected as a conversational tool. No demonstrated full bundle journey. |
| 15: objections | Substantial | Requested objection categories, stored state, strategy guidance and price-sensitive fallback exist. Fact-gathering tools/fit responses need integration tests. |
| 16: hesitation | Partial | Rule/score thresholds and contextual help exist. Broken event/cooldown persistence compromises behavior. |
| 17: closing | Partial | CART/CLOSING guidance and checkout link exist. Suppression of discovery/upsell/product output relies partly on the prompt. |
| 18: system prompt | Implemented, conflicting rules | Dedicated server prompt is called. Truthfulness, consent, restraint and fit rules present; broad-discovery/product-count instructions conflict. |
| 19: structured output | Partial | JSON and narrow legacy response validation exist. Full requested structured contract is not validated/applied. |
| 20: security | Partial | Signed proxy/session, rate limiting, catalog IDs and supported add validation exist. Full tool dispatch/cart ownership/execution boundary remains to be completed; no arbitrary SQL/code/Admin tool found. |
| 21: analytics | Partial | Funnel/AOV/cohort dashboard formulas exist. Webhook idempotency, purchase linkage and baseline data are incomplete. |
| 22: learning data | Partial | Rich outcome records exist. Outcome-based aggregate ranking feedback is missing. |
| 23: merchant settings | Partial | Most controls exist in schema/UI. Analytics, exclusions, maximum recommendations and discounts need consistent runtime enforcement. |
| 24: chat UI | Partial | Text/loading/cards/options/add/error/checkout/proactive/responsive styles exist. No dedicated comparison card; persistence restores text without cards. Visual/mobile QA unavailable. |
| 25: comparison | Partial | Structured product data is available and helper exists. Current validated output emphasizes price/options, not shopper-specific differences. |
| 26: memory | Partial | Separate profile and bounded server history exist. Corrections fail; browser persistence drops cards/CTA/selected variants; no rolling conversation summary found. |
| 27: context builder | Implemented | `buildSalesContext` includes profile/state/intent/page/cart/recent events/recommendations/rejections/settings. Bounded context, not entire catalog. |
| 28: response orchestration | Partial | Most stages exist, but structured update/tool execution stages are missing and legacy shortcut paths diverge. |
| 29: proactive engine | Partial | Separate deterministic rule engine is connected to offers. Count/cooldown storage and cache guard ordering need fixes. |
| 30: safety/trust | Partial | Strong prompt rules, canonical data and explicit-add checks exist. Consent/settings enforcement and consistent final action gates require work. |
| 31: errors | Partial | Provider timeout/fallback and cart errors handled. Some database/context failures occur before the stream's catch. Live outage does not prove every AI-failure scenario. |
| 32: performance | Partial | Deferred ~113.6 KB SDK, caching, throttling/debouncing and event batching exist. Not lazy-loaded by widget; no Core Web Vitals measurements. Event batch size/requeue behavior needs hardening. |
| 33: tests/journeys | Partial | 115 existing tests pass. Unit/synthetic journey coverage is useful but misses the reproduced integration cases and full A-E browser/order journeys. |
| 34: migrations | Source present | Additive sales-agent migration and relevant indexes exist. Applied state in deployed DB unverified. |
| 35-36: incremental/code conventions | Substantial | Existing framework, Prisma and TypeScript modules reused. Some legacy `any` and large-route coupling remain; no rewrite required. |
| 37: product principle | Partial | Observe/discover/recommend/cart/close intent is evident, but reliable controlled execution/attribution/learning loop is not complete. |
| 38: final deliverables | Audit only | No feature implementation, schema changes or deployments made during this audit. Findings, repair plan, commands and checklist are provided here. |

## 5. Existing state rules, ranking and tools

`app/sales/salesStateMachine.ts` deterministically prioritizes PURCHASED, CHECKOUT, ABANDONED, OBJECTION and HESITATING; then chooses CART/CLOSING from cart and intent/accepted recommendations; CONSIDERATION from shown/clicked recommendations; PRODUCT_MATCH from need and intent; otherwise INTEREST, DISCOVERY or BROWSING. It recomputes from facts rather than using the previous state as a transition guard. Checkout completion flags can remain sticky. Not all terminal-state behavior is enforced outside the prompt/proactive engine.

Recommendation defaults prioritize intent (38), preference (22), budget (15), availability (10), product sales (7), merchant priority (5), and order-derived historical signal (3), with a rejection penalty (35). This is fit-oriented rather than purely margin-oriented. It selects primary plus meaningful cheaper/premium alternatives, capped by settings within the module.

Upsells use affinity compatibility, order-count-derived attachment signal, product sales and merchant priority, minus price resistance. They require intent, avoid PRICE/NEED_TO_THINK objections, exclude cart/rejected/blocked product IDs and return one result. Margin and actual recommendation-outcome conversion are not independent inputs.

`app/sales/commerceTools.server.ts` defines search, product, variants, cached inventory, comparison, cart read, add/remove/update validators, related products, shipping/returns, bundle suggestions, discount validation and an allowlist validator. It does not provide the claimed full execution flow; reviews and selling-plan-aware cart actions are not connected. The prompt is at `app/models/chatPrompt.server.ts` and the concise context builder is `app/sales/salesContext.server.ts`.

## 6. Existing database and events

The sales-agent migration is `prisma/migrations/20260903100000_ai_sales_agent/migration.sql`. It adds session customer/timing/state/profile/checkout/purchase/order/revenue fields, merchant sales controls and the `RecommendationOutcome` table using additive SQL. The schema includes shop/session/event-time/order/product indexes. No migration was run during this audit.

`ShopperSession` stores profile JSON separately from `ChatMessage` history and behavior context. `RecommendationOutcome` includes variant, type, reason, rank, profile snapshot, state, timestamps for shown/clicked/added/purchased/rejected, rejection reason, order/revenue, primary product and cart value before/after. These fields are more complete than their present data population and downstream use.

Event architecture: browser hooks -> in-memory event envelope (`type`, timestamp, session, shop, URL, metadata) -> roughly two-second batches -> signed `/api/events` ingestion -> session recomputation, event persistence and recommendation-outcome updates. Chat messages also persist server-side. Scroll/search/hover work is throttled or debounced rather than invoking AI on every event. Checkout-start detection is best effort; `checkout_clicked` does not directly set the server checkout-start flag. No reliable checkout pixel integration was identified.

## 7. Verification and audit artifacts

| Check | Result |
| --- | --- |
| Existing `npm test` | 115 tests, 27 files passed during this investigation. |
| Existing typecheck and lint | Passed during this investigation. |
| New actual-source probes | Nine expectations fail: budget-as-size, size-as-budget, preference correction, lost prompt count, renewed proactive eligibility, zero cart quantity, unrelated recommendation, repeated rejected recommendation, duplicate-attribution return value used by webhook overwrite. |
| Probe isolation | Real source functions; Prisma dependency stubbed. No database, AI provider, store or production webhook mutation. |
| MCP | Storefront/catalog tools listed; catalog search worked. Not proof of app-proxy chat integration. |
| Live theme | `test-data` #135840923713 enabled embed. Dawn #135840858177 had no embed. |
| SDK | Live asset loads and exactly matches local built extension hash. |
| Live normal Shopify cart | Add, quantity change and remove passed in a fresh isolated cart; left empty. Not a widget cart test. |
| Live widget journey | Blocked by authenticated app-proxy 404 responses. No browser available for visual testing. No checkout or order placed. |

New files for this architecture audit only:

- `tmp/shopify-qa-20260906/ARCHITECTURE_AUDIT.md` (this report).
- `tmp/shopify-qa-20260906/architecture-probes.mjs` (standalone diagnostic regression probes, not part of the default Vitest suite).

Earlier live QA artifacts and consent probe are documented in [REPORT.md](REPORT.md). No application source, API route, prompt, schema, merchant setting or test-suite implementation was changed. The earlier CLI config inspection regenerated the root TOML formatting; its content was restored. `git diff` showed no remaining TOML content diff, although status retained a modified marker.

## 8. Concise incremental completion plan

1. **Restore the deployed connection:** inspect installed app proxy path/scopes, correct config with approval, deploy/re-authorize as needed, then confirm signed session/config/chat/offer requests through the storefront. Verify deployed migration state.
2. **Repair foundation and controls:** fix consent and analytics gates, contextual session patching, profile extraction/corrections, cart/revisit/checkout events, proactive cooldown persistence and eligibility checks on cache hits. Add regression tests first.
3. **Complete controlled orchestration:** validate the full structured output; merge safe profile updates; execute allowlisted tools with per-action constraints and results; maintain pending product/options/quantity; apply the same validation to deterministic and model paths.
4. **Enforce fit and sales behavior:** use one shared eligibility boundary on final recommendations/actions, selected-variant prices and currency, actual no-match handling, merchant limits and rejected products. Preserve grounded fit explanations and comparisons. Keep a separate one-upsell slot and connect truthful bundles.
5. **Make measurement trustworthy:** idempotent order processing, stable session/cart/order association, eligible product/variant credit, non-engaged cohorts, delivered-impression acknowledgement and aggregate outcome feedback for ranking. Align customer-data handling with stored fields.
6. **Harden and validate:** complete route/integration tests, A-E browser journeys, fallback/network/database failure checks, native theme cart updates, mobile/accessibility and performance measurements. Roll out incrementally without changing unrelated functionality.

## 9. Commands

From the repository root, rerun read-only/local checks:

```powershell
npm test
npm run typecheck
npm run lint
node tmp/shopify-qa-20260906/architecture-probes.mjs
node tmp/shopify-qa-20260906/consent-check.mjs
```

The architecture probe intentionally exits with status 1 while any of the documented expectations fail. It is not evidence that the existing Vitest suite failed.

To inspect migration state with the intended database environment configured:

```powershell
npx prisma migrate status
```

Only after reviewing pending migrations and approving the intended target database, the existing deployment workflow uses:

```powershell
npx prisma generate
npx prisma migrate deploy
npm run build
```

`migrate deploy` changes the database; these commands were not executed as an audit repair. Do not run a development/reset migration command against production.

## 10. Manual storefront acceptance checklist

- Verify the enabled theme embed and signed session/config/chat/offer responses; inspect browser console/network errors.
- Journey A: collection dwell/scroll -> one contextual prompt -> state budget/use/color/size -> at most configured number of eligible cards with reasons -> requested variant/quantity added -> one accepted add-on -> checkout CTA. Verify native cart and persisted state after navigation.
- Journey B: expensive product -> price objection -> cheaper available fit within the actual selected-variant budget; correct the budget/color mid-conversation and confirm old constraints are replaced. A test order must use an approved test checkout, not a real payment.
- Journey C: add -> open/close cart -> wait for hesitation threshold -> truthful published shipping answer -> checkout. Confirm no invented delivery guarantee.
- Journey D: dismiss proactive help -> navigate, reload, generate more events and repeat cached triggers -> no repeated interruption or limit reset. Test consent denied/granted and analytics disabled separately.
- Journey E: simulate AI timeout/invalid JSON and app endpoint failure in a test environment -> usable ordinary Shopify browsing/cart, clear widget fallback, no false cart-success message.
- Ask for an unmatched product, rejected recommendation, excluded collection, out-of-stock variant and two-unit cart action. Confirm final server controls, not only prompt wording.
- Compare two products; verify the selected differences and explanations against real product data. Confirm cards/options/checkout behavior on mobile and after navigation.
- With an approved test order, verify material-assistance attribution, an unassisted baseline order and duplicate webhook delivery. Revenue must remain stable; visibility alone must not earn attribution.
- Verify a real discounted bundle separately from a suggestion with no discount. Confirm disabled discount permissions prevent conversational application.
- Measure SDK/network load and Core Web Vitals before/after; inspect bounded event batches, multi-tab cart reconciliation and provider/database failures.
