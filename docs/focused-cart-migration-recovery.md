# Focused-cart migration recovery

## 7 November update: recover during the normal build

Plan recorded before source edits. The owner has now supplied repeated build logs
confirming the exact casing error and compatible schema. The manual-only guard
keeps stopping normal deployments, so extend the existing migration reconciliation
to prepare a single narrowly guarded rollback of that failed migration record.
Starting commit ea046f7 is clean; the previous local gate passed 699 tests in 92 files.

- Only this known error, an unchanged historical migration checksum and compatible
  schema qualify. Require exactly one unresolved failure and no failed/applied
  compatibility migration whose state conflicts with the proposed retry.
- Before changing history, require the exact reviewed compatibility SQL and the
  original focused-default SQL in the checkout, allowing only line-ending changes.
  Missing or changed files must stop the build.
- Use Prisma's existing resolve --rolled-back command through the established
  reconciliation runner. Never mark the migration applied, update business rows
  directly or reset the database. The existing migrate deploy step then applies
  the compatibility migration before retrying focused defaults.
- A completed/rolled-back record is a no-op on later builds. Reject unknown failures,
  schema drift and failed recovery commands. Add orchestration/real-SQL tests and
  run npm run verify without executing any production command here.

Keep the normal build command npm run vercel-build. No temporary build override is
needed once this update is released. The initial investigation/manual fallback is
recorded below; its manual-only behavior is superseded by this guarded build path.

Current deployment steps:

1. Commit/release this patch, including the new recovery helper and existing
   compatibility migration. If the earlier one-time build override was used,
   restore `buildCommand` to `npm run vercel-build` before deploying this update.
2. Redeploy the affected Vercel environment normally. Its existing pre-build step
   validates the error, schema, unique shop key, failed-record checksum and both
   reviewed SQL files. It then runs only
   `prisma migrate resolve --rolled-back 20261105140000_focused_cart_defaults`.
3. The existing `prisma migrate deploy` build command applies pending SQL in order.
   On subsequent successful builds, no unresolved failure remains, so recovery is
   skipped. Other failures, altered/missing files and unexpected schema still stop
   the build for review. No reset or mark-applied shortcut is used.

The standalone check command stays read-only. Only the existing build resolution
runner may execute the approved Prisma metadata command during a user-initiated
deployment. Codex has not run that command or connected to production here.

Files changed in this update: new `scripts/focused-cart-migration-recovery.mjs`;
the existing reconciliation runner; one fixed rollback alias in package.json;
`app/models/focusedCartMigration.integration.test.ts`; new
`app/migration-reconciliation.test.ts`; and this report. There is no new or edited
migration, dependency, environment variable, runtime feature or Vercel build-command
change. Existing migration files remain immutable.

Validation on 7 November 2026:

| Command | Result |
| --- | --- |
| Targeted recovery/default/orchestration tests | Passed: 29 tests before the final uniqueness guard; the full suite also validates that added case. |
| `npm.cmd run verify` | Passed, exit 0: 713 tests in 93 files, typecheck, lint, SDK build/size checks, Prisma generation and production client/server builds. Fourteen new regressions over the previous 699-test baseline. |
| `node --check` on changed scripts | Passed; syntax validation only. |
| `git diff --check` | Passed. No migration file was changed. |

The real-SQL recovery suite now has 18 cases and the mocked orchestration suite
has six. They verify no-op future builds, missing/altered SQL, failed-record
checksum and line endings, another unresolved failure, compatibility drift, the
unique shop index needed for an idempotent backfill, and stop-on-error execution.
Prisma command spawning is mocked; history resolution is simulated only in an
isolated in-memory database. The initial test-only WASM startup timeout was fixed
by waiting for PGlite readiness in its existing longer setup hook. No live Prisma
resolve, production migration, deploy, credential access, commit or push occurred.

## Initial 6 November investigation and manual fallback

Plan recorded before edits, 6 November 2026. Latest local gate passed 689 tests in
91 files. The owner reported P3009 for 20261105140000_focused_cart_defaults; the
original database error/log is not included. No production connection will be made.

Source finding: 20260803100000_complete_multitenant_schema renames Session to
lowercase session; Prisma maps Session to that lowercase table. The immutable
focused-cart migration nevertheless selects from quoted uppercase Session. Its
test created only uppercase Session and therefore missed the actual history.

