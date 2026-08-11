import crypto from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import {
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

  const url = new URL(request.url);
  const result = await migrateOfflineTokenBatch({
    limit: normalizeOfflineTokenMigrationLimit(url.searchParams.get("limit")),
  });
  return Response.json(result, {
    headers: { "Cache-Control": "no-store" },
  });
};

function isAuthorized(request: Request) {
  const expected = process.env.OFFLINE_TOKEN_MIGRATION_SECRET;
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
