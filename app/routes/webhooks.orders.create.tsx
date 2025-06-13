import crypto from "crypto";
import prisma from "app/db.server";
import { authenticate } from "app/shopify.server";
import type { ActionFunctionArgs } from "@remix-run/node";


// export const action = async ({ request } : ActionFunctionArgs) => {
//   console.log("Webhook route hit"); // ✅ should appear first

//   try {
//   const { shop, topic, payload } = await authenticate.webhook(request);
//    console.log("Authenticated", { shop, topic }); // ✅ verify data

//     if (topic === 'ORDERS_CREATE') {
//       const storeId = shop;
//       const order = payload;
//       console.log('Webhook triggered for orders/create'); // ✅ should show
//       await prisma.event.create({
//         data: {
//           event: "conversion",
//           timestamp: new Date(order.created_at),
//           data: order.line_items,
//           storeId
//         },
//       });
//     }
//   } catch (err) {
//     console.error("Webhook failed:", err); // ✅ catch unexpected errors
//   }

//   return new Response("OK", { status: 200 });
// };

// function extractProductVariantId(id) {
//   const prefix = "gid://shopify/ProductVariant/";

//   if (id.startsWith(prefix)) {
//     return id.replace(prefix, "");
//   }

//   return id; // If it doesn't start with the prefix, just return it as is
// }

// export const action = async ({ request } : ActionFunctionArgs) => {
//   console.log("Webhook route hit");

//   try {
//     // Authenticate webhook
//     const { shop, topic, payload } = await authenticate.webhook(request);
//     console.log("Authenticated", { shop, topic });

//     if (topic === "ORDERS_CREATE") {
//       console.log("Webhook triggered for orders/create");

//       // Loop through each line item in the order
//       for (const item of payload.line_items) {
//         // Extract variantId safely first
//         const cleanedId = extractProductVariantId(item.variant_id);

//         // Look up matching event by cleanedId
//         const matchingEvent = await prisma.event.findFirst({ 
//           where: {
//             OR: [
//               { event: "upsell_impression", data: { path: "$.id", equals: `gid://shopify/ProductVariant/${cleanedId}` } },
//               { event: "upsell_add_to_cart", data: { path: "$.variant_id", equals: cleanedId } },
//             ],
//           },
//         });

//         if (matchingEvent) {
//           console.log("Matched event!", matchingEvent.id);
//           const storeId = shop;
//           const order = payload;
//           // Now create a conversion event
//           await prisma.event.create({ 
//             data: {
//               event: "conversion",
//               timestamp: new Date(order.created_at),
//               data: order.line_items,
//               storeId
//              },
//           });
//         } else {
//           console.log("No matching event for item.", cleanedId);
//         }
//       }
//     }
//   } catch (err) {
//     console.error("Webhook failed.", err);
//     return new Response("Error.", { status: 500 });
//   }

//   return new Response("OK", { status: 200 });
// };


function extractProductVariantId(id) {
  const prefix = "gid://shopify/ProductVariant/";

  // first make sure we have a string
  const strId = String(id);

  if (strId.startsWith(prefix)) {
    return strId.replace(prefix, "");
  }

  return strId;
}

export const action = async ({ request } : ActionFunctionArgs) => {
  console.log("Webhook route hit");

  try {
    // Authenticate webhook
    const { shop, topic, payload } = await authenticate.webhook(request);
    console.log("Authenticated", { shop, topic });

    if (topic === "ORDERS_CREATE") {
      console.log("Webhook triggered for orders/create");

      // Loop through each line item in the order
      for (const item of payload.line_items) {
        // Extract variantId safely first
        const cleanedId = extractProductVariantId(item.variant_id);

        // Look up matching event by cleanedId
        const matchingEvent = await prisma.event.findFirst({ 
          where: {
            OR: [
              { event: "upsell_impression", data: { path: "$.id", equals: `gid://shopify/ProductVariant/${cleanedId}` } },
              { event: "upsell_add_to_cart", data: { path: "$.variant_id", equals: cleanedId } },
            ],
          },
        });

        if (matchingEvent) {
          console.log("Matched event!", matchingEvent.id);
          const storeId = shop;
          const order = payload;

          // Now create a conversion event
          await prisma.event.create({ 
            data: {
              event: "conversion",
              timestamp: new Date(order.created_at),
              data: order.line_items,
              storeId
            },
          });
        } else {
          console.log("No matching event for item.", cleanedId);
        }
      }
    }
  } catch (err) {
    console.error("Webhook failed.", err);
    return new Response("Error.", { status: 500 });
  }

  return new Response("OK", { status: 200 });
};


