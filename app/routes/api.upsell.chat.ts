import { json } from "@remix-run/node";
import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate, unauthenticated } from "../shopify.server";
import { getSessionForVisitor } from "../models/behavior-engine.server";
import prisma from "../db.server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    let admin: any = null;
    let storeId = "";

    try {
      const authResult = await authenticate.public.appProxy(request);
      admin = authResult.admin;
      storeId = authResult.session?.shop || "";
    } catch (e) {
      // Ignore app proxy authentication failures in dev/direct testing
    }

    if (!storeId) {
      const url = new URL(request.url);
      storeId = url.searchParams.get("shop") || "";
    }

    if (!storeId) {
      const bodyText = await request.clone().text();
      try {
        const parsed = JSON.parse(bodyText);
        storeId = parsed.storeId || parsed.shop || "";
      } catch {
        // ignore
      }
    }

    if (!storeId) {
      return json({ error: "Missing store context" }, { status: 400, headers: corsHeaders });
    }

    // Resolve unauthenticated admin client if proxy didn't inject it (e.g. testing)
    if (!admin) {
      try {
        const unauth = await unauthenticated.admin(storeId);
        admin = unauth.admin;
      } catch (e) {
        console.error("Failed to resolve offline admin client:", e);
      }
    }

    const body = await request.json();
    const { visitorId, message, context } = body;

    if (!visitorId || !message) {
      return json({ error: "Missing visitorId or message" }, { status: 400, headers: corsHeaders });
    }

    // Get intent context
    const visitorSession = await getSessionForVisitor(storeId, visitorId);
    
    // Log user message
    await prisma.chatMessage.create({
      data: {
        sessionId: visitorSession.id,
        storeId,
        role: "user",
        content: message,
      }
    });

    const shopConfig = await prisma.shopConfig.findUnique({
      where: { shopDomain: storeId }
    });

    const brandVoice = shopConfig?.brandVoice || "helpful, concise, sales-focused";

    // Fetch product catalog
    let productsList: any[] = [];
    if (admin) {
      try {
        const productResponse = await admin.graphql(`#graphql
          query ChatProductCatalog {
            products(first: 30) {
              edges {
                node {
                  id
                  title
                  handle
                  featuredImage {
                    originalSrc
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
        `);
        const productResult = (await productResponse.json()) as any;
        if (productResult?.data?.products?.edges) {
          productsList = productResult.data.products.edges.map((e: any) => ({
            id: e.node.id,
            title: e.node.title,
            handle: e.node.handle,
            image: e.node.featuredImage?.originalSrc || "",
            price: e.node.variants?.edges?.[0]?.node?.price || "",
            variantId: e.node.variants?.edges?.[0]?.node?.id || ""
          }));
        }
      } catch (e) {
        console.error("Failed to fetch product catalog for chat:", e);
      }
    }

    const catalogStr = productsList.map(p => `- ${p.title} (Price: $${p.price}, ID: ${p.id})`).join("\n");

    const prompt = `You are an AI sales assistant for a Shopify store.
Brand Voice: ${brandVoice}
Visitor Intent Profile: ${visitorSession.intentProfile}
Viewed Products: ${JSON.stringify(visitorSession.viewedProducts)}
Current Cart Total: $${context?.cartTotal || 0}

Here is the list of products available in the store:
${catalogStr}

Visitor Message: "${message}"

Respond directly to the visitor in character. Keep it brief, helpful, and natural.
Guidelines:
1. RECOMMENDATIONS: If they ask for recommendations or you think a product fits their request, recommend up to 2 items from the catalog. For each recommended product, append \`[RECOMMENDATION: <product_id>]\` (where <product_id> is the EXACT product ID from the catalog, e.g. gid://shopify/Product/12345678) to the very end of your response.
2. ORDER TRACKING (WISMO): If they ask to track their order or ask "Where is my order", ask them for their order number (e.g. #1001) or email. If they have already provided a valid-looking order number or email in their message, append \`[TRACK_ORDER: <order_number_or_email>]\` (e.g. [TRACK_ORDER: #1001] or [TRACK_ORDER: email@domain.com]) to the very end of your response.

Do not return JSON. Just the reply text.`;

    // Try Gemini First
    let reply = "";
    if (process.env.GOOGLE_API_KEY) {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GOOGLE_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 300, temperature: 0.7 },
        }),
      });
      if (response.ok) {
         const data = await response.json();
         reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      }
    }

    // Fallback to Groq
    if (!reply && process.env.GROQ_API_KEY) {
       const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: prompt }],
            max_tokens: 300,
            temperature: 0.7,
          }),
        });
        if (response.ok) {
           const data = await response.json();
           reply = data.choices?.[0]?.message?.content || "";
        }
    }

    if (!reply) {
      reply = "I'm having a little trouble thinking right now, but I'm here to help you find what you need!";
    }

    // Parse out any tags
    const recommendedIds: string[] = [];
    const recRegex = /\[RECOMMENDATION:\s*([^\]\s]+)\]/g;
    let match;
    while ((match = recRegex.exec(reply)) !== null) {
      recommendedIds.push(match[1]);
    }
    
    const trackRegex = /\[TRACK_ORDER:\s*([^\]]+)\]/;
    const trackMatch = reply.match(trackRegex);
    const orderQuery = trackMatch ? trackMatch[1].trim() : null;

    let cleanedReply = reply
      .replace(/\[RECOMMENDATION:\s*[^\]]+\]/g, "")
      .replace(/\[TRACK_ORDER:\s*[^\]]+\]/g, "")
      .trim();

    // Hydrate recommendations
    const recommendedProducts = productsList.filter(p => 
      recommendedIds.some(id => p.id === id || p.id.endsWith(id) || id.endsWith(p.id))
    );

    // Run WISMO search if tagged
    if (orderQuery && admin) {
      try {
        const orderResponse = await admin.graphql(`#graphql
          query SearchOrder($query: String!) {
            orders(first: 1, query: $query) {
              edges {
                node {
                  id
                  name
                  email
                  displayFulfillmentStatus
                  createdAt
                  fulfillments(first: 1) {
                    trackingInfo(first: 1) {
                      number
                      url
                    }
                  }
                }
              }
            }
          }
        `, {
          variables: {
            query: orderQuery.startsWith("#") ? `name:${orderQuery}` : `email:${orderQuery} OR name:${orderQuery} OR name:${orderQuery.replace('#', '')}`
          }
        });
        
        const orderResult = (await orderResponse.json()) as any;
        const orderNode = orderResult?.data?.orders?.edges?.[0]?.node;
        
        if (orderNode) {
          const status = orderNode.displayFulfillmentStatus;
          const tracking = orderNode.fulfillments?.[0]?.trackingInfo?.[0];
          
          let statusText = `I found order ${orderNode.name}. Status: ${status}.`;
          if (tracking?.number) {
            statusText += ` Tracking number: ${tracking.number}.`;
            if (tracking.url) {
              statusText += ` You can track it here: ${tracking.url}`;
            }
          } else {
            statusText += ` It is currently being processed and does not have a tracking code yet.`;
          }
          cleanedReply = statusText;
        } else {
          cleanedReply = `I couldn't find an order matching "${orderQuery}". Please double check your order number or email.`;
        }
      } catch (e) {
        console.error("Failed to query order tracking from Shopify API:", e);
        cleanedReply = "I encountered an error trying to look up your order status. Please contact our support team.";
      }
    }

    // Log assistant message
    await prisma.chatMessage.create({
      data: {
        sessionId: visitorSession.id,
        storeId,
        role: "assistant",
        content: cleanedReply,
      }
    });

    return json({ reply: cleanedReply, products: recommendedProducts }, { headers: corsHeaders });
  } catch (error) {
    console.error("Chat action error:", error);
    return json({ error: "Failed to process chat" }, { status: 500, headers: corsHeaders });
  }
};

