-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'OWNER';

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "marketplaceAccountId" TEXT,
ADD COLUMN     "module" TEXT,
ADD COLUMN     "userNameSnapshot" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "appRoleId" TEXT,
ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "updatedBy" TEXT;

-- CreateTable
CREATE TABLE "app_roles" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT,
    "name" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_role_permissions" (
    "id" TEXT NOT NULL,
    "appRoleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "app_role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_permission_overrides" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "allow" BOOLEAN NOT NULL,

    CONSTRAINT "user_permission_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "app_roles_organizationId_idx" ON "app_roles"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "app_roles_organizationId_key_key" ON "app_roles"("organizationId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE INDEX "permissions_module_idx" ON "permissions"("module");

-- CreateIndex
CREATE INDEX "app_role_permissions_permissionId_idx" ON "app_role_permissions"("permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "app_role_permissions_appRoleId_permissionId_key" ON "app_role_permissions"("appRoleId", "permissionId");

-- CreateIndex
CREATE INDEX "user_permission_overrides_permissionId_idx" ON "user_permission_overrides"("permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "user_permission_overrides_userId_permissionId_key" ON "user_permission_overrides"("userId", "permissionId");

-- CreateIndex
CREATE INDEX "users_appRoleId_idx" ON "users"("appRoleId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_appRoleId_fkey" FOREIGN KEY ("appRoleId") REFERENCES "app_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_roles" ADD CONSTRAINT "app_roles_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_role_permissions" ADD CONSTRAINT "app_role_permissions_appRoleId_fkey" FOREIGN KEY ("appRoleId") REFERENCES "app_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_role_permissions" ADD CONSTRAINT "app_role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
