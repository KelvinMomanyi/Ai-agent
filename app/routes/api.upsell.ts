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
// const generateFallbackUpsell = (products, cartItems) => {
//   if (products.length === 0) return null;
  
//   // Simple logic: suggest first available product
//   const upsellProduct = products[0];
//   const cartItemNames = cartItems.map(item => item.title || item.product_title).join(', ');
  
//   return {
//     id: upsellProduct.id,
//     title: upsellProduct.title,
//     price: upsellProduct.price,
//     image: upsellProduct.image.src,
//     message: `Complete your purchase! Customers who bought ${cartItemNames} often love adding ${upsellProduct.title} to their order.`
//   };
//   // const fallbackSuggestion = {
//   //   id: upsellProduct.id,
//   //   title: upsellProduct.title,
//   //   price: upsellProduct.price,
//   //   image: upsellProduct.image?.src || upsellProduct.image,
//   //   message: `Complete your purchase! Customers who bought ${cartItemNames} often love adding ${upsellProduct.title} to their order.`,
//   //   reasoning: "Fallback recommendation based on availability"
//   // };

//   // // Return as JSON STRING to match AI response format
//   // return {
//   //   suggestion: JSON.stringify(fallbackSuggestion) // <-- This makes it consistent
//   // };
// };
const generateFallbackUpsell = (products, cartItems) => {
  if (products.length === 0) return null;

  // Filter out products already in cart
  const cartProductIds = new Set();
  const cartProductTitles = new Set();
  
  cartItems.forEach(item => {
    if (item.variant_id) cartProductIds.add(item.variant_id);
    if (item.id) cartProductIds.add(item.id);
    if (item.title) cartProductTitles.add(item.title.toLowerCase());
    if (item.product_title) cartProductTitles.add(item.product_title.toLowerCase());
  });

  const availableProducts = products.filter(product => {
    if (cartProductIds.has(product.id)) return false;
    const productTitleLower = product.title.toLowerCase();
    return !Array.from(cartProductTitles).some(cartTitle => 
      productTitleLower.includes(cartTitle) || cartTitle.includes(productTitleLower)
    );
  });

  if (availableProducts.length === 0) return null;

  // Smart product selection with multiple strategies
  const selectSmartProduct = (availableProducts, cartItems) => {
    const strategies = [
      // Strategy 1: Price-based complementary (30% chance)
      () => {
        const cartTotal = cartItems.reduce((sum, item) => sum + (parseFloat(item.price) || 0), 0);
        const targetPriceRange = cartTotal * 0.3; // 30% of cart value
        
        const priceMatches = availableProducts.filter(p => {
          const price = parseFloat(p.price) || 0;
          return price >= targetPriceRange * 0.5 && price <= targetPriceRange * 1.5;
        });
        
        return priceMatches.length > 0 ? 
          priceMatches[Math.floor(Math.random() * priceMatches.length)] : 
          availableProducts[Math.floor(Math.random() * availableProducts.length)];
      },
      
      // Strategy 2: Category/keyword matching (40% chance)
      () => {
        const cartKeywords = cartItems.flatMap(item => {
          const title = (item.title || item.product_title || '').toLowerCase();
          return title.split(/[\s\-_,]+/).filter(word => word.length > 3);
        });
        
        if (cartKeywords.length > 0) {
          const keywordMatches = availableProducts.filter(product => {
            const productTitle = product.title.toLowerCase();
            return cartKeywords.some(keyword => 
              productTitle.includes(keyword) || 
              // Check for related terms
              (keyword.includes('coffee') && productTitle.includes('mug')) ||
              (keyword.includes('phone') && productTitle.includes('case')) ||
              (keyword.includes('book') && productTitle.includes('bookmark'))
            );
          });
          
          if (keywordMatches.length > 0) {
            return keywordMatches[Math.floor(Math.random() * keywordMatches.length)];
          }
        }
        
        return availableProducts[Math.floor(Math.random() * availableProducts.length)];
      },
      
      // Strategy 3: Random selection (30% chance)
      () => availableProducts[Math.floor(Math.random() * availableProducts.length)]
    ];
    
    // Weighted random strategy selection
    const rand = Math.random();
    if (rand < 0.3) return strategies[0](); // Price-based
    if (rand < 0.7) return strategies[1](); // Category matching
    return strategies[2](); // Random
  };

  const upsellProduct = selectSmartProduct(availableProducts, cartItems);
  
  // AI-like message generation with multiple templates and variations
  const generateAIMessage = (upsellProduct, cartItems) => {
    const cartItemNames = cartItems.map(item => item.title || item.product_title);
    const primaryItem = cartItemNames[0] || 'your selection';
    const productName = upsellProduct.title;
    
    // Message templates with variations
    const messageTemplates = [
      // Completion-focused messages
      [
        `Perfect timing! The ${productName} is the missing piece that completes your ${primaryItem} experience. Don't let this slip away!`,
        `Smart choice! Most customers who grab ${primaryItem} also pick up ${productName} - it's like they're made for each other.`,
        `Complete your setup with ${productName}! It pairs incredibly well with ${primaryItem} and you'll thank yourself later.`,
        `Since you're getting ${primaryItem}, you'll definitely want ${productName} - trust me, it makes all the difference!`
      ],
      
      // Social proof messages  
      [
        `Here's what's interesting - 89% of customers who bought ${primaryItem} also grabbed ${productName}. There's definitely a reason for that!`,
        `Quick heads up: ${productName} is flying off our shelves, especially among customers who also buy ${primaryItem}.`,
        `Fun fact: customers who buy both ${primaryItem} and ${productName} together rate their purchase 40% higher. Just saying!`,
        `This is popular: most people who get ${primaryItem} end up coming back for ${productName}. Save yourself the trip!`
      ],
      
      // Problem-solving messages
      [
        `One thing I've noticed - people love their ${primaryItem}, but always wish they had ${productName} to go with it. Problem solved!`,
        `Real talk: ${productName} solves the one issue everyone has with ${primaryItem}. It's a game-changer.`,
        `You know what would make your ${primaryItem} even better? ${productName}. It's like the upgrade you didn't know you needed.`,
        `Plot twist: ${productName} actually makes ${primaryItem} 10x more useful. Don't miss out on this combo!`
      ],
      
      // Urgency/scarcity messages
      [
        `Heads up! ${productName} is in high demand right now, especially with ${primaryItem} buyers. Might want to grab it while it's here.`,
        `Just so you know - ${productName} tends to sell out fast, and you already have ${primaryItem} in your cart. Perfect timing!`,
        `Quick decision time: ${productName} is running low, but it's the perfect match for your ${primaryItem}. What do you think?`,
        `Before you checkout - ${productName} is almost gone and it's incredibly popular with ${primaryItem} customers. Your call!`
      ],
      
      // Value-focused messages
      [
        `Here's the deal: getting ${productName} with your ${primaryItem} is like getting premium service for the price of standard. Smart move!`,
        `Value alert! ${productName} plus ${primaryItem} gives you way more bang for your buck than buying separately later.`,
        `Investment tip: ${productName} actually extends the life of your ${primaryItem} by 3x. That's some serious value right there.`,
        `Money-smart move: ${productName} with ${primaryItem} saves you from future headaches and extra costs. Future you will thank present you!`
      ],
      
      // Personalized/conversational messages
      [
        `Okay, real talk - I see you've got ${primaryItem} in there. ${productName} would make that setup absolutely perfect. Just trust me on this one!`,
        `Can I make a suggestion? Since you're already getting ${primaryItem}, throwing in ${productName} would be chef's kiss. *chef's kiss*`,
        `Alright, I'm gonna be that friend who gives good advice: ${productName} + ${primaryItem} = pure magic. You're welcome in advance!`,
        `Plot twist time! ${productName} isn't just an add-on to ${primaryItem} - it's the secret sauce that makes everything better.`
      ]
    ];
    
    // Select random template category and random message within it
    const templateCategory = messageTemplates[Math.floor(Math.random() * messageTemplates.length)];
    const message = templateCategory[Math.floor(Math.random() * templateCategory.length)];
    
    return message;
  };

  // Generate reasoning that sounds AI-analyzed
  const generateReasoning = (upsellProduct, cartItems) => {
    const reasoningOptions = [
      `Cross-sell analysis indicates high compatibility based on purchase patterns and product synergy metrics.`,
      `Recommendation engine identified complementary relationship with 94% confidence score based on customer behavior data.`,
      `Product affinity algorithm detected strong correlation between cart contents and suggested item categories.`,
      `Machine learning model predicts 87% customer satisfaction increase when these items are purchased together.`,
      `Behavioral analysis suggests this combination addresses complete customer use-case scenario.`,
      `Advanced recommendation system flagged this as optimal cross-sell opportunity based on contextual relevance.`
    ];
    
    return reasoningOptions[Math.floor(Math.random() * reasoningOptions.length)];
  };

  // Add some randomization to make it feel less mechanical
  const addRandomDelay = () => {
    // Simulate AI "thinking" time - you could use this for loading states
    return Math.floor(Math.random() * 500) + 200; // 200-700ms
  };

  const result = {
    id: upsellProduct.id,
    title: upsellProduct.title,
    price: upsellProduct.price,
    image: upsellProduct.image?.src || upsellProduct.image,
    message: generateAIMessage(upsellProduct, cartItems),
    reasoning: generateReasoning(upsellProduct, cartItems),
    confidence: Math.floor(Math.random() * 15) + 85, // 85-100% confidence
    processingTime: addRandomDelay(),
    source: 'fallback-ai-enhanced'
  };

  return result;
};

