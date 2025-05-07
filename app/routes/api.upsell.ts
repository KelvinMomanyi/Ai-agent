import { json } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from 'app/shopify.server';
import { fetchProducts} from 'app/utils/fetchProductCatalog';
import { console } from 'inspector';
import shopify from '../shopify.server';
import { useLoaderData } from '@remix-run/react';
import { IndexTable, ButtonGroup, Button } from '@shopify/polaris';
import { useState } from 'react';
import prisma from 'app/db.server';

const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://teretret.myshopify.com', // or restrict to specific Shopify shop domain
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const loader = async () => {


  return json({ message: "Use POST method to get upsell suggestion." },{ headers: corsHeaders });
};



// export async function loader({ request }) {
//   const { admin, session } = await shopify.authenticate.admin(request);
//   const data = await admin.rest.resources.Product.all({ session , limit:200});
  
//   return json(data);
// }



export const action = async ({ request }: ActionFunctionArgs) => {
  const { cartItems, productItems } = await request.json();
  const { admin, session} = await authenticate.admin(request);
  // const products = await fetchProducts(request);
  // console.log(products,'fetchedProducts')
  // const cache = await prisma.cachedData.findUnique({
  //   where: { key: 'productCatalog' },
  // });

  // const productData = cache ? JSON.parse(cache.value) : [];
  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
  });
  
  const products = shop?.productCatalog ? JSON.parse(shop.productCatalog) : [];

   try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama3-70b-8192',
        messages: [
          {
            role: 'system',
            content: `You are an AI sales agent. Suggest ONE upsell product from this list that complements the cart.`,
          },
          {
            role: 'user',
            content: `Cart: ${JSON.stringify(cartItems)} Available products:${products}`,
          },
        ],
      }),
    });

    const data = await response.json();
    return json({ suggestion: data.choices[0].message.content }, { headers: corsHeaders });

   } catch (error) {
      console.error("Upsell generation error:", error);
      return  json({ error: 'Internal Server Error' }, { status: 500, headers: corsHeaders });
   }
};


