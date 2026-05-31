import { json } from "@remix-run/node";
import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
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
    const { session } = await authenticate.public.appProxy(request);
    
    // In dev mode without app proxy, session might be undefined
    const storeId = session?.shop || new URL(request.url).searchParams.get("shop");
    if (!storeId) {
      return json({ error: "Missing store context" }, { status: 400, headers: corsHeaders });
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

    const prompt = `You are an AI sales assistant for a Shopify store.
Brand Voice: ${brandVoice}
Visitor Intent Profile: ${visitorSession.intentProfile}
Viewed Products: ${JSON.stringify(visitorSession.viewedProducts)}
Current Cart Total: $${context?.cartTotal || 0}
Visitor Message: "${message}"

Respond directly to the visitor in character. If they ask for recommendations, suggest items from their viewed products or general best sellers. Keep it brief and natural. Do not return JSON. Just the reply text.`;

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
         reply = data.candidates?.[0]?.content?.parts?.[0]?.text;
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
           reply = data.choices?.[0]?.message?.content;
        }
    }

    if (!reply) {
      reply = "I'm having a little trouble thinking right now, but I'm here to help you find what you need!";
    }

    // Log assistant message
    await prisma.chatMessage.create({
      data: {
        sessionId: visitorSession.id,
        storeId,
        role: "assistant",
        content: reply,
      }
    });

    return json({ reply }, { headers: corsHeaders });
  } catch (error) {
    console.error("Chat action error:", error);
    return json({ error: "Failed to process chat" }, { status: 500, headers: corsHeaders });
  }
};
