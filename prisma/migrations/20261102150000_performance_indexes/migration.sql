CREATE INDEX IF NOT EXISTS "session_shop_idx" ON "session"("shop");
CREATE INDEX IF NOT EXISTS "Product_shop_updatedAt_idx" ON "Product"("shop", "updatedAt");
CREATE INDEX IF NOT EXISTS "Product_shop_productType_updatedAt_idx" ON "Product"("shop", "productType", "updatedAt");
CREATE INDEX IF NOT EXISTS "Product_shop_handle_idx" ON "Product"("shop", "handle");
CREATE INDEX IF NOT EXISTS "Offer_shop_createdAt_idx" ON "Offer"("shop", "createdAt");
CREATE INDEX IF NOT EXISTS "RecommendationOutcome_shop_shownAt_idx" ON "RecommendationOutcome"("shop", "shownAt");
CREATE INDEX IF NOT EXISTS "Event_storeId_event_timestamp_idx" ON "Event"("storeId", "event", "timestamp");
-- Prisma cannot model expression indexes; keep this with the canonical variant lookup.
CREATE INDEX IF NOT EXISTS "Product_canonical_variants_idx"
  ON "Product" USING GIN ((metafields->'aovboost.variants') jsonb_path_ops);
