-- CreateEnum
CREATE TYPE "GitHubAutomationTrigger" AS ENUM ('PULL_REQUEST_OPENED', 'PULL_REQUEST_UPDATED', 'PULL_REQUEST_APPROVED', 'PULL_REQUEST_MERGED', 'PULL_REQUEST_CLOSED', 'ISSUE_OPENED', 'ISSUE_CLOSED', 'COMMIT_PUSHED');

-- CreateEnum
CREATE TYPE "GitHubAutomationAction" AS ENUM ('TRANSITION_TASK_STATUS', 'ADD_COMMENT');

-- CreateEnum
CREATE TYPE "GitHubAutomationExecutionMode" AS ENUM ('AUTOMATIC', 'APPROVAL_REQUIRED');

-- CreateEnum
CREATE TYPE "GitHubAutomationRunStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'EXECUTED', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "GitHubAutomationRule" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "repositoryId" UUID,
    "projectId" UUID,
    "taskId" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "triggerEvent" "GitHubAutomationTrigger" NOT NULL,
    "action" "GitHubAutomationAction" NOT NULL DEFAULT 'TRANSITION_TASK_STATUS',
    "targetStatus" "TaskStatus",
    "executionMode" "GitHubAutomationExecutionMode" NOT NULL DEFAULT 'AUTOMATIC',
    "conditions" JSONB NOT NULL DEFAULT '{}',
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID NOT NULL,
    "updatedById" UUID,
    "lastExecutedAt" TIMESTAMP(3),
    "lastExecutionStatus" "GitHubAutomationRunStatus",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GitHubAutomationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GitHubAutomationRun" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "ruleId" UUID NOT NULL,
    "eventId" UUID,
    "taskId" UUID,
    "triggerEvent" "GitHubAutomationTrigger" NOT NULL,
    "action" "GitHubAutomationAction" NOT NULL,
    "targetStatus" "TaskStatus",
    "status" "GitHubAutomationRunStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "executionMode" "GitHubAutomationExecutionMode" NOT NULL,
    "explanation" TEXT NOT NULL DEFAULT '',
    "payloadSummary" JSONB NOT NULL DEFAULT '{}',
    "errorMessage" TEXT,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GitHubAutomationRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GitHubAutomationRule_organizationId_isEnabled_idx" ON "GitHubAutomationRule"("organizationId", "isEnabled");

-- CreateIndex
CREATE INDEX "GitHubAutomationRule_organizationId_repositoryId_triggerEve_idx" ON "GitHubAutomationRule"("organizationId", "repositoryId", "triggerEvent");

-- CreateIndex
CREATE INDEX "GitHubAutomationRun_organizationId_status_idx" ON "GitHubAutomationRun"("organizationId", "status");

-- CreateIndex
CREATE INDEX "GitHubAutomationRun_organizationId_ruleId_createdAt_idx" ON "GitHubAutomationRun"("organizationId", "ruleId", "createdAt");

-- CreateIndex
CREATE INDEX "GitHubAutomationRun_organizationId_taskId_idx" ON "GitHubAutomationRun"("organizationId", "taskId");

-- AddForeignKey
ALTER TABLE "GitHubAutomationRule" ADD CONSTRAINT "GitHubAutomationRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitHubAutomationRule" ADD CONSTRAINT "GitHubAutomationRule_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "GitHubRepository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitHubAutomationRule" ADD CONSTRAINT "GitHubAutomationRule_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitHubAutomationRule" ADD CONSTRAINT "GitHubAutomationRule_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitHubAutomationRule" ADD CONSTRAINT "GitHubAutomationRule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitHubAutomationRule" ADD CONSTRAINT "GitHubAutomationRule_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitHubAutomationRun" ADD CONSTRAINT "GitHubAutomationRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitHubAutomationRun" ADD CONSTRAINT "GitHubAutomationRun_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "GitHubAutomationRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitHubAutomationRun" ADD CONSTRAINT "GitHubAutomationRun_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "GitHubEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitHubAutomationRun" ADD CONSTRAINT "GitHubAutomationRun_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitHubAutomationRun" ADD CONSTRAINT "GitHubAutomationRun_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
