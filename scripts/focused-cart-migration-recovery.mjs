import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  FOCUSED_CART_MIGRATION,
  SESSION_COMPATIBILITY_MIGRATION,
  focusedCartRecoveryMessage,
  inspectFocusedCartMigration,
} from "./focused-cart-migration-check.mjs";

// Reviewed immutable SQL. Only line-ending differences are allowed.
export const REVIEWED_MIGRATION_HASHES = Object.freeze({
  [SESSION_COMPATIBILITY_MIGRATION]:
    "189592dcbae183000249982aa6f671499163e54ec432d0752c44500f22fa2889",
  [FOCUSED_CART_MIGRATION]:
    "c1978eab1af319c1e7ff36ec74e2e19313f16e1f9f5efc68b99ab35d757dd4f3",
});
const focusedCrLfChecksum =
  "f260e36b4059954300568e25ffa0da2fbb39dcbac825835cdbc71065d2addeb1";
const readMigration = (name) =>
  readFileSync(
    new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url),
    "utf8",
  );

/** Read-only planning; the existing runner executes the fixed Prisma command. */
export async function planFocusedCartRecovery(prisma, readSql = readMigration) {
  const inspection = await inspectFocusedCartMigration(prisma);
  if (inspection.status === "not_failed") return null;
  if (inspection.status !== "retryable")
    throw new Error(focusedCartRecoveryMessage(inspection));

  const failures = await prisma.$queryRaw`
    SELECT migration_name name,checksum FROM public._prisma_migrations
    WHERE finished_at IS NULL AND rolled_back_at IS NULL`;
  if (failures.length !== 1 || failures[0].name !== FOCUSED_CART_MIGRATION)
    throw new Error(
      "Focused-cart recovery requires exactly its one known unresolved failure; review other migration states first.",
    );
  if (
    ![
      REVIEWED_MIGRATION_HASHES[FOCUSED_CART_MIGRATION],
      focusedCrLfChecksum,
    ].includes(failures[0].checksum)
  )
    throw new Error(
      "The failed focused-cart checksum is not the reviewed migration. Refusing automatic recovery.",
    );

  for (const [name, expected] of Object.entries(REVIEWED_MIGRATION_HASHES)) {
    let sql;
    try {
      sql = String(readSql(name)).replace(/\r\n/g, "\n");
    } catch {
      throw new Error(
        `Required migration ${name} is missing or unreadable. Refusing automatic recovery.`,
      );
    }
    if (createHash("sha256").update(sql).digest("hex") !== expected)
      throw new Error(
        `Required migration ${name} does not match the reviewed SQL. Refusing automatic recovery.`,
      );
  }
  const [compatibility] = await prisma.$queryRaw`
    SELECT finished_at "finishedAt",to_regclass('public."Session"') IS NOT NULL "hasAlias"
    FROM public._prisma_migrations WHERE migration_name=${SESSION_COMPATIBILITY_MIGRATION}
      AND rolled_back_at IS NULL ORDER BY started_at DESC LIMIT 1`;
  if (compatibility && (!compatibility.finishedAt || !compatibility.hasAlias))
    throw new Error(
      "The compatibility migration has a failed/incomplete or drifted state. Refusing automatic focused-cart recovery.",
    );

  const [upsert] = await prisma.$queryRaw`
    SELECT EXISTS (
      SELECT 1 FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid
      JOIN pg_namespace n ON n.oid=t.relnamespace
      JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=i.indkey[0]
      WHERE n.nspname='public' AND t.relname='AppSettings' AND a.attname='shop'
        AND i.indisunique AND i.indisvalid AND i.indisready AND i.indimmediate AND i.indnkeyatts=1
        AND i.indpred IS NULL AND i.indexprs IS NULL
    ) "safeUpsert"`;
  if (!upsert.safeUpsert)
    throw new Error(
      "The settings shop uniqueness required for an idempotent retry is missing. Refusing automatic recovery.",
    );

  return {
    message:
      "Confirmed the reviewed Session/session failure and compatibility SQL; marking only the failed focused-cart record rolled back so normal migrate deploy can retry it.",
    scriptName: "migrate:rollback:focused-cart",
  };
}
