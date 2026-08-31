-- CreateEnum
CREATE TYPE "ScanCaptureMethod" AS ENUM ('SCANNER_HID', 'MANUAL', 'QR_CODE');

-- CreateEnum
CREATE TYPE "ScanCodeType" AS ENUM ('BR', 'ORDER_ID', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ScanResolutionResult" AS ENUM ('MATCHED', 'NOT_FOUND', 'AMBIGUOUS', 'DUPLICATE');

-- CreateTable
CREATE TABLE "operational_locations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "operational_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scan_stations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "deviceIdentifier" TEXT,
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "scan_stations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_scan_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "marketplaceAccountId" TEXT,
    "orderId" TEXT,
    "userId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "rawCode" TEXT NOT NULL,
    "normalizedCode" TEXT NOT NULL,
    "codeType" "ScanCodeType" NOT NULL,
    "result" "ScanResolutionResult" NOT NULL,
    "captureMethod" "ScanCaptureMethod" NOT NULL DEFAULT 'SCANNER_HID',
    "resolvedExternalOrderId" TEXT,
    "trackingNumberSnapshot" TEXT,
    "workspaceOperationId" TEXT,
    "orderSource" TEXT,
    "clientTimestamp" TIMESTAMP(3),
    "serverTimestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shipment_scan_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_confirmations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "marketplaceAccountId" TEXT,
    "orderId" TEXT,
    "workspaceOperationId" TEXT,
    "externalOrderId" TEXT NOT NULL,
    "confirmationKey" TEXT NOT NULL,
    "firstScanEventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shipment_confirmations_pkey" PRIMARY KEY ("id")
);

-- Bootstrap seguro para organizações existentes. O administrador poderá
-- renomear/cadastrar novos locais depois; a produção não fica sem estação.
INSERT INTO "operational_locations" ("id", "organizationId", "code", "name", "timezone", "status", "updatedAt")
SELECT 'loc_' || md5("id"), "id", 'SEDE', 'Sede', 'America/Sao_Paulo', 'ACTIVE', CURRENT_TIMESTAMP
FROM "organizations";

INSERT INTO "scan_stations" ("id", "organizationId", "locationId", "code", "name", "status", "updatedAt")
SELECT 'sta_' || md5("id"), "id", 'loc_' || md5("id"), 'EXPEDICAO-01', 'Expedição 01', 'ACTIVE', CURRENT_TIMESTAMP
FROM "organizations";

CREATE UNIQUE INDEX "operational_locations_organizationId_code_key" ON "operational_locations"("organizationId", "code");
CREATE INDEX "operational_locations_organizationId_status_idx" ON "operational_locations"("organizationId", "status");
CREATE UNIQUE INDEX "scan_stations_organizationId_code_key" ON "scan_stations"("organizationId", "code");
CREATE INDEX "scan_stations_organizationId_locationId_status_idx" ON "scan_stations"("organizationId", "locationId", "status");
CREATE UNIQUE INDEX "shipment_scan_events_organizationId_idempotencyKey_key" ON "shipment_scan_events"("organizationId", "idempotencyKey");
CREATE INDEX "shipment_scan_events_organizationId_serverTimestamp_idx" ON "shipment_scan_events"("organizationId", "serverTimestamp");
CREATE INDEX "shipment_scan_events_organizationId_normalizedCode_idx" ON "shipment_scan_events"("organizationId", "normalizedCode");
CREATE INDEX "shipment_scan_events_organizationId_result_serverTimestamp_idx" ON "shipment_scan_events"("organizationId", "result", "serverTimestamp");
CREATE INDEX "shipment_scan_events_orderId_serverTimestamp_idx" ON "shipment_scan_events"("orderId", "serverTimestamp");
CREATE INDEX "shipment_scan_events_stationId_serverTimestamp_idx" ON "shipment_scan_events"("stationId", "serverTimestamp");
CREATE UNIQUE INDEX "shipment_confirmations_orderId_key" ON "shipment_confirmations"("orderId");
CREATE UNIQUE INDEX "shipment_confirmations_firstScanEventId_key" ON "shipment_confirmations"("firstScanEventId");
CREATE UNIQUE INDEX "shipment_confirmations_confirmationKey_key" ON "shipment_confirmations"("confirmationKey");
CREATE INDEX "shipment_confirmations_organizationId_confirmedAt_idx" ON "shipment_confirmations"("organizationId", "confirmedAt");
CREATE INDEX "shipment_confirmations_marketplaceAccountId_confirmedAt_idx" ON "shipment_confirmations"("marketplaceAccountId", "confirmedAt");

ALTER TABLE "operational_locations" ADD CONSTRAINT "operational_locations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scan_stations" ADD CONSTRAINT "scan_stations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scan_stations" ADD CONSTRAINT "scan_stations_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "operational_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shipment_scan_events" ADD CONSTRAINT "shipment_scan_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shipment_scan_events" ADD CONSTRAINT "shipment_scan_events_marketplaceAccountId_fkey" FOREIGN KEY ("marketplaceAccountId") REFERENCES "marketplace_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "shipment_scan_events" ADD CONSTRAINT "shipment_scan_events_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "marketplace_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "shipment_scan_events" ADD CONSTRAINT "shipment_scan_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shipment_scan_events" ADD CONSTRAINT "shipment_scan_events_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "operational_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shipment_scan_events" ADD CONSTRAINT "shipment_scan_events_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "scan_stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shipment_confirmations" ADD CONSTRAINT "shipment_confirmations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shipment_confirmations" ADD CONSTRAINT "shipment_confirmations_marketplaceAccountId_fkey" FOREIGN KEY ("marketplaceAccountId") REFERENCES "marketplace_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shipment_confirmations" ADD CONSTRAINT "shipment_confirmations_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "marketplace_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shipment_confirmations" ADD CONSTRAINT "shipment_confirmations_firstScanEventId_fkey" FOREIGN KEY ("firstScanEventId") REFERENCES "shipment_scan_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shipment_confirmations" ADD CONSTRAINT "shipment_confirmations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shipment_confirmations" ADD CONSTRAINT "shipment_confirmations_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "operational_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shipment_confirmations" ADD CONSTRAINT "shipment_confirmations_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "scan_stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
