-- CreateEnum
CREATE TYPE "MeetingProcessingState" AS ENUM ('NOT_STARTED', 'AWAITING_CONFIGURATION', 'QUEUED', 'TRANSCRIBING', 'ANALYZING', 'COMPLETE', 'FAILED');

-- CreateEnum
CREATE TYPE "MeetingActionStatus" AS ENUM ('EXTRACTED', 'APPROVED', 'REJECTED', 'CONVERTED');

-- AlterTable
ALTER TABLE "Meeting" ADD COLUMN     "analysisRecordingId" UUID,
ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "createdById" UUID,
ADD COLUMN     "description" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "discussionTopics" JSONB,
ADD COLUMN     "durationMinutes" INTEGER,
ADD COLUMN     "objectives" JSONB,
ADD COLUMN     "processingError" TEXT,
ADD COLUMN     "processingState" "MeetingProcessingState" NOT NULL DEFAULT 'NOT_STARTED',
ADD COLUMN     "risks" JSONB,
ADD COLUMN     "summaryEvidence" JSONB,
ADD COLUMN     "unresolvedQuestions" JSONB;

-- CreateTable
CREATE TABLE "MeetingParticipant" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "meetingId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingRecording" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "meetingId" UUID NOT NULL,
    "uploadedById" UUID,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "processingState" "MeetingProcessingState" NOT NULL DEFAULT 'NOT_STARTED',
    "processingError" TEXT,
    "processingGeneration" INTEGER NOT NULL DEFAULT 0,
    "transcriptionProvider" TEXT,
    "transcript" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingRecording_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TranscriptSegment" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "meetingId" UUID NOT NULL,
    "recordingId" UUID,
    "sequence" INTEGER NOT NULL,
    "startMs" INTEGER,
    "endMs" INTEGER,
    "speakerLabel" TEXT,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TranscriptSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingDecision" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "meetingId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "recordingId" UUID,
    "title" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "timestampMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingActionItem" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "meetingId" UUID NOT NULL,
    "projectId" UUID,
    "assigneeId" UUID,
    "approvedById" UUID,
    "createdTaskId" UUID,
    "recordingId" UUID,
    "sequence" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "evidence" TEXT NOT NULL,
    "timestampMs" INTEGER,
    "suggestedOwner" TEXT,
    "dueDate" TIMESTAMP(3),
    "status" "MeetingActionStatus" NOT NULL DEFAULT 'EXTRACTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingActionItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MeetingParticipant_organizationId_userId_idx" ON "MeetingParticipant"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingParticipant_meetingId_userId_key" ON "MeetingParticipant"("meetingId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingRecording_storageKey_key" ON "MeetingRecording"("storageKey");

-- CreateIndex
CREATE INDEX "MeetingRecording_organizationId_meetingId_createdAt_idx" ON "MeetingRecording"("organizationId", "meetingId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingRecording_meetingId_version_key" ON "MeetingRecording"("meetingId", "version");

-- CreateIndex
CREATE INDEX "TranscriptSegment_organizationId_meetingId_startMs_idx" ON "TranscriptSegment"("organizationId", "meetingId", "startMs");

-- CreateIndex
CREATE UNIQUE INDEX "TranscriptSegment_meetingId_sequence_key" ON "TranscriptSegment"("meetingId", "sequence");

-- CreateIndex
CREATE INDEX "MeetingDecision_organizationId_meetingId_idx" ON "MeetingDecision"("organizationId", "meetingId");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingDecision_meetingId_sequence_key" ON "MeetingDecision"("meetingId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingActionItem_createdTaskId_key" ON "MeetingActionItem"("createdTaskId");

-- CreateIndex
CREATE INDEX "MeetingActionItem_organizationId_meetingId_status_idx" ON "MeetingActionItem"("organizationId", "meetingId", "status");

-- CreateIndex
CREATE INDEX "MeetingActionItem_organizationId_projectId_idx" ON "MeetingActionItem"("organizationId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingActionItem_meetingId_sequence_key" ON "MeetingActionItem"("meetingId", "sequence");

-- CreateIndex
CREATE INDEX "Meeting_organizationId_archivedAt_startsAt_idx" ON "Meeting"("organizationId", "archivedAt", "startsAt");

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingParticipant" ADD CONSTRAINT "MeetingParticipant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingParticipant" ADD CONSTRAINT "MeetingParticipant_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingParticipant" ADD CONSTRAINT "MeetingParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingRecording" ADD CONSTRAINT "MeetingRecording_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingRecording" ADD CONSTRAINT "MeetingRecording_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingRecording" ADD CONSTRAINT "MeetingRecording_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranscriptSegment" ADD CONSTRAINT "TranscriptSegment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranscriptSegment" ADD CONSTRAINT "TranscriptSegment_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranscriptSegment" ADD CONSTRAINT "TranscriptSegment_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "MeetingRecording"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingDecision" ADD CONSTRAINT "MeetingDecision_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingDecision" ADD CONSTRAINT "MeetingDecision_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingDecision" ADD CONSTRAINT "MeetingDecision_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "MeetingRecording"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingActionItem" ADD CONSTRAINT "MeetingActionItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingActionItem" ADD CONSTRAINT "MeetingActionItem_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingActionItem" ADD CONSTRAINT "MeetingActionItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingActionItem" ADD CONSTRAINT "MeetingActionItem_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingActionItem" ADD CONSTRAINT "MeetingActionItem_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingActionItem" ADD CONSTRAINT "MeetingActionItem_createdTaskId_fkey" FOREIGN KEY ("createdTaskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingActionItem" ADD CONSTRAINT "MeetingActionItem_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "MeetingRecording"("id") ON DELETE SET NULL ON UPDATE CASCADE;
