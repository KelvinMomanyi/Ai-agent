import prisma from "../db.server";
import { cachedReport } from "./reportCache.server";
import { salesQuery } from "./analyticsQueries.server";

export type SalesAnalyticsReport = {
  chatImpressions: number;
  chatOpens: number;
  customerMessages: number;
  recommendationsShown: number;
  recommendationClickRate: number;
  recommendationAddToCartRate: number;
  upsellsShown: number;
  upsellAcceptanceRate: number;
  aiAssistedAddToCart: number;
  checkoutStarted: number;
  orders: number;
  aiAssistedOrders: number;
  aiAttributedRevenue: number;
  averageOrderValue: number;
  aiAssistedAov: number;
  nonAiAov: number;
  aiEngagedConversionRate: number;
  nonEngagedConversionRate: number;
  objectionToPurchaseRate: number;
  proactiveMessageConversionRate: number;
};

export async function getSalesAnalytics(
  shop: string,
  from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
): Promise<SalesAnalyticsReport> {
  return cachedReport(shop, "sales", from, async () => {
    const [row] = await prisma.$queryRaw<
      Array<{ report: Record<string, number> }>
    >(salesQuery(shop, from));
    const r = row.report;
    return {
      chatImpressions: r.chatImpressions,
      chatOpens: r.chatOpens,
      customerMessages: r.customerMessages,
      recommendationsShown: r.recommendationsShown,
      recommendationClickRate: ratio(
        r.recommendationClicks,
        r.recommendationsShown,
      ),
      recommendationAddToCartRate: ratio(
        r.recommendationAdds,
        r.recommendationsShown,
      ),
      upsellsShown: r.upsellsShown,
      upsellAcceptanceRate: ratio(r.upsellAdds, r.upsellsShown),
      aiAssistedAddToCart: r.recommendationAdds + r.upsellAdds,
      checkoutStarted: r.checkoutStarted,
      orders: r.orders,
      aiAssistedOrders: r.aiAssistedOrders,
      aiAttributedRevenue: r.aiAttributedRevenue,
      averageOrderValue: r.averageOrderValue,
      aiAssistedAov: r.aiAssistedAov,
      nonAiAov: r.nonAiAov,
      aiEngagedConversionRate: ratio(r.engagedPurchased, r.engaged),
      nonEngagedConversionRate: ratio(r.nonEngagedPurchased, r.nonEngaged),
      objectionToPurchaseRate: ratio(r.objectionsPurchased, r.objections),
      proactiveMessageConversionRate: ratio(r.proactivePurchased, r.proactive),
    };
  });
}

/** Reference reducer used to verify SQL reporting against existing attribution semantics. */
export function summarizeSalesAnalytics(input: {
  sessions: Array<{
    chatEngaged: boolean;
    purchaseCompleted: boolean;
    checkoutStarted: boolean;
    shopperProfile: unknown;
    context: unknown;
  }>;
  events: Array<{ type: string; sessionId: string; payload: unknown }>;
  outcomes: Array<{
    recommendationType: string;
    clickedAt: unknown;
    addedAt: unknown;
  }>;
  orders: Array<{ data: unknown }>;
}): SalesAnalyticsReport {
  const { sessions, events, outcomes, orders } = input;
  const eventCount = (type: string) =>
    events.filter((event) => event.type === type).length;
  const uniqueEventSessions = (...types: string[]) =>
    new Set(
      events
        .filter((event) => types.includes(event.type))
        .map((event) => event.sessionId),
    ).size;
  const recommendationRows = outcomes.filter(
    (outcome) => outcome.recommendationType !== "upsell",
  );
  const upsellRows = outcomes.filter(
    (outcome) => outcome.recommendationType === "upsell",
  );
  const aiAssistedOrders = orders.filter(
    (order) => asRecord(order.data).aiAssisted === true,
  );
  const nonAiOrders = orders.filter(
    (order) => asRecord(order.data).aiAssisted !== true,
  );
  const orderTotals = orders.map((order) => orderTotal(order.data));
  const aiOrderTotals = aiAssistedOrders.map((order) => orderTotal(order.data));
  const nonAiOrderTotals = nonAiOrders.map((order) => orderTotal(order.data));
  const engagedSessions = sessions.filter((session) => session.chatEngaged);
  const nonEngagedSessions = sessions.filter((session) => !session.chatEngaged);
  const objectionSessions = sessions.filter((session) => {
    const profile = asRecord(session.shopperProfile);
    return (
      Array.isArray(profile.knownObjections) &&
      profile.knownObjections.length > 0
    );
  });
  const proactiveSessions = sessions.filter(
    (session) =>
      Number(asRecord(session.context).proactivePromptCount || 0) > 0,
  );
  const chatImpressions = events.filter(
    (event) =>
      event.type === "widget_impression" &&
      String(asRecord(event.payload).widgetType || "") === "chat",
  ).length;
  const recommendationsShown = Math.max(
    recommendationRows.length,
    eventCount("recommendation_shown"),
  );
  const upsellsShown = Math.max(upsellRows.length, eventCount("upsell_shown"));
  const recommendationClicks = Math.max(
    recommendationRows.filter((outcome) => outcome.clickedAt).length,
    eventCount("recommendation_clicked"),
  );
  const recommendationAdds = Math.max(
    recommendationRows.filter((outcome) => outcome.addedAt).length,
    eventCount("recommendation_added"),
  );
  const upsellAdds = Math.max(
    upsellRows.filter((outcome) => outcome.addedAt).length,
    eventCount("upsell_added"),
  );

  return {
    chatImpressions,
    chatOpens: eventCount("chat_opened"),
    customerMessages: eventCount("customer_message_sent"),
    recommendationsShown,
    recommendationClickRate: ratio(recommendationClicks, recommendationsShown),
    recommendationAddToCartRate: ratio(
      recommendationAdds,
      recommendationsShown,
    ),
    upsellsShown,
    upsellAcceptanceRate: ratio(upsellAdds, upsellsShown),
    aiAssistedAddToCart: recommendationAdds + upsellAdds,
    checkoutStarted: Math.max(
      uniqueEventSessions("checkout_started", "checkout_start"),
      sessions.filter((session) => session.checkoutStarted).length,
    ),
    orders: orders.length,
    aiAssistedOrders: aiAssistedOrders.length,
    aiAttributedRevenue: aiAssistedOrders.reduce(
      (sum, order) =>
        sum + Number(asRecord(order.data).aiAttributedRevenue || 0),
      0,
    ),
    averageOrderValue: average(orderTotals),
    aiAssistedAov: average(aiOrderTotals),
    nonAiAov: average(nonAiOrderTotals),
    aiEngagedConversionRate: ratio(
      engagedSessions.filter((session) => session.purchaseCompleted).length,
      engagedSessions.length,
    ),
    nonEngagedConversionRate: ratio(
      nonEngagedSessions.filter((session) => session.purchaseCompleted).length,
      nonEngagedSessions.length,
    ),
    objectionToPurchaseRate: ratio(
      objectionSessions.filter((session) => session.purchaseCompleted).length,
      objectionSessions.length,
    ),
    proactiveMessageConversionRate: ratio(
      proactiveSessions.filter((session) => session.purchaseCompleted).length,
      proactiveSessions.length,
    ),
  };
}

function orderTotal(value: unknown) {
  return Math.max(Number(asRecord(value).total_price || 0), 0);
}

function average(values: number[]) {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

function ratio(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : 0;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
