-- AlterTable
ALTER TABLE "post_sale_occurrences" ADD COLUMN     "additionalCostTotal" DECIMAL(14,2),
ADD COLUMN     "causeFamily" TEXT,
ADD COLUMN     "checklist" JSONB,
ADD COLUMN     "cmvAvailable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "disputeContestedAmount" DECIMAL(14,2),
ADD COLUMN     "disputeDeadline" TIMESTAMP(3),
ADD COLUMN     "disputeNote" TEXT,
ADD COLUMN     "disputeRecoveredAmount" DECIMAL(14,2),
ADD COLUMN     "disputeRespondedAt" TIMESTAMP(3),
ADD COLUMN     "disputeStatus" TEXT NOT NULL DEFAULT 'NAO_INICIADA',
ADD COLUMN     "hasDispute" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "internalCause" TEXT,
ADD COLUMN     "internalStatus" TEXT NOT NULL DEFAULT 'NOVA',
ADD COLUMN     "knownNetImpact" DECIMAL(14,2),
ADD COLUMN     "merchandiseCondition" TEXT,
ADD COLUMN     "merchandiseStatus" TEXT NOT NULL DEFAULT 'DESCONHECIDO',
ADD COLUMN     "operatorNotes" TEXT,
ADD COLUMN     "ownerName" TEXT,
ADD COLUMN     "priority" TEXT NOT NULL DEFAULT 'MEDIA',
ADD COLUMN     "reasonRevised" TEXT,
ADD COLUMN     "recoverableValue" DECIMAL(14,2),
ADD COLUMN     "recoveredTotal" DECIMAL(14,2),
ADD COLUMN     "refundedTotal" DECIMAL(14,2),
ADD COLUMN     "responsibility" TEXT NOT NULL DEFAULT 'NAO_IDENTIFICADA';

-- CreateTable
CREATE TABLE "occurrence_financial_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "occurrenceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "externalRef" TEXT,
    "importBatchId" TEXT,
    "createdByUserId" TEXT,
    "createdByName" TEXT,
    "note" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "occurrence_financial_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "occurrence_activities" (
    "id" TEXT NOT NULL,
    "occurrenceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "field" TEXT,
    "oldValue" TEXT,
    "newValue" TEXT,
    "message" TEXT,
    "userId" TEXT,
    "userName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "occurrence_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "occurrence_financial_events_organizationId_idx" ON "occurrence_financial_events"("organizationId");

-- CreateIndex
CREATE INDEX "occurrence_financial_events_occurrenceId_idx" ON "occurrence_financial_events"("occurrenceId");

-- CreateIndex
CREATE UNIQUE INDEX "occurrence_financial_events_occurrenceId_dedupeKey_key" ON "occurrence_financial_events"("occurrenceId", "dedupeKey");

-- CreateIndex
CREATE INDEX "occurrence_activities_occurrenceId_createdAt_idx" ON "occurrence_activities"("occurrenceId", "createdAt");

-- CreateIndex
CREATE INDEX "post_sale_occurrences_marketplaceAccountId_internalStatus_idx" ON "post_sale_occurrences"("marketplaceAccountId", "internalStatus");

-- CreateIndex
CREATE INDEX "post_sale_occurrences_marketplaceAccountId_disputeStatus_idx" ON "post_sale_occurrences"("marketplaceAccountId", "disputeStatus");

-- AddForeignKey
ALTER TABLE "occurrence_financial_events" ADD CONSTRAINT "occurrence_financial_events_occurrenceId_fkey" FOREIGN KEY ("occurrenceId") REFERENCES "post_sale_occurrences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "occurrence_activities" ADD CONSTRAINT "occurrence_activities_occurrenceId_fkey" FOREIGN KEY ("occurrenceId") REFERENCES "post_sale_occurrences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

