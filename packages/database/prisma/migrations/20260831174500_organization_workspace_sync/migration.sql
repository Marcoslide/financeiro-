-- Hotfix v1.0.2: persistência compartilhada das stores da V1 por organização.
-- Não altera nem migra tabelas financeiras existentes.
CREATE TABLE "organization_workspace_stores" (
    "organizationId" TEXT NOT NULL,
    "storeName" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_workspace_stores_pkey" PRIMARY KEY ("organizationId", "storeName")
);

CREATE INDEX "organization_workspace_stores_organizationId_updatedAt_idx"
ON "organization_workspace_stores"("organizationId", "updatedAt");

ALTER TABLE "organization_workspace_stores"
ADD CONSTRAINT "organization_workspace_stores_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
