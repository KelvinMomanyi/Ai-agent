import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import { syncProductsJob } from "../jobs/aovboost.server";
import { cacheKeys, getJsonCache, setJsonCache } from "../redis.server";
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
  await setJsonCache(
    cacheKeys.syncProgress(session.shop),
    { total: 0, done: 0, status: "queued" },
    600,
  );

  try {
    await syncProductsJob(session.shop);
    return json(
      { ok: true, ...(await getCatalogSyncStatus(session.shop)) },
      { headers: withCors() },
    );
  } catch (error) {
    await setJsonCache(
      cacheKeys.syncProgress(session.shop),
      { total: 0, done: 0, status: "failed" },
      600,
    );
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
  const [progress, productCount] = await Promise.all([
    getJsonCache(cacheKeys.syncProgress(shop)),
    prisma.product.count({ where: { shop } }),
  ]);

  return {
    progress,
    productCount,
    progressKey: cacheKeys.syncProgress(shop),
  };
}
