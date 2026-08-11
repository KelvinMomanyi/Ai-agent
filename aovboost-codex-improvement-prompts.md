# AOVBoost — Codex Improvement Prompts (5 Phases)

Feed these to Codex **one phase at a time, in order**. Each phase is self-contained,
lists exact files to touch, files to leave alone, and a manual verification
checklist to run before moving to the next phase. Do not combine phases in a
single Codex session — each should be its own scoped run with its own diff review.

Reference doc for Codex context: `AOVBOOST_APPLICATION_COMPLETE_FLOW_AND_EXECUTION_GUIDE.txt`
(the flow document, dated 2026-08-04). Codex should treat that document as the
current ground truth for existing behavior and should not "fix" anything
described there as intentional (e.g., catalog guard behavior, offer decision
caching, tenant isolation) unless explicitly instructed below.

---

## PHASE 1 — Make experiments actually render their treatment config

### Goal
Currently `Experiment.controlConfig` / `Experiment.treatmentConfig` are stored
and a control/treatment bucket is assigned deterministically per session, but
the JSON is never merged into the widget payload or copy. Fix this so an
active experiment's treatment config actually changes what the shopper sees.

### Codex Prompt

```
Context: AOVBoost is a Shopify app. Experiments are stored per widget type in
the Experiment model (controlConfig, treatmentConfig as JSON, trafficSplit).
Shopper bucket assignment already happens deterministically via
hash(sessionId + experimentId) / 100 compared against trafficSplit, and the
result ("treatment" or "control") is stored on Offer.abVariant. What is
missing: the stored controlConfig/treatmentConfig JSON is never applied to
the actual widget payload or copy sent to the storefront.

Task:
1. In the offer decision flow (app/ai/decisionEngine.server.ts and
   app/models/offer.server.ts — locate the exact files that build the final
   widget payload before it's returned from /api/offer), after the
   control/treatment bucket is assigned, merge the corresponding config JSON
   (controlConfig or treatmentConfig, matching the assigned variant) into the
   payload that is sent to the storefront SDK.
2. Define a strict, documented schema for what fields are allowed inside
   controlConfig/treatmentConfig (e.g., copy overrides, CTA text, urgency
   framing text, display delay, color/theme hint). Do NOT allow this JSON to
   inject arbitrary product IDs, prices, or discount values — those must
   still only ever come from the catalog guard. Validate the JSON against
   this schema before merging; on validation failure, log a warning and fall
   back to the widget's normal deterministic/AI-generated copy (do not throw,
   do not fail the request).
3. Ensure the merge happens AFTER the catalog guard runs, not before, so a
   malformed experiment config can never bypass product/price validation.
4. Update the /app/experiments merchant UI (app/routes/app.experiments.tsx)
   so the config JSON editor includes inline documentation/placeholder text
   showing the allowed schema fields from step 2.
5. Update Offer creation so Offer stores which experimentId produced the
   decision (currently Offer stores abVariant but not experimentId — add an
   experimentId column via Prisma migration, nullable, foreign key to
   Experiment, and set it whenever an experiment is active for the widget
   type being decided).
6. Update app/models/analytics.server.ts experiment analytics queries to
   group by experimentId in addition to widgetType + abVariant, so
   consecutive experiments of the same widget type no longer blend together
   in the significance calculation.

Do NOT touch:
- The bucket assignment hash formula itself.
- The catalog guard logic in app/models/catalogGuard.server.ts.
- The two-proportion z-test statistical significance calculation logic.
- Any files under storefront-sdk/src/widgets/* rendering logic beyond
  accepting the new merged config fields as props.

Return a summary of every file changed and a Prisma migration file if the
schema changed.
```

### Manual Verification Checklist
- [ ] Create a test experiment with different CTA text in control vs treatment.
- [ ] Confirm both buckets are still assigned deterministically (same session -> same bucket across repeated requests).
- [ ] Confirm a malformed treatmentConfig (e.g., containing a `productId` field) does NOT get merged and does NOT crash `/api/offer`.
- [ ] Confirm Offer rows now have `experimentId` populated when an experiment is active.
- [ ] Run two sequential experiments on the same widget type and confirm `/app/experiments` analytics no longer mixes their numbers.
- [ ] Confirm catalog guard still strips any invalid product from the final payload even if config injected something products-adjacent.

---

## PHASE 2 — Add configurable, real bundle discounts

### Goal
`Bundle.discountType` and `Bundle.discountValue` currently exist in the schema
but are force-set to `"none"` / `0` on every save. Merchants have no way to
offer an actual incentive for bundle purchases. Make this configurable while
keeping Shopify's live catalog price as the source of truth for the base price.

