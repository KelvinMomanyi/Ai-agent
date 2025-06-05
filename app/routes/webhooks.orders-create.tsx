import { json } from "@remix-run/node";
import crypto from "crypto";
import prisma from "app/db.server";
import { authenticate } from "app/shopify.server";

// 🔐 Replace this with your actual Shopify app's shared secret
const SHOPIFY_SHARED_SECRET = process.env.SHOPIFY_API_SECRET || "";

export const loader = async () => {
  return json({ message: "This route is for Shopify webhooks only." });
};

// export const action = async ({ request }) => {
//  const { shop, topic, payload, admin } = await authenticate.webhook(request);
//  const storeId = shop
//  const order = payload

//   await prisma.event.create({
//     data: {
//       event: "conversion",
//       timestamp: new Date(order.created_at),
//       data: order,
//       storeId
//     },
//   });

//   return new Response("OK", { status: 200 });
// };

// export const action = async ({ request }) => {
//   try {
//     const { shop, topic, payload, admin } = await authenticate.webhook(request);
//     const storeId = shop;
//     const order = payload;
//     await prisma.event.create({
//       data: {
//         event: "conversion",
//         timestamp: new Date(order.created_at),
//         data: order,
//         storeId
//       },
//     });

//     return new Response("OK", { status: 200 });
//   } catch (error) {
//     console.error('Webhook error:', error);
//     return new Response("Error", { status: 500 });
//   }
// };



// This is the right approach
export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  
  if (topic === 'orders/create') {
    const storeId = shop;
    const order = payload;
    await prisma.event.create({
      data: {
        event: "conversion",
        timestamp: new Date(order.created_at),
        data: order,
        storeId
      },
    });;
  }
  
  return new Response("OK", { status: 200 });
};
