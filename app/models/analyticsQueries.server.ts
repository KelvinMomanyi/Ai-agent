import { Prisma } from "@prisma/client";

// Queries return aggregate JSON, never raw shopper history or offer payloads.
// All shop and time inputs are bound parameters, including JSON joins.
export function revenueQuery(shop: string, from: Date) {
  return Prisma.sql`
    WITH offers AS MATERIALIZED (
      SELECT * FROM "Offer" WHERE shop = ${shop} AND "createdAt" >= ${from}
    ), orders AS MATERIALIZED (
      SELECT *, CASE WHEN jsonb_typeof(data->'offerIds') = 'array' THEN data->'offerIds' ELSE '[]'::jsonb END ids,
        CASE WHEN COALESCE(NULLIF(data->>'total_price', ''), data->>'totalPrice', '0') ~ '^-?[0-9]{1,18}([.][0-9]{1,6})?$'
          THEN COALESCE(NULLIF(data->>'total_price', ''), data->>'totalPrice', '0')::float ELSE 0 END total
      FROM "Event" WHERE "storeId" = ${shop} AND event = 'conversion' AND timestamp >= ${from}
    ), links AS MATERIALIZED (
      SELECT o.id, o.timestamp, value AS "offerId" FROM orders o CROSS JOIN LATERAL jsonb_array_elements_text(o.ids) value
    ), actions AS (
      SELECT COALESCE(NULLIF(payload->>'offerId', ''), payload->>'offer_id') id,
        MIN("createdAt") FILTER (WHERE type IN ('widget_impression', 'impression')) impression,
        MIN("createdAt") FILTER (WHERE type IN ('widget_click', 'click')) click
      FROM "ShopperEvent" WHERE shop = ${shop} AND "createdAt" >= ${from}
        AND type IN ('widget_impression', 'impression', 'widget_click', 'click') GROUP BY 1
    ), conversions AS (SELECT "offerId", MIN(timestamp) timestamp FROM links GROUP BY 1),
    widget AS (
      SELECT "widgetType", COUNT(*) FILTER (WHERE shown)::int impressions, COUNT(*) FILTER (WHERE clicked)::int clicks,
        COUNT(*) FILTER (WHERE converted)::int conversions, COALESCE(SUM("revenueImpact"), 0)::float revenue
      FROM offers GROUP BY 1
    ), funnel AS (
      SELECT COUNT(*)::int generated, COUNT(*) FILTER (WHERE shown)::int impressions,
        COUNT(*) FILTER (WHERE clicked)::int clicks, COUNT(*) FILTER (WHERE converted)::int conversions,
        COALESCE(SUM("revenueImpact"), 0)::float revenue FROM offers
    ), order_totals AS (
      SELECT COUNT(*) FILTER (WHERE jsonb_array_length(ids) > 0)::int attributed,
        COUNT(*) FILTER (WHERE jsonb_array_length(ids) = 0)::int baseline,
        COALESCE(AVG(total) FILTER (WHERE jsonb_array_length(ids) > 0), 0)::float aov,
        COALESCE(AVG(total) FILTER (WHERE jsonb_array_length(ids) = 0), 0)::float baseline_aov FROM orders
    ), revenue_days AS (
      SELECT to_char(l.timestamp, 'YYYY-MM-DD') date, COALESCE(o."revenueImpact", 0)::float revenue
      FROM links l LEFT JOIN offers o ON o.id = l."offerId"
      UNION ALL SELECT to_char(o."createdAt", 'YYYY-MM-DD'), COALESCE(o."revenueImpact", 0)::float
      FROM offers o WHERE o.converted AND NOT EXISTS (SELECT 1 FROM links l WHERE l."offerId" = o.id)
    ), series AS (
      SELECT to_char(o."createdAt", 'YYYY-MM-DD') date, 1 generated, 0 impressions, 0 clicks, 0 conversions, 0::float revenue FROM offers o
      UNION ALL SELECT to_char(COALESCE(a.impression, o."createdAt"), 'YYYY-MM-DD'), 0, 1, 0, 0, 0 FROM offers o LEFT JOIN actions a ON a.id = o.id WHERE o.shown
      UNION ALL SELECT to_char(COALESCE(a.click, o."createdAt"), 'YYYY-MM-DD'), 0, 0, 1, 0, 0 FROM offers o LEFT JOIN actions a ON a.id = o.id WHERE o.clicked
      UNION ALL SELECT to_char(COALESCE(c.timestamp, o."createdAt"), 'YYYY-MM-DD'), 0, 0, 0, 1, COALESCE(o."revenueImpact", 0)::float FROM offers o LEFT JOIN conversions c ON c."offerId" = o.id WHERE o.converted
    ), named AS (
      SELECT *, LEFT(COALESCE(NULLIF(payload#>>'{bundle,name}', ''), NULLIF(payload#>>'{bundle,title}', ''),
        NULLIF(payload#>>'{copy,headline}', ''), NULLIF(payload->>'headline', ''), NULLIF(payload#>>'{product,title}', ''),
        NULLIF(payload#>>'{products,0,title}', ''), initcap(replace("widgetType", '_', ' '))), 120) name FROM offers
    ), offer_rows AS (
      SELECT name, "widgetType", COUNT(*)::int generated, COUNT(*) FILTER (WHERE shown)::int impressions,
        COUNT(*) FILTER (WHERE clicked)::int clicks, COUNT(*) FILTER (WHERE converted)::int conversions,
        COALESCE(SUM("revenueImpact"), 0)::float revenue FROM named GROUP BY 1, 2
      ORDER BY revenue DESC, conversions DESC, clicks DESC LIMIT 10
    ), experiment_rows AS (
      SELECT COALESCE(e.name, 'Archived experiment') experiment, o."abVariant" variant, COUNT(*)::int generated,
        COUNT(*) FILTER (WHERE o.shown)::int impressions, COUNT(*) FILTER (WHERE o.clicked)::int clicks,
        COUNT(*) FILTER (WHERE o.converted)::int conversions, COALESCE(SUM(o."revenueImpact"), 0)::float revenue
      FROM offers o LEFT JOIN "Experiment" e ON e.id = o."experimentId" AND e.shop = ${shop}
      WHERE o."experimentId" IS NOT NULL AND o."abVariant" IS NOT NULL
      GROUP BY o."experimentId", e.name, o."abVariant" ORDER BY revenue DESC, conversions DESC LIMIT 100
    ), session_offers AS (
      SELECT "sessionId", bool_or(converted) converted, COALESCE(SUM("revenueImpact"), 0)::float revenue FROM offers GROUP BY 1
    ), journey AS (
      SELECT COALESCE(NULLIF(s."journeyStage", ''), 'unknown') "journeyStage", COUNT(*)::int sessions,
        COUNT(*) FILTER (WHERE o.converted)::int "convertedSessions", COALESCE(SUM(o.revenue), 0)::float revenue
      FROM "ShopperSession" s LEFT JOIN session_offers o ON o."sessionId" = s.id
      WHERE s.shop = ${shop} AND s."updatedAt" >= ${from} GROUP BY 1 ORDER BY revenue DESC, sessions DESC
    ) SELECT jsonb_build_object(
      'dashboard', jsonb_build_object('avgAov', t.aov, 'aovLift', CASE WHEN t.baseline_aov > 0 THEN (t.aov - t.baseline_aov) / t.baseline_aov ELSE 0 END,
        'widgetCtr', CASE WHEN f.impressions > 0 THEN f.clicks::float / f.impressions ELSE 0 END,
        'widgetImpressions', f.impressions, 'chatEngaged', (SELECT COUNT(*)::int FROM "ShopperSession" WHERE shop = ${shop} AND "chatEngaged" AND "updatedAt" >= ${from}),
        'attributedRevenue', f.revenue, 'attributedOrderCount', t.attributed, 'baselineOrderCount', t.baseline,
        'aovLiftAvailable', t.attributed > 0 AND t.baseline_aov > 0,
        'widgetRows', COALESCE((SELECT jsonb_agg(to_jsonb(w) ORDER BY w.revenue DESC) FROM widget w), '[]'::jsonb),
        'revenueSeries', COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.date) FROM (SELECT date, SUM(revenue) revenue FROM revenue_days GROUP BY date) d), '[]'::jsonb)),
      'funnel', jsonb_build_object('generated', f.generated, 'impressions', f.impressions, 'clicks', f.clicks, 'conversions', f.conversions),
      'timeSeries', COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.date) FROM (SELECT date, SUM(generated) generated, SUM(impressions) impressions, SUM(clicks) clicks, SUM(conversions) conversions, SUM(revenue) revenue FROM series GROUP BY date) d), '[]'::jsonb),
      'offerRows', COALESCE((SELECT jsonb_agg(to_jsonb(o)) FROM offer_rows o), '[]'::jsonb),
      'experimentRows', COALESCE((SELECT jsonb_agg(to_jsonb(e)) FROM experiment_rows e), '[]'::jsonb),
      'journeyRows', COALESCE((SELECT jsonb_agg(to_jsonb(j)) FROM journey j), '[]'::jsonb),
      'bundleShare', CASE WHEN f.impressions > 0 THEN COALESCE((SELECT impressions FROM widget WHERE "widgetType" = 'bundle'), 0)::float / f.impressions ELSE 0 END
    ) report FROM funnel f CROSS JOIN order_totals t
  `;
}