- Reproduce the failure with real historical SQL in isolated PGlite data.
- Keep every existing migration byte-for-byte unchanged. Add an idempotent
  migration ordered immediately before focused-cart that creates a non-updatable
  uppercase compatibility view exposing only DISTINCT shop from lowercase session.
  Do not expose credentials, rename/drop a table or change the runtime session
  store. Refuse an unrelated existing uppercase relation rather than overwrite it.
- Add a read-only check for this specific failed record, its original missing-
  Session error and compatible table/column state. It must not print raw migration
  logs, connection URLs, row contents or secrets and must never resolve history.
- Make the existing pre-build reconciliation error actionable for this failure,
  without automatically rolling it back or marking it applied. Supply exact manual
  check/resolve/retry steps. P3009 blocks new migrations until an operator resolves
  the failed record; adding SQL alone cannot clear it.
- Test full-history replay, retry/idempotence, existing preference preservation,
  new-install defaults, conflicting relation refusal, view privacy/non-updatability
  and tenant deletion. Test known/unknown failure diagnostics and run npm run verify.

The production cause remains unverified until the read-only check or original
error lines confirm it. Do not recommend marking a migration applied based only on
P3009. No database reset, production migration, deploy or credential read is allowed.

References: [Prisma 6 failed migration recovery](https://www.prisma.io/docs/orm/v6/prisma-migrate/workflows/patching-and-hotfixing#failed-migration).

## Reproduced cause and patch

Replaying the real migrations through product_relationships reproduces PostgreSQL
42P01, relation "Session" does not exist, when focused_cart_defaults runs. The
original simplified test missed this because it invented an uppercase credential
table rather than following the earlier rename. The production P3009 log alone
still does not prove that its original failure was the same; use the check below.

Added `20261105135000_session_migration_compatibility`, intentionally ordered before
the immutable failing migration. It creates public."Session" as a regular view
over DISTINCT shop from public.session. It holds no rows, includes no credential
columns, is not updatable, and immediately reflects existing uninstall/redact
deletion from session. The runtime Prisma model remains mapped to lowercase
session. An ownership comment and exact normalized view definition make reruns
idempotent while refusing an unrelated or changed uppercase relation. No existing
migration file was edited, and no legacy table was renamed or dropped.

The new read-only inspection checks the unresolved failure's original error and
the expected public tables/columns. It recognizes an absent or compatible partial
focusedMode column. It returns a retry instruction only for the known casing
failure; unexpected errors or conflicting schema require review. It never prints
raw logs, URLs, credentials or merchant rows, and never updates migration history.
The existing build reconciliation now reports that instruction rather than
silently ignoring this failed migration. Its other legacy handlers remain intact.
It also tolerates absent migration-history metadata on an empty database.

Files changed:

- `prisma/migrations/20261105135000_session_migration_compatibility/migration.sql`
- `scripts/focused-cart-migration-check.mjs` (side-effect-free inspection helpers)
- `scripts/check-focused-cart-migration.mjs` (read-only operator command)
- `scripts/reconcile-failed-migrations.mjs` (actionable failure, fresh-history guard)
- `package.json` (migrate:check:focused-cart script only; no dependency change)
- `app/models/focusedCartMigration.integration.test.ts` (ten new tests)
- `app/models/focusedCartDefaults.test.ts` (fixture uses the actual lowercase table)
- This recovery report.

## Operator recovery steps

The following is the **manual fallback** from the initial patch. It is not required
for the confirmed casing failure once the 7 November automatic build update above
is deployed.

Do this from the reviewed patched checkout with its installed Prisma 6 dependencies,
using your trusted deployment environment and intended database. Test against a
development/restored Neon branch first. The agent has not connected to production
or run any of these database commands.

1. Privately verify that the existing DATABASE_DIRECT_URL points to the intended
   database's **direct/unpooled** Neon endpoint. The supplied build log showed a
   pooled endpoint; that is separate from P3009's failed-history state. Runtime
   DATABASE_URL can remain pooled. Do not paste connection strings into chat.
   See [Neon's connection guidance](https://neon.com/docs/guides/prisma-migrations#configure-prisma-for-neon).
2. Ensure the new compatibility migration exists in the reviewed release. There
   are now 21 migration directories. Without that file, retrying the old SQL
   would reproduce the same casing error.
3. Run this read-only command in an environment where DATABASE_DIRECT_URL is
   already configured. It deliberately does not load a credential file itself:

   ```sh
   npm run migrate:check:focused-cart
   ```

   Continue only if it reports the known casing failure and compatible schema.
   If it reports needs review or no unresolved failure, do not blindly resolve
   the migration. Diagnose the actual state instead.
4. After that confirmation, an operator can mark **only** the failed migration
   rolled back, allowing its idempotent SQL to retry with the new prerequisite:

   ```sh
   npx prisma migrate resolve --rolled-back 20261105140000_focused_cart_defaults
   npx prisma migrate deploy
   ```

   Resolve updates migration history; it does not undo SQL. The isolated retry
   tests verify the supported partial state. Deploy applies the earlier-dated
   compatibility migration before replaying focused defaults and subsequent
   pending migrations. Never mark focused defaults applied without executing its
   missing steps, and never use migrate reset or db push for this recovery.
   This follows [Prisma 6's rolled-back/retry procedure](https://www.prisma.io/docs/orm/v6/prisma-migrate/workflows/patching-and-hotfixing#option-1-mark-the-migration-as-rolled-back-and-re-deploy).
5. Redeploy the reviewed release on Vercel. Confirm the migrations finish and the
   normal build completes. Check that existing merchants keep their settings,
   new installs receive focused defaults, and Shopify authentication still uses
   lowercase session. No Shopify extension/scope release is introduced by this fix.

If using the Neon SQL editor to confirm the original error without exposing logs,
these SELECTs are read-only and reveal no credentials:

```sql
SELECT migration_name, finished_at, rolled_back_at,
       COALESCE(logs, '') LIKE '%relation "Session" does not exist%'
         AS known_casing_error
FROM public._prisma_migrations
WHERE migration_name = '20261105140000_focused_cart_defaults'
ORDER BY started_at DESC;

SELECT to_regclass('public.session') AS actual_session_table,
       to_regclass('public."Session"') AS legacy_compatibility_relation;
```

These two SELECTs are a preliminary check, not a substitute for the scripted
schema validation when deciding to retry. An unresolved row should have both
finished_at and rolled_back_at null and known_casing_error true for this patch.
No raw migration logs or connection values need to be shared.

## Verification and limits

Targeted tests passed: 16 tests across the new full-history suite and existing
focused-default suite. They reproduce the original error, execute all 21 SQL
migrations on a clean isolated PGlite database, retry idempotently after the exact
failure, preserve customized/legacy settings, verify fresh defaults, refuse
conflicting/changed relations, prove the view exposes only distinct shop names
and disallows writes, and verify tenant deletion/refusal of unrelated failures.
The checker leaves a fixture's migration history unchanged and does not echo its
private diagnostic text. No real database or provider credential is used.

The history replay verifies PostgreSQL SQL and ordering, not a live Prisma engine
or Neon/Vercel deployment. The original production error and operational recovery
remain to be confirmed by the owner. This fix does not waive the inventory/reorder
business gates or activate billing.

Final local verification, 6 November 2026:

| Command | Result |
| --- | --- |
| `npm.cmd test -- app/models/focusedCartMigration.integration.test.ts app/models/focusedCartDefaults.test.ts` | Passed: 16 tests in two files; ten new cases. |
| `node --check` on all three changed/new scripts | Passed; syntax only, no script execution or database connection. |
| `npm.cmd run verify` | Passed, exit 0: typecheck, lint, 699 tests in 92 files, SDK build/size check, Prisma generation and production browser/server builds. |
| `node scripts/check-sdk-size.mjs` | Passed; SDK unchanged at main 158,670 bytes, combined 210,625 bytes, combined gzip 58,597 bytes. |
| `git diff --check` | Passed. Existing 20 migration files have no diff; only the new compatibility migration was added. |

The first targeted run exposed test-adapter handling of tagged SQL and harmless
PostgreSQL differences in view-definition formatting. Both were corrected and
reruns pass, while deliberately modified definitions still fail validation.
Existing nonfatal React Router/Rollup/import warnings remain. Verification used
approved filesystem access because Vite config loading is blocked in the Windows
sandbox. It did not run vercel-build, the database check CLI, migrate resolve,
migrate deploy or any production action. No credential file/value was inspected
or printed. Standard Prisma/build tooling loads its normal environment internally.
No commit, push or release was created.
