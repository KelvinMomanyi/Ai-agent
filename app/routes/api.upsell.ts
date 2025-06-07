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


















// MAIN 

// import { json } from '@remix-run/node';
// import type { ActionFunctionArgs, LoaderFunctionArgs} from '@remix-run/node';
// import { authenticate } from '../shopify.server';

// const corsHeaders = {
//   'Access-Control-Allow-Origin': '*',
//   'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
//   'Access-Control-Allow-Headers': 'Content-Type',
// };


// export const action = async ({ request }: ActionFunctionArgs) => {
//   if (request.method === 'OPTIONS') {
//     return new Response(null, { status: 204, headers: corsHeaders });
//   }

//   try {
//     const { cartItems } = await request.json();
//     const { session, admin } = await authenticate.public.appProxy(request);

//     // ✅ Updated GraphQL query with product variants
//     const graphqlQuery = `
//       query {
//         products(first: 50) {
//           edges {
//             node {
//               id
//               title
//               handle
//               featuredImage {
//                 originalSrc
//                 altText
//               }
//               variants(first: 1) {
//                 edges {
//                   node {
//                     id
//                     price
//                   }
//                 }
//               }
//             }
//           }
//         }
//       }
//     `;

//     const productResponse = await admin.graphql(`#graphql\n${graphqlQuery}`);
//     const result = await productResponse.json();

//     // ✅ Format products with variant ID and price
//     const products = result.data.products.edges.map(({ node }) => {
//       const variant = node.variants.edges[0]?.node;

//       return {
//         id: variant?.id, // This is a variant ID: gid://shopify/ProductVariant/...
//         title: node.title,
//         price: variant?.price || "0.00",
//         image: {
//           src: node.featuredImage?.originalSrc || 'https://via.placeholder.com/40',
//           alt: node.featuredImage?.altText || node.title,
//         },
//       };
//     }).filter(product => product.id); // Filter out products with no variant

//     // 🧠 Call the AI model with upsell prompt
//     const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
//       method: 'POST',
//       headers: {
//         Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
//         'Content-Type': 'application/json',
//       },
//       body: JSON.stringify({
//         model: 'llama-3.3-70b-versatile',
//         // messages: [
//         //   {
//         //     role: 'system',
//         //     content: `
//         //       You are an AI sales agent. From the available products, suggest ONE upsell item that complements the cart contents.
//         //       Respond in a friendly, persuasive marketing tone.
//         //       Example message: "Customers who bought [cart item] also loved [upsell product] because it perfectly complements their purchase."

//         //       Return a JSON object like this:
//         //       {
//         //         "id": "[Variant ID of the upsell product]",
//         //         "title": "[Product title]",
//         //         "image": "[Image URL or path]",
//         //         "price": "[Price as a number]",
//         //         "message": "[Persuasive upsell message]"
//         //       }

//         //       This will be used to show the upsell product visually on the frontend. Keep the tone helpful and convincing, like a seasoned salesperson offering great advice.
//         //     `,
//         //   },
//         //   {
//         //     role: 'user',
//         //     content: `Cart: ${JSON.stringify(cartItems)} Available products: ${JSON.stringify(products)}`
//         //   }
//         // ]
//         // messages: [
//         //     {
//         //       role: 'system',
//         //       content: `
//         //         You are an AI sales agent. From the available products, suggest ONE upsell item that complements the cart contents.
//         //         Respond in a friendly, persuasive marketing tone.
//         //         Say something like: "Customers who bought [cart item] also loved [upsell product] because it perfectly complements their purchase."
          
//         //         In addition to the marketing message, return a JSON object with the following structure:
//         //         {
//         //           "id": "[Variant ID of the upsell product]",
//         //           "title": "[Product title]",
//         //           "image": "[Image URL or path]",
//         //           "price": "[Price as a number]",
//         //           "message": "[Persuasive upsell message]"
//         //         }
          
//         //         This will be used to show the upsell product visually on the frontend. Keep the tone helpful and convincing, like a seasoned salesperson offering great advice.
//         //       `,
//         //     },
//         //     {
//         //       role: 'user',
//         //       content: `Cart: ${JSON.stringify(cartItems)} Available products: ${JSON.stringify(products)}`,
//         //     }
//         //   ]   
//         messages: [
//           {
//             role: 'system',
//             content: `
//               You are an experienced and persuasive sales agent for a high-end online store.
        