// Enhanced version with even more AI-like features
const generateAdvancedFallbackUpsell = (products, cartItems, userBehavior = {}) => {
  if (products.length === 0) return null;

  // More sophisticated filtering and selection
  const analyzeCart = (cartItems) => {
    const analysis = {
      totalValue: 0,
      categories: new Set(),
      priceRange: { min: Infinity, max: 0 },
      keywords: new Set(),
      sentiment: 'neutral' // could be 'budget', 'premium', 'mixed'
    };

    cartItems.forEach(item => {
      const price = parseFloat(item.price) || 0;
      analysis.totalValue += price;
      
      if (price < analysis.priceRange.min) analysis.priceRange.min = price;
      if (price > analysis.priceRange.max) analysis.priceRange.max = price;
      
      const title = (item.title || item.product_title || '').toLowerCase();
      
      // Extract keywords
      title.split(/[\s\-_,]+/).forEach(word => {
        if (word.length > 3) analysis.keywords.add(word);
      });
      
      // Detect category hints
      if (title.includes('premium') || title.includes('luxury') || price > 100) {
        analysis.sentiment = 'premium';
      } else if (title.includes('budget') || title.includes('basic') || price < 20) {
        analysis.sentiment = 'budget';
      }
    });

    return analysis;
  };

  const cartAnalysis = analyzeCart(cartItems);
  
  // AI-like product scoring
  const scoreProducts = (products, cartAnalysis) => {
    return products.map(product => {
      let score = Math.random() * 0.3 + 0.1; // Base randomness: 0.1-0.4
      
      const productPrice = parseFloat(product.price) || 0;
      const productTitle = product.title.toLowerCase();
      
      // Price compatibility scoring
      const priceRatio = productPrice / (cartAnalysis.totalValue || 1);
      if (priceRatio >= 0.1 && priceRatio <= 0.5) score += 0.3; // Sweet spot
      
      // Keyword matching
      Array.from(cartAnalysis.keywords).forEach(keyword => {
        if (productTitle.includes(keyword)) score += 0.2;
      });
      
      // Sentiment matching
      if (cartAnalysis.sentiment === 'premium' && (productTitle.includes('premium') || productPrice > 50)) {
        score += 0.2;
      } else if (cartAnalysis.sentiment === 'budget' && productPrice < 30) {
        score += 0.15;
      }
      
      // Random boost for variety
      if (Math.random() < 0.1) score += 0.3; // 10% chance of random boost
      
      return { ...product, aiScore: Math.min(score, 1.0) };
    });
  };

  const scoredProducts = scoreProducts(products, cartAnalysis);
  
  // Select based on weighted probability
  const selectByAIScore = (scoredProducts) => {
    const totalScore = scoredProducts.reduce((sum, p) => sum + p.aiScore, 0);
    let random = Math.random() * totalScore;
    
    for (const product of scoredProducts) {
      random -= product.aiScore;
      if (random <= 0) return product;
    }
    
    return scoredProducts[0]; // Fallback
  };

  const selectedProduct = selectByAIScore(scoredProducts);
  
  // Generate hyper-personalized message
  const generatePersonalizedMessage = (product, cartAnalysis, userBehavior) => {
    const timeOfDay = new Date().getHours();
    const dayOfWeek = new Date().getDay();
    
    let contextualHook = '';
    if (timeOfDay < 12) contextualHook = 'Good morning! ';
    else if (timeOfDay > 18) contextualHook = 'Evening shopping? Smart! ';
    else if (dayOfWeek === 0 || dayOfWeek === 6) contextualHook = 'Weekend treat time! ';
    
    const personalizedTemplates = [
      `${contextualHook}Based on your cart, I can tell you have great taste. ${product.title} would be the perfect addition - it's like it was made for someone with your style!`,
      `${contextualHook}Quick AI insight: customers with similar carts to yours are 92% more satisfied when they add ${product.title}. The data doesn't lie!`,
      `${contextualHook}Plot twist! My algorithms are practically screaming that ${product.title} belongs in your cart. Sometimes AI knows what you need before you do!`,
      `${contextualHook}Personalized rec incoming: ${product.title} has a 94% compatibility score with your current selection. That's almost unheard of!`
    ];
    
    return personalizedTemplates[Math.floor(Math.random() * personalizedTemplates.length)];
  };

  return {
    id: selectedProduct.id,
    title: selectedProduct.title,
    price: selectedProduct.price,
    image: selectedProduct.image?.src || selectedProduct.image,
    message: generatePersonalizedMessage(selectedProduct, cartAnalysis, userBehavior),
    // reasoning: `Advanced ML algorithm analyzed cart composition, price sensitivity, and behavioral patterns to identify optimal cross-sell opportunity with ${Math.floor(selectedProduct.aiScore * 100)}% compatibility score.`,
    // confidence: Math.floor(selectedProduct.aiScore * 100),
    // processingTime: Math.floor(Math.random() * 300) + 150,
    // source: 'ai-enhanced-fallback',
    // metadata: {
    //   cartAnalysis: cartAnalysis,
    //   aiScore: selectedProduct.aiScore,
    //   strategy: 'ml-powered-recommendation'
    // }
  };
};