### Codex Prompt

```
Context: In app/models/bundle.server.ts, the bundle save path currently
forces discountType to "none" and discountValue to 0 regardless of merchant
input, per a prior deliberate safety decision (avoiding a mismatch between
displayed price and what checkout actually charges). We now want to support
real, safe bundle discounts.

Task:
1. Allow discountType to be one of: "none", "percentage", "fixed_amount".
   Allow discountValue to be a merchant-set number, validated server-side:
   - percentage: 1-50 (inclusive), reject anything outside this range.
   - fixed_amount: must be less than the sum of the bundle's real catalog
     line prices at save time; reject otherwise.
2. Bundle discounts must NOT be applied by fabricating a price on the
   frontend. Use Shopify's native discount mechanism: when a bundle with an
   active discount is added to cart, use a Shopify automatic discount
   function or a cart-line discount allocation via the Shopify Cart API
   (research current Shopify Ajax Cart / Cart API support for
   line-item-scoped discounts as of API version 2026-07 and use whichever
   approach keeps checkout price and displayed price guaranteed consistent --
   do not attempt to fake a lower displayed price without an underlying
   real Shopify discount applied to the order).
3. Update the bundle widget (storefront-sdk/src/widgets/bundle) to display
   both the original summed price and the discounted price when a discount
   is active, and clearly label the savings.
4. Update /app/bundles/:id and /app/bundles/new editor UI (Polaris) to expose
   discount type/value fields with the validation from step 1 surfaced as
   inline form errors.
5. Update attribution logic (app/models/attribution.server.ts) so
   Offer.revenueImpact for bundle conversions reflects the actual discounted
   line revenue from the order webhook, not the pre-discount sum.
6. Add a Prisma migration only if any schema change beyond removing the
   force-override is needed (the discountType/discountValue columns already
   exist -- confirm their current types support the above before migrating).

Do NOT touch:
- Recommendation strip, upsell drawer, or any non-bundle widget pricing
  logic.
- The catalog guard's product-existence validation.
- Existing bundle creation/product-membership validation (same-shop check,
  trigger product logic).

If Shopify's current API does not cleanly support line-scoped discounts for
this app's context, stop and report back the constraint instead of
implementing a workaround that could create a displayed-vs-charged price
mismatch. This is a hard constraint, not a preference.
```

### Manual Verification Checklist
- [ ] Create a bundle with a 15% discount; confirm the widget shows original + discounted price correctly.
- [ ] Add the bundle to cart; confirm the actual Shopify checkout price matches what was displayed (this is the critical check -- do not skip).
- [ ] Try to save a bundle with a 75% discount; confirm server-side rejection.
- [ ] Try a fixed-amount discount larger than the bundle sum; confirm rejection.
- [ ] Complete a real test order with a discounted bundle; confirm `Offer.revenueImpact` reflects discounted revenue, not pre-discount sum.
- [ ] Confirm non-discounted bundles behave exactly as before (regression check).

---

## PHASE 3 — Fix variant-limited direct add-to-cart

### Goal
Currently only the first synced Shopify variant is stored/used, so any
product requiring option selection (size, color, etc.) gets punted to a
product-page link instead of direct add -- a likely conversion leak.

### Codex Prompt

```
Context: During catalog sync (app/jobs/aovboost.server.ts /
app/models/product.server.ts, phase 8.5 of the sync process), only the first
variant's ID, price, and compare-at price are stored under
aovboost.defaultVariantId. Widgets that require option selection currently
fall back to a product-page link rather than direct add.

Task:
1. Extend the Product sync to store ALL variants (or, if payload size is a
   concern, up to a reasonable cap -- confirm existing metafield cap of 20 as
   a size reference and propose a sensible variant cap, e.g. 100) with their
   option names/values, price, compare-at price, and inventory if available.
2. Add a lightweight "most popular variant" heuristic as the new default
   direct-add variant where option data exists: prefer the variant with the
   most order history from ProductOrderStat-adjacent order line data if
   available; otherwise fall back to the first in-stock variant; otherwise
   the first variant.
3. For widgets that support it (bundle, upsell drawer, recommendation strip),
   add an inline lightweight variant picker (e.g., a dropdown or swatch row)
   rendered in the widget's Shadow DOM before the add-to-cart action fires,
   ONLY when the product has more than one variant. Single-variant products
   keep the current one-click direct-add behavior unchanged.
4. Ensure the variant picker only ever offers variants that exist in the
   canonical synced catalog (post catalog-guard equivalent check) -- never
   invent option combinations.
5. Update the catalog cache snapshot structure (app/models/catalogCache.server.ts)
   to include the expanded variant list so the AI/heuristic decision layer
   and copy generation can reference real option availability if useful
   (e.g., avoid recommending an out-of-stock-in-all-variants product).

Do NOT touch:
- The chat widget's existing deterministic add-to-cart resolution logic
  beyond making it variant-aware in the same way (treat chat as its own
  follow-up task, not part of this phase, unless it's a trivial reuse of the
  same picker component).
- Bundle discount logic from Phase 2 (assume Phase 2 is either already
  merged or not yet started -- do not couple this phase to it).
- Sync job lease/concurrency/pagination mechanics.

Flag if the expanded variant storage meaningfully changes Product row size or
sync duration at scale (e.g., merchants with thousands of multi-variant
products) and propose a mitigation if so (e.g., separate ProductVariant
table instead of JSON blob on Product).
```

