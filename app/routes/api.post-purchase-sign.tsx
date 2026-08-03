import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { signPostPurchaseChangeset } from "../models/postPurchaseOffer.server";
import { authenticate } from "../shopify.server";

export const loader = ({ request }: LoaderFunctionArgs) =>
  request.method === "OPTIONS"
    ? new Response(null, { status: 204, headers: extensionCorsHeaders() })
    : Response.json({ error: "Method not allowed" }, { status: 405 });

export const action = async ({ request }: ActionFunctionArgs) => {
  const { sessionToken, cors } = await authenticate.public.checkout(request);
  const body = await request.json();
  const token = await signPostPurchaseChangeset({
    shop: normalizeShop(sessionToken.dest),
    referenceId: String(body.referenceId || ""),
    offerId: String(body.offerId || ""),
  });
  return token
    ? cors(Response.json({ token }))
    : cors(Response.json({ error: "Offer not found" }, { status: 404 }));
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
