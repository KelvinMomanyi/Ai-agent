import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { callAi, getLastAiProvider, streamOpenAIChat, STREAM_PROVIDERS } from "../ai/client.server";
import { CHAT_AGENT_SYSTEM } from "../ai/prompts";
import prisma from "../db.server";
import { getProductsByIds } from "../models/product.server";
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
  const cartProducts = await getProductsByIds(shop, session.cartProductIds);
  const brandVoiceSection = settings.brandVoice
    ? `Brand Voice:\n${settings.brandVoice}`
    : "";
  const systemPrompt = CHAT_AGENT_SYSTEM.replace("{storeName}", shop)
    .replace("{tone}", settings.aiTone)
    .replace("{brandVoiceSection}", brandVoiceSection)
    .replace(
      "{storeContext}",
      JSON.stringify({
        blockedProductIds: settings.blockedProductIds,
        discountThreshold: settings.discountThreshold.toString(),
      }),
    )
    .replace(
      "{cartContents}",
      JSON.stringify(cartProducts.map((product) => product.title)),
    )
    .replace("{journeyStage}", session.journeyStage);
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
