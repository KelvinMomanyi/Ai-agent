import { json } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  return json(
    { message: "Use POST to track revenue engine events." },
    { headers: corsHeaders },
  );
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const { session } = await authenticate.public.appProxy(request);
    const body = await request.json();
    const { event, timestamp, data } = body;

    if (!event || !timestamp) {
      return json(
        { error: "Missing required fields" },
        { status: 400, headers: corsHeaders },
      );
    }

    await prisma.event.create({
      data: {
        event,
        timestamp: new Date(timestamp),
        data: data || {},
        storeId: session.shop,
      },
    });

    return json({ success: true }, { headers: corsHeaders });
  } catch (error) {
    console.error("Revenue event tracking failed:", getErrorMessage(error));
    return json(
      { error: "Unable to track event" },
      { status: 500, headers: corsHeaders },
    );
  }
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
