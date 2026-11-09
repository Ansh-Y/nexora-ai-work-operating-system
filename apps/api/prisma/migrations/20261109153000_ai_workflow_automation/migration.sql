-- CreateEnum
CREATE TYPE "WorkflowTriggerType" AS ENUM ('TASK_OVERDUE', 'TASK_STATUS_CHANGED', 'TASK_MARKED_BLOCKED', 'PROJECT_HEALTH_AT_RISK', 'MILESTONE_APPROACHING', 'TASK_CREATED');

-- CreateEnum
CREATE TYPE "WorkflowActionType" AS ENUM ('AI_TASK_RECOMMENDATION', 'RECOMMEND_TASK_ASSIGNEE', 'NOTIFY_PROJECT_MANAGER', 'GENERATE_HEALTH_SUMMARY', 'CREATE_TASK_PROPOSAL');

-- CreateEnum
CREATE TYPE "WorkflowRunStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'EXECUTED', 'REJECTED', 'FAILED');

-- CreateTable
CREATE TABLE "WorkflowAutomationRule" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "triggerEvent" "WorkflowTriggerType" NOT NULL,
    "action" "WorkflowActionType" NOT NULL,
    "conditions" JSONB NOT NULL DEFAULT '{}',
    "actionConfig" JSONB NOT NULL DEFAULT '{}',
    "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID NOT NULL,
    "updatedById" UUID,
    "lastExecutedAt" TIMESTAMP(3),
    "lastExecutionStatus" "WorkflowRunStatus",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowAutomationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowAutomationRun" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "ruleId" UUID NOT NULL,
    "projectId" UUID,
    "taskId" UUID,
    "milestoneId" UUID,
    "triggerEvent" "WorkflowTriggerType" NOT NULL,
    "action" "WorkflowActionType" NOT NULL,
    "status" "WorkflowRunStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "dedupeKey" TEXT,
    "explanation" TEXT NOT NULL DEFAULT '',
    "proposedAction" JSONB NOT NULL DEFAULT '{}',
    "executionResult" JSONB,
    "errorMessage" TEXT,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowAutomationRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkflowAutomationRule_organizationId_isEnabled_idx" ON "WorkflowAutomationRule"("organizationId", "isEnabled");

-- CreateIndex
CREATE INDEX "WorkflowAutomationRule_organizationId_triggerEvent_idx" ON "WorkflowAutomationRule"("organizationId", "triggerEvent");

-- CreateIndex
CREATE INDEX "WorkflowAutomationRun_organizationId_status_idx" ON "WorkflowAutomationRun"("organizationId", "status");

-- CreateIndex
CREATE INDEX "WorkflowAutomationRun_organizationId_ruleId_createdAt_idx" ON "WorkflowAutomationRun"("organizationId", "ruleId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkflowAutomationRun_organizationId_dedupeKey_idx" ON "WorkflowAutomationRun"("organizationId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "WorkflowAutomationRule" ADD CONSTRAINT "WorkflowAutomationRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowAutomationRule" ADD CONSTRAINT "WorkflowAutomationRule_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowAutomationRule" ADD CONSTRAINT "WorkflowAutomationRule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowAutomationRule" ADD CONSTRAINT "WorkflowAutomationRule_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowAutomationRun" ADD CONSTRAINT "WorkflowAutomationRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowAutomationRun" ADD CONSTRAINT "WorkflowAutomationRun_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "WorkflowAutomationRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowAutomationRun" ADD CONSTRAINT "WorkflowAutomationRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowAutomationRun" ADD CONSTRAINT "WorkflowAutomationRun_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowAutomationRun" ADD CONSTRAINT "WorkflowAutomationRun_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