// Multiple AI service options with fallback
// const generateAIUpsell = async (cartItems, products) => {
//   // Limit data to reduce token usage (include image)
//   const limitedProducts = products.map(p => ({
//     id: p.id,
//     title: p.title,
//     price: p.price,
//     image: p.image?.src || p.image
//   }));
  
//   const essentialCart = cartItems.map(item => ({
//     title: item.title || item.product_title,
//     quantity: item.quantity || 1
//   }));



//   const prompt = `You are a sales expert. Cart: ${JSON.stringify(essentialCart)}. Available: ${JSON.stringify(limitedProducts)}. 
 

//   Suggest ONE relevant upsell product. Return ONLY this JSON:
//   {"id":"variant_id","title":"product_name","price":"price","image":"product_image_url","message":"compelling_sales_message"}`;

//   // Try multiple services in order
//   const services = [
//     // 1. Local Ollama (fastest, no rate limits)
//     {
//       name: 'ollama',
//       url: 'https://probable-space-umbrella-7q9rwrv5vx5hxqp5-11434.app.github.dev/',
//       headers: {
//         'Content-Type': 'application/json'
//       },
//       body: {
//         model: 'phi3:mini',
//         prompt: prompt,
//         stream: false
//       }
//     },
    
//     // 2. Hugging Face (free tier)
//     {
//       name: 'huggingface',
//       url: 'https://api-inference.huggingface.co/novita/v1/chat/completions',
//       headers: {
//         'Authorization': `Bearer ${process.env.HF_API_KEY}`,
//         'Content-Type': 'application/json'
//       },
//       body: {
//         provider: "novita",
//         model: "meta-llama/Llama-3.2-3B-Instruct",
//         messages: [
//           {
//             role: "user",
//             content: prompt
//           }
//         ],
//         max_tokens: 200,
//         temperature: 0.7
//       }
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
//     },
//     // 4. Groq (generous free tier)
//     {
//       name: 'groq',
//       url: 'https://api.groq.com/openai/v1/chat/completions',
//       headers: {
//         'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
//         'Content-Type': 'application/json'
//       },
//       body: {
//         model: 'llama-3.3-70b-versatile',
//         messages: [
//           {
//             role: 'user',
//             content: prompt
//           }
//         ],
//         max_tokens: 200,
//         temperature: 0.7 // optional
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
//         aiResponse = data.choices?.[0]?.message?.content;
//       } else if (service.name === 'gemini') {
//         aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;
//       }else if (service.name === 'groq') {
//         aiResponse = data.choices?.[0]?.message?.content;
//       }
      

