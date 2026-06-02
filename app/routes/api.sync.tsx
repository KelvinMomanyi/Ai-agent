import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { enqueueProductSync } from "../jobs/aovboost.server";
import { cacheKeys, getJsonCache, setJsonCache } from "../redis.server";
import { authenticate } from "../shopify.server";
import { optionsResponse, withCors } from "../utils/cors.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") return optionsResponse();

  const { session } = await authenticate.admin(request);
  const progress = await getJsonCache(cacheKeys.syncProgress(session.shop));
  return json({ progress }, { headers: withCors() });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") return optionsResponse();

  const { session } = await authenticate.admin(request);
  await setJsonCache(
    cacheKeys.syncProgress(session.shop),
    { total: 0, done: 0, status: "queued" },
    600,
  );
  const job = await enqueueProductSync(session.shop);

  return json(
    { ok: true, jobId: job.id, progressKey: cacheKeys.syncProgress(session.shop) },
    { headers: withCors() },
  );
};
