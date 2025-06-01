import type { ActionFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "app/db.server";
import { authenticate } from "../shopify.server";
// Simple in-memory store (replace with DB)
let events: any[] = [];

export function getAllEvents() {
  return events;
}

// export const action = async ({ request }) => {
//   const body = await request.json();

//   const { event, timestamp, data } = body;

//   if (!event || !timestamp) {
//     return json({ error: "Missing required fields" }, { status: 400 });
//   }

//   await prisma.event.create({
//     data: {
//       event,
//       timestamp: new Date(timestamp),
//       data,
      
//     },
//   });

//   return json({ success: true });
// };

// import { json } from "@remix-run/node";
// import prisma from "../db.server";

// export const action = async ({ request }) => {
//   // 1. Authenticate and extract session
//   const { admin, session } = await authenticate.admin(request);

//   // 2. Parse request body
//   const body = await request.json();
//   const { event, timestamp, data } = body;

//   // 3. Validate required fields
//   if (!event || !timestamp) {
//     return json({ error: "Missing required fields" }, { status: 400 });
//   }

//   // 4. Get storeId from session
//   const storeId = session?.shop;

//   if (!storeId) {
//     return json({ error: "Missing storeId from session" }, { status: 400 });
//   }

//   // 5. Store the event
//   await prisma.event.create({
//     data: {
//       event,
//       timestamp: new Date(timestamp),
//       data,
//       storeId,
//     },
//   });

//   return json({ success: true });
// };


import { json } from "@remix-run/node";
import prisma from "../db.server";

export const action = async ({ request }) => {
  const body = await request.json();
  const { admin, session } = await authenticate.admin(request);

  const { event, timestamp, data } = body;
  console.log(session.shop, 'sessionshop')
  if (!event || !timestamp) {
    return json({ error: "Missing required fields" }, { status: 400 });
  }

  // Try to get shop from URL if session is not present
  const url = new URL(request.url);
  const fallbackShop = url.searchParams.get("shop");
  //const storeId = session.shop
 // const storeId = sessionShop || fallbackShop;

  //if (!storeId) {
 //   return json({ error: "Missing storeId (session or ?shop= param)" }, { status: 400 });
  //}
   const storeId =  data?.shop;
  
  await prisma.event.create({
    data: {
      event,
      timestamp: new Date(timestamp),
      data,
      storeId // scoped per merchant
    },
  });
  

  return json({ success: true });
};
