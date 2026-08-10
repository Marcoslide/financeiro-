-- CreateEnum
CREATE TYPE "OccurrenceType" AS ENUM ('RETURN_REFUND', 'ORDER_CANCELLATION', 'FAILED_DELIVERY', 'DISPUTE', 'COMPENSATION');

-- CreateTable
CREATE TABLE "marketplace_orders" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "marketplaceAccountId" TEXT NOT NULL,
    "externalOrderId" TEXT NOT NULL,
    "orderStatus" TEXT,
    "orderCreatedAt" TIMESTAMP(3),
    "buyerUsername" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_sale_occurrences" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "marketplaceAccountId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" "OccurrenceType" NOT NULL,
    "naturalKey" TEXT NOT NULL,
    "externalReturnId" TEXT,
    "externalOrderId" TEXT NOT NULL,
    "status" TEXT,
    "reason" TEXT,
    "resolution" TEXT,
    "returnType" TEXT,
    "disputeReason" TEXT,
    "sellerNote" TEXT,
    "requestedRefundAmount" DECIMAL(14,2),
    "sellerCompensationAmount" DECIMAL(14,2),
    "buyerPaidAmount" DECIMAL(14,2),
    "occurredAt" TIMESTAMP(3),
    "trackingNumber" TEXT,
    "trackingStatus" TEXT,
    "sourceReportType" TEXT NOT NULL,
    "firstImportBatchId" TEXT,
    "lastImportBatchId" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "post_sale_occurrences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_sale_occurrence_items" (
    "id" TEXT NOT NULL,
    "occurrenceId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sku" TEXT,
    "parentSku" TEXT,
    "productName" TEXT,
    "variationName" TEXT,
    "quantity" INTEGER,
    "unitPrice" DECIMAL(14,2),
    "productVariationId" TEXT,
    "skuLinked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "post_sale_occurrence_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "occurrence_status_history" (
    "id" TEXT NOT NULL,
    "occurrenceId" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "previousStatus" TEXT,
    "newStatus" TEXT,
    "importBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "occurrence_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_sale_import_batches" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "marketplaceAccountId" TEXT NOT NULL,
    "occurrenceType" "OccurrenceType" NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "sanitizedFilename" TEXT NOT NULL,
    "fileFormat" "FileFormat" NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "fileHash" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "parserVersion" TEXT NOT NULL DEFAULT 'v1',
    "sheetName" TEXT,
    "headerRowIndex" INTEGER,
    "physicalRowCount" INTEGER NOT NULL DEFAULT 0,
    "dataRowCount" INTEGER NOT NULL DEFAULT 0,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "status" "ImportBatchStatus" NOT NULL DEFAULT 'PROCESSING',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "occurrencesSeen" INTEGER NOT NULL DEFAULT 0,
    "itemsSeen" INTEGER NOT NULL DEFAULT 0,
    "newOccurrences" INTEGER NOT NULL DEFAULT 0,
    "updatedOccurrences" INTEGER NOT NULL DEFAULT 0,
    "unchangedOccurrences" INTEGER NOT NULL DEFAULT 0,
    "ordersTouched" INTEGER NOT NULL DEFAULT 0,
    "unlinkedItems" INTEGER NOT NULL DEFAULT 0,
    "errorRows" INTEGER NOT NULL DEFAULT 0,
    "processingMs" INTEGER,
    "errorMessage" TEXT,
    "errors" JSONB,
    "createdByUserId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "post_sale_import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "marketplace_orders_organizationId_idx" ON "marketplace_orders"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_orders_marketplaceAccountId_externalOrderId_key" ON "marketplace_orders"("marketplaceAccountId", "externalOrderId");

-- CreateIndex
CREATE INDEX "post_sale_occurrences_organizationId_type_idx" ON "post_sale_occurrences"("organizationId", "type");

-- CreateIndex
CREATE INDEX "post_sale_occurrences_marketplaceAccountId_occurredAt_idx" ON "post_sale_occurrences"("marketplaceAccountId", "occurredAt");

-- CreateIndex
CREATE INDEX "post_sale_occurrences_orderId_idx" ON "post_sale_occurrences"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "post_sale_occurrences_marketplaceAccountId_type_naturalKey_key" ON "post_sale_occurrences"("marketplaceAccountId", "type", "naturalKey");

-- CreateIndex
CREATE INDEX "post_sale_occurrence_items_occurrenceId_idx" ON "post_sale_occurrence_items"("occurrenceId");

-- CreateIndex
CREATE INDEX "post_sale_occurrence_items_organizationId_skuLinked_idx" ON "post_sale_occurrence_items"("organizationId", "skuLinked");

-- CreateIndex
CREATE INDEX "post_sale_occurrence_items_sku_idx" ON "post_sale_occurrence_items"("sku");

-- CreateIndex
CREATE INDEX "occurrence_status_history_occurrenceId_observedAt_idx" ON "occurrence_status_history"("occurrenceId", "observedAt");

-- CreateIndex
CREATE INDEX "post_sale_import_batches_organizationId_createdAt_idx" ON "post_sale_import_batches"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "post_sale_import_batches_marketplaceAccountId_occurrenceTyp_idx" ON "post_sale_import_batches"("marketplaceAccountId", "occurrenceType");

-- CreateIndex
CREATE INDEX "post_sale_import_batches_marketplaceAccountId_fileHash_idx" ON "post_sale_import_batches"("marketplaceAccountId", "fileHash");

-- AddForeignKey
ALTER TABLE "marketplace_orders" ADD CONSTRAINT "marketplace_orders_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_orders" ADD CONSTRAINT "marketplace_orders_marketplaceAccountId_fkey" FOREIGN KEY ("marketplaceAccountId") REFERENCES "marketplace_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_sale_occurrences" ADD CONSTRAINT "post_sale_occurrences_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_sale_occurrences" ADD CONSTRAINT "post_sale_occurrences_marketplaceAccountId_fkey" FOREIGN KEY ("marketplaceAccountId") REFERENCES "marketplace_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_sale_occurrences" ADD CONSTRAINT "post_sale_occurrences_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "marketplace_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_sale_occurrence_items" ADD CONSTRAINT "post_sale_occurrence_items_occurrenceId_fkey" FOREIGN KEY ("occurrenceId") REFERENCES "post_sale_occurrences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_sale_occurrence_items" ADD CONSTRAINT "post_sale_occurrence_items_productVariationId_fkey" FOREIGN KEY ("productVariationId") REFERENCES "product_variations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "occurrence_status_history" ADD CONSTRAINT "occurrence_status_history_occurrenceId_fkey" FOREIGN KEY ("occurrenceId") REFERENCES "post_sale_occurrences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_sale_import_batches" ADD CONSTRAINT "post_sale_import_batches_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_sale_import_batches" ADD CONSTRAINT "post_sale_import_batches_marketplaceAccountId_fkey" FOREIGN KEY ("marketplaceAccountId") REFERENCES "marketplace_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_sale_import_batches" ADD CONSTRAINT "post_sale_import_batches_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
