ALTER TABLE "Offer"
ADD COLUMN "experimentId" TEXT;

CREATE INDEX "Offer_shop_experimentId_widgetType_abVariant_idx"
ON "Offer"("shop", "experimentId", "widgetType", "abVariant");

ALTER TABLE "Offer"
ADD CONSTRAINT "Offer_experimentId_fkey"
FOREIGN KEY ("experimentId") REFERENCES "Experiment"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
