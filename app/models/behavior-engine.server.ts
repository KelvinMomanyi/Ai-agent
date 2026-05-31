import type { VisitorSession } from "@prisma/client";
import prisma from "../db.server";

export type IntentProfile = "browsing" | "considering" | "high_intent" | "price_sensitive" | "abandoning";

export async function getSessionForVisitor(storeId: string, visitorId: string): Promise<VisitorSession> {
  let session = await prisma.visitorSession.findFirst({
    where: { storeId, visitorId },
    orderBy: { lastActivity: "desc" },
  });

  if (!session || isSessionExpired(session)) {
    session = await prisma.visitorSession.create({
      data: {
        storeId,
        visitorId,
        sessionStart: new Date(),
        lastActivity: new Date(),
        viewedProducts: [],
        cartAdds: [],
        cartRemoves: [],
        scrollDepths: {},
        pageViews: 0,
        totalDwellMs: 0,
        intentProfile: "browsing",
        intentScore: 0,
      },
    });
  }

  return session;
}

export async function updateSessionSignal(
  storeId: string,
  visitorId: string,
  signals: Array<{ type: string; data: any; timestamp: string }>
): Promise<VisitorSession> {
  const session = await getSessionForVisitor(storeId, visitorId);
  
  let viewedProducts = parseJsonArray(session.viewedProducts);
  let cartAdds = parseJsonArray(session.cartAdds);
  let cartRemoves = parseJsonArray(session.cartRemoves);
  let scrollDepths = parseJsonObject(session.scrollDepths);
  let pageViews = session.pageViews;
  let totalDwellMs = session.totalDwellMs;

  for (const signal of signals) {
    switch (signal.type) {
      case "page_view":
        pageViews++;
        if (signal.data.device && !session.device) {
          await prisma.visitorSession.update({
            where: { id: session.id },
            data: { device: signal.data.device }
          });
        }
        if (signal.data.trafficSource && !session.trafficSource) {
           await prisma.visitorSession.update({
            where: { id: session.id },
            data: { trafficSource: signal.data.trafficSource, referrer: signal.data.referrer }
          });
        }
        break;
      case "product_view": {
        const { id, title } = signal.data;
        const existing = viewedProducts.find((p: any) => p.id === id);
        if (existing) {
          existing.viewCount = (existing.viewCount || 1) + 1;
        } else {
          viewedProducts.push({ id, title, viewCount: 1, dwellMs: 0 });
        }
        break;
      }
      case "dwell": {
        totalDwellMs += signal.data.durationMs;
        if (signal.data.productId) {
          const product = viewedProducts.find((p: any) => p.id === signal.data.productId);
          if (product) {
            product.dwellMs = (product.dwellMs || 0) + signal.data.durationMs;
          }
        }
        break;
      }
      case "scroll_depth": {
        const { path, depth } = signal.data;
        const currentDepth = scrollDepths[path] || 0;
        if (depth > currentDepth) {
          scrollDepths[path] = depth;
        }
        break;
      }
      case "cart_add":
        cartAdds.push({ variantId: signal.data.variantId, timestamp: signal.timestamp });
        break;
      case "cart_remove":
        cartRemoves.push({ variantId: signal.data.variantId, timestamp: signal.timestamp });
        break;
    }
  }

  // Update intent based on new signals
  const newIntent = classifyIntent({
    ...session,
    viewedProducts,
    cartAdds,
    cartRemoves,
    scrollDepths,
    pageViews,
    totalDwellMs
  });

  return await prisma.visitorSession.update({
    where: { id: session.id },
    data: {
      viewedProducts: JSON.stringify(viewedProducts),
      cartAdds: JSON.stringify(cartAdds),
      cartRemoves: JSON.stringify(cartRemoves),
      scrollDepths: JSON.stringify(scrollDepths),
      pageViews,
      totalDwellMs,
      intentProfile: newIntent.profile,
      intentScore: newIntent.score,
      lastActivity: new Date(),
    },
  });
}

function classifyIntent(session: any): { profile: IntentProfile; score: number } {
  const views = parseJsonArray(session.viewedProducts);
  const adds = parseJsonArray(session.cartAdds);
  const removes = parseJsonArray(session.cartRemoves);

  let score = 0;
  let profile: IntentProfile = "browsing";

  // Score base activity
  score += session.pageViews * 5;
  score += Math.min(session.totalDwellMs / 1000, 300) * 0.1; // Cap dwell score

  const maxProductViews = Math.max(...views.map((v: any) => v.viewCount || 1), 0);

  if (removes.length > 0) {
    profile = "price_sensitive";
    score += 20;
    // If they have adds but removes, they are hesitating
    if (adds.length > 0 && (new Date().getTime() - new Date(session.lastActivity).getTime()) > 30000) {
       profile = "abandoning";
    }
  } else if (adds.length > 0) {
    profile = "high_intent";
    score += 50;
  } else if (maxProductViews >= 2 || session.totalDwellMs > 45000) {
    profile = "considering";
    score += 30;
  }

  // Exit intent or long idle with items in cart is abandoning
  if (adds.length > removes.length) {
     const idleMs = new Date().getTime() - new Date(session.lastActivity).getTime();
     if (idleMs > 60000) {
       profile = "abandoning";
     }
  }

  return { profile, score };
}

function isSessionExpired(session: VisitorSession): boolean {
  // Session expires after 2 hours of inactivity
  const expiryTime = 2 * 60 * 60 * 1000;
  return (new Date().getTime() - new Date(session.lastActivity).getTime()) > expiryTime;
}

function parseJsonArray(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return []; }
  }
  return [];
}

function parseJsonObject(value: any): Record<string, any> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) return value;
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return {}; }
  }
  return {};
}
