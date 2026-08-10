import crypto from "node:crypto";
import { Session } from "@shopify/shopify-api";
import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { ensureExpiringOfflineToken } from "../services/offline-token-migration.server";
import { sessionStorage } from "../shopify.server";

const MAX_BATCH_SIZE = 25;

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  if (!isAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const input = await readInput(request);
  if (input instanceof Response) return input;

  const where = {
    isOnline: false,
    expires: null,
    refreshToken: null,
    accessToken: { not: "" },
    ...(input.shop ? { shop: input.shop } : {}),
  };
  const total = await prisma.session.count({ where });
  if (!input.execute) {
    return noStore({
      execute: false,
      candidates: total,
      message: "Dry run only. Send execute=true to perform token exchange.",
    });
  }

  const records = await prisma.session.findMany({
    where,
    orderBy: { shop: "asc" },
    take: input.limit,
  });
  const results: Array<{
    shop: string;
    status: "migrated" | "failed";
    error?: string;
  }> = [];

  for (const record of records) {
    try {
      const stored = await sessionStorage.loadSession(record.id);
      const session =
        stored ||
        new Session({
          id: record.id,
          shop: record.shop,
          state: record.state,
          isOnline: false,
          scope: record.scope || undefined,
          accessToken: record.accessToken,
        });
      await ensureExpiringOfflineToken(session, sessionStorage);
      results.push({ shop: record.shop, status: "migrated" });
    } catch (error) {
      results.push({
        shop: record.shop,
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  const remaining = await prisma.session.count({ where });
  return noStore({
    execute: true,
    attempted: records.length,
    migrated: results.filter(({ status }) => status === "migrated").length,
    failed: results.filter(({ status }) => status === "failed").length,
    remaining,
    results,
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
  if (shop && !/^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop)) {
    return Response.json({ error: "Invalid shop domain" }, { status: 400 });
  }

  const requestedLimit = Number(input.limit || MAX_BATCH_SIZE);
  const limit = Number.isInteger(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), MAX_BATCH_SIZE)
    : MAX_BATCH_SIZE;
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
