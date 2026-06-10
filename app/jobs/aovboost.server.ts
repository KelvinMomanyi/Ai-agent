import prisma from "../db.server";
import { cacheKeys, createWorker, queues, redis } from "../redis.server";
import { getOfferDecision } from "../ai/decisionEngine.server";
import { buildOfferCandidates, createOfferRecord } from "../models/offer.server";
import { syncProductsFromAdmin } from "../models/product.server";
import { getShopperSession, toShopperSessionSnapshot } from "../models/session.server";
import { unauthenticated } from "../shopify.server";

let workersRegistered = false;

export function registerAovboostWorkers() {
  if (workersRegistered || process.env.AOVBOOST_DISABLE_WORKERS === "true") return;
  workersRegistered = true;

  createWorker<{ sessionId: string; shop: string; trigger: string }>(
    "generate-offer",
    async (job) => {
      await generateOfferJob(job.data);
    },
  );

  createWorker<{ shop: string }>("sync-products", async (job) => {
    await syncProductsJob(job.data.shop);
  });

  createWorker<{ shop: string; productId: string }>(
    "recompute-affinity",
    async (job) => {
      const { recomputeAffinities } = await import("../models/product.server");
      await recomputeAffinities(job.data.shop, job.data.productId);
    },
  );
}

export async function enqueueProductSync(shop: string) {
  return queues.syncProductsQueue.add("sync-products", { shop });
}

export async function syncProductsJob(shop: string) {
  await redis.set(
    cacheKeys.syncProgress(shop),
    JSON.stringify({ total: 0, done: 0, status: "starting" }),
    "EX",
    600,
  );
  const { admin } = await unauthenticated.admin(shop);
  const result = await syncProductsFromAdmin(shop, admin, async (progress) => {
    await redis.set(
      cacheKeys.syncProgress(shop),
      JSON.stringify({
        total: progress.total ?? 0,
        done: progress.done,
        status: progress.status,
      }),
      "EX",
      600,
    );
  });
  await redis.set(
    cacheKeys.syncProgress(shop),
    JSON.stringify({ total: result.synced, done: result.synced, status: "complete" }),
    "EX",
    600,
  );
  return result;
}

export async function generateOfferJob(input: {
  sessionId: string;
  shop: string;
  trigger: string;
}) {
  const session = await getShopperSession(input.shop, input.sessionId);
  if (!session) return null;

  const settings = await prisma.appSettings.upsert({
    where: { shop: input.shop },
    update: {},
    create: { shop: input.shop },
  });
  const snapshot = toShopperSessionSnapshot(session);
  const currentProductId = session.viewedProductIds.at(-1);
  const candidates = await buildOfferCandidates({
    shop: input.shop,
    session: snapshot,
    currentProductId,
  });
  const decision = await getOfferDecision({
    shop: input.shop,
    session: snapshot,
    currentProductId,
    currentPageType: currentProductId ? "product" : "other",
    cartProductIds: session.cartProductIds,
    recentlyDismissedWidgets: [],
    settings,
    candidates,
    trigger: {
      type: input.trigger,
    },
  });

  return createOfferRecord({
    shop: input.shop,
    sessionId: session.id,
    decision,
    triggerContext: { trigger: input.trigger, session: snapshot },
  });
}
