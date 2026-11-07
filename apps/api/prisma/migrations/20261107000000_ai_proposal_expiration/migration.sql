ALTER TYPE "ProposalStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';

ALTER TABLE "AiProposal" ADD COLUMN "expiresAt" TIMESTAMP(3);
UPDATE "AiProposal"
SET "expiresAt" = "createdAt" + INTERVAL '30 days'
WHERE "expiresAt" IS NULL;
ALTER TABLE "AiProposal" ALTER COLUMN "expiresAt" SET NOT NULL;