//               Your goal is to recommend ONE highly relevant upsell product from the available list that truly complements the items in the customer's cart.
//               Write a very convincing marketing message on why the recommended product is a perfect complement what is already in the cart
//               Your response must:
//               - Be written in a friendly, professional, and confident tone.
//               - Use emotional or persuasive language to explain *why* this product is a perfect match.
//               - Highlight benefits, compatibility, or how it enhances the cart item(s).
//               - Use sales techniques such as social proof, urgency, or value ("Customers love this with...").
//               - Sound like a real salesperson — not a robot.
        
//               ✅ Format your reply **as a single JSON object**, like this:
//               {
//                 "id": "[Variant ID of the upsell product]",
//                 "title": "[Product title]",
//                 "image": "[Image URL or path]",
//                 "price": "[Price as a number]",
//                 "message": "[Persuasive and emotionally engaging upsell message]"
//               }
        
//               ❗Do NOT suggest unrelated products. Only choose products that clearly complement the cart contents based on title, category, or image.
        
//               Example message:
//               "If you’re picking up the [cart item], don’t miss out on the [upsell product] — it’s a perfect match that adds style, comfort, or function. Customers who bought this combo absolutely love the pairing!"
        
//               Focus on helpful upselling, not hard selling. Be human. Be smart.
//             `,
//           },
//           {
//             role: 'user',
//             content: `Cart: ${JSON.stringify(cartItems)} Available products: ${JSON.stringify(products)}`
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



// import { json } from '@remix-run/node';
// import type { ActionFunctionArgs } from '@remix-run/node';
// import { authenticate } from '../shopify.server';

// const corsHeaders = {
//   'Access-Control-Allow-Origin': '*',
//   'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
//   'Access-Control-Allow-Headers': 'Content-Type',
// };

// // Fallback function for when AI is unavailable
// const generateFallbackUpsell = (products, cartItems) => {
//   if (products.length === 0) return null;
  
//   // Simple logic: suggest first available product
//   const upsellProduct = products[0];
//   const cartItemNames = cartItems.map(item => item.title || item.product_title).join(', ');
  
//   return {
//     id: upsellProduct.id,
//     title: upsellProduct.title,
//     price: upsellProduct.price,
//     image: upsellProduct.image,
//     message: `Complete your purchase! Customers who bought ${cartItemNames} often love adding ${upsellProduct.title} to their order.`
//   };
// };

// // Multiple AI service options with fallback
// const generateAIUpsell = async (cartItems, products) => {
//   // Limit data to reduce token usage
//   const limitedProducts = products.slice(0, 8).map(p => ({
//     id: p.id,
//     title: p.title,
//     price: p.price
//   }));
  
//   const essentialCart = cartItems.map(item => ({
//     title: item.title || item.product_title,
//     quantity: item.quantity || 1
//   }));

  

//   const prompt = `You are a sales expert. Cart: ${JSON.stringify(essentialCart)}. Available: ${JSON.stringify(limitedProducts)}. 
  
//   Suggest ONE relevant upsell product. Return ONLY this JSON:
//   {"id":"variant_id","title":"product_name","price":"price","image":"product_image", message":"compelling_sales_message"}`;

//   // Try multiple services in order
//   const services = [
//     // 1. Local Ollama (fastest, no rate limits)
//     {
//       name: 'ollama',
//       url: 'http://localhost:11434/v1/chat/completions',
//       headers: { 'Content-Type': 'application/json' },
//       body: {
//         model: 'llama3.2:3b-instruct-q4_0',
//         messages: [{ role: 'user', content: prompt }],
//         stream: false
//       }
//     },
    
//     // 2. Hugging Face (free tier)
//     {
//       name: 'huggingface',
//       url: 'https://api-inference.huggingface.co/models/meta-llama/Llama-3.2-3B-Instruct',
//       headers: {
//         'Authorization': `Bearer ${process.env.HF_API_KEY}`,
//         'Content-Type': 'application/json'
//       },
//       body: { inputs: prompt, parameters: { max_new_tokens: 200 } }
//     },
    
//     // 3. Google Gemini (generous free tier)
//     {
//       name: 'gemini',
//       url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GOOGLE_API_KEY}`,
//       headers: { 'Content-Type': 'application/json' },
//       body: {
//         contents: [{ parts: [{ text: prompt }] }],
//         generationConfig: { maxOutputTokens: 200 }
//       }
//     }
//   ];

//   for (const service of services) {
//     try {
//       console.log(`Trying ${service.name} AI service...`);
      
//       const response = await fetch(service.url, {
//         method: 'POST',
//         headers: service.headers,
//         body: JSON.stringify(service.body),
//         signal: AbortSignal.timeout(8000) // 8 second timeout
//       });

