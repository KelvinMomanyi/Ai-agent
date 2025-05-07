/*
  Warnings:

  - You are about to drop the `CachedData` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "productCatalog" TEXT;

-- DropTable
DROP TABLE "CachedData";
