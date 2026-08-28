-- AlterTable
ALTER TABLE "users" ADD COLUMN     "allowedCompanyNames" TEXT[] DEFAULT ARRAY[]::TEXT[];
