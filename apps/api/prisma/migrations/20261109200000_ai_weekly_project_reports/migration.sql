-- CreateTable
CREATE TABLE "ProjectWeeklyReport" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "creatorId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "executiveSummary" TEXT NOT NULL DEFAULT '',
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "progressOverview" JSONB NOT NULL DEFAULT '{}',
    "blockersAndRisks" JSONB NOT NULL DEFAULT '{}',
    "teamWorkload" JSONB NOT NULL DEFAULT '[]',
    "meetingInsights" JSONB NOT NULL DEFAULT '{}',
    "recommendations" JSONB NOT NULL DEFAULT '[]',
    "pdfStorageKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectWeeklyReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectWeeklyReport_organizationId_projectId_createdAt_idx" ON "ProjectWeeklyReport"("organizationId", "projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectWeeklyReport_organizationId_createdAt_idx" ON "ProjectWeeklyReport"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "ProjectWeeklyReport" ADD CONSTRAINT "ProjectWeeklyReport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectWeeklyReport" ADD CONSTRAINT "ProjectWeeklyReport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectWeeklyReport" ADD CONSTRAINT "ProjectWeeklyReport_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
