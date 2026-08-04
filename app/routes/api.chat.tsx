import {
  data as json,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { callAI } from "../ai/client.server";
import prisma from "../db.server";
import { getActiveBundlesForProduct } from "../models/bundle.server";
import {
  filterBundlesToCatalog,
  filterCatalogProducts,
  sanitizeAssistantReplyToCatalog,
} from "../models/catalogGuard.server";
import {
  getRecommendationCatalog,
  pickCatalogProducts,
} from "../models/catalogCache.server";
import {
  buildCatalogFallbackReply,
  classifyMessageIntent,
  enforceReplyCurrency,
  findRequestedCartProduct,
  formatPrice,
  getReplyProductCards,
  normalizeCurrencyCode,
  sanitizeMessageHistory,
  type BundleSummary,
  type ChatMessageHistory,
  type CurrencyInfo,
} from "../models/chatResponse";
import { getSafeDefaultVariantId } from "../models/productCatalogMapping";
import {
  getShopperSession,
  upsertShopperSessionFromEvents,
} from "../models/session.server";
import {
  cacheKeys,
  getJsonCache,
  incrementRateLimit,
  setJsonCache,
} from "../redis.server";
import { unauthenticated } from "../shopify.server";
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
  messageHistory?: ChatMessageHistory;
  currency?: string;
  currencySource?: string;
  moneyFormat?: string;
  moneyWithCurrencyFormat?: string;
  locale?: string;
};

type ChatCartAction = {
  type: "add_to_cart";
  productId: string;
  productTitle: string;
  variantId: string;
  quantity: number;
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
    return json(
      { error: "Invalid JSON" },
      { status: 400, headers: withCors() },
    );
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
  const userMessage =
    typeof body.message === "string" ? body.message.trim().slice(0, 1000) : "";
  const messageHistory = sanitizeMessageHistory(body.messageHistory);
  const messageIntent = classifyMessageIntent(userMessage);

  if (!shop || !sessionId || !userMessage) {
    return json(
      { error: "Invalid request" },
      { status: 400, headers: withCors() },
    );
  }

  if (!(await isInstalledShop(shop))) {
    return json(
      { error: "Invalid shop" },
      { status: 401, headers: withCors() },
    );
  }

  const chatRequestCount = await incrementRateLimit(
    cacheKeys.chatRateLimit(sessionId),
    60,
  );
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

  const storeName = shop
    .replace(/\.[^.]+\.myshopify\.com$/, "")
    .replace(/[-_]/g, " ");
  const currency = await resolveCurrencyInfo(shop, body);
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
  const requestedCartProduct = findRequestedCartProduct(
    userMessage,
    messageHistory,
    safeRecommendationProducts,
  );

  const cartInfo =
    cartProducts.length > 0
      ? cartProducts
          .map((p) => `- ${p.title} (${formatPrice(p.price, currency)})`)
          .join("\n")
      : "Cart is empty";

  const bundles = filterBundlesToCatalog(
    rawBundles as unknown as BundleSummary[],
    catalogProducts,
  );
  const bundlesInfo =
    bundles.length > 0
      ? bundles
          .map((b) => {
            const items = b.items
              .map((i) => `  - ${i.product?.title || i.productId}`)
              .join("\n");
            return `- "${b.name}"\n${items}`;
          })
          .join("\n")
      : "No active bundles right now.";

  const catalogInfo =
    catalogProducts.length > 0
      ? catalogProducts
          .map(
            (p) =>
              `- ${p.title} | ${formatPrice(p.price, currency)} | /products/${p.handle} | tags: ${p.tags.join(", ")}`,
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
- Cart-value goal: ${formatPrice(settings.discountThreshold, currency)}
- Active currency code: ${currency.code}
- Blocked product GIDs: ${settings.blockedProductIds.join(", ") || "none"}
- Shopper journey stage: ${session.journeyStage}

Guidelines:
- Greet warmly, ask one focused question at a time
- Use the shopper's browsing context to make hyper-relevant suggestions
- When recommending products, explain WHY they go together and include the /products/ link
- Reference active bundles when they match what the shopper is looking at
- Never invent or promise discount codes; suggest real lower-priced alternatives when the shopper is price-sensitive
- Use the active store currency exactly as shown in the catalog and threshold above. Do not use $, dollars, or USD unless the active currency code is USD.
- Tone: ${settings.aiTone}
- Keep responses under 3 sentences unless the shopper asks for detail
- Never be pushy; if the shopper declines, respect it immediately
${brandVoiceSection}`;

  const encoder = new TextEncoder();
  let finalReply = "";
  let provider: "gemini" | "groq" | "mistral" | "deepseek" | "heuristic" =
    "heuristic";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (value: unknown) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(value)}\n\n`),
        );
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
          currency,
        );
        if (requestedCartProduct) {
          const variantId = getSafeDefaultVariantId(
            requestedCartProduct.metafields,
          );
          const productCards = getReplyProductCards(
            `${requestedCartProduct.title} /products/${requestedCartProduct.handle}`,
            safeRecommendationProducts,
            currency,
          );
          const deterministicReply = variantId
            ? `Adding ${requestedCartProduct.title} to your cart.`
            : `I found ${requestedCartProduct.title}, but I need you to choose an option on the product page before adding it to cart: /products/${requestedCartProduct.handle}`;
          const cartAction: ChatCartAction | undefined = variantId
            ? {
                type: "add_to_cart",
                productId: requestedCartProduct.id,
                productTitle: requestedCartProduct.title,
                variantId,
                quantity: 1,
              }
            : undefined;

          send({
            delta: deterministicReply,
            productCards,
            cartAction,
          });
          await persistAssistantMessage(
            shop,
            session.id,
            deterministicReply,
            "heuristic",
          );
          done();
          return;
        }

        const aiResult = await callAI({
          triggerName:
            messageIntent === "price_sensitive"
              ? "price_sensitive_chat"
              : `chat:${messageIntent}`,
          systemPrompt,
          userPrompt: JSON.stringify({
            message: userMessage,
            recentHistory: messageHistory,
            activeCurrency: currency,
          }),
          schemaType: "text",
          maxTokens: 300,
          timeoutProfile:
            messageIntent === "checkout_assistance" ? "urgent" : "normal",
          fallback: fallbackReply,
        });
        provider =
          aiResult.provider === "none" ? "heuristic" : aiResult.provider;
        finalReply = aiResult.content || fallbackReply;

        finalReply = sanitizeAssistantReplyToCatalog({
          reply: finalReply,
          userMessage,
          messageIntent,
          catalog: catalogProducts,
          fallback: fallbackReply,
        });
        finalReply = enforceReplyCurrency(finalReply, fallbackReply, currency);
        send({
          delta: finalReply,
          productCards: getReplyProductCards(
            finalReply,
            safeRecommendationProducts,
            currency,
          ),
        });

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
    prisma.shop.findUnique({
      where: { shopDomain: shop },
      select: { shopDomain: true },
    }),
  ]);

  return Boolean(session || legacyShop);
}

