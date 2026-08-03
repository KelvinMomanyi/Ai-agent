import { data as json, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import {
  getCatalogSyncProgress,
  processCatalogSyncChunk,
  startCatalogSync,
} from "../jobs/aovboost.server";
import { cacheKeys, getJsonCache } from "../redis.server";
import { authenticate } from "../shopify.server";
import { optionsResponse, withCors } from "../utils/cors.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") return optionsResponse();

  const { session } = await authenticate.admin(request);
  return json(await getCatalogSyncStatus(session.shop), { headers: withCors() });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") return optionsResponse();

  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  if (formData.get("intent") === "restart") {
    await startCatalogSync(session.shop);
  }

  try {
    const progress = await processCatalogSyncChunk(session.shop);
    return json(
      {
        ok: true,
        ...(await getCatalogSyncStatus(session.shop)),
        continue: !progress.complete && !progress.failed,
      },
      { headers: withCors() },
    );
  } catch (error) {
    console.error(
      "AOVBoost product sync failed:",
      error instanceof Error ? error.message : String(error),
    );
    return json(
      { ok: false, ...(await getCatalogSyncStatus(session.shop)) },
      { status: 500, headers: withCors() },
    );
  }
};

async function getCatalogSyncStatus(shop: string) {
  const [durableProgress, cachedProgress, productCount] = await Promise.all([
    getCatalogSyncProgress(shop),
    getJsonCache(cacheKeys.syncProgress(shop)),
    prisma.product.count({ where: { shop } }),
  ]);

  return {
    progress: durableProgress || cachedProgress,
    productCount,
    progressKey: cacheKeys.syncProgress(shop),
  };
}
