import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { callAI } from "../ai/client.server";
import prisma from "../db.server";
import { getActiveBundlesForProduct } from "../models/bundle.server";
import {
  filterBundlesToCatalog,
  filterCatalogProducts,
  sanitizeAssistantReplyToCatalog,
  type CatalogProduct,
} from "../models/catalogGuard.server";
import {
  getRecommendationCatalog,
  pickCatalogProducts,
} from "../models/catalogCache.server";
import { getShopperSession, upsertShopperSessionFromEvents } from "../models/session.server";
import { cacheKeys, incrementRateLimit } from "../redis.server";
import { optionsResponse, withCors } from "../utils/cors.server";
import {
  authenticateStorefrontRequest,
  isStorefrontAuthError,
  logStorefrontAuthError,
} from "../utils/storefrontAuth.server";
import { getStorefrontSessionRecovery } from "../utils/storefrontSessionRecovery.server";

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
  items: Array<{
    productId: string;
    product?: { id: string; title: string } | null;
  }>;
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
      const storefrontSession = await getStorefrontSessionRecovery(request);
      logStorefrontAuthError(request, "api.chat", error);
      return json(
        {
          error: "Unauthorized",
          reauth: Boolean(storefrontSession),
          storefrontSession,
        },
        {
          status: error.status,
          headers: withCors(
            storefrontSession ? { "X-AOVBoost-Reauth": "true" } : undefined,
          ),
        },
      );
    }
    throw error;
  }

  const { shop, sessionId } = auth;
  const userMessage = typeof body.message === "string" ? body.message.trim() : "";
  const messageIntent = classifyMessageIntent(userMessage);

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
  if (messageIntent !== "general") {
    await prisma.shopperEvent.create({
      data: {
        shop,
        sessionId: session.id,
        type: "chat_intent",
        payload: {
          intent: messageIntent,
          message: userMessage,
        },
      },
    });
  }

  const settings = await prisma.appSettings.upsert({
    where: { shop },
    update: {},
    create: { shop },
  });

  const storeName = shop.replace(/\.[^.]+\.myshopify\.com$/, "").replace(/[-_]/g, " ");
  const recommendationSourceProductId =
    session.cartProductIds[0] || session.viewedProductIds.at(-1);
  const [rawBundles, recommendationCatalog] = await Promise.all([
    getActiveBundlesForProduct(shop, session.viewedProductIds[0], {
      excludeProductIds: settings.blockedProductIds,
    }),
    getRecommendationCatalog({
      shop,
      sourceProductId: recommendationSourceProductId,
    }),
  ]);
  const safeRecommendationProducts = filterCatalogProducts(
    recommendationCatalog.products,
    settings.blockedProductIds,
  );
  const catalogProducts = pickCatalogProducts({
    catalog: {
      ...recommendationCatalog,
      products: safeRecommendationProducts,
    },
    sourceProductId: recommendationSourceProductId,
    cartProductIds: session.cartProductIds,
    excludeProductIds: settings.blockedProductIds,
    query: userMessage,
    limit: 35,
  });
  const cartProductIds = new Set(session.cartProductIds);
  const cartProducts = safeRecommendationProducts.filter((product) =>
    cartProductIds.has(product.id),
  );

  const cartInfo = cartProducts.length > 0
    ? cartProducts.map((p) => `- ${p.title} ($${p.price})`).join("\n")
    : "Cart is empty";

  const bundles = filterBundlesToCatalog(
    rawBundles as unknown as BundleSummary[],
    catalogProducts,
  );
  const bundlesInfo = bundles.length > 0
    ? bundles.map((b) => {
        const items = b.items.map((i) => `  - ${i.product?.title || i.productId}`).join("\n");
        const discount = b.discountType === "none" ? "" : ` (${b.discountValue}% off)`;
        return `- "${b.name}"${discount}\n${items}`;
      }).join("\n")
    : "No active bundles right now.";

  const catalogInfo =
    catalogProducts.length > 0
      ? catalogProducts
          .map(
            (p) =>
              `- ${p.title} | $${p.price} | /products/${p.handle} | tags: ${p.tags.join(", ")}`,
          )
          .join("\n")
      : "No synced catalog products are available.";

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

Detected shopper intent:
- ${messageIntent}

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
- If intent is price_sensitive, do not invent discount codes; suggest real lower-priced alternatives from the catalog and mention the configured threshold only when relevant
- Tone: ${settings.aiTone}
- Keep responses under 3 sentences unless the shopper asks for detail
- Never be pushy; if the shopper declines, respect it immediately
${brandVoiceSection}`;

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
        const fallbackReply = buildCatalogFallbackReply(
          userMessage,
          catalogProducts,
          bundles,
          messageIntent,
        );
        const aiResult = await callAI({
          triggerName:
            messageIntent === "price_sensitive"
              ? "price_sensitive_chat"
              : `chat:${messageIntent}`,
          systemPrompt,
          userPrompt: JSON.stringify({
            message: userMessage,
            recentHistory: (body.messageHistory || []).slice(-12),
          }),
          schemaType: "text",
          maxTokens: 300,
          timeoutProfile: messageIntent === "checkout_assistance" ? "urgent" : "normal",
          fallback: fallbackReply,
        });
        provider = aiResult.provider === "none" ? "heuristic" : aiResult.provider;
        finalReply = aiResult.content || fallbackReply;

        finalReply = sanitizeAssistantReplyToCatalog({
          reply: finalReply,
          userMessage,
          messageIntent,
          catalog: catalogProducts,
          fallback: fallbackReply,
        });
        send({ delta: finalReply });

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
  messageIntent = "general",
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

  const matches = messageIntent === "price_sensitive"
    ? catalogProducts
        .slice()
        .sort((left, right) => Number(left.price || 0) - Number(right.price || 0))
        .slice(0, 3)
    : scoredProducts.length > 0
      ? scoredProducts.map((item) => item.product)
      : catalogProducts.slice(0, 3);

  const intro = messageIntent === "price_sensitive"
    ? "Here are lower-priced options from this store:"
    : scoredProducts.length > 0
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

function classifyMessageIntent(value: string) {
  if (
    /\b(expensive|cheaper|cheap|discount|coupon|promo|deal|sale|price|afford|budget|cost)\b/i.test(
      value,
    )
  ) {
    return "price_sensitive";
  }

  if (/\b(compare|versus|vs|alternative|similar|difference)\b/i.test(value)) {
    return "comparison";
  }

  if (/\b(warranty|protect|support|installment|payment|pay later)\b/i.test(value)) {
    return "checkout_assistance";
  }

  return "general";
}
