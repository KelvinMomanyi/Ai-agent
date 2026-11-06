import crypto from "node:crypto";
import prisma from "../db.server";
import { refreshCatalogCache } from "../models/catalogCache.server";
import {
  pruneDeletedProducts,
  recomputeInitialAffinityBatch,
  syncProductsPageFromAdmin,
} from "../models/product.server";
import { cacheKeys, redis } from "../redis.server";
import { unauthenticated } from "../shopify.server";
import { schedulePairingDrain } from "./pairingAutopilot.server";

const LEASE_SECONDS = 90;

export async function startCatalogSync(
  shop: string,
  options: { restart?: boolean } = {},
) {
  const job = await prisma.catalogSyncJob
    .upsert({
      where: { shop },
      update:
        options.restart === false
          ? {}
          : {
              phase: "fetching",
              cursor: null,
              syncedProductIds: [],
              syncedCount: 0,
              affinityOffset: 0,
              affinityTotal: 0,
              error: null,
              leaseToken: null,
              leaseUntil: null,
              startedAt: new Date(),
            },
      create: { shop },
    })
    .catch(async (error: unknown) => {
      // Prisma may emulate an empty-update upsert. If another request won the
      // unique shop insert, read its job instead of restarting or clearing a lease.
      if (
        options.restart === false &&
        (error as { code?: string })?.code === "P2002"
      ) {
        const existing = await prisma.catalogSyncJob.findUnique({
          where: { shop },
        });
        if (existing) return existing;
      }
      throw error;
    });
  await publishProgress(job);
  return job;
}

export async function ensureInitialCatalogSync(shop: string) {
  let job = await prisma.catalogSyncJob.findUnique({ where: { shop } });
  if (!job && (await prisma.product.count({ where: { shop } })) === 0) {
    // Concurrent first loads must not reset another request's cursor or lease.
    job = await startCatalogSync(shop, { restart: false });
  }
  return job ? toProgress(job) : null;
}

export async function resumeCatalogSyncOnAdminEntry(shop: string, admin: any) {
  const progress = await ensureInitialCatalogSync(shop);
  if (!progress || progress.complete || progress.failed) return progress;
  return processCatalogSyncChunk(shop, admin);
}

export async function processCatalogSyncChunk(shop: string, adminClient?: any) {
  let job = await prisma.catalogSyncJob.findUnique({ where: { shop } });
  if (!job) job = await startCatalogSync(shop, { restart: false });
  if (job.phase === "complete" || job.phase === "failed") {
    return toProgress(job);
  }

  const leaseToken = crypto.randomUUID();
  const claimed = await prisma.catalogSyncJob.updateMany({
    where: {
      shop,
      OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
    },
    data: {
      leaseToken,
      leaseUntil: new Date(Date.now() + LEASE_SECONDS * 1000),
    },
  });
  if (claimed.count === 0) return { ...toProgress(job), busy: true };

  try {
    job = (await prisma.catalogSyncJob.findUnique({ where: { shop } }))!;
    if (job.phase === "fetching") {
      let admin = adminClient;
      if (!admin) {
        const auth = await unauthenticated.admin(shop);
        admin = auth.admin;
      }
      const page = await syncProductsPageFromAdmin(shop, admin, job.cursor);
      const syncedProductIds = Array.from(
        new Set([...job.syncedProductIds, ...page.productIds]),
      );
      job = await prisma.catalogSyncJob.update({
        where: { shop },
        data: {
          cursor: page.cursor,
          syncedProductIds,
          syncedCount: syncedProductIds.length,
          phase: page.hasNextPage ? "fetching" : "pruning_deleted",
        },
      });
    } else if (job.phase === "pruning_deleted") {
      await pruneDeletedProducts(shop, job.syncedProductIds);
      job = await prisma.catalogSyncJob.update({
        where: { shop },
        data: { phase: "building_affinities", affinityOffset: 0 },
      });
    } else if (job.phase === "building_affinities") {
      const result = await recomputeInitialAffinityBatch(
        shop,
        job.affinityOffset,
      );
      job = await prisma.catalogSyncJob.update({
        where: { shop },
        data: {
          affinityOffset: result.done,
          affinityTotal: result.total,
          phase: result.complete ? "catalog_refreshing" : "building_affinities",
        },
      });
    } else if (job.phase === "catalog_refreshing") {
      await refreshCatalogCache(shop);
      job = await prisma.catalogSyncJob.update({
        where: { shop },
        data: { phase: "complete" },
      });
      schedulePairingDrain(shop, { seed: true });
    }

    await publishProgress(job);
    return toProgress(job);
  } catch (error) {
    job = await prisma.catalogSyncJob.update({
      where: { shop },
      data: {
        phase: "failed",
        error: error instanceof Error ? error.message : String(error),
      },
    });
    await publishProgress(job);
    throw error;
  } finally {
    await prisma.catalogSyncJob.updateMany({
      where: { shop, leaseToken },
      data: { leaseToken: null, leaseUntil: null },
    });
  }
}

export async function getCatalogSyncProgress(shop: string) {
  const job = await prisma.catalogSyncJob.findUnique({
    where: { shop },
    select: {
      phase: true,
      syncedCount: true,
      affinityOffset: true,
      affinityTotal: true,
      error: true,
      updatedAt: true,
    },
  });
  return job ? toProgress(job) : null;
}

function toProgress(job: {
  phase: string;
  syncedCount: number;
  affinityOffset: number;
  affinityTotal: number;
  error: string | null;
  updatedAt?: Date;
}) {
  const buildingAffinities = job.phase === "building_affinities";
  return {
    status: job.phase,
    done: buildingAffinities ? job.affinityOffset : job.syncedCount,
    total: buildingAffinities ? job.affinityTotal : job.syncedCount,
    error: job.error || undefined,
    complete: job.phase === "complete",
    failed: job.phase === "failed",
    emptyCatalog: job.phase === "complete" && job.syncedCount === 0,
    updatedAt: job.updatedAt?.toISOString(),
  };
}

async function publishProgress(
  job: Parameters<typeof toProgress>[0] & { shop: string },
) {
  await redis.set(
    cacheKeys.syncProgress(job.shop),
    JSON.stringify(toProgress(job)),
    "EX",
    3600,
  );
}
