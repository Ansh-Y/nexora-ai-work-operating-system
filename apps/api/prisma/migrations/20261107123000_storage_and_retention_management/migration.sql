-- CreateEnum
CREATE TYPE "StorageUploadStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "RetentionHoldType" AS ENUM ('LEGAL', 'OPERATIONAL', 'COMPLIANCE');

-- AlterTable
ALTER TABLE "Document" ADD COLUMN "storageObjectId" UUID;

-- AlterTable
ALTER TABLE "MeetingRecording" ADD COLUMN "storageObjectId" UUID;

-- CreateTable
CREATE TABLE "StorageObject" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'local',
    "bucket" TEXT,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" UUID,
    "uploadStatus" "StorageUploadStatus" NOT NULL DEFAULT 'READY',
    "lastAccessedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorageObject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationRetentionPolicy" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "recordingRetentionDays" INTEGER,
    "documentRetentionDays" INTEGER,
    "autoDeleteExpired" BOOLEAN NOT NULL DEFAULT false,
    "manualDeletionAllowed" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationRetentionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileRetentionHold" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "storageObjectId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "holdType" "RetentionHoldType" NOT NULL DEFAULT 'LEGAL',
    "appliedById" UUID NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedById" UUID,
    "releasedAt" TIMESTAMP(3),
    "releaseReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileRetentionHold_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StorageObject_storageKey_key" ON "StorageObject"("storageKey");

-- CreateIndex
CREATE INDEX "StorageObject_organizationId_entityType_idx" ON "StorageObject"("organizationId", "entityType");

-- CreateIndex
CREATE INDEX "StorageObject_organizationId_expiresAt_idx" ON "StorageObject"("organizationId", "expiresAt");

-- CreateIndex
CREATE INDEX "StorageObject_organizationId_deletedAt_idx" ON "StorageObject"("organizationId", "deletedAt");

-- CreateIndex
CREATE INDEX "StorageObject_organizationId_sha256_idx" ON "StorageObject"("organizationId", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationRetentionPolicy_organizationId_key" ON "OrganizationRetentionPolicy"("organizationId");

-- CreateIndex
CREATE INDEX "FileRetentionHold_organizationId_storageObjectId_idx" ON "FileRetentionHold"("organizationId", "storageObjectId");

-- CreateIndex
CREATE INDEX "FileRetentionHold_storageObjectId_releasedAt_idx" ON "FileRetentionHold"("storageObjectId", "releasedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Document_storageObjectId_key" ON "Document"("storageObjectId");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingRecording_storageObjectId_key" ON "MeetingRecording"("storageObjectId");

-- AddForeignKey
ALTER TABLE "MeetingRecording" ADD CONSTRAINT "MeetingRecording_storageObjectId_fkey" FOREIGN KEY ("storageObjectId") REFERENCES "StorageObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_storageObjectId_fkey" FOREIGN KEY ("storageObjectId") REFERENCES "StorageObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorageObject" ADD CONSTRAINT "StorageObject_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationRetentionPolicy" ADD CONSTRAINT "OrganizationRetentionPolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileRetentionHold" ADD CONSTRAINT "FileRetentionHold_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileRetentionHold" ADD CONSTRAINT "FileRetentionHold_storageObjectId_fkey" FOREIGN KEY ("storageObjectId") REFERENCES "StorageObject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileRetentionHold" ADD CONSTRAINT "FileRetentionHold_appliedById_fkey" FOREIGN KEY ("appliedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileRetentionHold" ADD CONSTRAINT "FileRetentionHold_releasedById_fkey" FOREIGN KEY ("releasedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
