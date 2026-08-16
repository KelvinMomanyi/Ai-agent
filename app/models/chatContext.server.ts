import type { ShopperSession } from "@prisma/client";
import prisma from "../db.server";
import {
  getCatalogSnapshot,
  type CatalogCacheProduct,
  type CatalogSnapshot,
} from "./catalogCache.server";
import {
  sanitizeMessageHistory,
  type ChatMessageHistory,
} from "./chatResponse";

const RECENT_BEHAVIOR_EVENT_LIMIT = 120;
const PAGE_VIEW_HISTORY_LIMIT = 200;
const VISIT_GAP_MS = 30 * 60 * 1000;

export type StorefrontPageContext = {
  pageType?: string;
  path?: string;
  productId?: string;
  productHandle?: string;
};

export type BehaviorEventRow = {
  type: string;
  payload: unknown;
  createdAt: Date;
};

export type VisitorBehaviorContext = {
  status: "loaded" | "partial";
  journeyStage: string;
  intentScore: number;
  hesitationScore: number;
  viewedProductIds: string[];
  abandonedCartProductIds: string[];
  totalPageViews: number;
  sessionDurationSeconds: number;
  currentPage: {
    pageType: string;
    path: string;
    productId: string;
    timeOnPageSeconds: number | null;
    scrollDepthPercent: number | null;
  };
  referralSource: string;
  visitorType: "new" | "returning" | "unknown";
  pastSessionCount: number | null;
  recentSearchQueries: string[];
  lastSignal: string;
};

export type ChatContextSources = {
  catalog: {
    status: "loaded" | "unavailable";
    snapshot: CatalogSnapshot;
  };
  behavior: VisitorBehaviorContext;
  conversation: {
    status: "loaded" | "client_fallback";
    history: ChatMessageHistory;
  };
};

export async function loadChatContextSources(input: {
  shop: string;
  session: ShopperSession;
  pageContext?: StorefrontPageContext;
  clientHistory?: ChatMessageHistory;
}): Promise<ChatContextSources> {
  const [catalog, behavior, conversation] = await Promise.all([
    loadCatalogContext(input.shop),
    loadBehaviorContext(input.session, input.pageContext),
    loadConversationContext(
      input.shop,
      input.session.id,
      input.clientHistory || [],
    ),
  ]);

  return { catalog, behavior, conversation };
}

