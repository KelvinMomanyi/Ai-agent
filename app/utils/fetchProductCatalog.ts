// utils/fetchProductCatalog.ts
import  shopify, { authenticate }  from "../shopify.server";
import  prisma  from "../db.server"; // Ensure it's the named export
import { restResources } from "@shopify/shopify-api/rest/admin/2023-10";


export async function fetchProductCatalog(request) {
  const { session } = await authenticate.admin(request);

  // Create a session object for the shop


  // Initialize REST client using session
  const productClient = new restResources.Product({ session });

  const result = await productClient.all({
    session,
    // Optionally you can pass `ids` or any other supported params
    // ids: "632910392,921728736",
    limit: 10,
  });

  return result.map((p: any) => ({
    id: p.id,
    title: p.title,
    price: p.variants?.[0]?.price,
    image: p.image?.src,
  }));
}
