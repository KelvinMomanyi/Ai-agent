import crypto from "crypto";
import prisma from "app/db.server";
import { authenticate } from "app/shopify.server";
import type { ActionFunctionArgs } from "@remix-run/node";
import { v4 as uuidv4 } from "uuid";

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


// function extractProductVariantId(id) {
//   const prefix = "gid://shopify/ProductVariant/";

//   // first make sure we have a string
//   const strId = String(id);

//   if (strId.startsWith(prefix)) {
//     return strId.replace(prefix, "");
//   }

//   return strId;
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
//             },
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
//         // const matchingEvent = await prisma.event.findFirst({ 
//         //   where: {
//         //     OR: [
//         //       { 
//         //         event: "upsell_impression", 
//         //         data: { 
//         //           path: ["id"], 
//         //           equals: `gid://shopify/ProductVariant/${cleanedId}` 
//         //         } 
//         //       },
//         //       { 
//         //         event: "upsell_add_to_cart", 
//         //         data: { 
//         //           path: ["variant_id"], 
//         //           equals: cleanedId 
//         //         } 
//         //       },
//         //     ],
//         //   },
//         // });
//         const matchingEvent = await prisma.event.findFirst({ 
//           where: {
//             event: "upsell_impression", 
//             data: { 
//               path: ["id"], 
//               equals: `gid://shopify/ProductVariant/${cleanedId}` 
//             }
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
//             },
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
// export const action = async ({ request } : ActionFunctionArgs) => {
//   console.log("Webhook route hit");
  
//   try {
//     const { shop, topic, payload } = await authenticate.webhook(request);
//     console.log("Authenticated", { shop, topic });
    
//     if (topic === "ORDERS_CREATE") {
//       console.log("Webhook triggered for orders/create");
      
//       // Loop through each line item in the order
//       for (const item of payload.line_items) {
//         const cleanedId = extractProductVariantId(item.variant_id);
        
//         // Look up matching upsell impression event
//         const matchingEvent = await prisma.event.findFirst({
//           where: {
//           //   event: "upsell_impression",
//           //   data: {
//           //     path: ["id"],
//           //     equals: `gid://shopify/ProductVariant/${cleanedId}`
//           //   }
//           // },
//           event: "upsell_add_to_cart", 
//           data: { 
//             path: "$.variant_id",
//             equals: cleanedId
//            } 
//         }});
        
//         if (matchingEvent) {
//           console.log("Matched event!", matchingEvent.id);
//           const storeId = shop;
//           const order = payload;
          
//           // Create conversion event with ONLY this specific line item
//           await prisma.event.create({
//             data: {
//               event: "conversion",
//               timestamp: new Date(order.created_at),
//               data: order,
//               storeId
//             },
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
// export const action = async ({ request }: ActionFunctionArgs) => {
//   console.log("Webhook route hit");

//   try {
//     const { shop, topic, payload } = await authenticate.webhook(request);
//     console.log("Authenticated", { shop, topic });

//     if (topic === "ORDERS_CREATE") {
//       console.log("Webhook triggered for orders/create");

//       let matched = false; // flag to track if we found a match

//       // Loop through each line item
//       for (const item of payload.line_items) {
//         const cleanedId = extractProductVariantId(item.variant_id);

//         const matchingEvent = await prisma.event.findFirst({
//           where: {
//             event: "upsell_add_to_cart",
//             data: {
//               path: "$.variant_id",
//               equals: cleanedId
//             }
//           }
//         });

//         if (matchingEvent) {
//           console.log("Matched event!", matchingEvent.id);
//           matched = true;
//           break; // exit loop after first match
//         } else {
//           console.log("No matching event for item.", cleanedId);
//         }
//       }

//       // Run once if we found at least one match
//       if (matched) {
//         const storeId = shop;
//         const order = payload;

//         await prisma.event.create({
//           data: {
//             event: "conversion",
//             timestamp: new Date(order.created_at),
//             data: order,
//             storeId
//           }
//         });
//       }
//     }

//   } catch (err) {
//     console.error("Webhook failed.", err);
//     return new Response("Error.", { status: 500 });
//   }

//   return new Response("OK", { status: 200 });
// };

// export const action = async ({ request }: ActionFunctionArgs) => {
//   console.log("Webhook route hit");

//   try {
//     const { shop, topic, payload } = await authenticate.webhook(request);
//     console.log("Authenticated", { shop, topic });

//     if (topic === "ORDERS_CREATE") {
//       console.log("Webhook triggered for orders/create");

//       // Check if we've already processed this order
//       const existing = await prisma.event.findFirst({ 
//         where: { 
//           event: "conversion",
//           data: {
//             path: "$.id",
//             equals: String(payload.id)
//           }
//         }
//       });

//       if (existing) {
//         console.log("Conversion event already exists for this order.");
//         return new Response("OK", { status: 200 });
//       }

//       let matched = false;

//       // Loop through each line item
//       for (const item of payload.line_items) {
//         const cleanedId = extractProductVariantId(item.variant_id);

//         const matchingEvent = await prisma.event.findFirst({ 
//           where: { 
//             event: "upsell_add_to_cart",
//             data: {
//               path: "$.variant_id",
//               equals: cleanedId
//             }
//           }
//         });

