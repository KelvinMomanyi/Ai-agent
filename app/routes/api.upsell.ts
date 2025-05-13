import { json } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from 'app/shopify.server';
import shopify from '../shopify.server';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  return json({ message: "Use POST method to get upsell suggestion." }, { headers: corsHeaders });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const { cartItems } = await request.json();
    const { session, admin } = await authenticate.public.appProxy(request);

          const graphqlQuery = `
              query {
                products(first: 50) {
                  edges {
                    node {
                      id
                      title
                      handle
                      featuredImage {
                        originalSrc
                        altText
                      }
                    }
                    cursor
                  }
                  pageInfo {
                    hasNextPage
                  }
                }
              }
              `;
        
        const productResponse = await admin.graphql(`#graphql\n${graphqlQuery}`);
        const result = await productResponse.json();
        
        const products = result.data.products.edges.map(({ node }) => ({
        id: node.id,
        title: node.title,
        image: {
          src: node.featuredImage?.originalSrc || 'https://via.placeholder.com/40',
          alt: node.featuredImage?.altText || node.title,
        },
        }));
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama3-70b-8192',
        // messages: [
        //   // {
        //   //   role: 'system',
        //   //   content: `You are an AI sales agent. Suggest ONE upsell product from this list that complements the cart.`,
        //   // },
        //   // {
        //   //   role: 'user',
        //   //   content: `Cart: ${JSON.stringify(cartItems)} Available products: ${JSON.stringify(products)}`,
        //   // },
        //   {
        //     role: 'system',
        //     content: `You are an AI sales agent. From the available products, suggest ONE upsell item that complements the cart contents. Respond in a friendly, persuasive marketing tone. Say something like: "Customers who bought [cart item] also loved [upsell product] because it perfectly complements their purchase." Keep the tone helpful and convincing, like a seasoned salesperson offering great advice.`,
        //   },
        //   {
        //     role: 'user',
        //     content: `Cart: ${JSON.stringify(cartItems)} Available products: ${JSON.stringify(products)}`,
        //   }
          
        // ],
        messages: [
          {
            role: 'system',
            content: `
              You are an AI sales agent. From the available products, suggest ONE upsell item that complements the cart contents.
              Respond in a friendly, persuasive marketing tone.
              Say something like: "Customers who bought [cart item] also loved [upsell product] because it perfectly complements their purchase."
        
              In addition to the marketing message, return a JSON object with the following structure:
              {
                "id": "[Variant ID of the upsell product]",
                "title": "[Product title]",
                "image": "[Image URL or path]",
                "price": "[Price as a number]",
                "message": "[Persuasive upsell message]"
              }
        
              This will be used to show the upsell product visually on the frontend. Keep the tone helpful and convincing, like a seasoned salesperson offering great advice.
            `,
          },
          {
            role: 'user',
            content: `Cart: ${JSON.stringify(cartItems)} Available products: ${JSON.stringify(products)}`,
          }
        ]         
      }),
    });

    const data = await response.json();

    return json({ suggestion: data.choices[0].message.content }, { headers: corsHeaders });

  } catch (error) {
    console.error("Upsell generation error:", error);
    return json({ error: 'Internal Server Error' }, { status: 500, headers: corsHeaders });
  }
};
