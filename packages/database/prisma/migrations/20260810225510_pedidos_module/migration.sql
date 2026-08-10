-- AlterTable
ALTER TABLE "marketplace_orders" ADD COLUMN     "address" TEXT,
ADD COLUMN     "buyerNote" TEXT,
ADD COLUMN     "buyerPaidShipping" DECIMAL(14,2),
ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cep" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "commissionGross" DECIMAL(14,2),
ADD COLUMN     "commissionNet" DECIMAL(14,2),
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "costPending" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "district" TEXT,
ADD COLUMN     "estimatedMarginPct" DECIMAL(9,4),
ADD COLUMN     "estimatedResult" DECIMAL(14,2),
ADD COLUMN     "estimatedShipping" DECIMAL(14,2),
ADD COLUMN     "firstImportBatchId" TEXT,
ADD COLUMN     "grandTotal" DECIMAL(14,2),
ADD COLUMN     "itemCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "itemsSubtotal" DECIMAL(14,2),
ADD COLUMN     "lastImportBatchId" TEXT,
ADD COLUMN     "marketplaceFeesTotal" DECIMAL(14,2),
ADD COLUMN     "normalizedStatus" TEXT,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "productCostTotal" DECIMAL(14,2),
ADD COLUMN     "rawPayload" JSONB,
ADD COLUMN     "recipientName" TEXT,
ADD COLUMN     "returnRefundStatus" TEXT,
ADD COLUMN     "reverseShippingFee" DECIMAL(14,2),
ADD COLUMN     "sellerDiscountTotal" DECIMAL(14,2),
ADD COLUMN     "serviceFeeGross" DECIMAL(14,2),
ADD COLUMN     "serviceFeeNet" DECIMAL(14,2),
ADD COLUMN     "shipByDate" TIMESTAMP(3),
ADD COLUMN     "shippedAt" TIMESTAMP(3),
ADD COLUMN     "shippingMethod" TEXT,
ADD COLUMN     "shippingOption" TEXT,
ADD COLUMN     "totalAmount" DECIMAL(14,2),
ADD COLUMN     "trackingNumber" TEXT,
ADD COLUMN     "transactionFee" DECIMAL(14,2),
ADD COLUMN     "uf" TEXT,
ADD COLUMN     "unitsTotal" INTEGER;

-- CreateTable
CREATE TABLE "marketplace_order_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "lineIndex" INTEGER NOT NULL DEFAULT 0,
    "productName" TEXT,
    "sku" TEXT,
    "mainSkuRef" TEXT,
    "variationName" TEXT,
    "originalPrice" DECIMAL(14,2),
    "agreedPrice" DECIMAL(14,2),
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "productSubtotal" DECIMAL(14,2),
    "sellerDiscount1" DECIMAL(14,2),
    "sellerDiscount2" DECIMAL(14,2),
    "weightSku" DECIMAL(14,4),
    "productVariationId" TEXT,
    "skuLinked" BOOLEAN NOT NULL DEFAULT false,
    "costUnit" DECIMAL(14,4),
    "costTotal" DECIMAL(14,2),
    "costSource" TEXT,
    "costFamilyId" TEXT,
    "costReferenceAt" TIMESTAMP(3),
    "costMissing" BOOLEAN NOT NULL DEFAULT false,
    "allocatedFees" DECIMAL(14,2),
    "estimatedResult" DECIMAL(14,2),
    "estimatedMarginPct" DECIMAL(9,4),
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_status_history" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "importBatchId" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_import_batches" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "marketplaceAccountId" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "parserVersion" TEXT NOT NULL DEFAULT 'v1',
    "rowsProcessed" INTEGER NOT NULL DEFAULT 0,
    "ordersSeen" INTEGER NOT NULL DEFAULT 0,
    "newOrders" INTEGER NOT NULL DEFAULT 0,
    "updatedOrders" INTEGER NOT NULL DEFAULT 0,
    "unchangedOrders" INTEGER NOT NULL DEFAULT 0,
    "itemsSeen" INTEGER NOT NULL DEFAULT 0,
    "newItems" INTEGER NOT NULL DEFAULT 0,
    "updatedItems" INTEGER NOT NULL DEFAULT 0,
    "unchangedItems" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "warnings" INTEGER NOT NULL DEFAULT 0,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "marketplace_order_items_organizationId_idx" ON "marketplace_order_items"("organizationId");

-- CreateIndex
CREATE INDEX "marketplace_order_items_sku_idx" ON "marketplace_order_items"("sku");

-- CreateIndex
CREATE INDEX "marketplace_order_items_productVariationId_idx" ON "marketplace_order_items"("productVariationId");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_order_items_orderId_itemKey_key" ON "marketplace_order_items"("orderId", "itemKey");

-- CreateIndex
CREATE INDEX "order_status_history_orderId_observedAt_idx" ON "order_status_history"("orderId", "observedAt");

-- CreateIndex
CREATE INDEX "sales_import_batches_organizationId_marketplaceAccountId_cr_idx" ON "sales_import_batches"("organizationId", "marketplaceAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "marketplace_orders_marketplaceAccountId_normalizedStatus_idx" ON "marketplace_orders"("marketplaceAccountId", "normalizedStatus");

-- CreateIndex
CREATE INDEX "marketplace_orders_marketplaceAccountId_orderCreatedAt_idx" ON "marketplace_orders"("marketplaceAccountId", "orderCreatedAt");

-- CreateIndex
CREATE INDEX "marketplace_orders_trackingNumber_idx" ON "marketplace_orders"("trackingNumber");

-- AddForeignKey
ALTER TABLE "marketplace_order_items" ADD CONSTRAINT "marketplace_order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "marketplace_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_order_items" ADD CONSTRAINT "marketplace_order_items_productVariationId_fkey" FOREIGN KEY ("productVariationId") REFERENCES "product_variations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "marketplace_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_import_batches" ADD CONSTRAINT "sales_import_batches_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_import_batches" ADD CONSTRAINT "sales_import_batches_marketplaceAccountId_fkey" FOREIGN KEY ("marketplaceAccountId") REFERENCES "marketplace_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_import_batches" ADD CONSTRAINT "sales_import_batches_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

