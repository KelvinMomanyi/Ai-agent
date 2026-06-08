import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { callAi, getLastAiProvider, streamOpenAIChat, STREAM_PROVIDERS } from "../ai/client.server";
import prisma from "../db.server";
import { getProductsByIds } from "../models/product.server";
import { getActiveBundlesForProduct } from "../models/bundle.server";
import { getShopperSession } from "../models/session.server";
import { optionsResponse, withCors } from "../utils/cors.server";

type ChatBody = {
  sessionId?: string;
  shop?: string;
  message?: string;
  messageHistory?: Array<{ role: "user" | "assistant"; content: string }>;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") return optionsResponse();
  return json({ ok: true }, { headers: withCors() });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") return optionsResponse();

  const body = (await request.json()) as ChatBody;
  const headerShop = request.headers.get("X-AOVBoost-Shop");
  const shop = body.shop || headerShop || "";

  if (!shop || headerShop !== shop || !body.sessionId || !body.message) {
    return json({ error: "Invalid request" }, { status: 400, headers: withCors() });
  }

  const session = await getShopperSession(shop, body.sessionId);
  if (!session) {
    return json({ error: "Invalid session" }, { status: 404, headers: withCors() });
  }

  await prisma.chatMessage.create({
    data: {
      shop,
      sessionId: session.id,
      role: "user",
      content: body.message,
      storeId: shop,
    },
  });

  const settings = await prisma.appSettings.upsert({
    where: { shop },
    update: {},
    create: { shop },
  });

  const storeName = shop.replace(/\.[^.]+\.myshopify\.com$/, "").replace(/[-_]/g, " ");
  const [cartProducts, rawBundles, catalogProducts] = await Promise.all([
    getProductsByIds(shop, session.cartProductIds),
    getActiveBundlesForProduct(shop, session.viewedProductIds[0]),
    prisma.product.findMany({
      where: { shop },
      select: {
        id: true,
        title: true,
        handle: true,
        price: true,
        tags: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 50,
    }),
  ]);

  const cartInfo = cartProducts.length > 0
    ? cartProducts.map((p) => `- ${p.title} ($${p.price})`).join("\n")
    : "Cart is empty";

  type BundleSummary = { name: string; discountType: string; discountValue: string; items: Array<{ productId: string; product?: { title: string } | null }> };
  const bundles = (rawBundles as unknown as BundleSummary[]);
  const bundlesInfo = bundles.length > 0
    ? bundles.map((b) => {
        const items = b.items.map((i) => `  - ${i.product?.title || i.productId}`).join("\n");
        const discount = b.discountType === "none" ? "" : ` (${b.discountValue}% off)`;
        return `- "${b.name}"${discount}\n${items}`;
      }).join("\n")
    : "No active bundles right now.";

  const catalogInfo = catalogProducts.map((p) =>
    `- ${p.title} | $${p.price} | /products/${p.handle} | tags: ${p.tags.join(", ")}`
  ).join("\n");

  const brandVoiceSection = settings.brandVoice
    ? `Brand Voice:\n${settings.brandVoice}`
    : "";

  const systemPrompt = `You are a friendly AI shopping assistant for ${storeName}.
Your goal is to help the shopper find exactly what they need and discover
products they did not know they needed, thereby increasing their order value naturally.

You have access to the store's product catalog below. When recommending products,
ALWAYS include the product URL (e.g., /products/example-handle) so the system can
render a clickable product card. Only recommend products that actually exist in the catalog.

Available products:
${catalogInfo}

Active bundles:
${bundlesInfo}

Current cart:
${cartInfo}

Store settings:
- Discount threshold: $${settings.discountThreshold}
- Blocked product GIDs: ${settings.blockedProductIds.join(", ") || "none"}
- Shopper journey stage: ${session.journeyStage}

Guidelines:
- Greet warmly, ask one focused question at a time
- Use the shopper's browsing context to make hyper-relevant suggestions
- When recommending products, explain WHY they go together and include the /products/ link
- Reference active bundles when they match what the shopper is looking at
- If the cart qualifies for a discount (above threshold), mention it
- Tone: ${settings.aiTone}
- Keep responses under 3 sentences unless the shopper asks for detail
- Never be pushy; if the shopper declines, respect it immediately
${brandVoiceSection}`;

  const messages = [
    { role: "system", content: systemPrompt },
    ...(body.messageHistory || []).slice(-12),
    { role: "user", content: body.message },
  ];

  const encoder = new TextEncoder();
  let finalReply = "";
  let provider: "gemini" | "groq" | "mistral" | "deepseek" | "heuristic" = "heuristic";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (value: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
      };
      const done = () => {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      };

      try {
        let sentToken = false;

        for (const cfg of STREAM_PROVIDERS) {
          if (!process.env[cfg.envKey]) continue;
          try {
            for await (const delta of streamOpenAIChat(messages, {
              apiKey: process.env[cfg.envKey]!,
              url: cfg.url,
              model: cfg.model,
            })) {
              sentToken = true;
              provider = cfg.name;
              finalReply += delta;
              send({ delta });
            }
            break;
          } catch (error) {
            console.log(`${cfg.name} chat stream skipped:`, getErrorMessage(error));
            if (sentToken) {
              await persistAssistantMessage(shop, session.id, finalReply, provider);
              done();
              return;
            }
          }
        }

        if (!finalReply) {
          const geminiReply =
            (await callAi(systemPrompt, body.message || "")) ||
            "I can help you compare products and find the right add-ons.";
          provider =
            getLastAiProvider() === "none"
              ? "heuristic"
              : (getLastAiProvider() as "gemini" | "groq" | "mistral" | "deepseek");
          finalReply = geminiReply;
          send({ delta: geminiReply });
        }

        await persistAssistantMessage(shop, session.id, finalReply, provider);
        done();
      } catch (error) {
        console.error("AOVBoost chat stream failed:", getErrorMessage(error));
        done();
      }
    },
  });

  return new Response(stream, {
    headers: withCors({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    }),
  });
};

async function persistAssistantMessage(
  shop: string,
  sessionId: string,
  content: string,
  provider: "gemini" | "groq" | "mistral" | "deepseek" | "heuristic",
) {
  await prisma.$transaction([
    prisma.chatMessage.create({
      data: {
        shop,
        sessionId,
        role: "assistant",
        content,
        provider,
        storeId: shop,
      },
    }),
    prisma.shopperSession.updateMany({
      where: { shop, id: sessionId },
      data: { chatEngaged: true },
    }),
  ]);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
