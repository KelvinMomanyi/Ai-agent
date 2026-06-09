export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, X-AOVBoost-Shop, X-Shopify-Shop-Domain, X-Shopify-Topic, X-Shopify-Hmac-Sha256",
};

export function optionsResponse() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export function withCors(headers?: HeadersInit) {
  return {
    ...corsHeaders,
    ...(headers || {}),
  };
}