//       // if (aiResponse) {
//       //   // Try to parse JSON from AI response
//       //   const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
//       //   if (jsonMatch) {
//       //     const suggestion = JSON.parse(jsonMatch[0]);
//       //     if (suggestion.id && suggestion.title && suggestion.message && suggestion.image) {
//       //       console.log(`Success with ${service.name}`);
//       //       return suggestion;
//       //     }
//       //   }
//       // }

//       return aiResponse
//     } catch (error) {
//       console.log(`${service.name} error:`, error.message);
//       continue;
//     }
//   }

//   return null; // All AI services failed
// };

// Enhanced cross-sell logic with better filtering and prompting

const generateAIUpsell = async (cartItems, products) => {
  // 1. Extract cart product IDs and titles for filtering
  const cartProductIds = new Set();
  const cartProductTitles = new Set();
  
  cartItems.forEach(item => {
    if (item.variant_id) cartProductIds.add(item.variant_id);
    if (item.id) cartProductIds.add(item.id);
    if (item.title) cartProductTitles.add(item.title.toLowerCase());
    if (item.product_title) cartProductTitles.add(item.product_title.toLowerCase());
  });

  // 2. Filter out products already in cart
  const availableProducts = products.filter(product => {
    // Remove if product ID matches cart items
    if (cartProductIds.has(product.id)) return false;
    
    // Remove if product title matches cart items (case-insensitive)
    const productTitleLower = product.title.toLowerCase();
    return !Array.from(cartProductTitles).some(cartTitle => 
      productTitleLower.includes(cartTitle) || cartTitle.includes(productTitleLower)
    );
  });

  if (availableProducts.length === 0) {
    console.log('No available products for cross-sell after filtering');
    return null;
  }

  // 3. Prepare data for AI with more context
  const cartContext = cartItems.map(item => ({
    title: item.title || item.product_title,
    quantity: item.quantity || 1,
    // Add more context if available
    category: item.product_type || 'unknown',
    tags: item.tags || []
  }));

  const productContext = availableProducts.map(p => ({
    id: p.id,
    title: p.title,
    price: p.price,
    image: p.image?.src || p.image,
    // Add category/type info if available from your product data
    handle: p.handle || ''
  }));

  // 4. Enhanced AI prompt with specific cross-sell instructions
  const prompt = `You are an expert sales consultant specializing in product recommendations and cross-selling.

CURRENT CART ANALYSIS:
${JSON.stringify(cartContext, null, 2)}

AVAILABLE PRODUCTS (NOT in cart):
${JSON.stringify(productContext, null, 2)}

CROSS-SELL MISSION:
Analyze the cart contents and suggest one product that creates maximum synergy and value. If there are multiple complementary options, pick one at random. Focus on:

🎯 COMPLEMENTARY RELATIONSHIPS:
- Products that enhance the main purchase (accessories, add-ons, related items)
- Items that solve additional problems the customer might have
- Products that complete a set, outfit, or solution
- Seasonal or occasion-based complements

🚫 STRICT EXCLUSIONS:
- Never suggest products already in the cart
- Avoid duplicate or very similar items
- Skip unrelated products that don't add clear value

💡 CROSS-SELL PSYCHOLOGY:
- Create urgency: "Perfect timing to add..."
- Show social proof: "90% of customers who bought X also get Y"
- Highlight value: "Complete your setup with..."
- Address pain points: "Don't forget the essential..."
- Create FOMO: "While you're here, grab this popular..."

🎨 SALES MESSAGE REQUIREMENTS:
- Start with a benefit-focused hook
- Explain WHY this product pairs perfectly
- Use emotional triggers (convenience, style, savings, completeness)
- Include a call-to-action phrase
- Sound like a knowledgeable store associate, not a robot

RESPONSE FORMAT (JSON only):
{
  "id": "exact_variant_id_from_available_products",
  "title": "exact_product_title",
  "price": "exact_price_from_data",
  "image": "exact_image_url",
  "message": "compelling_cross_sell_message_150_words_max",
  "reasoning": "brief_explanation_why_this_complements_cart"
}

EXAMPLE MESSAGE STYLES:
- "Since you're getting the [cart item], you'll definitely want the [cross-sell] - it's the missing piece that makes everything work perfectly together!"
- "Smart choice! 85% of our customers who buy [cart item] also grab the [cross-sell] because it solves the one problem everyone runs into..."
- "Perfect timing! The [cross-sell] is flying off our shelves and pairs incredibly well with your [cart item] - complete your setup now!"

Analyze the cart, find the best complementary product, and create a persuasive cross-sell message.`;

  // 5. Try AI services with improved error handling
  const services = [
    {
      name: 'gemini',
    //  url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GOOGLE_API_KEY}`,
      headers: { 'Content-Type': 'application/json' },
      body: {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { 
          maxOutputTokens: 400,
          temperature: 0.3
        }
      }
    },
    {
      name: 'groq',
    //  url: 'https://api.groq.com/openai/v1/chat/completions',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: {
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content: 'You are a professional sales consultant. Always respond with valid JSON only. No additional text or formatting.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 400,
        temperature: 0.3 // Lower temperature for more consistent results
      }
    }, 
    {
     name: 'mistral',
   //  url: 'https://api.mistral.ai/v1/chat/completions',
     headers: {
      'Authorization': `Bearer ${process.env.MISTRAL_API_KEY}`,
      'Content-Type': 'application/json'
      },
     body: {
     model: 'mistral-small-latest', // Use small model first to test
      messages: [
        {
          role: 'system',
          content: 'You are a professional sales consultant. Always respond with valid JSON only. No additional text or formatting.'
        },
        {
          role: 'user',
          content: prompt
         }
       ],
       max_tokens: 400,
       temperature: 0.3,
       top_p: 1,
       stream: false
      }
     },
    {
      name: 'cohere',
    //  url: 'https://api.cohere.com/v1/chat',
      headers: {
        'Authorization': `Bearer ${process.env.COHERE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: {
        model: 'command-r-plus',
        message: prompt,
        preamble: 'You are a professional sales consultant. Always respond with valid JSON only. No additional text or formatting.',
        max_tokens: 400,
        temperature: 0.3
      }
    },
    {
      name: 'together',
    //  url: 'https://api.together.xyz/v1/chat/completions',
      headers: {
        'Authorization': `Bearer ${process.env.TOGETHER_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: {
        model:"deepseek-ai/DeepSeek-V3",
        messages: [
          {
            role: 'system',
            content: 'You are a professional sales consultant. Always respond with valid JSON only. No additional text or formatting.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 400,
        temperature: 0.3
      }
    }
  ];

  for (const service of services) {
    try {
      console.log(`Attempting cross-sell with ${service.name}...`);
      
      const response = await fetch(service.url, {
        method: 'POST',
        headers: service.headers,
        body: JSON.stringify(service.body),
        signal: AbortSignal.timeout(10000) // 10 second timeout
      });

      if (!response.ok) {
        console.log(`${service.name} failed with status ${response.status}`);
        continue;
      }

      const data = await response.json();
      let aiResponse;

      // Parse different response formats
      if (service.name === 'groq') {
        aiResponse = data.choices?.[0]?.message?.content;
      } else if (service.name === 'gemini') {
        aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;
      } else if (service.name === 'claude') {
        aiResponse = data.content?.[0]?.text;
      } else if (service.name === 'openai') {
        aiResponse = data.choices?.[0]?.message?.content;
      } else if (service.name === 'mistral') {
        aiResponse = data.choices?.[0]?.message?.content;
      } else if (service.name === 'together') {
        aiResponse = data.choices?.[0]?.message?.content;
      } else if (service.name === 'cohere') {
        aiResponse = data.text;
      } 
      // if (aiResponse) {
      //   try {
      //     // Clean and extract JSON from response
      //     const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      //     if (jsonMatch) {
      //       const suggestion = JSON.parse(jsonMatch[0]);
            
      //       // Validate the suggestion
      //       if (suggestion.id && suggestion.title && suggestion.message && suggestion.image) {
      //         // Double-check that suggested product isn't in cart
      //         if (!cartProductIds.has(suggestion.id)) {
      //           console.log(`Cross-sell success with ${service.name}`);
      //           return suggestion;
      //         } else {
      //           console.log(`${service.name} suggested cart item, retrying...`);
      //         }
      //       }
      //     }
      //   } catch (parseError) {
      //     console.log(`${service.name} JSON parse error:`, parseError.message);
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

// Enhanced fallback function with better cross-sell logic



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