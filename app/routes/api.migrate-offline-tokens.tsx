import crypto from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import {
  countOfflineTokenMigrationCandidates,
  isValidShopDomain,
  migrateOfflineTokenBatch,
  normalizeOfflineTokenMigrationLimit,
} from "../services/offline-token-migration-batch.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  if (!isAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const input = await readInput(request);
  if (input instanceof Response) return input;

  if (!input.execute) {
    return noStore({
      execute: false,
      candidates: await countOfflineTokenMigrationCandidates(input),
      message: "Dry run only. Send execute=true to perform token exchange.",
    });
  }

  return noStore({
    execute: true,
    ...(await migrateOfflineTokenBatch(input)),
  });
};

async function readInput(request: Request) {
  let value: unknown = {};
  try {
    const text = await request.text();
    value = text ? JSON.parse(text) : {};
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const input = value as Record<string, unknown>;
  const shop = typeof input.shop === "string" ? input.shop.trim() : "";
  if (shop && !isValidShopDomain(shop)) {
    return Response.json({ error: "Invalid shop domain" }, { status: 400 });
  }

  const limit = normalizeOfflineTokenMigrationLimit(input.limit);
  return { execute: input.execute === true, shop: shop || undefined, limit };
}

function isAuthorized(request: Request) {
  const expected = process.env.SHOPIFY_TOKEN_MIGRATION_SECRET;
  const authorization = request.headers.get("authorization") || "";
  const supplied = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
  if (!expected || !supplied) return false;

  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return (
    expectedBuffer.length === suppliedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
}

function noStore(body: unknown) {
  return Response.json(body, {
    headers: { "Cache-Control": "no-store" },
  });
}
