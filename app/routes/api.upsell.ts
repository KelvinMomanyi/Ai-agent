// import { json } from '@remix-run/node';
// import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
// import { authenticate } from 'app/shopify.server';
// import shopify from '../shopify.server';

// const corsHeaders = {
//   'Access-Control-Allow-Origin': '*',
//   'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
//   'Access-Control-Allow-Headers': 'Content-Type',
// };

// export const loader = async ({ request }: LoaderFunctionArgs) => {
//   if (request.method === 'OPTIONS') {
//     return new Response(null, { status: 204, headers: corsHeaders });
//   }

//   return json({ message: "Use POST method to get upsell suggestion." }, { headers: corsHeaders });
// };

// export const action = async ({ request }: ActionFunctionArgs) => {
//   if (request.method === 'OPTIONS') {
//     return new Response(null, { status: 204, headers: corsHeaders });
//   }

//   try {
//     const { cartItems } = await request.json();
//     const { session, admin } = await authenticate.public.appProxy(request);

//           const graphqlQuery = `
//               query {
//                 products(first: 50) {
//                   edges {
//                     node {
//                       id
//                       title
//                       handle
//                       featuredImage {
//                         originalSrc
//                         altText
//                       }
//                     }
//                     cursor
//                   }
//                   pageInfo {
//                     hasNextPage
//                   }
//                 }
//               }
//               `;
        
//         const productResponse = await admin.graphql(`#graphql\n${graphqlQuery}`);
//         const result = await productResponse.json();
        
//         const products = result.data.products.edges.map(({ node }) => ({
//         id: node.id,
//         title: node.title,
//         image: {
//           src: node.featuredImage?.originalSrc || 'https://via.placeholder.com/40',
//           alt: node.featuredImage?.altText || node.title,
//         },
//         }));
//     const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
//       method: 'POST',
//       headers: {
//         Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
//         'Content-Type': 'application/json',
//       },
//       body: JSON.stringify({
//         model: 'llama3-70b-8192',
//         // messages: [
//         //   // {
//         //   //   role: 'system',
//         //   //   content: `You are an AI sales agent. Suggest ONE upsell product from this list that complements the cart.`,
//         //   // },
//         //   // {
//         //   //   role: 'user',
//         //   //   content: `Cart: ${JSON.stringify(cartItems)} Available products: ${JSON.stringify(products)}`,
//         //   // },
//         //   {
//         //     role: 'system',
//         //     content: `You are an AI sales agent. From the available products, suggest ONE upsell item that complements the cart contents. Respond in a friendly, persuasive marketing tone. Say something like: "Customers who bought [cart item] also loved [upsell product] because it perfectly complements their purchase." Keep the tone helpful and convincing, like a seasoned salesperson offering great advice.`,
//         //   },
//         //   {
//         //     role: 'user',
//         //     content: `Cart: ${JSON.stringify(cartItems)} Available products: ${JSON.stringify(products)}`,
//         //   }
          
//         // ],
//         messages: [
//           {
//             role: 'system',
//             content: `
//               You are an AI sales agent. From the available products, suggest ONE upsell item that complements the cart contents.
//               Respond in a friendly, persuasive marketing tone.
//               Say something like: "Customers who bought [cart item] also loved [upsell product] because it perfectly complements their purchase."
        
//               In addition to the marketing message, return a JSON object with the following structure:
//               {
//                 "id": "[Variant ID of the upsell product]",
//                 "title": "[Product title]",
//                 "image": "[Image URL or path]",
//                 "price": "[Price as a number]",
//                 "message": "[Persuasive upsell message]"
//               }
        
//               This will be used to show the upsell product visually on the frontend. Keep the tone helpful and convincing, like a seasoned salesperson offering great advice.
//             `,
//           },
//           {
//             role: 'user',
//             content: `Cart: ${JSON.stringify(cartItems)} Available products: ${JSON.stringify(products)}`,
//           }
//         ]         
//       }),
//     });

//     const data = await response.json();

//     return json({ suggestion: data.choices[0].message.content }, { headers: corsHeaders });

