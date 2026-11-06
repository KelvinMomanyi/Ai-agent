import { WebhookValidationErrorReason } from "@shopify/shopify-api";
import { getTokenApi } from "./offline-token-migration.server";

const DATA_ONLY_TOPICS = new Set([
  "app/uninstalled",
  "shop/redact",
  "customers/data_request",
  "customers/redact",
  "app/scopes_update",
  "app_subscriptions/update",
]);

type WebhookData = { shop: string; topic: string; payload: unknown };

export async function authenticateDataWebhook(
  request: Request,
  authenticateWithSession: (request: Request) => Promise<WebhookData>,
): Promise<WebhookData> {
  if (request.method !== "POST") {
    throw new Response(null, { status: 405 });
  }

  // The header selects the authentication path only. No handler receives data
  // until the library has validated the signature and required webhook headers.
  const topic = request.headers.get("x-shopify-topic")?.toLowerCase() || "";
  if (!DATA_ONLY_TOPICS.has(topic)) return authenticateWithSession(request);

  const rawBody = await request.text();
  const validation = await getTokenApi().webhooks.validate({
    rawBody,
    rawRequest: request,
  });
  if (!validation.valid) {
    throw new Response(null, {
      status:
        validation.reason === WebhookValidationErrorReason.InvalidHmac
          ? 401
          : 400,
    });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw new Response(null, { status: 400 });
  }
  return { shop: validation.domain, topic: validation.topic, payload };
}
