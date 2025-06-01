import { json } from "@remix-run/node";
import crypto from "crypto";
import prisma from "app/db.server";

// 🔐 Replace this with your actual Shopify app's shared secret
const SHOPIFY_SHARED_SECRET = process.env.SHOPIFY_SHARED_SECRET || "";

export const action = async ({ request }) => {
  const rawBody = await request.text();
  const hmacHeader = request.headers.get("x-shopify-hmac-sha256");

  if (!hmacHeader) {
    return json({ error: "Missing HMAC header" }, { status: 401 });
  }

  // Validate HMAC
  const generatedHmac = crypto
    .createHmac("sha256", SHOPIFY_SHARED_SECRET)
    .update(rawBody, "utf8")
    .digest("base64");

  const isValid = crypto.timingSafeEqual(
    Buffer.from(generatedHmac, "utf8"),
    Buffer.from(hmacHeader, "utf8")
  );

  if (!isValid) {
    return json({ error: "Invalid webhook signature" }, { status: 401 });
  }

  // If valid, parse and save the order
  const order = JSON.parse(rawBody);

  await prisma.event.create({
    data: {
      event: "conversion",
      timestamp: new Date(order.created_at),
      data: order,
    },
  });

  return new Response("OK", { status: 200 });
};
