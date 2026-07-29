-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('ORDERS', 'ORDER_CANCELLATION', 'FAILED_DELIVERY', 'RETURN_REFUND', 'WALLET_TRANSACTION', 'SHOPEE_ACELERA', 'AFFILIATE_COMMISSION', 'AFFILIATE_PERFORMANCE', 'WEEKLY_INCOME_STATEMENT', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "FileFormat" AS ENUM ('XLSX', 'XLS', 'CSV');

-- CreateEnum
CREATE TYPE "ImportBatchStatus" AS ENUM ('AWAITING_CONFIRMATION', 'PROCESSING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "ImportRowStatus" AS ENUM ('PENDING', 'IMPORTED', 'DUPLICATE', 'UPDATED', 'WARNING', 'ERROR', 'SKIPPED');

-- CreateTable
CREATE TABLE "import_batches" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "marketplaceAccountId" TEXT NOT NULL,
    "ingestionSource" "IngestionSource" NOT NULL DEFAULT 'MANUAL_UPLOAD',
    "reportType" "ReportType" NOT NULL DEFAULT 'UNKNOWN',
    "detectedReportType" "ReportType" NOT NULL DEFAULT 'UNKNOWN',
    "reportTypeConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reportTypeManualOverride" BOOLEAN NOT NULL DEFAULT false,
    "originalFilename" TEXT NOT NULL,
    "sanitizedFilename" TEXT NOT NULL,
    "declaredExtension" TEXT NOT NULL,
    "fileFormat" "FileFormat" NOT NULL,
    "extensionMismatch" BOOLEAN NOT NULL DEFAULT false,
    "fileSizeBytes" INTEGER NOT NULL,
    "fileHash" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sheetName" TEXT,
    "headerRowIndex" INTEGER,
    "dataStartRowIndex" INTEGER,
    "columnCount" INTEGER NOT NULL DEFAULT 0,
    "physicalRowCount" INTEGER NOT NULL DEFAULT 0,
    "dataRowCount" INTEGER NOT NULL DEFAULT 0,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "status" "ImportBatchStatus" NOT NULL DEFAULT 'AWAITING_CONFIRMATION',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "validRows" INTEGER NOT NULL DEFAULT 0,
    "importedRows" INTEGER NOT NULL DEFAULT 0,
    "updatedRows" INTEGER NOT NULL DEFAULT 0,
    "duplicatedRows" INTEGER NOT NULL DEFAULT 0,
    "warningRows" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "processingMs" INTEGER,
    "errorMessage" TEXT,
    "analysis" JSONB,
    "reprocessedFromBatchId" TEXT,
    "createdByUserId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_rows" (
    "id" TEXT NOT NULL,
    "importBatchId" TEXT NOT NULL,
    "sheetName" TEXT NOT NULL,
    "physicalRowNumber" INTEGER NOT NULL,
    "logicalRowNumber" INTEGER NOT NULL,
    "rawPayload" JSONB NOT NULL,
    "normalizedPayload" JSONB,
    "detectedIdentifiers" JSONB,
    "externalOrderId" TEXT,
    "externalReference" TEXT,
    "rawHash" TEXT NOT NULL,
    "canonicalHash" TEXT NOT NULL,
    "canonicalHashVersion" TEXT NOT NULL DEFAULT 'v1',
    "processingStatus" "ImportRowStatus" NOT NULL DEFAULT 'PENDING',
    "warnings" JSONB,
    "errors" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_dedup_keys" (
    "id" TEXT NOT NULL,
    "marketplaceAccountId" TEXT NOT NULL,
    "reportType" "ReportType" NOT NULL,
    "canonicalHash" TEXT NOT NULL,
    "naturalKey" TEXT NOT NULL,
    "firstSeenBatchId" TEXT NOT NULL,
    "lastSeenBatchId" TEXT NOT NULL,
    "firstSeenRowId" TEXT,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_dedup_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_batches_organizationId_createdAt_idx" ON "import_batches"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "import_batches_marketplaceAccountId_fileHash_idx" ON "import_batches"("marketplaceAccountId", "fileHash");

-- CreateIndex
CREATE INDEX "import_batches_marketplaceAccountId_reportType_idx" ON "import_batches"("marketplaceAccountId", "reportType");

-- CreateIndex
CREATE INDEX "import_rows_importBatchId_processingStatus_idx" ON "import_rows"("importBatchId", "processingStatus");

-- CreateIndex
CREATE INDEX "import_rows_canonicalHash_idx" ON "import_rows"("canonicalHash");

-- CreateIndex
CREATE UNIQUE INDEX "import_rows_importBatchId_physicalRowNumber_key" ON "import_rows"("importBatchId", "physicalRowNumber");

-- CreateIndex
CREATE INDEX "import_dedup_keys_marketplaceAccountId_reportType_naturalKe_idx" ON "import_dedup_keys"("marketplaceAccountId", "reportType", "naturalKey");

-- CreateIndex
CREATE UNIQUE INDEX "import_dedup_keys_marketplaceAccountId_reportType_canonical_key" ON "import_dedup_keys"("marketplaceAccountId", "reportType", "canonicalHash");

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_marketplaceAccountId_fkey" FOREIGN KEY ("marketplaceAccountId") REFERENCES "marketplace_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_dedup_keys" ADD CONSTRAINT "import_dedup_keys_marketplaceAccountId_fkey" FOREIGN KEY ("marketplaceAccountId") REFERENCES "marketplace_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
