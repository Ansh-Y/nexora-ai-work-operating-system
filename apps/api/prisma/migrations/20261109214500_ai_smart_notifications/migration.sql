-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PROJECT_HEALTH';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'WORKFLOW_APPROVAL';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'WORKFLOW_EXECUTION';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'WEEKLY_REPORT';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'AI_INSIGHT';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TASK_COMPLETED';

-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('PROJECT', 'TASK', 'AI', 'TEAM');

-- CreateEnum
CREATE TYPE "NotificationPriority" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN "category" "NotificationCategory" NOT NULL DEFAULT 'TASK';
ALTER TABLE "Notification" ADD COLUMN "priority" "NotificationPriority" NOT NULL DEFAULT 'MEDIUM';
ALTER TABLE "Notification" ADD COLUMN "actionUrl" TEXT;
ALTER TABLE "Notification" ADD COLUMN "metadata" JSONB;
ALTER TABLE "Notification" ADD COLUMN "dismissedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "projectAlerts" BOOLEAN NOT NULL DEFAULT true,
    "taskAlerts" BOOLEAN NOT NULL DEFAULT true,
    "aiAlerts" BOOLEAN NOT NULL DEFAULT true,
    "teamAlerts" BOOLEAN NOT NULL DEFAULT true,
    "lowPriorityAlerts" BOOLEAN NOT NULL DEFAULT true,
    "projectHealthAlerts" BOOLEAN NOT NULL DEFAULT true,
    "projectRiskAlerts" BOOLEAN NOT NULL DEFAULT true,
    "taskAssignmentAlerts" BOOLEAN NOT NULL DEFAULT true,
    "taskStatusAlerts" BOOLEAN NOT NULL DEFAULT true,
    "taskDeadlineAlerts" BOOLEAN NOT NULL DEFAULT true,
    "aiProposalAlerts" BOOLEAN NOT NULL DEFAULT true,
    "weeklyReportAlerts" BOOLEAN NOT NULL DEFAULT true,
    "teamCommentAlerts" BOOLEAN NOT NULL DEFAULT true,
    "deadlineReminderLeadHours" INTEGER NOT NULL DEFAULT 24,
    "inAppAlerts" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_organizationId_userId_category_idx" ON "Notification"("organizationId", "userId", "category");

-- CreateIndex
CREATE INDEX "Notification_organizationId_userId_priority_idx" ON "Notification"("organizationId", "userId", "priority");

-- CreateIndex
CREATE INDEX "Notification_organizationId_userId_dismissedAt_idx" ON "Notification"("organizationId", "userId", "dismissedAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_organizationId_userId_key" ON "NotificationPreference"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "NotificationPreference_organizationId_userId_idx" ON "NotificationPreference"("organizationId", "userId");

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
