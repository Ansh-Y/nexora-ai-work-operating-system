-- AlterEnum
ALTER TYPE "MeetingActionStatus" ADD VALUE 'EXPIRED';

-- AlterTable
ALTER TABLE "MeetingActionItem" ADD COLUMN     "expiresAt" TIMESTAMP(3);

-- Existing reviewable actions receive the same seven-day approval window.
UPDATE "MeetingActionItem"
SET "expiresAt" = "createdAt" + INTERVAL '7 days'
WHERE "expiresAt" IS NULL AND "status" IN ('EXTRACTED', 'APPROVED');

-- CreateIndex
CREATE INDEX "MeetingActionItem_organizationId_status_expiresAt_idx" ON "MeetingActionItem"("organizationId", "status", "expiresAt");
