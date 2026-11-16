# Cart Upsell, Chat, Toast and Bundle repairs — 16 November 2026

These are code repairs following [the live verification](live-end-to-end-verification-2026-11-16.md). They are locally validated; this report does not upgrade the four surfaces to verified working in production. No backend or Shopify release was published in this repair run.

## Changes and regression evidence

| Flow | Change | Verification |
| --- | --- | --- |
| Cart Upsell | Preserve an armed native-form continuation when its destination cart read fails transiently. Retry that read at most twice, with bounded delays and the existing intent expiry, session, referrer, exact cart-delta and mutation checks. Never retry the cart write. | The new native-redirect browser regression failed before this fix. It now confirms one offer and one shopper item after the first cart read fails, and no offer after reload. Tested with Core off/on on desktop/mobile. Existing Ajax add, acceptance, section refresh, quantity/notes, source attribution and no-loop tests pass. |
| Chat | Stop interpreting the product words “Bag” and “basket” alone as cart-summary requests. Keep explicit shopping-cart questions and cart-action consent checks. Expand bounded database search tokens to include the existing singular alternatives, so “bags” retrieves titles containing “Bag.” | The two exact messages from the live failure initially failed the new tests. PostgreSQL/PGlite retrieval now returns tenant-scoped, available catalog products; ranking produces variant-bearing KES cards, prioritizes Collection20 for its named query, and still enforces a hard budget. Browser card selection/add/undo and retryable error flows pass with simulated SSE responses. No real-provider end-to-end success is claimed by these tests. |
| Toast | Recognize Velour’s actual `.product-info` container when reading the primary price and selected variant. Preserve the existing 20-second visible-price sensor, health/permission gates, pause/dismiss behavior and context handoff. | Inspected the live primary purchase area, external quantity control, installment form and unrelated quick-add forms. Added a synthetic fixture matching that structure. The desktop browser verifies exactly one `price_hesitation` offer after the threshold, product/variant handoff to chat and paused auto-dismiss while focused. Mobile toast remains deliberately unsupported; the two mobile toast cases are skipped. |
| Bundle | Compare the configured bundle against its selected, catalog-verified items, rather than recursively collecting trigger IDs, product metadata and other bundle candidates as if they were cart contents. Canonicalize configured item IDs before comparison. | A new selected-bundle regression failed before the fix. It now accepts the correct bundle even when other trigger/candidate IDs are present, and rejects changed/missing configuration. Existing hard product/collection exclusions, explicit pairing denials, availability and configured-discount checks remain. Browser bundle acceptance uses one batch cart add and never triggers the upsell. |

Files changed:

- `app/models/chatResponse.ts`, `catalogCache.server.ts`: intent routing and database retrieval.
- `app/models/pairingRecommendations.server.ts`: selected-bundle validation.
- `storefront-sdk/src/nativeCartContinuation.ts`, `triggerRouter.ts`: bounded native-cart read recovery. Shared validation expressions and direct browser `location` access offset the new runtime bytes.
- `storefront-sdk/src/agent/ProductHesitation.ts`: verified Velour container selector.
- `app/models/chatResponse.test.ts`, new `chatCatalog.integration.test.ts`, `pairingRecommendations.server.test.ts`: message-to-catalog/card and bundle regressions.
- `storefront-sdk/src/agent/ProductHesitation.test.ts`, `tests/browser/cart-flow.spec.ts`, `agent-experience.spec.ts`, new `storefront-sdk/test/fixtures/themes/velour-product.html`, `scripts/browser-fixture-server.mjs`: actual-shaped purchase forms, external controls, multipart submission, hesitation and failed-read coverage.
- `.eslintignore`: exclude generated agent chunks consistently with the already excluded generated SDK/theme bundles; source code remains linted.
- `extensions/aovboost-storefront/assets/`: rebuilt SDK and referenced Core/conversation chunks; old generated chunk names removed together.

No event names, cart source/header/property keys, merchant-facing setting names or metafield schemas were renamed. No new runtime dependency was added. Billing, subscriptions, Redis configuration, AI prompts and the checkout post-purchase extension were unchanged. Native read recovery intentionally corrects the legacy purchase path too; no new retry calls occur on an ordinary page without a pending native add. New Core behavior remains default-off.

## Checks run locally

- `npx.cmd vitest run --maxWorkers=2`: **1,019 passed in 122 files**.
- `npx.cmd playwright test`: **114 passed, two intentionally skipped mobile-toast cases** (116 total, desktop and mobile viewports). Local synthetic fixtures use the actual built assets; they do not call the live shop or AI provider.
- `npm.cmd run typecheck`: passed.
- `npm.cmd run lint`: passed after excluding generated agent assets. The initial full lint correctly exposed that regenerated agent chunks had no matching generated-file exclusion; no source rule was disabled.
- `npm.cmd run build:sdk`: passed with all original budgets unchanged.
- `node scripts/check-agent-release.mjs`: passed; asset-graph fingerprint `32d834bfa965ef0e1437ce1c1aa660dcbd3d9ed8ea5deb9e0946493f804de334`.
- `npx.cmd react-router build`: passed, without running production migrations. Existing nonfatal dependency annotation and shared-import warnings remain.
- `git diff --check`: passed. The checkout post-purchase extension has no diff.

## Size and release boundary

Measured against starting HEAD `030a48be19b7f1b83c054bff2f2d87d9dab32629`, in bytes per served JS asset:

| Stage | Before raw / gzip | After raw / gzip |
| --- | ---: | ---: |
| Initial SDK | 163,724 / 44,905 | 163,729 / 44,951 |
| Flagged boot | 232,925 / 67,194 | 232,944 / 67,243 |
| First conversation | 241,341 / 70,490 | 241,360 / 70,541 |
| Lazy conversation | 8,416 / 3,296 | 8,416 / 3,298 |
| All runtime assets | 284,975 / 85,035 | **284,994 / 85,086** |

The 285,000-byte combined raw ceiling remains unchanged, with six bytes of headroom. Further runtime growth requires reduction elsewhere.

Read-only/reversible live diagnostics in this repair run confirmed that active version 88 already contains native-form continuation, while its SDK still differs from the local build. A traced native purchase armed its intent before navigation and arrived with the correct product/variant, currency, baseline and same-origin referrer. A later sample reached a real cart-add offer decision and a pending widget host; visible acceptance was not certified by that diagnostic. This supports retaining the existing native observer and correcting failure recovery, rather than replacing the passing Ajax/cart-refresh flow. It does not establish that a failed cart read caused every earlier live miss.

The isolated diagnostic cart was emptied after each exact one-item test add, the temporary observation entry point was restored, and the isolated browser was closed. No Admin settings, orders or subscriptions changed in this repair run. Existing historical QA telemetry can remain.

Production still needs the repaired backend plus a newly built, activated Shopify asset release, followed by fresh storefront verification with the real saved Core/chat/proactive/bundle settings. Activating the previously uploaded version 89 alone would omit these new fixes. Recheck the native purchase-button flow through visible acceptance, both original chat messages through real SSE/card add/undo, the 20-second visible-price toast and the actual saved two-item bundle. Until then, the prior production failures remain open for live sign-off.