async function resolveCurrencyInfo(
  shop: string,
  body: ChatBody,
): Promise<CurrencyInfo> {
  const clientCurrency = normalizeCurrencyInfo(body, "");
  const storeCurrency = await getCachedShopCurrencyInfo(shop);
  const source = stringOrEmpty(body.currencySource);
  const clientLooksLikeFallback =
    source === "fallback" || (!source && clientCurrency.code === "USD");
  const shouldTrustClient =
    Boolean(clientCurrency.code) && !clientLooksLikeFallback;

  return {
    code: shouldTrustClient
      ? clientCurrency.code
      : storeCurrency?.code || clientCurrency.code || "USD",
    moneyFormat: shouldTrustClient
      ? clientCurrency.moneyFormat || storeCurrency?.moneyFormat
      : storeCurrency?.moneyFormat || clientCurrency.moneyFormat,
    moneyWithCurrencyFormat: shouldTrustClient
      ? clientCurrency.moneyWithCurrencyFormat ||
        storeCurrency?.moneyWithCurrencyFormat
      : storeCurrency?.moneyWithCurrencyFormat ||
        clientCurrency.moneyWithCurrencyFormat,
    locale: clientCurrency.locale || storeCurrency?.locale,
    source: shouldTrustClient
      ? source || "storefront"
      : storeCurrency?.source || source,
  };
}

function normalizeCurrencyInfo(body: ChatBody, fallback = "USD"): CurrencyInfo {
  return {
    code: normalizeCurrencyCode(body.currency, fallback),
    moneyFormat: stringOrEmpty(body.moneyFormat),
    moneyWithCurrencyFormat: stringOrEmpty(body.moneyWithCurrencyFormat),
    locale: stringOrEmpty(body.locale),
    source: stringOrEmpty(body.currencySource),
  };
}

async function getCachedShopCurrencyInfo(shop: string) {
  const key = `shop-currency:${shop}`;
  const cached = await getJsonCache<CurrencyInfo>(key);
  if (cached?.code) return cached;

  try {
    const { admin } = await unauthenticated.admin(shop);
    const response = await admin.graphql(`#graphql
      query AOVBoostShopCurrency {
        shop {
          currencyCode
          currencyFormats {
            moneyFormat
            moneyWithCurrencyFormat
          }
        }
      }
    `);
    const json = await response.json();
    const shopData = json?.data?.shop || {};
    const currency: CurrencyInfo = {
      code: normalizeCurrencyCode(shopData.currencyCode),
      moneyFormat: stringOrEmpty(shopData.currencyFormats?.moneyFormat),
      moneyWithCurrencyFormat: stringOrEmpty(
        shopData.currencyFormats?.moneyWithCurrencyFormat,
      ),
      source: "shopify_admin",
    };
    await setJsonCache(key, currency, 60 * 60 * 6);
    return currency;
  } catch (error) {
    console.warn("AOVBoost could not resolve shop currency:", {
      shop,
      error: getErrorMessage(error),
    });
    return null;
  }
}

function stringOrEmpty(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}