export function salesQuery(shop: string, from: Date) {
  return Prisma.sql`
    WITH sessions AS (
      SELECT *, CASE WHEN jsonb_typeof("shopperProfile"->'knownObjections') = 'array' THEN jsonb_array_length("shopperProfile"->'knownObjections') > 0 ELSE false END objection,
        COALESCE(context->>'proactivePromptCount', '0') ~ '^[1-9][0-9]*$' proactive
      FROM "ShopperSession" WHERE shop = ${shop} AND "updatedAt" >= ${from}
    ), events AS (
      SELECT * FROM "ShopperEvent" WHERE shop = ${shop} AND "createdAt" >= ${from}
        AND type IN ('widget_impression','chat_opened','customer_message_sent','recommendation_shown','recommendation_clicked','recommendation_added','upsell_shown','upsell_added','checkout_started','checkout_start')
    ), outcomes AS (
      SELECT * FROM "RecommendationOutcome" WHERE shop = ${shop} AND "shownAt" >= ${from}
    ), orders AS (
      SELECT data->'aiAssisted' = 'true'::jsonb ai,
        CASE WHEN data->>'total_price' ~ '^[0-9]{1,18}([.][0-9]{1,6})?$' THEN (data->>'total_price')::float ELSE 0 END total,
        CASE WHEN data->>'aiAttributedRevenue' ~ '^-?[0-9]{1,18}([.][0-9]{1,6})?$' THEN (data->>'aiAttributedRevenue')::float ELSE 0 END revenue
      FROM "Event" WHERE "storeId" = ${shop} AND event = 'conversion' AND timestamp >= ${from}
    ) SELECT jsonb_build_object(
      'chatImpressions', (SELECT COUNT(*) FROM events WHERE type = 'widget_impression' AND payload->>'widgetType' = 'chat'),
      'chatOpens', (SELECT COUNT(*) FROM events WHERE type = 'chat_opened'),
      'customerMessages', (SELECT COUNT(*) FROM events WHERE type = 'customer_message_sent'),
      'recommendationsShown', GREATEST((SELECT COUNT(*) FROM outcomes WHERE "recommendationType" <> 'upsell'), (SELECT COUNT(*) FROM events WHERE type = 'recommendation_shown')),
      'recommendationClicks', GREATEST((SELECT COUNT(*) FROM outcomes WHERE "recommendationType" <> 'upsell' AND "clickedAt" IS NOT NULL), (SELECT COUNT(*) FROM events WHERE type = 'recommendation_clicked')),
      'recommendationAdds', GREATEST((SELECT COUNT(*) FROM outcomes WHERE "recommendationType" <> 'upsell' AND "addedAt" IS NOT NULL), (SELECT COUNT(*) FROM events WHERE type = 'recommendation_added')),
      'upsellsShown', GREATEST((SELECT COUNT(*) FROM outcomes WHERE "recommendationType" = 'upsell'), (SELECT COUNT(*) FROM events WHERE type = 'upsell_shown')),
      'upsellAdds', GREATEST((SELECT COUNT(*) FROM outcomes WHERE "recommendationType" = 'upsell' AND "addedAt" IS NOT NULL), (SELECT COUNT(*) FROM events WHERE type = 'upsell_added')),
      'checkoutStarted', GREATEST((SELECT COUNT(DISTINCT "sessionId") FROM events WHERE type IN ('checkout_started','checkout_start')), (SELECT COUNT(*) FROM sessions WHERE "checkoutStarted")),
      'orders', (SELECT COUNT(*) FROM orders), 'aiAssistedOrders', (SELECT COUNT(*) FROM orders WHERE ai),
      'aiAttributedRevenue', COALESCE((SELECT SUM(revenue) FROM orders WHERE ai), 0),
      'averageOrderValue', COALESCE((SELECT AVG(total) FROM orders), 0),
      'aiAssistedAov', COALESCE((SELECT AVG(total) FROM orders WHERE ai), 0),
      'nonAiAov', COALESCE((SELECT AVG(total) FROM orders WHERE ai IS NOT TRUE), 0),
      'engaged', (SELECT COUNT(*) FROM sessions WHERE "chatEngaged"), 'engagedPurchased', (SELECT COUNT(*) FROM sessions WHERE "chatEngaged" AND "purchaseCompleted"),
      'nonEngaged', (SELECT COUNT(*) FROM sessions WHERE NOT "chatEngaged"), 'nonEngagedPurchased', (SELECT COUNT(*) FROM sessions WHERE NOT "chatEngaged" AND "purchaseCompleted"),
      'objections', (SELECT COUNT(*) FROM sessions WHERE objection), 'objectionsPurchased', (SELECT COUNT(*) FROM sessions WHERE objection AND "purchaseCompleted"),
      'proactive', (SELECT COUNT(*) FROM sessions WHERE proactive), 'proactivePurchased', (SELECT COUNT(*) FROM sessions WHERE proactive AND "purchaseCompleted")
    ) report
  `;
}
