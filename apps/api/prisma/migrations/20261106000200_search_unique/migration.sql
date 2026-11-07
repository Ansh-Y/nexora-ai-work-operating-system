DROP INDEX IF EXISTS "SearchChunk_organizationId_sourceType_sourceId_idx";
CREATE UNIQUE INDEX "SearchChunk_organizationId_sourceType_sourceId_key" ON "SearchChunk"("organizationId", "sourceType", "sourceId");
ALTER TABLE "Notification" ADD COLUMN "dedupeKey" TEXT;
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");
