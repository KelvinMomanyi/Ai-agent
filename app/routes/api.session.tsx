import { json, type LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import {
  isStorefrontAuthError,
  issueStorefrontSession,
  logStorefrontAuthError,
  verifyAppProxyRequest,
} from "../utils/storefrontAuth.server";
import { optionsResponse, withCors } from "../utils/cors.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") return optionsResponse();

  try {
    const { shop } = verifyAppProxyRequest(request);
    if (!shop || !(await isInstalledShop(shop))) {
      return json({ error: "Invalid shop" }, { status: 401, headers: withCors() });
    }

    return json(issueStorefrontSession(shop), {
      headers: withCors({ "Cache-Control": "no-store" }),
    });
  } catch (error) {
    const status = isStorefrontAuthError(error) ? error.status : 500;
    if (isStorefrontAuthError(error)) {
      logStorefrontAuthError(request, "api.session", error);
    }
    return json({ error: "Unauthorized" }, { status, headers: withCors() });
  }
};

async function isInstalledShop(shop: string) {
  const [session, legacyShop] = await Promise.all([
    prisma.session.findFirst({ where: { shop }, select: { id: true } }),
    prisma.shop.findUnique({ where: { shopDomain: shop }, select: { shopDomain: true } }),
  ]);

  return Boolean(session || legacyShop);
}
