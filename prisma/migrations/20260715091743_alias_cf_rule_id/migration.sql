-- AlterTable
ALTER TABLE "Alias" ADD COLUMN "cfRuleId" TEXT;

-- CreateIndex
CREATE INDEX "Alias_cfRuleId_idx" ON "Alias"("cfRuleId");
