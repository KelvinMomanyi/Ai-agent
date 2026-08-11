-- Keep compact per-variant order history adjacent to ProductOrderStat. Variant
-- definitions remain capped JSON on Product.metafields; this table stores only
-- the counts needed to choose a deterministic popular default.
CREATE TABLE IF NOT EXISTS "ProductVariantOrderStat" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "orderCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductVariantOrderStat_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProductVariantOrderStat_shop_productId_variantId_key"
ON "ProductVariantOrderStat"("shop", "productId", "variantId");

CREATE INDEX IF NOT EXISTS "ProductVariantOrderStat_shop_productId_idx"
ON "ProductVariantOrderStat"("shop", "productId");

CREATE INDEX IF NOT EXISTS "ProductVariantOrderStat_shop_variantId_idx"
ON "ProductVariantOrderStat"("shop", "variantId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ProductVariantOrderStat_shop_productId_fkey'
      AND conrelid = '"ProductVariantOrderStat"'::regclass
  ) THEN
    ALTER TABLE "ProductVariantOrderStat"
    ADD CONSTRAINT "ProductVariantOrderStat_shop_productId_fkey"
    FOREIGN KEY ("shop", "productId") REFERENCES "Product"("shop", "id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Backfill the order history already retained in conversion Event JSON. The
-- md5 key is deterministic and Prisma treats IDs as opaque strings.
INSERT INTO "ProductVariantOrderStat" (
  "id", "shop", "productId", "variantId", "orderCount"
)
SELECT
  md5(e."storeId" || ':' || line."productId" || ':' || line."variantId"),
  e."storeId",
  line."productId",
  line."variantId",
  COUNT(DISTINCT e."orderId")::INTEGER
FROM "Event" e
CROSS JOIN LATERAL jsonb_to_recordset(
  CASE
    WHEN jsonb_typeof((e."data"::jsonb)->'line_items') = 'array'
      THEN (e."data"::jsonb)->'line_items'
    ELSE '[]'::jsonb
  END
) AS line("productId" TEXT, "variantId" TEXT)
INNER JOIN "Product" p
  ON p."shop" = e."storeId"
 AND p."id" = line."productId"
WHERE e."event" = 'conversion'
  AND COALESCE(e."orderId", '') <> ''
  AND COALESCE(line."variantId", '') <> ''
GROUP BY e."storeId", line."productId", line."variantId"
ON CONFLICT ("shop", "productId", "variantId") DO UPDATE
SET "orderCount" = EXCLUDED."orderCount";
