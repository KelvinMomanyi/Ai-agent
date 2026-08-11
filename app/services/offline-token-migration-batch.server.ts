import { Session } from "@shopify/shopify-api";
import type { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { sessionStorage } from "../shopify.server";
import { ensureExpiringOfflineToken } from "./offline-token-migration.server";

export const MAX_OFFLINE_TOKEN_MIGRATION_BATCH_SIZE = 25;

export type OfflineTokenMigrationBatchInput = {
  limit: number;
  shop?: string;
};

export async function countOfflineTokenMigrationCandidates(
  input: Pick<OfflineTokenMigrationBatchInput, "shop"> = {},
) {
  return prisma.session.count({ where: migrationCandidateWhere(input.shop) });
}

export async function migrateOfflineTokenBatch(
  input: OfflineTokenMigrationBatchInput,
) {
  const where = migrationCandidateWhere(input.shop);
  const records = await prisma.session.findMany({
    where,
    orderBy: { shop: "asc" },
    take: normalizeOfflineTokenMigrationLimit(input.limit),
  });
  const results: Array<{
    shop: string;
    status: "migrated" | "failed";
    error?: string;
  }> = [];

  for (const record of records) {
    try {
      const stored = await sessionStorage.loadSession(record.id);
      const session =
        stored ||
        new Session({
          id: record.id,
          shop: record.shop,
          state: record.state,
          isOnline: false,
          scope: record.scope || undefined,
          accessToken: record.accessToken,
        });
      await ensureExpiringOfflineToken(session, sessionStorage);
      results.push({ shop: record.shop, status: "migrated" });
    } catch (error) {
      results.push({
        shop: record.shop,
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return {
    attempted: records.length,
    migrated: results.filter(({ status }) => status === "migrated").length,
    failed: results.filter(({ status }) => status === "failed").length,
    remaining: await prisma.session.count({ where }),
    results,
  };
}

export function normalizeOfflineTokenMigrationLimit(value: unknown) {
  const requested = Number(value || MAX_OFFLINE_TOKEN_MIGRATION_BATCH_SIZE);
  return Number.isInteger(requested)
    ? Math.min(Math.max(requested, 1), MAX_OFFLINE_TOKEN_MIGRATION_BATCH_SIZE)
    : MAX_OFFLINE_TOKEN_MIGRATION_BATCH_SIZE;
}

export function isValidShopDomain(shop: string) {
  return /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop);
}

function migrationCandidateWhere(shop?: string): Prisma.SessionWhereInput {
  return {
    isOnline: false,
    expires: null,
    refreshToken: null,
    accessToken: { not: "" },
    ...(shop ? { shop } : {}),
  };
}