### Manual Verification Checklist
- [ ] Sync a store with multi-variant products (size/color); confirm all variants now stored.
- [ ] Confirm single-variant products still one-click add exactly as before (no regression).
- [ ] Confirm multi-variant products show an inline picker in bundle/upsell/rec-strip widgets.
- [ ] Confirm picker only ever lists real, in-catalog variant combinations.
- [ ] Confirm out-of-stock-only products are excluded or clearly marked, not silently offered.
- [ ] Spot-check sync duration/time on a large test catalog before/after.

---

## PHASE 4 — Push live urgency events into open storefront sessions

### Goal
Price-drop and low-inventory webhook events are currently recorded as Event
rows but never proactively pushed to an already-open shopper session -- they
only surface if something dispatches `aovboost:system-event` manually. Make
this automatic and real-time.

### Codex Prompt

```
Context: PRODUCTS_UPDATE webhook handling (app/routes/api.webhooks.tsx) already
records price_drop_webhook and low_inventory_alert Event rows when relevant
conditions are met (price falls; lowest variant inventory <= 5). Nothing
currently pushes these to an open browser session automatically -- the
TriggerRouter only reacts to a manually dispatched aovboost:system-event.

Task:
1. Introduce a lightweight real-time delivery mechanism for these two event
   types to sessions that are currently viewing the affected product.
   Prefer Server-Sent Events (SSE) reusing the same pattern already used for
   /api/chat streaming, given no new infra dependency is introduced. Do NOT
   introduce a WebSocket server or new long-lived infra dependency unless
   SSE is proven insufficient -- justify the choice in your summary.
2. Add a new authenticated, rate-limited endpoint (e.g., GET
   /apps/aovboost/live via app/routes/api.live.tsx) that a browser with an
   active session can subscribe to. Reuse the existing storefront session
   authentication pattern from app/utils/storefrontAuth.server.ts exactly as
   used elsewhere -- do not create a parallel auth mechanism.
3. On the server, when a price_drop_webhook or low_inventory_alert Event is
   created AND the affected productId matches a product currently being
   viewed by any active session for that shop (check recent ShopperSession /
   ShopperEvent product_view records within a short recency window, e.g. last
   10 minutes), push a message to any subscribed live connections for that
   session.
4. On the client (storefront-sdk/src/eventBus.ts or a new
   storefront-sdk/src/liveUpdates.ts module), subscribe to /apps/aovboost/live
   when a session is active, and on receiving a price_drop or low_inventory
   message, dispatch the existing aovboost:system-event DOM event so
   TriggerRouter's existing inline_alert handling picks it up unchanged.
5. Ensure this cannot become a spam vector: cap live pushes to at most one
   message per event type per product per session per 10-minute window, and
   ensure the SSE connection is properly cleaned up on pagehide/disconnect
   to avoid leaking server resources (mirror cleanup patterns already used
   for the chat SSE route).
6. Feature-flag this behind an environment variable (e.g.
   AOVBOOST_ENABLE_LIVE_EVENTS=true, default false) so it can be rolled out
   gradually per environment.

Do NOT touch:
- The existing chat SSE route/logic itself (reuse patterns, don't modify it).
- inline_alert widget rendering logic beyond confirming it already handles
  this event shape.
- Webhook HMAC verification or the existing price-drop/low-inventory
  detection thresholds.

Report expected serverless/infra implications (e.g., SSE connection limits
on Vercel functions) given this app already runs on Vercel per the flow doc,
and flag if a serverless-hostile pattern (long-lived SSE) needs a fallback
(e.g., short-poll every 30s as a serverless-safe alternative) -- propose
whichever is actually safe for the current Vercel deployment, don't assume
SSE is safe without checking.
```