//       if (!response.ok) {
//         console.log(`${service.name} failed with status ${response.status}`);
//         continue;
//       }

//       const data = await response.json();
//       let aiResponse;

//       // Parse different response formats
//       if (service.name === 'ollama') {
//         aiResponse = data.choices?.[0]?.message?.content;
//       } else if (service.name === 'huggingface') {
//         aiResponse = Array.isArray(data) ? data[0]?.generated_text : data.generated_text;
//       } else if (service.name === 'gemini') {
//         aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;
//       }
   
//       return aiResponse
//       // if (aiResponse) {
//       //   // Try to parse JSON from AI response
//       //   const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
//       //   if (jsonMatch) {
//       //     const suggestion = JSON.parse(jsonMatch[0]);
//       //     if (suggestion.id && suggestion.title && suggestion.message) {
//       //       console.log(`Success with ${service.name}`);
//       //       return suggestion;
//       //     }
//       //   }
//       // }
//     } catch (error) {
//       console.log(`${service.name} error:`, error.message);
//       continue;
//     }
//   }

//   return null; // All AI services failed
// };

// export const action = async ({ request }: ActionFunctionArgs) => {
//   if (request.method === 'OPTIONS') {
//     return new Response(null, { status: 204, headers: corsHeaders });
//   }

//   try {
//     const { cartItems } = await request.json();
//     const { session, admin } = await authenticate.public.appProxy(request);

//     // Get products from Shopify
//     const graphqlQuery = `
//       query {
//         products(first: 20) {
//           edges {
//             node {
//               id
//               title
//               handle
//               featuredImage {
//                 originalSrc
//                 altText
//               }
//               variants(first: 1) {
//                 edges {
//                   node {
//                     id
//                     price
//                   }
//                 }
//               }
//             }
//           }
//         }
//       }
//     `;

//     const productResponse = await admin.graphql(`#graphql\n${graphqlQuery}`);
//     const result = await productResponse.json();

//     if (result.errors) {
//       throw new Error(`GraphQL error: ${JSON.stringify(result.errors)}`);
//     }

//     const products = result.data.products.edges.map(({ node }) => {
//       const variant = node.variants.edges[0]?.node;
//       return {
//         id: variant?.id,
//         title: node.title,
//         price: variant?.price || "0.00",
//         image: {
//           src: node.featuredImage?.originalSrc || 'https://via.placeholder.com/40',
//           alt: node.featuredImage?.altText || node.title,
//         },
//       };
//     }).filter(product => product.id);

//     // Try AI services, fallback to simple logic
//     let suggestion = await generateAIUpsell(cartItems, products);
    
//     if (!suggestion) {
//       console.log('All AI services failed, using fallback logic');
//       suggestion = generateFallbackUpsell(products, cartItems);
//     }

//     if (!suggestion) {
//       return json({ error: 'No products available for upsell' }, { status: 404, headers: corsHeaders });
//     }

//     return json({ suggestion }, { headers: corsHeaders });

//   } catch (error) {
//     console.error("Upsell generation error:", {
//       message: error.message,
//       timestamp: new Date().toISOString()
//     });
    
//     return json({ 
//       error: 'Service temporarily unavailable',
//       suggestion: null 
//     }, { 
//       status: 500, 
//       headers: corsHeaders 
//     });
//   }
// };




import { json } from '@remix-run/node';
import type { ActionFunctionArgs } from '@remix-run/node';
import { authenticate } from '../shopify.server';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Fallback function for when AI is unavailable
const generateFallbackUpsell = (products, cartItems) => {
  if (products.length === 0) return null;
  
  // Simple logic: suggest first available product
  const upsellProduct = products[0];
  const cartItemNames = cartItems.map(item => item.title || item.product_title).join(', ');
  
  return {
    id: upsellProduct.id,
    title: upsellProduct.title,
    price: upsellProduct.price,
    image: upsellProduct.image,
    message: `Complete your purchase! Customers who bought ${cartItemNames} often love adding ${upsellProduct.title} to their order.`
  };
};