//         if (matchingEvent) {
//           console.log("Matched event!", matchingEvent.id);
//           matched = true;
//           break;
//         } else {
//           console.log("No matching event for item.", cleanedId);
//         }
//       }

//       if (matched) {
//         console.log("Creating conversion event.");

//         await prisma.event.create({ 
//           data: {
//             event: "conversion",
//             timestamp: new Date(payload.created_at),
//             data: payload, // Store the whole order
//             storeId: shop
//           },
//         });
//       } else {
//         console.log("No matching event for this order.");
//       }
//     }

//   } catch (err) {
//     console.error("Webhook failed.", err);
//     return new Response("Error.", { status: 500 });
//   }

//   return new Response("OK", { status: 200 });
// };



// export const action = async ({ request }: ActionFunctionArgs) => {
//   console.log("Webhook route hit");

//   try {
//     const { shop, topic, payload } = await authenticate.webhook(request);
//     console.log("Authenticated", { shop, topic });

//     if (topic === "ORDERS_CREATE") {
//       console.log("Webhook triggered for orders/create");

//       // Check if we've already processed this order
//       const existing = await prisma.event.findFirst({ 
//         where: { 
//           event: "conversion",
//           data: {
//             path: "$.id",
//             equals: String(payload.id)
//           }
//         }
//       });

//       if (existing) {
//         console.log("Conversion event already exists for this order.");
//         return new Response("OK", { status: 200 });
//       }

//       let matched = false;

//       // Loop through each line item
//       for (const item of payload.line_items) {
//         const cleanedId = extractProductVariantId(item.variant_id);

//         const matchingEvent = await prisma.event.findFirst({ 
//           where: { 
//             event: "upsell_add_to_cart",
//             data: {
//               path: "$.variant_id",
//               equals: cleanedId
//             }
//           }
//         });

//         if (matchingEvent) {
//           console.log("Matched event!", matchingEvent.id);
//           matched = true;
//           break;
//         } else {
//           console.log("No matching event for item.", cleanedId);
//         }
//       }

//       if (matched) {
//         console.log("Creating conversion event.");

//         // Generate a uniqueId for this event
//         const uniqueId = uuidv4();

//         // Create conversion event
//         await prisma.event.create({ 
//           data: {
//             event: "conversion",
//             timestamp: new Date(payload.created_at),
//             data: { 
//               ...payload, 
//               uniqueId // Store this uniqueId alongside 
//             },
//             storeId: shop
//           },
//         });

//         // Now clean up duplicates (keep the earliest)
//         const duplicates = await prisma.event.findMany({ 
//           where: {
//             event: "conversion",
//             data: {
//               path: "$.uniqueId",
//               equals: uniqueId
//             },
//             NOT: { id: existing?.id }
//           },
//           orderBy: { timestamp: "asc" },
//         });

//         if (duplicates.length > 0) {
//           // Delete duplicates except for the first
//           for (let i = 1; i < duplicates.length; i++) {
//             await prisma.event.delete({ where: { id: duplicates[i].id } });
//             console.log("Deleted duplicate event.", duplicates[i].id);
//           }
//         }
//       } else {
//         console.log("No matching event for this order.");
//       }
//     }

//   } catch (err) {
//     console.error("Webhook failed.", err);
//     return new Response("Error.", { status: 500 });
//   }

//   return new Response("OK", { status: 200 });
// };




export const action = async ({ request }: ActionFunctionArgs) => {
  console.log("Webhook route hit");

  try {
    const { shop, topic, payload } = await authenticate.webhook(request);
    console.log("Authenticated", { shop, topic });

    if (topic === "ORDERS_CREATE") {
      console.log("Webhook triggered for orders/create");

      // Use the order ID as the deduplication key
      const orderId = String(payload.id);
      
      // Use upsert to prevent race conditions - this is atomic
      const result = await prisma.event.upsert({
        where: {
          // Create a unique constraint on event + orderId + storeId in your schema
          event_orderId_storeId: {
            event: "conversion",
            orderId: orderId,
            storeId: shop
          }
        },
        update: {
          // If it exists, just update the timestamp to show it was processed again
          updatedAt: new Date()
        },
        create: {
          event: "conversion",
          orderId: orderId, // Add this field to your schema
          timestamp: new Date(payload.created_at),
          data: payload,
          storeId: shop
        }
      });

      // Check if this was a new creation or just an update
      if (result.createdAt.getTime() === result.updatedAt.getTime()) {
        console.log("Created new conversion event");
        
        // Only do the matching logic for new events
        let matched = false;

        for (const item of payload.line_items) {
          const cleanedId = extractProductVariantId(item.variant_id);

          const matchingEvent = await prisma.event.findFirst({ 
            where: { 
              event: "upsell_add_to_cart",
              data: {
                path: "$.variant_id",
                equals: cleanedId
              }
            }
          });

          if (matchingEvent) {
            console.log("Matched event!", matchingEvent.id);
            matched = true;
            break;
          }
        }

        if (!matched) {
          // If no match found, delete the conversion event we just created
          await prisma.event.delete({ where: { id: result.id } });
          console.log("No matching upsell event found, deleted conversion event");
        }
      } else {
        console.log("Conversion event already existed, skipping processing");
      }
    }

  } catch (err) {
    console.error("Webhook failed.", err);
    return new Response("Error.", { status: 500 });
  }

  return new Response("OK", { status: 200 });
}


