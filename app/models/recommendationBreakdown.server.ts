import { Prisma } from "@prisma/client";

// A descriptive reporting threshold, not a significance or statistical power test.
export const MIN_BREAKDOWN_DISPLAYS = 30;
export const ORIGIN_BUCKETS = [
  "merchant",
  "autopilot",
  "affinity",
  "catalog",
  "mixed",
  "unknown",
] as const;
export const PLACEMENT_BUCKETS = [
  "native_drawer",
  "cart_page",
  "floating_card",
  "unknown",
] as const;
export type BreakdownAggregate = {
  axis: "origin" | "placement";
  bucket: string;
  displayed: number;
  clicked: number;
  added: number;
  purchased: number;
  amounts: Array<{ currency: string | null; revenue: number }>;
};
export function summarizeBreakdowns(rows: BreakdownAggregate[]) {
  const groups = (
    axis: BreakdownAggregate["axis"],
    buckets: readonly string[],
  ) =>
    buckets.map((bucket) => {
      const row = rows.find(
        (entry) => entry.axis === axis && entry.bucket === bucket,
      );
      const result = {
        bucket,
        displayed: row?.displayed || 0,
        clicked: row?.clicked || 0,
        added: row?.added || 0,
        purchased: row?.purchased || 0,
        amounts: row?.amounts || [],
      };
      const ready = result.displayed >= MIN_BREAKDOWN_DISPLAYS;
      return {
        ...result,
        ready,
        clickRate: ready ? result.clicked / result.displayed : null,
        addRate:
          ready && result.clicked > 0 ? result.added / result.clicked : null,
        purchaseRate:
          ready && result.added > 0 ? result.purchased / result.added : null,
      };
    });
  return {
    byOrigin: groups("origin", ORIGIN_BUCKETS),
    byPlacement: groups("placement", PLACEMENT_BUCKETS),
    minimumDisplays: MIN_BREAKDOWN_DISPLAYS,
  };
}
export type RecommendationBreakdowns = ReturnType<typeof summarizeBreakdowns>;

