-- Persist the shop-level automatic app discount node used by the bundle
-- Discount Function. Bundle.discountType and Bundle.discountValue already
-- support the required values, so those columns do not need alteration.
ALTER TABLE "AppSettings" ADD COLUMN "bundleDiscountId" TEXT;
