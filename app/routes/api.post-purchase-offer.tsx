import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { createPostPurchaseOffer } from "../models/postPurchaseOffer.server";
import { authenticate } from "../shopify.server";

export const loader = ({ request }: LoaderFunctionArgs) =>
  request.method === "OPTIONS"
    ? new Response(null, { status: 204, headers: extensionCorsHeaders() })
    : Response.json({ error: "Method not allowed" }, { status: 405 });

export const action = async ({ request }: ActionFunctionArgs) => {
  const { sessionToken, cors } = await authenticate.public.checkout(request);
  const body = await request.json();
  const referenceId = String(body.referenceId || "").trim();
  if (!referenceId) return cors(Response.json({ error: "Missing reference ID" }, { status: 400 }));

  const offer = await createPostPurchaseOffer({
    shop: normalizeShop(sessionToken.dest),
    referenceId,
    purchasedVariantIds: Array.isArray(body.purchasedVariantIds)
      ? body.purchasedVariantIds.map(String)
      : [],
  });
  return cors(Response.json({ offers: offer ? [offer] : [] }));
};

function normalizeShop(value: unknown) {
  return String(value || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function extensionCorsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}
