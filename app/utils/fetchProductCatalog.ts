// utils/fetchStoreProducts.ts
// utils/shopifyProducts.ts
import prisma  from '../db.server';

export async function fetchProductCatalog() {
  // Retrieve the shop and access token from your database
  const shopRecord = await prisma.shop.findFirst();

  if (!shopRecord || !shopRecord.shopDomain || !shopRecord.accessToken) {
    throw new Error('Shop credentials not found in the database.');
  }

  const shop = shopRecord.shopDomain;
  const token = shopRecord.accessToken;

  // Fetch product catalog from Shopify API
  const res = await fetch(`https://${shop}/admin/api/2023-10/products.json?limit=50`, {
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch products: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();

  return json.products.map((p: any) => ({
    title: p.title,
    price: parseFloat(p.variants[0].price),
    image: p.image?.src,
  }));
}





