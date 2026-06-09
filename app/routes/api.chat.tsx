import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { callAi, getLastAiProvider, streamOpenAIChat, STREAM_PROVIDERS } from "../ai/client.server";
import prisma from "../db.server";
import { getProductsByIds } from "../models/product.server";
import { getActiveBundlesForProduct } from "../models/bundle.server";
import { getShopperSession, upsertShopperSessionFromEvents } from "../models/session.server";
import { cacheKeys, incrementRateLimit } from "../redis.server";
import { optionsResponse, withCors } from "../utils/cors.server";
import {
  authenticateStorefrontRequest,
  isStorefrontAuthError,
} from "../utils/storefrontAuth.server";

type ChatBody = {
  sessionId?: string;
  sessionToken?: string;
  shop?: string;
  message?: string;
  messageHistory?: Array<{ role: "user" | "assistant"; content: string }>;
};

type BundleSummary = {
  name: string;
  discountType: string;
  discountValue: string;
  items: Array<{ productId: string; product?: { title: string } | null }>;
};

type CatalogProduct = {
  title: string;
  handle: string;
  price: unknown;
  tags: string[];
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") return optionsResponse();
  return json({ ok: true }, { headers: withCors() });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") return optionsResponse();

  let body: ChatBody;
  try {
    body = (await request.json()) as ChatBody;
  } catch {
    return json({ error: "Invalid JSON" }, { status: 400, headers: withCors() });
  }

  let auth;
  try {
    auth = authenticateStorefrontRequest(request, body);
  } catch (error) {
    if (isStorefrontAuthError(error)) {
      return json({ error: "Unauthorized" }, { status: error.status, headers: withCors() });
    }
    throw error;
  }

  const { shop, sessionId } = auth;
  const userMessage = typeof body.message === "string" ? body.message.trim() : "";

  if (!shop || !sessionId || !userMessage) {
    return json({ error: "Invalid request" }, { status: 400, headers: withCors() });
  }

  if (!(await isInstalledShop(shop))) {
    return json({ error: "Invalid shop" }, { status: 401, headers: withCors() });
  }

  const chatRequestCount = await incrementRateLimit(cacheKeys.chatRateLimit(sessionId), 60);
  if (chatRequestCount > 12) {
    return json(
      { error: "Rate limited" },
      { status: 429, headers: withCors({ "Retry-After": "60" }) },
    );
  }

  const session =
    (await getShopperSession(shop, sessionId)) ||
    (await upsertShopperSessionFromEvents({
      shop,
      sessionId,
      events: [{ type: "session_sync", ts: Date.now() }],
    }));

  await prisma.chatMessage.create({
    data: {
      shop,
      sessionId: session.id,
      role: "user",
      content: userMessage,
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
    { role: "user", content: userMessage },
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
            (await callAi(systemPrompt, userMessage)) ||
            buildCatalogFallbackReply(userMessage, catalogProducts, bundles);
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

async function isInstalledShop(shop: string) {
  const [session, legacyShop] = await Promise.all([
    prisma.session.findFirst({ where: { shop }, select: { id: true } }),
    prisma.shop.findUnique({ where: { shopDomain: shop }, select: { shopDomain: true } }),
  ]);

  return Boolean(session || legacyShop);
}

function buildCatalogFallbackReply(
  userMessage: string,
  catalogProducts: CatalogProduct[],
  bundles: BundleSummary[],
) {
  if (catalogProducts.length === 0) {
    return "I do not see synced products in this store yet. Sync the product catalog first, then I can recommend exact items.";
  }

  const queryTokens = tokenize(userMessage);
  const scoredProducts = catalogProducts
    .map((product) => ({
      product,
      score: scoreProduct(product, queryTokens),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3);

  const matches = scoredProducts.length > 0
    ? scoredProducts.map((item) => item.product)
    : catalogProducts.slice(0, 3);

  const intro = scoredProducts.length > 0
    ? "These look like the best matches:"
    : "I did not find an exact match, but these are good places to start:";
  const recommendations = matches
    .map((product) => `${product.title} (${formatPrice(product.price)}) /products/${product.handle}`)
    .join("; ");
  const bundle = bundles[0]
    ? ` There is also an active bundle: ${bundles[0].name}.`
    : "";

  return `${intro} ${recommendations}.${bundle}`;
}

function scoreProduct(product: CatalogProduct, queryTokens: string[]) {
  if (queryTokens.length === 0) return 0;

  const searchable = [
    product.title,
    product.handle,
    ...(Array.isArray(product.tags) ? product.tags : []),
  ].join(" ").toLowerCase();

  return queryTokens.reduce((score, token) => {
    if (searchable.includes(token)) return score + 2;
    if (token.length > 4 && searchable.includes(token.slice(0, -1))) return score + 1;
    return score;
  }, 0);
}

function tokenize(value: string) {
  const stopWords = new Set([
    "about",
    "anything",
    "best",
    "find",
    "help",
    "need",
    "product",
    "recommend",
    "show",
    "with",
  ]);

  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !stopWords.has(token));
}

function formatPrice(value: unknown) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) return "price unavailable";
  return `$${amount.toFixed(2)}`;
}