export function buildVisitorBehaviorContext(input: {
  session: Pick<
    ShopperSession,
    | "journeyStage"
    | "intentScore"
    | "hesitationScore"
    | "viewedProductIds"
    | "totalPageViews"
    | "sessionDuration"
    | "context"
  >;
  recentEvents: BehaviorEventRow[];
  pageViewEvents: Array<Pick<BehaviorEventRow, "createdAt">>;
  pageContext?: StorefrontPageContext;
  now?: Date;
  status?: "loaded" | "partial";
}): VisitorBehaviorContext {
  const now = input.now || new Date();
  const recentEvents = input.recentEvents
    .slice()
    .sort(
      (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
    );
  const path = cleanPath(input.pageContext?.path);
  const currentPageView = recentEvents.find((event) => {
    if (event.type !== "page_view") return false;
    if (!path) return true;
    return getEventPath(event.payload) === path;
  });
  const pageStartedAt = currentPageView?.createdAt || null;
  const pageEvents = pageStartedAt
    ? recentEvents.filter((event) => event.createdAt >= pageStartedAt)
    : recentEvents;
  const scrollDepths = pageEvents
    .filter((event) => event.type === "scroll_depth")
    .map((event) => Number(asRecord(event.payload).depth || 0))
    .filter((depth) => Number.isFinite(depth) && depth >= 0 && depth <= 100);
  const context = asRecord(input.session.context);
  const sessionMaxScroll = finiteNumber(context.maxScrollDepth);
  const scrollDepthPercent = pageStartedAt
    ? scrollDepths.length > 0
      ? Math.max(...scrollDepths)
      : 0
    : sessionMaxScroll === null
      ? null
      : clamp(sessionMaxScroll, 0, 100);
  const referral = recentEvents
    .map((event) => cleanReferral(asRecord(event.payload).referrer))
    .find(Boolean);
  const abandonedCartEvent = recentEvents.find(
    (event) => event.type === "cart_abandoned",
  );
  const abandonedCartProductIds = abandonedCartEvent
    ? getCartProductIds(abandonedCartEvent.payload)
    : [];
  const recentSearchQueries = Array.from(
    new Set(
      recentEvents
        .filter((event) => ["search", "search_query"].includes(event.type))
        .map((event) => cleanText(asRecord(event.payload).query, 120))
        .filter(Boolean),
    ),
  ).slice(0, 5);
  const visitCount = countVisitWindows(input.pageViewEvents);
  const hasFirstTimeSignal = recentEvents.some(
    (event) => event.type === "first_time_visitor",
  );
  const visitorType =
    visitCount > 1 ? "returning" : hasFirstTimeSignal ? "new" : "unknown";
  const timeOnPageSeconds = pageStartedAt
    ? clamp(
        Math.round((now.getTime() - pageStartedAt.getTime()) / 1000),
        0,
        4 * 60 * 60,
      )
    : null;

  return {
    status: input.status || "loaded",
    journeyStage: cleanText(input.session.journeyStage, 40) || "discovering",
    intentScore: clamp(finiteNumber(input.session.intentScore) || 0, 0, 100),
    hesitationScore: clamp(
      finiteNumber(input.session.hesitationScore) || 0,
      0,
      100,
    ),
    viewedProductIds: input.session.viewedProductIds
      .map(String)
      .filter(Boolean)
      .slice(-30),
    abandonedCartProductIds,
    totalPageViews: clamp(
      Math.round(finiteNumber(input.session.totalPageViews) || 0),
      0,
      100_000,
    ),
    sessionDurationSeconds: clamp(
      Math.round(finiteNumber(input.session.sessionDuration) || 0),
      0,
      30 * 24 * 60 * 60,
    ),
    currentPage: {
      pageType: cleanText(input.pageContext?.pageType, 50),
      path,
      productId: cleanText(input.pageContext?.productId, 120),
      timeOnPageSeconds,
      scrollDepthPercent,
    },
    referralSource: referral || "",
    visitorType,
    pastSessionCount: visitCount > 0 ? Math.max(0, visitCount - 1) : null,
    recentSearchQueries,
    lastSignal: cleanText(context.lastEventType, 64),
  };
}

export function formatVisitorSignalsForPrompt(
  behavior: VisitorBehaviorContext,
  catalogProducts: CatalogCacheProduct[],
) {
  const byId = new Map(catalogProducts.map((product) => [product.id, product]));
  const viewedProducts = behavior.viewedProductIds
    .map((id) => byId.get(id))
    .filter((product): product is CatalogCacheProduct => Boolean(product))
    .slice(-8);
  const abandonedProducts = behavior.abandonedCartProductIds
    .map((id) => byId.get(id))
    .filter((product): product is CatalogCacheProduct => Boolean(product))
    .slice(0, 8);
  const currentProduct = byId.get(behavior.currentPage.productId);
  const currentPage = [
    behavior.currentPage.pageType,
    behavior.currentPage.path,
    currentProduct
      ? `verified product ${currentProduct.title} (${currentProduct.id})`
      : "",
  ]
    .filter(Boolean)
    .join("; ");

  return [
    `Behavior context status: ${behavior.status}`,
    `Journey stage: ${behavior.journeyStage}`,
    `Intent score: ${Math.round(behavior.intentScore)}/100`,
    `Hesitation score: ${Math.round(behavior.hesitationScore)}/100`,
    `Visitor type: ${behavior.visitorType}`,
    behavior.pastSessionCount === null
      ? "Past session count: unavailable"
      : `Past session count: ${behavior.pastSessionCount}`,
    `Page views recorded: ${behavior.totalPageViews}`,
    `Session duration: ${behavior.sessionDurationSeconds} seconds`,
    currentPage ? `Current page: ${currentPage}` : "Current page: unavailable",
    behavior.currentPage.timeOnPageSeconds === null
      ? "Time on current page: unavailable"
      : `Time on current page: ${behavior.currentPage.timeOnPageSeconds} seconds`,
    behavior.currentPage.scrollDepthPercent === null
      ? "Current-page scroll depth: unavailable"
      : `Current-page scroll depth: ${behavior.currentPage.scrollDepthPercent}%`,
    behavior.referralSource
      ? `Referral source: ${behavior.referralSource}`
      : "Referral source: unavailable or direct",
    viewedProducts.length > 0
      ? `Verified products viewed: ${viewedProducts
          .map((product) => `${product.title} (${product.id})`)
          .join(", ")}`
      : `Verified products viewed: none available (${behavior.viewedProductIds.length} tracked IDs)`,
    abandonedProducts.length > 0
      ? `Previously abandoned verified cart products: ${abandonedProducts
          .map((product) => `${product.title} (${product.id})`)
          .join(", ")}`
      : "Previously abandoned verified cart products: none available",
    behavior.recentSearchQueries.length > 0
      ? `Recent searches: ${behavior.recentSearchQueries.join(", ")}`
      : "Recent searches: none available",
    behavior.lastSignal ? `Last recorded signal: ${behavior.lastSignal}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatConversationHistoryForPrompt(
  history: ChatMessageHistory,
) {
  if (history.length === 0) return "No prior chat turns in this session.";
  return history
    .slice(-10)
    .map(
      (message) =>
        `${message.role === "user" ? "Shopper" : "Assistant"}: ${cleanText(message.content, 1_000)}`,
    )
    .join("\n");
}

async function loadCatalogContext(shop: string) {
  try {
    return {
      status: "loaded" as const,
      snapshot: await getCatalogSnapshot(shop),
    };
  } catch (error) {
    console.warn("AOVBoost chat catalog context unavailable:", {
      shop,
      error: getErrorMessage(error),
    });
    return {
      status: "unavailable" as const,
      snapshot: emptyCatalogSnapshot(shop),
    };
  }
}

async function loadBehaviorContext(
  session: ShopperSession,
  pageContext?: StorefrontPageContext,
) {
  try {
    const [recentEvents, pageViewEvents] = await Promise.all([
      prisma.shopperEvent.findMany({
        where: { sessionId: session.id, shop: session.shop },
        select: { type: true, payload: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: RECENT_BEHAVIOR_EVENT_LIMIT,
      }),
      prisma.shopperEvent.findMany({
        where: {
          sessionId: session.id,
          shop: session.shop,
          type: "page_view",
        },
        select: { createdAt: true },
        orderBy: { createdAt: "desc" },
        take: PAGE_VIEW_HISTORY_LIMIT,
      }),
    ]);
    return buildVisitorBehaviorContext({
      session,
      recentEvents,
      pageViewEvents,
      pageContext,
    });
  } catch (error) {
    console.warn("AOVBoost chat behavior context unavailable:", {
      shop: session.shop,
      sessionId: session.id,
      error: getErrorMessage(error),
    });
    return buildVisitorBehaviorContext({
      session,
      recentEvents: [],
      pageViewEvents: [],
      pageContext,
      status: "partial",
    });
  }
}

async function loadConversationContext(
  shop: string,
  sessionId: string,
  clientHistory: ChatMessageHistory,
) {
  try {
    const rows = await prisma.chatMessage.findMany({
      where: { shop, sessionId },
      select: { role: true, content: true },
      orderBy: { createdAt: "desc" },
      take: 12,
    });
    return {
      status: "loaded" as const,
      history: sanitizeMessageHistory(rows.slice().reverse()),
    };
  } catch (error) {
    console.warn("AOVBoost chat conversation context unavailable:", {
      shop,
      sessionId,
      error: getErrorMessage(error),
    });
    return {
      status: "client_fallback" as const,
      history: sanitizeMessageHistory(clientHistory),
    };
  }
}

function emptyCatalogSnapshot(shop: string): CatalogSnapshot {
  return {
    shop,
    refreshedAt: new Date(0).toISOString(),
    productCount: 0,
    products: [],
    byId: {},
    byCategory: {},
    byTag: {},
  };
}

function countVisitWindows(events: Array<Pick<BehaviorEventRow, "createdAt">>) {
  const timestamps = events
    .map((event) => event.createdAt.getTime())
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  if (timestamps.length === 0) return 0;
  let visits = 1;
  for (let index = 1; index < timestamps.length; index += 1) {
    if (timestamps[index] - timestamps[index - 1] > VISIT_GAP_MS) visits += 1;
  }
  return visits;
}

function getCartProductIds(value: unknown) {
  const payload = asRecord(value);
  const directIds = Array.isArray(payload.cartProductIds)
    ? payload.cartProductIds.map(String)
    : [];
  const itemIds = Array.isArray(payload.cartItems)
    ? payload.cartItems.map((item) => String(asRecord(item).productId || ""))
    : [];
  return Array.from(new Set([...directIds, ...itemIds].filter(Boolean))).slice(
    0,
    30,
  );
}

function getEventPath(value: unknown) {
  const url = cleanText(asRecord(value).url, 1_000);
  if (!url) return "";
  try {
    return cleanPath(new URL(url).pathname);
  } catch {
    return cleanPath(url);
  }
}

function cleanReferral(value: unknown) {
  const referral = cleanText(value, 1_000);
  if (!referral) return "";
  try {
    const url = new URL(referral);
    return url.hostname.toLowerCase().slice(0, 255);
  } catch {
    return cleanText(referral.split(/[/?#]/)[0], 255);
  }
}

function cleanPath(value: unknown) {
  const path = cleanText(value, 300);
  return path.startsWith("/") && !path.startsWith("//") ? path : "";
}

function cleanText(value: unknown, maxLength: number) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function finiteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
