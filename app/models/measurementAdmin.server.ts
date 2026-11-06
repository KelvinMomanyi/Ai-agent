import { data, type ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { redis } from "../redis.server";
export async function pauseCartRecommendationsAction({
  request,
}: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  if ((await request.formData()).get("intent") !== "pause_recommendations")
    return new Response("Unknown action", { status: 400 });
  await prisma.appSettings.updateMany({
    where: { shop: session.shop },
    data: {
      upsellEnabled: false,
      holdoutEnabled: false,
      holdoutVersion: { increment: 1 },
    },
  });
  await Promise.all([
    redis.del(`settings:${session.shop}`),
    redis.del(`public-settings:${session.shop}`),
  ]);
  return data({ ok: true });
}
