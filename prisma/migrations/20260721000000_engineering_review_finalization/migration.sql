-- FMH Engineering finalization: resumable human review and catalog provenance.
ALTER TABLE "StructuralSection" ADD COLUMN IF NOT EXISTS "sourceId" TEXT;
ALTER TABLE "StructuralSection" ADD COLUMN IF NOT EXISTS "sourcePage" INTEGER;
ALTER TABLE "StructuralSection" ADD COLUMN IF NOT EXISTS "reviewStatus" TEXT NOT NULL DEFAULT 'PENDING_REVIEW';

CREATE INDEX IF NOT EXISTS "StructuralSection_sourceId_idx" ON "StructuralSection"("sourceId");
CREATE INDEX IF NOT EXISTS "StructuralSection_companyId_reviewStatus_idx" ON "StructuralSection"("companyId", "reviewStatus");

DO $$ BEGIN
  ALTER TABLE "StructuralSection" ADD CONSTRAINT "StructuralSection_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "EngineeringSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "EngineeringReviewSession" (
  "id" TEXT NOT NULL,
  "companyId" TEXT,
  "reviewType" TEXT NOT NULL,
  "reviewer" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "cursorJson" TEXT NOT NULL DEFAULT '{}',
  "processedCount" INTEGER NOT NULL DEFAULT 0,
  "confirmedCount" INTEGER NOT NULL DEFAULT 0,
  "correctedCount" INTEGER NOT NULL DEFAULT 0,
  "skippedCount" INTEGER NOT NULL DEFAULT 0,
  "rejectedCount" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastActivityAt" TIMESTAMP(3) NOT NULL,
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "EngineeringReviewSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "EngineeringReviewSession_companyId_reviewType_status_idx" ON "EngineeringReviewSession"("companyId", "reviewType", "status");
CREATE INDEX IF NOT EXISTS "EngineeringReviewSession_reviewer_lastActivityAt_idx" ON "EngineeringReviewSession"("reviewer", "lastActivityAt");

DO $$ BEGIN
  ALTER TABLE "EngineeringReviewSession" ADD CONSTRAINT "EngineeringReviewSession_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "EngineeringReview" ADD COLUMN IF NOT EXISTS "sessionId" TEXT;
ALTER TABLE "EngineeringReview" ADD COLUMN IF NOT EXISTS "entityType" TEXT;
ALTER TABLE "EngineeringReview" ADD COLUMN IF NOT EXISTS "entityId" TEXT;
ALTER TABLE "EngineeringReview" ADD COLUMN IF NOT EXISTS "decision" TEXT;

CREATE INDEX IF NOT EXISTS "EngineeringReview_sessionId_idx" ON "EngineeringReview"("sessionId");
CREATE INDEX IF NOT EXISTS "EngineeringReview_entityType_entityId_idx" ON "EngineeringReview"("entityType", "entityId");

DO $$ BEGIN
  ALTER TABLE "EngineeringReview" ADD CONSTRAINT "EngineeringReview_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "EngineeringReviewSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
