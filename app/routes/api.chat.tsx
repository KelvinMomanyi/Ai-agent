import {
  data as json,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { callAI, parseAiJson } from "../ai/client.server";
import prisma from "../db.server";
import { getActiveBundlesForProduct } from "../models/bundle.server";
import {
  filterBundlesToCatalog,
  filterCatalogProducts,
  sanitizeAssistantReplyToCatalog,
} from "../models/catalogGuard.server";
import { pickCatalogProducts } from "../models/catalogCache.server";
import {
  formatConversationHistoryForPrompt,
  formatVisitorSignalsForPrompt,
  loadChatContextSources,
} from "../models/chatContext.server";
import { buildSalesAgentSystemPrompt } from "../models/chatPrompt.server";
import {
  buildCartSummaryReply,
  buildCatalogFallbackReply,
  classifyMessageIntent,
  enforceReplyCurrency,
  findRequestedCartProduct,
  formatCartContextForPrompt,
  formatCatalogProductsForPrompt,
  formatPrice,
  getCatalogProductCards,
  getReplyProductCards,
  normalizeLiveCartContext,
  normalizeCurrencyCode,
  resolveRequestedCartSelection,
  sanitizeMessageHistory,
  validateGroundedAiChatResponse,
  type BundleSummary,
  type ChatMessageHistory,
  type CurrencyInfo,
  type GroundedChatAction,
  type GroundedAiChatResponse,
} from "../models/chatResponse";
import {
  getShopperSession,
  upsertShopperSessionFromEvents,
} from "../models/session.server";
import { cacheKeys, incrementRateLimit } from "../redis.server";
import {
  buildStoreKnowledgeFallbackReply,
  formatStoreKnowledgeForPrompt,
  getStoreKnowledge,
  type StoreKnowledge,
} from "../models/storeKnowledge.server";
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
  storefrontContext?: {
    pageType?: string;
    path?: string;
    productId?: string;
    productHandle?: string;
  };
  cartContext?: unknown;
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
  const clientMessageHistory = sanitizeMessageHistory(body.messageHistory);
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

  const [settings, storeKnowledge, urgencyLevel, contextSources] =
    await Promise.all([
      prisma.appSettings.upsert({
        where: { shop },
        update: {},
        create: { shop },
      }),
      getStoreKnowledge(shop),
      getShopUrgencyLevel(shop),
      loadChatContextSources({
        shop,
        session,
        pageContext: body.storefrontContext,
        clientHistory: clientMessageHistory,
      }),
    ]);
  const catalogSnapshot = contextSources.catalog.snapshot;
  const messageHistory = contextSources.conversation.history;

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

  const currency = resolveCurrencyInfo(body, storeKnowledge);
  const safeCatalogProducts = filterCatalogProducts(
    catalogSnapshot.products,
    settings.blockedProductIds,
  );
  const liveCart = normalizeLiveCartContext(
    body.cartContext,
    catalogSnapshot.products,
  );
  const safeCatalogProductIds = new Set(
    safeCatalogProducts.map((product) => product.id),
  );
  const liveSafeCartProductIds = liveCart.items.flatMap((item) =>
    item.product && safeCatalogProductIds.has(item.product.id)
      ? [item.product.id]
      : [],
  );
  const effectiveCartProductIds =
    liveCart.status === "loaded"
      ? Array.from(new Set(liveSafeCartProductIds))
      : session.cartProductIds;
  const storefrontProduct = findStorefrontContextProduct(
    body.storefrontContext,
    safeCatalogProducts,
  );
  const recommendationSourceProductId =
    storefrontProduct?.id ||
    effectiveCartProductIds[0] ||
    contextSources.behavior.viewedProductIds.at(-1) ||
    session.viewedProductIds.at(-1);
  const rawBundles = await getActiveBundlesForProduct(
    shop,
    recommendationSourceProductId,
    { excludeProductIds: settings.blockedProductIds },
  );
  const bundles = filterBundlesToCatalog(
    rawBundles as unknown as BundleSummary[],
    safeCatalogProducts,
  );
  const bundleProductIds = bundles.flatMap((bundle) =>
    bundle.items.map((item) => item.productId),
  );
  const historyProductIds = getHistoryProductIds(
    messageHistory,
    safeCatalogProducts,
  );
  const previousUserMessage = messageHistory
    .filter((message) => message.role === "user")
    .at(-1)?.content;
  const catalogProducts = pickCatalogProducts({
    catalog: {
      ...catalogSnapshot,
      products: safeCatalogProducts,
      byId: Object.fromEntries(
        safeCatalogProducts.map((product) => [product.id, product]),
      ),
    },
    sourceProductId: recommendationSourceProductId,
    cartProductIds: effectiveCartProductIds,
    preferredProductIds: [
      ...bundleProductIds,
      ...historyProductIds,
      ...contextSources.behavior.viewedProductIds.slice(-8),
      ...contextSources.behavior.abandonedCartProductIds,
    ],
    includeContextProducts: true,
    excludeProductIds: settings.blockedProductIds,
    query: [
      previousUserMessage,
      userMessage,
      ...contextSources.behavior.recentSearchQueries,
    ]
      .filter(Boolean)
      .join("\n"),
    limit: 12,
  });
  const requestedCartSelection = resolveRequestedCartSelection(
    userMessage,
    messageHistory,
    safeCatalogProducts,
  );
  const promptBundles = filterBundlesToCatalog(bundles, catalogProducts);

  const cartInfo = formatCartContextForPrompt(liveCart, currency);

  const bundlesInfo =
    promptBundles.length > 0
      ? promptBundles
          .map((b) => {
            const items = b.items
              .map((i) => `  - ${i.product?.title || i.productId}`)
              .join("\n");
            return `- "${b.name}" (${b.discountValue} ${b.discountType})\n${items}`;
          })
          .join("\n")
      : "No active bundles right now.";

  const catalogInfo = formatCatalogProductsForPrompt(catalogProducts, currency);
  const storeInfo = formatStoreKnowledgeForPrompt({
    store: storeKnowledge,
    merchantKnowledge: settings.storeKnowledge,
    userMessage,
  });
  const visitorInfo = formatVisitorSignalsForPrompt(
    contextSources.behavior,
    catalogProducts,
  );
  const conversationInfo = formatConversationHistoryForPrompt(messageHistory);
  const systemPrompt = buildSalesAgentSystemPrompt({
    storeIdentity: storeInfo,
    allowedProducts: catalogInfo,
    cartState: cartInfo,
    visitorSignals: visitorInfo,
    conversationHistory: conversationInfo,
    activeBundles: bundlesInfo,
    assistantTone: settings.aiTone,
    brandVoice: settings.brandVoice || "",
    messageIntent,
    urgencyLevel,
    cartValueGoal: formatPrice(settings.discountThreshold, currency),
    catalogStatus: contextSources.catalog.status,
  });

  const fallbackReply =
    buildStoreKnowledgeFallbackReply(userMessage, storeKnowledge) ||
    buildCatalogFallbackReply(
      userMessage,
      catalogProducts,
      promptBundles,
      messageIntent,
      currency,
      messageIntent === "price_sensitive" || messageIntent === "product_search"
        ? effectiveCartProductIds
        : [],
    );

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
        if (requestedCartSelection) {
          const { product, variant } = requestedCartSelection;
          const productCards = getCatalogProductCards(
            [product],
            currency,
            variant ? { [product.id]: variant.id } : {},
          );
          const selectedOptions = variant
            ? formatSelectedVariantOptions(variant.selectedOptions)
            : "";
          const deterministicReply = variant
            ? `Adding ${product.title}${selectedOptions} to your cart.`
            : `I found ${product.title}. Choose the options you want below, then tap Add to cart.`;
          const cartAction: ChatCartAction | undefined = variant
            ? {
                type: "add_to_cart",
                productId: product.id,
                productTitle: product.title,
                variantId: variant.id,
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

        if (messageIntent === "cart_summary") {
          finalReply = buildCartSummaryReply(liveCart, currency);
          send({
            delta: finalReply,
            productCards: getReplyProductCards(
              finalReply,
              safeCatalogProducts,
              currency,
            ),
          });
          await persistAssistantMessage(
            shop,
            session.id,
            finalReply,
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
            activeCurrencyCode: currency.code,
            contextStatus: {
              catalog: contextSources.catalog.status,
              behavior: contextSources.behavior.status,
              conversation: contextSources.conversation.status,
              cart: liveCart.status,
            },
          }),
          schemaType: "json",
          maxTokens: 450,
          timeoutProfile:
            messageIntent === "checkout_assistance" ? "urgent" : "normal",
          fallback: JSON.stringify({
            reply: fallbackReply,
            productIds: [],
            action: null,
            followUpQuestion: null,
          }),
        });
        provider =
          aiResult.provider === "none" ? "heuristic" : aiResult.provider;
        const validated = validateGroundedAiChatResponse({
          value: parseAiJson<GroundedAiChatResponse>(aiResult.content),
          catalog: catalogProducts,
          fallback: fallbackReply,
          currency,
          userMessage,
          excludedProductIds:
            messageIntent === "price_sensitive" ||
            messageIntent === "product_search"
              ? effectiveCartProductIds
              : [],
        });
        if (validated.fallbackUsed) provider = "heuristic";
        finalReply = validated.reply;

        finalReply = sanitizeAssistantReplyToCatalog({
          reply: finalReply,
          userMessage,
          messageIntent,
          catalog: catalogProducts,
          fallback: fallbackReply,
        });
        finalReply = enforceReplyCurrency(finalReply, fallbackReply, currency);
        const aiCartAction = toExecutableAiCartAction(
          validated.action,
          validated.products,
          userMessage,
        );
        const productCards =
          validated.products.length > 0
            ? getCatalogProductCards(
                validated.products,
                currency,
                aiCartAction
                  ? { [aiCartAction.productId]: aiCartAction.variantId }
                  : {},
              )
            : getReplyProductCards(finalReply, catalogProducts, currency);
        send({
          delta: finalReply,
          productCards,
          suggestedAction: validated.action,
          cartAction: aiCartAction,
        });

        await persistAssistantMessage(shop, session.id, finalReply, provider);
        done();
      } catch (error) {
        console.error("AOVBoost chat stream failed:", getErrorMessage(error));
        if (!finalReply) {
          finalReply = fallbackReply;
          send({
            delta: finalReply,
            productCards: getReplyProductCards(
              finalReply,
              catalogProducts,
              currency,
            ),
          });
        }
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

async function getShopUrgencyLevel(shop: string) {
  try {
    const config = await prisma.shopConfig.findUnique({
      where: { shopDomain: shop },
      select: { urgencyLevel: true },
    });
    return config?.urgencyLevel || "balanced";
  } catch {
    return "balanced";
  }
}

function resolveCurrencyInfo(
  body: ChatBody,
  store: StoreKnowledge,
): CurrencyInfo {
  const clientCurrency = normalizeCurrencyInfo(body, "");
  const storeCurrency: CurrencyInfo = {
    code: normalizeCurrencyCode(store.currencyCode, ""),
    moneyFormat: store.moneyFormat,
    moneyWithCurrencyFormat: store.moneyWithCurrencyFormat,
    source: store.source,
  };
  const source = stringOrEmpty(body.currencySource);
  const clientLooksLikeFallback =
    source === "fallback" || (!source && clientCurrency.code === "USD");
  const shouldTrustClient =
    Boolean(clientCurrency.code) && !clientLooksLikeFallback;
  const code = shouldTrustClient
    ? clientCurrency.code
    : storeCurrency.code || clientCurrency.code || "USD";
  const storeFormatMatchesCurrency =
    !storeCurrency.code || storeCurrency.code === code;

  return {
    code,
    moneyFormat: shouldTrustClient
      ? clientCurrency.moneyFormat ||
        (storeFormatMatchesCurrency ? storeCurrency.moneyFormat : undefined)
      : storeCurrency.moneyFormat || clientCurrency.moneyFormat,
    moneyWithCurrencyFormat: shouldTrustClient
      ? clientCurrency.moneyWithCurrencyFormat ||
        (storeFormatMatchesCurrency
          ? storeCurrency.moneyWithCurrencyFormat
          : undefined)
      : storeCurrency.moneyWithCurrencyFormat ||
        clientCurrency.moneyWithCurrencyFormat,
    locale: clientCurrency.locale,
    source: shouldTrustClient
      ? source || "storefront"
      : storeCurrency.source || source,
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

function stringOrEmpty(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function findStorefrontContextProduct(
  context: ChatBody["storefrontContext"],
  catalog: Parameters<typeof findRequestedCartProduct>[2],
) {
  const requestedId = String(context?.productId || "").trim();
  const requestedHandle = String(context?.productHandle || "")
    .trim()
    .toLowerCase();
  const numericId = requestedId.split("/").filter(Boolean).pop() || "";
  const candidateIds = new Set(
    [
      requestedId,
      numericId,
      numericId ? `gid://shopify/Product/${numericId}` : "",
    ].filter(Boolean),
  );
  return (
    catalog.find((product) => candidateIds.has(product.id)) ||
    catalog.find(
      (product) =>
        requestedHandle && product.handle.toLowerCase() === requestedHandle,
    ) ||
    null
  );
}

function getHistoryProductIds(
  history: ChatMessageHistory,
  catalog: Parameters<typeof findRequestedCartProduct>[2],
) {
  const text = history
    .slice(-6)
    .map((message) => message.content)
    .join("\n")
    .toLowerCase();
  return catalog
    .filter((product) => {
      const title = product.title
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();
      return (
        text.includes(`/products/${product.handle.toLowerCase()}`) ||
        (title.length >= 3 && text.includes(title))
      );
    })
    .map((product) => product.id)
    .slice(0, 8);
}

function formatSelectedVariantOptions(
  options: Array<{ name: string; value: string }>,
) {
  const label = options
    .slice(0, 5)
    .map((option) => `${option.name}: ${option.value}`)
    .join(", ");
  return label ? ` (${label})` : "";
}

function toExecutableAiCartAction(
  action: GroundedChatAction | null,
  products: Parameters<typeof getCatalogProductCards>[0],
  userMessage: string,
): ChatCartAction | undefined {
  if (
    action?.type !== "add_to_cart" ||
    !isExplicitAddToCartRequest(userMessage)
  ) {
    return undefined;
  }
  const product = products.find(
    (candidate) => candidate.id === action.productId,
  );
  if (!product) return undefined;
  return {
    type: "add_to_cart",
    productId: product.id,
    productTitle: product.title,
    variantId: action.variantId,
    quantity: action.quantity,
  };
}

function isExplicitAddToCartRequest(value: string) {
  if (
    /\b(?:don['\u2019]?t|do not|never|stop|cancel|not now)\b[^.!?]*\b(?:add|buy|purchase)\b/i.test(
      value,
    )
  ) {
    return false;
  }
  return (
    /\b(?:add|buy|purchase|get|take)\b.*\b(?:cart|bag|it|this|one|item|product)\b/i.test(
      value,
    ) || /\badd to (?:my |the )?(?:cart|bag)\b/i.test(value)
  );
}
