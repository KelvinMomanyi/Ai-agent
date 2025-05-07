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
import { cors } from "remix-utils/cors";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*', // or restrict to specific Shopify shop domain
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const loader = async () => {


  return cors(json({ message: "Use POST method to get upsell suggestion." },{ headers: corsHeaders }));
};



// export async function loader({ request }) {
//   const { admin, session } = await shopify.authenticate.admin(request);
//   const data = await admin.rest.resources.Product.all({ session , limit:200});
  
//   return json(data);
// }



export const action = async ({ request }: ActionFunctionArgs) => {
  const { cartItems} = await request.json();
  // const { admin, session, cors} = await authenticate.admin(request);
  // const products = await fetchProducts(request);
  // console.log(products,'fetchedProducts')
  // const cache = await prisma.cachedData.findUnique({
  //   where: { key: 'productCatalog' },
  // });

  // const productData = cache ? JSON.parse(cache.value) : [];
 // const { admin } = await authenticate.public.appProxy(request); 
  // const products = await fetchProducts(request);
  // console.log(products,'fetchedProducts')
  // const graphqlQuery = `
  // query {
  //   products(first: 50) {
  //     edges {
  //       node {
  //         id
  //         title
  //         handle
  //         featuredImage {
  //           originalSrc
  //           altText
  //         }
  //       }
  //       cursor
  //     }
  //     pageInfo {
  //       hasNextPage
  //     }
  //   }
  // }
  // `;
  
  // const response = await admin.graphql(`#graphql\n${graphqlQuery}`);
  // const result = await cors(response.json());
  
  // const products = result.data.products.edges.map(({ node }) => ({
  // id: node.id,
  // title: node.title,
  // image: {
  //   src: node.featuredImage?.originalSrc || 'https://via.placeholder.com/40',
  //   alt: node.featuredImage?.altText || node.title,
  // },
  // }));
  const url = new URL(request.url);
  const shop = url.searchParams.get('shop');

  const products = await prisma.product.findMany({
      where: { shop },
      select: { productId: true, type: true },
  });

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

    const data = await cors(response.json());
    return json({ suggestion: data.choices[0].message.content }, { headers: corsHeaders });

   } catch (error) {
      console.error("Upsell generation error:", error);
      return  cors(json({ error: 'Internal Server Error' }, { status: 500, headers: corsHeaders }));
   }
};


