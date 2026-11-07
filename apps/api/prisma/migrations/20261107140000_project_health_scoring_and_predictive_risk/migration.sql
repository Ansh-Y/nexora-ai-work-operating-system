-- CreateTable
CREATE TABLE "ProjectHealthSnapshot" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "score" DOUBLE PRECISION,
    "classification" TEXT NOT NULL,
    "dimensionScores" JSONB NOT NULL,
    "activeRisksCount" JSONB NOT NULL,
    "dataCompleteness" DOUBLE PRECISION NOT NULL,
    "forecast" JSONB,
    "algorithmVersion" TEXT NOT NULL DEFAULT '1.0.0',
    "explanation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectHealthSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectRisk" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "riskType" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "recommendedAction" TEXT NOT NULL,
    "confidence" TEXT NOT NULL DEFAULT 'HIGH',
    "affectedTaskIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "affectedMilestoneIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "dismissedAt" TIMESTAMP(3),
    "dismissedById" UUID,
    "dismissReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectRisk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectHealthSnapshot_organizationId_projectId_createdAt_idx" ON "ProjectHealthSnapshot"("organizationId", "projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectHealthSnapshot_organizationId_classification_idx" ON "ProjectHealthSnapshot"("organizationId", "classification");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectRisk_projectId_fingerprint_key" ON "ProjectRisk"("projectId", "fingerprint");

-- CreateIndex
CREATE INDEX "ProjectRisk_organizationId_projectId_status_idx" ON "ProjectRisk"("organizationId", "projectId", "status");

-- CreateIndex
CREATE INDEX "ProjectRisk_organizationId_severity_status_idx" ON "ProjectRisk"("organizationId", "severity", "status");

-- AddForeignKey
ALTER TABLE "ProjectHealthSnapshot" ADD CONSTRAINT "ProjectHealthSnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectHealthSnapshot" ADD CONSTRAINT "ProjectHealthSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectRisk" ADD CONSTRAINT "ProjectRisk_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectRisk" ADD CONSTRAINT "ProjectRisk_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectRisk" ADD CONSTRAINT "ProjectRisk_dismissedById_fkey" FOREIGN KEY ("dismissedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