//   } catch (error) {
//     console.error("Upsell generation error:", error);
//     return json({ error: 'Internal Server Error' }, { status: 500, headers: corsHeaders });
//   }
// };
import { json } from '@remix-run/node';
import type { ActionFunctionArgs } from '@remix-run/node';
import { authenticate } from 'app/shopify.server';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const { cartItems } = await request.json();
    const { session, admin } = await authenticate.public.appProxy(request);

    // ✅ Updated GraphQL query with product variants
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
              variants(first: 1) {
                edges {
                  node {
                    id
                    price
                  }
                }
              }
            }
          }
        }
      }
    `;

    const productResponse = await admin.graphql(`#graphql\n${graphqlQuery}`);
    const result = await productResponse.json();

    // ✅ Format products with variant ID and price
    const products = result.data.products.edges.map(({ node }) => {
      const variant = node.variants.edges[0]?.node;

      return {
        id: variant?.id, // This is a variant ID: gid://shopify/ProductVariant/...
        title: node.title,
        price: variant?.price || "0.00",
        image: {
          src: node.featuredImage?.originalSrc || 'https://via.placeholder.com/40',
          alt: node.featuredImage?.altText || node.title,
        },
      };
    }).filter(product => product.id); // Filter out products with no variant

    // 🧠 Call the AI model with upsell prompt
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama3-70b-8192',
        // messages: [
        //   {
        //     role: 'system',
        //     content: `
        //       You are an AI sales agent. From the available products, suggest ONE upsell item that complements the cart contents.
        //       Respond in a friendly, persuasive marketing tone.
        //       Example message: "Customers who bought [cart item] also loved [upsell product] because it perfectly complements their purchase."

        //       Return a JSON object like this:
        //       {
        //         "id": "[Variant ID of the upsell product]",
        //         "title": "[Product title]",
        //         "image": "[Image URL or path]",
        //         "price": "[Price as a number]",
        //         "message": "[Persuasive upsell message]"
        //       }

        //       This will be used to show the upsell product visually on the frontend. Keep the tone helpful and convincing, like a seasoned salesperson offering great advice.
        //     `,
        //   },
        //   {
        //     role: 'user',
        //     content: `Cart: ${JSON.stringify(cartItems)} Available products: ${JSON.stringify(products)}`
        //   }
        // ]
        // messages: [
        //     {
        //       role: 'system',
        //       content: `
        //         You are an AI sales agent. From the available products, suggest ONE upsell item that complements the cart contents.
        //         Respond in a friendly, persuasive marketing tone.
        //         Say something like: "Customers who bought [cart item] also loved [upsell product] because it perfectly complements their purchase."
          
        //         In addition to the marketing message, return a JSON object with the following structure:
        //         {
        //           "id": "[Variant ID of the upsell product]",
        //           "title": "[Product title]",
        //           "image": "[Image URL or path]",
        //           "price": "[Price as a number]",
        //           "message": "[Persuasive upsell message]"
        //         }
          
        //         This will be used to show the upsell product visually on the frontend. Keep the tone helpful and convincing, like a seasoned salesperson offering great advice.
        //       `,
        //     },
        //     {
        //       role: 'user',
        //       content: `Cart: ${JSON.stringify(cartItems)} Available products: ${JSON.stringify(products)}`,
        //     }
        //   ]   
        messages: [
          {
            role: 'system',
            content: `
              You are an experienced and persuasive sales agent for a high-end online store.
        
              Your goal is to recommend ONE highly relevant upsell product from the available list that truly complements the items in the customer's cart.
        
              Your response must:
              - Be written in a friendly, professional, and confident tone.
              - Use emotional or persuasive language to explain *why* this product is a perfect match.
              - Highlight benefits, compatibility, or how it enhances the cart item(s).
              - Use sales techniques such as social proof, urgency, or value ("Customers love this with...").
              - Sound like a real salesperson — not a robot.
        
              ✅ Format your reply **as a single JSON object**, like this:
              {
                "id": "[Variant ID of the upsell product]",
                "title": "[Product title]",
                "image": "[Image URL or path]",
                "price": "[Price as a number]",
                "message": "[Persuasive and emotionally engaging upsell message]"
              }
        
              ❗Do NOT suggest unrelated products. Only choose products that clearly complement the cart contents based on title, category, or image.
        
              Example message:
              "If you’re picking up the [cart item], don’t miss out on the [upsell product] — it’s a perfect match that adds style, comfort, or function. Customers who bought this combo absolutely love the pairing!"
        
              Focus on helpful upselling, not hard selling. Be human. Be smart.
            `,
          },
          {
            role: 'user',
            content: `Cart: ${JSON.stringify(cartItems)} Available products: ${JSON.stringify(products)}`
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
