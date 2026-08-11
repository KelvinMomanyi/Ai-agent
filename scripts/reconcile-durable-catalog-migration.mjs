import { spawnSync } from "node:child_process";

import { PrismaClient } from "@prisma/client";

const migrationName = "20260803090000_durable_catalog_sync";
const migrationDatabaseUrl = process.env.DATABASE_DIRECT_URL;

if (!migrationDatabaseUrl) {
  throw new Error(
    "DATABASE_DIRECT_URL is required to inspect the same database targeted by Prisma Migrate.",
  );
}

const expectedColumns = [
  ["id", "text", "text", "NO"],
  ["shop", "text", "text", "NO"],
  ["phase", "text", "text", "NO"],
  ["cursor", "text", "text", "YES"],
  ["syncedProductIds", "ARRAY", "_text", "YES"],
  ["syncedCount", "integer", "int4", "NO"],
  ["affinityOffset", "integer", "int4", "NO"],
  ["affinityTotal", "integer", "int4", "NO"],
  ["error", "text", "text", "YES"],
  ["leaseToken", "text", "text", "YES"],
  ["leaseUntil", "timestamp without time zone", "timestamp", "YES"],
  ["startedAt", "timestamp without time zone", "timestamp", "NO"],
  ["updatedAt", "timestamp without time zone", "timestamp", "NO"],
];

const expectedIndexes = [
  ["CatalogSyncJob_phase_updatedAt_idx", false, false, ["phase", "updatedAt"]],
  ["CatalogSyncJob_pkey", true, true, ["id"]],
  ["CatalogSyncJob_shop_key", true, false, ["shop"]],
];

function normalizedColumns(rows) {
  return rows.map((row) => [
    row.columnName,
    row.dataType,
    row.udtName,
    row.isNullable,
  ]);
}

function normalizedIndexes(rows) {
  return rows
    .map((row) => [
      row.indexName,
      row.isUnique,
      row.isPrimary,
      row.columns,
    ])
    .sort(([left], [right]) => left.localeCompare(right));
}

function assertExactShape(actual, expected, objectName) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${objectName} does not exactly match the known legacy migration. ` +
        `Refusing to alter Prisma migration history.\n` +
        `Expected: ${JSON.stringify(expected)}\n` +
        `Actual: ${JSON.stringify(actual)}`,
    );
  }
}

const prisma = new PrismaClient({ datasourceUrl: migrationDatabaseUrl });
let disconnected = false;

try {
  const failedMigrations = await prisma.$queryRaw`
    SELECT "id"
    FROM "_prisma_migrations"
    WHERE "migration_name" = ${migrationName}
      AND "finished_at" IS NULL
      AND "rolled_back_at" IS NULL
    LIMIT 1
  `;

  if (failedMigrations.length === 0) {
    console.log(`No active failed ${migrationName} migration to reconcile.`);
    process.exitCode = 0;
  } else {
    const columns = await prisma.$queryRaw`
      SELECT
        "column_name" AS "columnName",
        "data_type" AS "dataType",
        "udt_name" AS "udtName",
        "is_nullable" AS "isNullable"
      FROM "information_schema"."columns"
      WHERE "table_schema" = current_schema()
        AND "table_name" = 'CatalogSyncJob'
      ORDER BY "ordinal_position"
    `;

    const indexes = await prisma.$queryRaw`
      SELECT
        index_class.relname AS "indexName",
        index_metadata.indisunique AS "isUnique",
        index_metadata.indisprimary AS "isPrimary",
        array_agg(attribute.attname ORDER BY index_key.ordinality)
          FILTER (WHERE attribute.attname IS NOT NULL) AS "columns"
      FROM pg_class AS table_class
      JOIN pg_namespace AS namespace
        ON namespace.oid = table_class.relnamespace
      JOIN pg_index AS index_metadata
        ON index_metadata.indrelid = table_class.oid
      JOIN pg_class AS index_class
        ON index_class.oid = index_metadata.indexrelid
      CROSS JOIN LATERAL unnest(index_metadata.indkey)
        WITH ORDINALITY AS index_key(attnum, ordinality)
      LEFT JOIN pg_attribute AS attribute
        ON attribute.attrelid = table_class.oid
        AND attribute.attnum = index_key.attnum
      WHERE namespace.nspname = current_schema()
        AND table_class.relname = 'CatalogSyncJob'
      GROUP BY
        index_class.relname,
        index_metadata.indisunique,
        index_metadata.indisprimary
    `;

    assertExactShape(
      normalizedColumns(columns),
      expectedColumns,
      "CatalogSyncJob columns",
    );
    assertExactShape(
      normalizedIndexes(indexes),
      expectedIndexes,
      "CatalogSyncJob indexes",
    );

    await prisma.$disconnect();
    disconnected = true;

    console.log(
      `CatalogSyncJob matches ${migrationName}; reconciling the failed migration record.`,
    );

    const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
    const result = spawnSync(
      npmCommand,
      ["run", "migrate:resolve:durable-catalog"],
      {
        env: process.env,
        stdio: "inherit",
        shell: process.platform === "win32",
      },
    );

    if (result.error) {
      throw result.error;
    }

    if (result.status !== 0) {
      throw new Error(
        `Prisma migration reconciliation exited with status ${result.status}.`,
      );
    }
  }
} finally {
  if (!disconnected) {
    await prisma.$disconnect();
  }
}
