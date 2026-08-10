-- CreateTable
CREATE TABLE "product_families" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "marketplaceAccountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "internalCode" TEXT,
    "notes" TEXT,
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentCostAmount" DECIMAL(14,4),
    "currentCostEffectiveFrom" TIMESTAMP(3),
    "costUpdatedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_families_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_family_cost_history" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "costAmount" DECIMAL(14,4) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_family_cost_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "marketplaceAccountId" TEXT NOT NULL,
    "shopeeProductId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "firstImportBatchId" TEXT,
    "lastImportBatchId" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "marketplaceAccountId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "shopeeVariationId" TEXT NOT NULL,
    "variationKey" TEXT NOT NULL,
    "variationName" TEXT,
    "sku" TEXT,
    "referenceSku" TEXT,
    "gtin" TEXT,
    "shopeeFullPrice" DECIMAL(14,4),
    "sellerStock" INTEGER,
    "failReason" TEXT,
    "closingPrice" DECIMAL(14,4),
    "familyId" TEXT,
    "internalNotes" TEXT,
    "firstImportBatchId" TEXT,
    "lastImportBatchId" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_variations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_import_batches" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "marketplaceAccountId" TEXT NOT NULL,
    "ingestionSource" "IngestionSource" NOT NULL DEFAULT 'MANUAL_UPLOAD',
    "originalFilename" TEXT NOT NULL,
    "sanitizedFilename" TEXT NOT NULL,
    "declaredExtension" TEXT NOT NULL,
    "fileFormat" "FileFormat" NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "fileHash" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sheetName" TEXT,
    "headerRowIndex" INTEGER,
    "dataStartRowIndex" INTEGER,
    "columnCount" INTEGER NOT NULL DEFAULT 0,
    "physicalRowCount" INTEGER NOT NULL DEFAULT 0,
    "dataRowCount" INTEGER NOT NULL DEFAULT 0,
    "status" "ImportBatchStatus" NOT NULL DEFAULT 'PROCESSING',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "productsSeen" INTEGER NOT NULL DEFAULT 0,
    "variationsSeen" INTEGER NOT NULL DEFAULT 0,
    "newProducts" INTEGER NOT NULL DEFAULT 0,
    "newVariations" INTEGER NOT NULL DEFAULT 0,
    "updatedRecords" INTEGER NOT NULL DEFAULT 0,
    "unchangedRecords" INTEGER NOT NULL DEFAULT 0,
    "ignoredRows" INTEGER NOT NULL DEFAULT 0,
    "errorRows" INTEGER NOT NULL DEFAULT 0,
    "processingMs" INTEGER,
    "errorMessage" TEXT,
    "errors" JSONB,
    "analysis" JSONB,
    "createdByUserId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_families_organizationId_idx" ON "product_families"("organizationId");

-- CreateIndex
CREATE INDEX "product_families_marketplaceAccountId_status_idx" ON "product_families"("marketplaceAccountId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "product_families_marketplaceAccountId_normalizedName_key" ON "product_families"("marketplaceAccountId", "normalizedName");

-- CreateIndex
CREATE INDEX "product_family_cost_history_familyId_effectiveFrom_idx" ON "product_family_cost_history"("familyId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "products_organizationId_idx" ON "products"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "products_marketplaceAccountId_shopeeProductId_key" ON "products"("marketplaceAccountId", "shopeeProductId");

-- CreateIndex
CREATE INDEX "product_variations_marketplaceAccountId_idx" ON "product_variations"("marketplaceAccountId");

-- CreateIndex
CREATE INDEX "product_variations_marketplaceAccountId_sku_idx" ON "product_variations"("marketplaceAccountId", "sku");

-- CreateIndex
CREATE INDEX "product_variations_familyId_idx" ON "product_variations"("familyId");

-- CreateIndex
CREATE UNIQUE INDEX "product_variations_productId_variationKey_key" ON "product_variations"("productId", "variationKey");

-- CreateIndex
CREATE INDEX "product_import_batches_organizationId_createdAt_idx" ON "product_import_batches"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "product_import_batches_marketplaceAccountId_fileHash_idx" ON "product_import_batches"("marketplaceAccountId", "fileHash");

-- AddForeignKey
ALTER TABLE "product_families" ADD CONSTRAINT "product_families_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_families" ADD CONSTRAINT "product_families_marketplaceAccountId_fkey" FOREIGN KEY ("marketplaceAccountId") REFERENCES "marketplace_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_families" ADD CONSTRAINT "product_families_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_family_cost_history" ADD CONSTRAINT "product_family_cost_history_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "product_families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_family_cost_history" ADD CONSTRAINT "product_family_cost_history_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_marketplaceAccountId_fkey" FOREIGN KEY ("marketplaceAccountId") REFERENCES "marketplace_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variations" ADD CONSTRAINT "product_variations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variations" ADD CONSTRAINT "product_variations_marketplaceAccountId_fkey" FOREIGN KEY ("marketplaceAccountId") REFERENCES "marketplace_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variations" ADD CONSTRAINT "product_variations_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variations" ADD CONSTRAINT "product_variations_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "product_families"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_import_batches" ADD CONSTRAINT "product_import_batches_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_import_batches" ADD CONSTRAINT "product_import_batches_marketplaceAccountId_fkey" FOREIGN KEY ("marketplaceAccountId") REFERENCES "marketplace_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_import_batches" ADD CONSTRAINT "product_import_batches_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