### Manual Verification Checklist
- [ ] Confirm feature flag defaults to off and existing behavior is unchanged when disabled.
- [ ] With flag on: drop a test product's price while a session is actively viewing it; confirm inline alert appears within a few seconds without a page reload.
- [ ] Confirm a session viewing a DIFFERENT product does not receive the alert.
- [ ] Confirm no more than one alert per event type per product per session per 10-minute window.
- [ ] Confirm SSE/poll connections are cleaned up on tab close (check server logs/connection count).
- [ ] Load-test or reason through serverless connection limits before enabling in production.

---

## PHASE 5 — Consolidate analytics onto a single authoritative event schema

### Goal
`/app` (main dashboard) and `/app/analytics` currently read different event
shapes, and the current SDK doesn't populate the legacy funnel events that
`/app/analytics` expects, leaving some panels empty. Unify onto one
authoritative source.

### Codex Prompt

```
Context: The main /app dashboard (app/routes/app._index.tsx) is based on
Offer records and signed conversion Event rows and is confirmed accurate.
/app/analytics (app/routes/app.analytics.tsx) reads Event rows expecting
legacy event names (offer_generated, upsell_impression, upsell_add_to_cart,
conversion) that the current storefront SDK does not produce -- it instead
tracks impressions/clicks via ShopperEvent and Offer.shown/Offer.clicked
flags. This causes some /app/analytics panels to render empty even though
real data exists elsewhere.

Task:
1. Audit every panel currently rendered on /app/analytics. For each panel,
   determine whether it can be re-derived from existing authoritative data
   (Offer.shown/clicked/converted/revenueImpact, ShopperEvent, ShopperSession)
   versus whether it genuinely requires a new event producer.
2. Rewrite /app/analytics queries to read from the same authoritative
   Offer/ShopperEvent/conversion Event sources the main dashboard already
   uses, rather than the legacy funnel event names. Do NOT create new
   duplicate event producers to satisfy the old schema -- retire the old
   expectation instead.
3. For any panel that cannot be honestly reconstructed from existing data
   (report exactly which ones, if any), either remove the panel or clearly
   label it as unavailable/deprecated rather than silently showing zeros --
   a merchant should never see a blank/zero panel that looks like "no
   activity" when the real issue is a schema mismatch.
4. Once /app/analytics is fully backed by the authoritative schema, decide
   whether /app/analytics should be merged into /app as expanded
   sections/tabs, or kept separate -- default to merging into /app as
   additional tabs unless there's a clear reason (e.g., page load
   performance) to keep them split; report your reasoning either way.
5. Add a short in-app note/tooltip on /app/analytics (or the merged
   equivalent) documenting the 30-day default window and that AOV lift is
   an observational comparison, not a randomized causal estimate (this
   caveat currently exists only in internal documentation, not in the UI --
   surface it to merchants for transparency).

Do NOT touch:
- The underlying Offer/ShopperEvent/Event schema itself unless a genuinely
  new field is required to honestly render a panel (if so, propose the
  migration explicitly and explain why).
- The two-proportion z-test experiment significance logic (only touch this
  file if Phase 1 already changed it -- otherwise leave it as is).
- Revenue/conversion webhook logic in app/routes/api.webhooks.tsx.

Report a clear before/after list: which panels were re-derived successfully,
which were removed, and which were relabeled as deprecated.
```

### Manual Verification Checklist
- [ ] Confirm every remaining panel on /app/analytics shows real, non-zero data on a store with genuine test activity.
- [ ] Confirm no panel silently shows "0" due to a schema mismatch -- deprecated panels are explicitly labeled, not blank.
- [ ] Cross-check a specific number (e.g., attributed revenue for a date range) matches between /app and the rewritten /app/analytics.
- [ ] Confirm the AOV-lift observational-not-causal disclaimer is visible in the UI.
- [ ] If panels were merged into /app, confirm dashboard load time hasn't regressed noticeably.

---

## General notes for every phase

- Run each phase in its own Codex session/branch. Review the diff before merging.
- After each phase, re-run the operational readiness checklist items relevant to what changed (from the flow doc, section 34) before deploying to a real store.
- Any Prisma schema change requires `npm run setup` (or the deployment pipeline equivalent) to actually apply migrations -- a Vercel build alone does not run migrations, per the existing documented boundary.
- If Codex proposes touching any file not listed as in-scope for a phase, stop and review manually before accepting -- this mirrors your existing do-not-touch discipline.
