import { json } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { updateSessionSignal } from "../models/behavior-engine.server";

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
    { message: "Use POST to track behavioral events." },
    { headers: corsHeaders },
  );
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const body = await request.json();
    const { visitorId, signals, storeId } = body;

    // Use provided storeId or fallback to header if needed.
    // In a real app proxy context, you might get this from authenticate.public.appProxy(request)
    // For raw storefront API calls, we rely on the client passing the shop domain.
    const shopDomain = storeId || new URL(request.url).searchParams.get("shop");

    if (!visitorId || !signals || !Array.isArray(signals) || !shopDomain) {
      return json(
        { error: "Missing required fields (visitorId, signals, storeId)" },
        { status: 400, headers: corsHeaders },
      );
    }

    const session = await updateSessionSignal(shopDomain, visitorId, signals);

    return json({ success: true, intent: session.intentProfile }, { headers: corsHeaders });
  } catch (error) {
    console.error("Behavior tracking failed:", error instanceof Error ? error.message : String(error));
    return json(
      { error: "Unable to track behavior" },
      { status: 500, headers: corsHeaders },
    );
  }
};
