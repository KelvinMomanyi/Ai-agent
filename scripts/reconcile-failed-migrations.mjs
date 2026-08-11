import { spawnSync } from "node:child_process";

import { PrismaClient } from "@prisma/client";

const durableCatalogMigration = "20260803090000_durable_catalog_sync";
const variantStatsMigration = "20260811130000_product_variant_order_stats";
const migrationDatabaseUrl = process.env.DATABASE_DIRECT_URL;

if (!migrationDatabaseUrl) {
  throw new Error(
    "DATABASE_DIRECT_URL is required to inspect the same database targeted by Prisma Migrate.",
  );
}

const durableCatalogColumns = [
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

const durableCatalogIndexes = [
  ["CatalogSyncJob_phase_updatedAt_idx", false, false, ["phase", "updatedAt"]],
  ["CatalogSyncJob_pkey", true, true, ["id"]],
  ["CatalogSyncJob_shop_key", true, false, ["shop"]],
];

const variantStatsColumns = [
  ["id", "text", "text", "NO"],
  ["shop", "text", "text", "NO"],
  ["productId", "text", "text", "NO"],
  ["variantId", "text", "text", "NO"],
  ["orderCount", "integer", "int4", "NO"],
];

const variantStatsIndexes = [
  ["ProductVariantOrderStat_pkey", true, true, ["id"]],
  ["ProductVariantOrderStat_shop_productId_idx", false, false, ["shop", "productId"]],
  [
    "ProductVariantOrderStat_shop_productId_variantId_key",
    true,
    false,
    ["shop", "productId", "variantId"],
  ],
  ["ProductVariantOrderStat_shop_variantId_idx", false, false, ["shop", "variantId"]],
];

const variantStatsForeignKeys = [
  [
    "ProductVariantOrderStat_shop_productId_fkey",
    ["shop", "productId"],
    "Product",
    ["shop", "id"],
    "c",
    "c",
  ],
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

function normalizedForeignKeys(rows) {
  return rows
    .map((row) => [
      row.constraintName,
      row.columns,
      row.referencedTable,
      row.referencedColumns,
      row.deleteAction,
      row.updateAction,
    ])
    .sort(([left], [right]) => left.localeCompare(right));
}

function assertExactShape(actual, expected, objectName) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${objectName} does not exactly match the known migration. ` +
        `Refusing to alter Prisma migration history.\n` +
        `Expected: ${JSON.stringify(expected)}\n` +
        `Actual: ${JSON.stringify(actual)}`,
    );
  }
}

function assertCompatibleSubset(actual, expected, objectName) {
  for (const actualEntry of actual) {
    const expectedEntry = expected.find(([name]) => name === actualEntry[0]);
    if (
      !expectedEntry ||
      JSON.stringify(actualEntry) !== JSON.stringify(expectedEntry)
    ) {
      throw new Error(
        `${objectName} contains an unexpected partial object. ` +
          `Refusing to retry the migration.\n` +
          `Expected subset of: ${JSON.stringify(expected)}\n` +
          `Actual: ${JSON.stringify(actual)}`,
      );
    }
  }
}

async function getFailedMigration(prisma, migrationName) {
  const rows = await prisma.$queryRaw`
    SELECT "id", "logs"
    FROM "_prisma_migrations"
    WHERE "migration_name" = ${migrationName}
      AND "finished_at" IS NULL
      AND "rolled_back_at" IS NULL
    ORDER BY "started_at" DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function getTableColumns(prisma, tableName) {
  return prisma.$queryRaw`
    SELECT
      "column_name" AS "columnName",
      "data_type" AS "dataType",
      "udt_name" AS "udtName",
      "is_nullable" AS "isNullable"
    FROM "information_schema"."columns"
    WHERE "table_schema" = current_schema()
      AND "table_name" = ${tableName}
    ORDER BY "ordinal_position"
  `;
}

async function getTableIndexes(prisma, tableName) {
  return prisma.$queryRaw`
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
      AND table_class.relname = ${tableName}
    GROUP BY
      index_class.relname,
      index_metadata.indisunique,
      index_metadata.indisprimary
  `;
}

async function getTableForeignKeys(prisma, tableName) {
  return prisma.$queryRaw`
    SELECT
      constraint_metadata.conname AS "constraintName",
      array_agg(local_attribute.attname ORDER BY constraint_key.ordinality)
        AS "columns",
      referenced_table.relname AS "referencedTable",
      array_agg(referenced_attribute.attname ORDER BY constraint_key.ordinality)
        AS "referencedColumns",
      constraint_metadata.confdeltype::text AS "deleteAction",
      constraint_metadata.confupdtype::text AS "updateAction"
    FROM pg_constraint AS constraint_metadata
    JOIN pg_class AS table_class
      ON table_class.oid = constraint_metadata.conrelid
    JOIN pg_namespace AS namespace
      ON namespace.oid = table_class.relnamespace
    JOIN pg_class AS referenced_table
      ON referenced_table.oid = constraint_metadata.confrelid
    CROSS JOIN LATERAL unnest(
      constraint_metadata.conkey,
      constraint_metadata.confkey
    ) WITH ORDINALITY AS constraint_key(
      local_attnum,
      referenced_attnum,
      ordinality
    )
    JOIN pg_attribute AS local_attribute
      ON local_attribute.attrelid = table_class.oid
      AND local_attribute.attnum = constraint_key.local_attnum
    JOIN pg_attribute AS referenced_attribute
      ON referenced_attribute.attrelid = referenced_table.oid
      AND referenced_attribute.attnum = constraint_key.referenced_attnum
    WHERE constraint_metadata.contype = 'f'
      AND namespace.nspname = current_schema()
      AND table_class.relname = ${tableName}
    GROUP BY
      constraint_metadata.conname,
      referenced_table.relname,
      constraint_metadata.confdeltype,
      constraint_metadata.confupdtype
  `;
}

function runNpmScript(scriptName) {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npmCommand, ["run", scriptName], {
    env: process.env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `Prisma migration reconciliation exited with status ${result.status}.`,
    );
  }
}

const prisma = new PrismaClient({ datasourceUrl: migrationDatabaseUrl });
const resolutions = [];

try {
  const failedDurableCatalog = await getFailedMigration(
    prisma,
    durableCatalogMigration,
  );

  if (failedDurableCatalog) {
    const columns = normalizedColumns(
      await getTableColumns(prisma, "CatalogSyncJob"),
    );
    const indexes = normalizedIndexes(
      await getTableIndexes(prisma, "CatalogSyncJob"),
    );

    assertExactShape(columns, durableCatalogColumns, "CatalogSyncJob columns");
    assertExactShape(indexes, durableCatalogIndexes, "CatalogSyncJob indexes");
    resolutions.push({
      message: `CatalogSyncJob matches ${durableCatalogMigration}; marking it applied.`,
      scriptName: "migrate:resolve:durable-catalog",
    });
  }

  const failedVariantStats = await getFailedMigration(
    prisma,
    variantStatsMigration,
  );

  if (failedVariantStats) {
    const logs = String(failedVariantStats.logs ?? "");
    const isKnownJsonOperatorFailure =
      logs.includes("operator does not exist: text ->> unknown") ||
      (logs.includes("42883") && logs.includes("line.item"));

    if (!isKnownJsonOperatorFailure) {
      throw new Error(
        `${variantStatsMigration} failed for an unexpected reason. ` +
          "Refusing to alter its migration record.",
      );
    }

    const columns = normalizedColumns(
      await getTableColumns(prisma, "ProductVariantOrderStat"),
    );
    const indexes = normalizedIndexes(
      await getTableIndexes(prisma, "ProductVariantOrderStat"),
    );
    const foreignKeys = normalizedForeignKeys(
      await getTableForeignKeys(prisma, "ProductVariantOrderStat"),
    );

    if (columns.length > 0) {
      assertExactShape(
        columns,
        variantStatsColumns,
        "ProductVariantOrderStat columns",
      );
      assertCompatibleSubset(
        indexes,
        variantStatsIndexes,
        "ProductVariantOrderStat indexes",
      );
      assertCompatibleSubset(
        foreignKeys,
        variantStatsForeignKeys,
        "ProductVariantOrderStat foreign keys",
      );
    } else {
      assertExactShape(indexes, [], "ProductVariantOrderStat indexes");
      assertExactShape(
        foreignKeys,
        [],
        "ProductVariantOrderStat foreign keys",
      );
    }

    resolutions.push({
      message:
        `${variantStatsMigration} has only the known JSON operator failure; ` +
        "marking it rolled back so the corrected idempotent migration can retry.",
      scriptName: "migrate:rollback:variant-stats",
    });
  }
} finally {
  await prisma.$disconnect();
}

if (resolutions.length === 0) {
  console.log("No recognized failed Prisma migrations to reconcile.");
}

for (const resolution of resolutions) {
  console.log(resolution.message);
  runNpmScript(resolution.scriptName);
}
