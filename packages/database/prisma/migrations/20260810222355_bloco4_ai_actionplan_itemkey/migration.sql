-- AlterTable
ALTER TABLE "post_sale_occurrence_items" ADD COLUMN     "itemKey" TEXT NOT NULL,
ADD COLUMN     "rawPayload" JSONB;

-- CreateTable
CREATE TABLE "ai_settings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'anthropic',
    "model" TEXT NOT NULL DEFAULT 'claude-sonnet-4-5',
    "encryptedApiKey" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_analyses" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "marketplaceAccountId" TEXT NOT NULL,
    "functionKey" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL DEFAULT 'v1',
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "evidences" JSONB,
    "status" TEXT NOT NULL DEFAULT 'OK',
    "tokensInput" INTEGER,
    "tokensOutput" INTEGER,
    "costUsd" DECIMAL(12,6),
    "errorMessage" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_plans" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "marketplaceAccountId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "origin" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SUGGESTED',
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "ownerName" TEXT,
    "dueDate" TIMESTAMP(3),
    "implementedAt" TIMESTAMP(3),
    "reviewAt" TIMESTAMP(3),
    "indicator" TEXT,
    "baselineValue" DECIMAL(14,4),
    "targetValue" DECIMAL(14,4),
    "financialImpact" DECIMAL(14,2),
    "notes" TEXT,
    "relatedSkus" JSONB,
    "relatedFindings" JSONB,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "action_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_plan_checklist_items" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "action_plan_checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_settings_organizationId_key" ON "ai_settings"("organizationId");

-- CreateIndex
CREATE INDEX "ai_analyses_organizationId_functionKey_scopeKey_idx" ON "ai_analyses"("organizationId", "functionKey", "scopeKey");

-- CreateIndex
CREATE INDEX "ai_analyses_marketplaceAccountId_createdAt_idx" ON "ai_analyses"("marketplaceAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "action_plans_organizationId_status_idx" ON "action_plans"("organizationId", "status");

-- CreateIndex
CREATE INDEX "action_plan_checklist_items_planId_idx" ON "action_plan_checklist_items"("planId");

-- CreateIndex
CREATE UNIQUE INDEX "post_sale_occurrence_items_occurrenceId_itemKey_key" ON "post_sale_occurrence_items"("occurrenceId", "itemKey");

-- AddForeignKey
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_marketplaceAccountId_fkey" FOREIGN KEY ("marketplaceAccountId") REFERENCES "marketplace_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_plans" ADD CONSTRAINT "action_plans_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_plans" ADD CONSTRAINT "action_plans_marketplaceAccountId_fkey" FOREIGN KEY ("marketplaceAccountId") REFERENCES "marketplace_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_plan_checklist_items" ADD CONSTRAINT "action_plan_checklist_items_planId_fkey" FOREIGN KEY ("planId") REFERENCES "action_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

