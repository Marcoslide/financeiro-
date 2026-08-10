-- AlterTable
ALTER TABLE "products" ADD COLUMN     "maxPrice" DECIMAL(14,4),
ADD COLUMN     "minPrice" DECIMAL(14,4),
ADD COLUMN     "totalStock" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "variationCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "variationsWithoutClosingPrice" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "variationsWithoutFamily" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "products_marketplaceAccountId_name_idx" ON "products"("marketplaceAccountId", "name");

-- CreateIndex
CREATE INDEX "products_marketplaceAccountId_variationsWithoutFamily_idx" ON "products"("marketplaceAccountId", "variationsWithoutFamily");