// Multiple AI service options with fallback
const generateAIUpsell = async (cartItems, products) => {
  // Limit data to reduce token usage (include image)
  const limitedProducts = products.slice(0, 8).map(p => ({
    id: p.id,
    title: p.title,
    price: p.price,
    image: p.image?.src || p.image
  }));
  
  const essentialCart = cartItems.map(item => ({
    title: item.title || item.product_title,
    quantity: item.quantity || 1
  }));

  const prompt = `You are a sales expert. Cart: ${JSON.stringify(essentialCart)}. Available: ${JSON.stringify(limitedProducts)}. 
  
  Suggest ONE relevant upsell product. Return ONLY this JSON:
  {"id":"variant_id","title":"product_name","price":"price","image":"product_image_url","message":"compelling_sales_message"}`;

  // Try multiple services in order
  const services = [
    // 1. Local Ollama (fastest, no rate limits)
    {
      name: 'ollama',
      url: 'https://probable-space-umbrella-7q9rwrv5vx5hxqp5-11434.app.github.dev/',
      headers: {
        'Content-Type': 'application/json'
      },
      body: {
        model: 'phi3:mini',
        prompt: prompt,
        stream: false
      }
    },
    
    // 2. Hugging Face (free tier)
    {
      name: 'huggingface',
      url: 'https://api-inference.huggingface.co/novita/v1/chat/completions',
      headers: {
        'Authorization': `Bearer ${process.env.HF_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: {
        provider: "novita",
        model: "meta-llama/Llama-3.2-3B-Instruct",
        messages: [
          {
            role: "user",
            content: prompt
          }
        ],
        max_tokens: 200,
        temperature: 0.7
      }
    },
    
    // 3. Google Gemini (generous free tier)
    {
      name: 'gemini',
      url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GOOGLE_API_KEY}`,
      headers: { 'Content-Type': 'application/json' },
      body: {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 200 }
      }
    },
    // 4. Groq (generous free tier)
    {
      name: 'groq',
      url: 'https://api.groq.com/openai/v1/chat/completions',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: {
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 200,
        temperature: 0.7 // optional
      }
    }
  ];

  for (const service of services) {
    try {
      console.log(`Trying ${service.name} AI service...`);
      
      const response = await fetch(service.url, {
        method: 'POST',
        headers: service.headers,
        body: JSON.stringify(service.body),
        signal: AbortSignal.timeout(8000) // 8 second timeout
      });

      if (!response.ok) {
        console.log(`${service.name} failed with status ${response.status}`);
        continue;
      }

      const data = await response.json();
      let aiResponse;

      // Parse different response formats
      if (service.name === 'ollama') {
        aiResponse = data.choices?.[0]?.message?.content;
      } else if (service.name === 'huggingface') {
        aiResponse = data.choices?.[0]?.message?.content;
      } else if (service.name === 'gemini') {
        aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;
      }else if (service.name === 'groq') {
        aiResponse = data.choices?.[0]?.message?.content;
      }
      

      // if (aiResponse) {
      //   // Try to parse JSON from AI response
      //   const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      //   if (jsonMatch) {
      //     const suggestion = JSON.parse(jsonMatch[0]);
      //     if (suggestion.id && suggestion.title && suggestion.message && suggestion.image) {
      //       console.log(`Success with ${service.name}`);
      //       return suggestion;
      //     }
      //   }
      // }

      return aiResponse
    } catch (error) {
      console.log(`${service.name} error:`, error.message);
      continue;
    }
  }

  return null; // All AI services failed
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const { cartItems } = await request.json();
    const { session, admin } = await authenticate.public.appProxy(request);

    // Get products from Shopify
    const graphqlQuery = `
      query {
        products(first: 20) {
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

    if (result.errors) {
      throw new Error(`GraphQL error: ${JSON.stringify(result.errors)}`);
    }

    const products = result.data.products.edges.map(({ node }) => {
      const variant = node.variants.edges[0]?.node;
      return {
        id: variant?.id,
        title: node.title,
        price: variant?.price || "0.00",
        image: {
          src: node.featuredImage?.originalSrc || 'https://via.placeholder.com/40',
          alt: node.featuredImage?.altText || node.title,
        },
      };
    }).filter(product => product.id);

    // Try AI services, fallback to simple logic
    let suggestion = await generateAIUpsell(cartItems, products);
    
    if (!suggestion) {
      console.log('All AI services failed, using fallback logic');
      suggestion = generateFallbackUpsell(products, cartItems);
    }

    if (!suggestion) {
      return json({ error: 'No products available for upsell' }, { status: 404, headers: corsHeaders });
    }

    return json({ suggestion }, { headers: corsHeaders });

  } catch (error) {
    console.error("Upsell generation error:", {
      message: error.message,
      timestamp: new Date().toISOString()
    });
    
    return json({ 
      error: 'Service temporarily unavailable',
      suggestion: null 
    }, { 
      status: 500, 
      headers: corsHeaders 
    });
  }
};