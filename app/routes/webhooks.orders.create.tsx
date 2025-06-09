import crypto from "crypto";
import prisma from "app/db.server";
import { authenticate } from "app/shopify.server";
import type { ActionFunctionArgs } from "@remix-run/node";


export const action = async ({ request } : ActionFunctionArgs) => {
  console.log("Webhook route hit"); // ✅ should appear first

  try {
    const { shop, topic, payload } = await authenticate.webhook(request);
    console.log("Authenticated", { shop, topic }); // ✅ verify data

    if (topic === 'ORDERS_CREATE') {
      const storeId = shop;
      const order = payload;
      console.log('Webhook triggered for orders/create'); // ✅ should show
      await prisma.event.create({
        data: {
          event: "conversion",
          timestamp: new Date(order.created_at),
          data: order.line_items,
          storeId
        },
      });
    }
  } catch (err) {
    console.error("Webhook failed:", err); // ✅ catch unexpected errors
  }

  return new Response("OK", { status: 200 });
};

