import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import { ingestStorefrontEvents } from "../models/event.server";
import type { StorefrontEvent } from "../models/session.server";
import { optionsResponse, withCors } from "../utils/cors.server";

type EventsBody = {
  sessionId?: string;
  shop?: string;
  events?: StorefrontEvent[];
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") return optionsResponse();
  return json({ ok: true }, { headers: withCors() });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") return optionsResponse();

  try {
    const body = (await request.json()) as EventsBody;
    const headerShop = request.headers.get("X-AOVBoost-Shop") || body.shop || "";
    const shop = body.shop || headerShop || "";

    if (!shop || headerShop !== shop || !(await isInstalledShop(shop))) {
      return json({ ok: false, error: "Invalid shop" }, { status: 401, headers: withCors() });
    }

    if (!body.sessionId || !Array.isArray(body.events)) {
      return json(
        { ok: false, error: "Missing sessionId or events" },
        { status: 400, headers: withCors() },
      );
    }

    await ingestStorefrontEvents({
      shop,
      sessionId: body.sessionId,
      events: body.events.map((event) => ({ ...event, shop, sessionId: body.sessionId })),
    });

    return json({ ok: true }, { headers: withCors() });
  } catch (error) {
    console.error("AOVBoost event ingestion failed:", getErrorMessage(error));
    return json({ ok: false }, { status: 500, headers: withCors() });
  }
};

async function isInstalledShop(shop: string) {
  const [session, legacyShop] = await Promise.all([
    prisma.session.findFirst({ where: { shop }, select: { id: true } }),
    prisma.shop.findUnique({ where: { shopDomain: shop }, select: { shopDomain: true } }),
  ]);

  return Boolean(session || legacyShop);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