/** Offer-level descriptive funnels. Browser metadata never determines pairing origin. */
export function recommendationBreakdownQuery(
  shop: string,
  from: Date,
  to: Date,
) {
  return Prisma.sql`
    WITH offers AS MATERIALIZED (
      SELECT id,"sessionId",payload,"pairingProvenance","createdAt" FROM "Offer"
      WHERE shop=${shop} AND "widgetType"='upsell_drawer' AND "createdAt">=${from} AND "createdAt"<${to}
    ), cards AS MATERIALIZED (
      SELECT DISTINCT o.id,COALESCE(card->>'productId',card->'product'->>'id') "productId"
      FROM offers o CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(o.payload->'products')='array' THEN o.payload->'products' ELSE '[]'::jsonb END) card
      WHERE COALESCE(card->>'productId',card->'product'->>'id') ~ '^gid://shopify/Product/[0-9]+$'
    ), card_origins AS (
      SELECT c.id,c."productId",CASE
        WHEN COUNT(p.value)<>1 THEN 'unknown'
        WHEN MIN(p.value->>'origin')='merchant' AND MIN(p.value->>'status')='approved' THEN 'merchant'
        WHEN MIN(p.value->>'origin')='autopilot' AND MIN(p.value->>'status')='auto_approved' THEN 'autopilot'
        WHEN MIN(p.value->>'origin')='affinity' AND MIN(p.value->>'status')='fallback' THEN 'affinity'
        WHEN MIN(p.value->>'origin')='catalog' AND MIN(p.value->>'status')='fallback' THEN 'catalog'
        ELSE 'unknown' END origin
      FROM cards c JOIN offers o ON o.id=c.id LEFT JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(o."pairingProvenance")='array' THEN o."pairingProvenance" ELSE '[]'::jsonb END
      ) p ON p.value->>'targetProductId'=c."productId" GROUP BY c.id,c."productId"
    ), origins AS (
      SELECT id,COUNT(*) card_count,CASE WHEN BOOL_OR(origin='unknown') THEN 'unknown'
        WHEN COUNT(DISTINCT origin)>1 THEN 'mixed' ELSE MIN(origin) END origin
      FROM card_origins GROUP BY id
    ), events AS MATERIALIZED (
      SELECT e.id,e.type,e.payload,e."createdAt",o.id "offerId" FROM "ShopperEvent" e JOIN offers o
        ON o.id=COALESCE(e.payload->>'offerId',e.payload->>'offer_id') AND o."sessionId"=e."sessionId"
      WHERE e.shop=${shop} AND e."createdAt">=${from} AND e."createdAt"<${to} AND e."createdAt">=o."createdAt"
        AND e.type IN ('widget_impression','impression','widget_click','click','recommendation_added','upsell_added')
    ), displayed AS MATERIALIZED (
      SELECT DISTINCT ON (e."offerId") e."offerId",e."createdAt" at,
        CASE WHEN e.payload->'verified'='true'::jsonb AND e.payload->>'strategy' IN ('native_drawer','cart_page','floating_card')
          THEN e.payload->>'strategy' ELSE 'unknown' END placement
      FROM events e WHERE e.type IN ('widget_impression','impression') ORDER BY e."offerId",e."createdAt",e.id
    ), clicked AS (
      SELECT e."offerId",MIN(e."createdAt") at FROM events e JOIN displayed d ON d."offerId"=e."offerId"
      WHERE e.type IN ('widget_click','click') AND e."createdAt">=d.at GROUP BY e."offerId"
    ), added AS MATERIALIZED (
      SELECT e."offerId",c."productId",MIN(e."createdAt") at FROM events e
      JOIN clicked k ON k."offerId"=e."offerId" JOIN cards c ON c.id=e."offerId" AND c."productId"=e.payload->>'productId'
      WHERE e.type IN ('recommendation_added','upsell_added') AND e."createdAt">=k.at GROUP BY e."offerId",c."productId"
    ), orders AS MATERIALIZED (
      SELECT DISTINCT ON ("orderId") "orderId",timestamp,data FROM "Event"
      WHERE "storeId"=${shop} AND event='conversion' AND timestamp>=${from} AND timestamp<${to}
        AND "orderId" IS NOT NULL AND "orderId"<>'' ORDER BY "orderId",timestamp DESC,id DESC
    ), lines AS (
      SELECT o."orderId",a."offerId",CASE WHEN o.data->>'currency' ~ '^[A-Z]{3}$' THEN o.data->>'currency' ELSE NULL END currency,
        l.value line FROM orders o CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(o.data->'line_items')='array' THEN o.data->'line_items' ELSE '[]'::jsonb END) l
      JOIN added a ON a."offerId"=l.value->>'offerId' AND a."productId"=l.value->>'productId' AND o.timestamp>=a.at
      WHERE COALESCE(o.data->'offerIds','[]'::jsonb) @> jsonb_build_array(a."offerId")
    ), valid_lines AS MATERIALIZED (
      SELECT "offerId",currency,GREATEST(0,(line->>'price')::numeric*(line->>'quantity')::numeric-(line->>'totalDiscount')::numeric) revenue
      FROM lines WHERE (line->>'price') ~ '^[0-9]+([.][0-9]+)?$' AND (line->>'quantity') ~ '^[1-9][0-9]*$'
        AND (line->>'totalDiscount') ~ '^[0-9]+([.][0-9]+)?$'
    ), purchased AS (SELECT DISTINCT "offerId" FROM valid_lines),
    dimensions AS MATERIALIZED (
      SELECT d."offerId",v.axis,v.bucket FROM displayed d JOIN offers o ON o.id=d."offerId" LEFT JOIN origins r ON r.id=o.id
      CROSS JOIN LATERAL (VALUES ('origin',CASE WHEN r.card_count>0 AND r.card_count=jsonb_array_length(
        CASE WHEN jsonb_typeof(o.payload->'products')='array' THEN o.payload->'products' ELSE '[]'::jsonb END)
        THEN r.origin ELSE 'unknown' END),('placement',d.placement)) v(axis,bucket)
    ), counts AS (
      SELECT d.axis,d.bucket,COUNT(*)::int displayed,COUNT(k."offerId")::int clicked,
        COUNT(a."offerId")::int added,COUNT(p."offerId")::int purchased
      FROM dimensions d LEFT JOIN clicked k ON k."offerId"=d."offerId"
      LEFT JOIN (SELECT DISTINCT "offerId" FROM added) a ON a."offerId"=d."offerId"
      LEFT JOIN purchased p ON p."offerId"=d."offerId" GROUP BY d.axis,d.bucket
    ), money AS (
      SELECT d.axis,d.bucket,l.currency,SUM(l.revenue)::float revenue FROM dimensions d
      JOIN valid_lines l ON l."offerId"=d."offerId" GROUP BY d.axis,d.bucket,l.currency
    ), amounts AS (
      SELECT axis,bucket,jsonb_agg(jsonb_build_object('currency',currency,'revenue',revenue) ORDER BY currency NULLS LAST) amounts
      FROM money GROUP BY axis,bucket
    ) SELECT c.*,COALESCE(a.amounts,'[]'::jsonb) amounts FROM counts c LEFT JOIN amounts a USING(axis,bucket) ORDER BY c.axis,c.bucket`;
}
