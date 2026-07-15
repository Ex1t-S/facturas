-- FMH Engineering Golden Library: source registry, benchmarks, validations and resumable jobs.
ALTER TABLE "EngineeringReview" ADD COLUMN IF NOT EXISTS "reviewerUserId" TEXT;
ALTER TABLE "EngineeringReview" ADD COLUMN IF NOT EXISTS "fieldName" TEXT;
ALTER TABLE "EngineeringKnowledgeDocument" ADD COLUMN IF NOT EXISTS "sourceId" TEXT;
CREATE INDEX IF NOT EXISTS "EngineeringKnowledgeDocument_sourceId_idx" ON "EngineeringKnowledgeDocument"("sourceId");

CREATE TABLE IF NOT EXISTS "EngineeringSource" (
  "id" TEXT NOT NULL,
  "companyId" TEXT,
  "title" TEXT NOT NULL,
  "publisher" TEXT NOT NULL,
  "jurisdiction" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceUrl" TEXT NOT NULL,
  "finalUrl" TEXT,
  "officialDomain" TEXT NOT NULL,
  "localFilePath" TEXT,
  "documentId" TEXT,
  "publicationDate" TIMESTAMP(3),
  "edition" TEXT,
  "revision" TEXT,
  "effectiveDate" TIMESTAMP(3),
  "retrievedAt" TIMESTAMP(3),
  "lastCheckedAt" TIMESTAMP(3),
  "contentHash" TEXT,
  "fileHash" TEXT,
  "mimeType" TEXT,
  "language" TEXT NOT NULL DEFAULT 'es',
  "licenseStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "downloadStatus" TEXT NOT NULL DEFAULT 'NOT_ATTEMPTED',
  "verificationStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "supersededById" TEXT,
  "notes" TEXT,
  "metadataJson" TEXT NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EngineeringSource_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "EngineeringSource_companyId_sourceType_idx" ON "EngineeringSource"("companyId", "sourceType");
CREATE INDEX IF NOT EXISTS "EngineeringSource_jurisdiction_verificationStatus_idx" ON "EngineeringSource"("jurisdiction", "verificationStatus");
CREATE INDEX IF NOT EXISTS "EngineeringSource_officialDomain_idx" ON "EngineeringSource"("officialDomain");
CREATE INDEX IF NOT EXISTS "EngineeringSource_documentId_idx" ON "EngineeringSource"("documentId");
CREATE INDEX IF NOT EXISTS "EngineeringSource_fileHash_idx" ON "EngineeringSource"("fileHash");
DO $$ BEGIN
  ALTER TABLE "EngineeringSource" ADD CONSTRAINT "EngineeringSource_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "EngineeringSource" ADD CONSTRAINT "EngineeringSource_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "EngineeringKnowledgeDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "EngineeringSource" ADD CONSTRAINT "EngineeringSource_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "EngineeringSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "EngineeringKnowledgeDocument" ADD CONSTRAINT "EngineeringKnowledgeDocument_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "EngineeringSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "EngineeringBenchmark" (
  "id" TEXT NOT NULL,
  "companyId" TEXT,
  "title" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "benchmarkType" TEXT NOT NULL,
  "jurisdiction" TEXT NOT NULL,
  "standardCode" TEXT,
  "standardEdition" TEXT,
  "problemStatement" TEXT NOT NULL,
  "inputJson" TEXT NOT NULL,
  "expectedOutputJson" TEXT NOT NULL,
  "tolerancesJson" TEXT NOT NULL DEFAULT '{}',
  "calculationStepsJson" TEXT NOT NULL DEFAULT '[]',
  "pageReferencesJson" TEXT NOT NULL DEFAULT '[]',
  "status" TEXT NOT NULL DEFAULT 'NEEDS_REVIEW',
  "verified" BOOLEAN NOT NULL DEFAULT FALSE,
  "verificationNotes" TEXT,
  "implementedTool" TEXT,
  "testFile" TEXT,
  "extractionVersion" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EngineeringBenchmark_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "EngineeringBenchmark_companyId_benchmarkType_idx" ON "EngineeringBenchmark"("companyId", "benchmarkType");
CREATE INDEX IF NOT EXISTS "EngineeringBenchmark_sourceId_idx" ON "EngineeringBenchmark"("sourceId");
CREATE INDEX IF NOT EXISTS "EngineeringBenchmark_verified_idx" ON "EngineeringBenchmark"("verified");
DO $$ BEGIN
  ALTER TABLE "EngineeringBenchmark" ADD CONSTRAINT "EngineeringBenchmark_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "EngineeringBenchmark" ADD CONSTRAINT "EngineeringBenchmark_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "EngineeringSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "EngineeringToolValidation" (
  "id" TEXT NOT NULL,
  "companyId" TEXT,
  "toolName" TEXT NOT NULL,
  "toolVersion" TEXT NOT NULL,
  "benchmarkId" TEXT NOT NULL,
  "resultJson" TEXT NOT NULL,
  "absoluteError" DOUBLE PRECISION,
  "relativeError" DOUBLE PRECISION,
  "passed" BOOLEAN NOT NULL,
  "scope" TEXT NOT NULL DEFAULT 'PRELIMINARY',
  "validatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notes" TEXT,
  CONSTRAINT "EngineeringToolValidation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "EngineeringToolValidation_toolName_toolVersion_benchmarkId_key" ON "EngineeringToolValidation"("toolName", "toolVersion", "benchmarkId");
CREATE INDEX IF NOT EXISTS "EngineeringToolValidation_companyId_toolName_idx" ON "EngineeringToolValidation"("companyId", "toolName");
CREATE INDEX IF NOT EXISTS "EngineeringToolValidation_benchmarkId_idx" ON "EngineeringToolValidation"("benchmarkId");
DO $$ BEGIN
  ALTER TABLE "EngineeringToolValidation" ADD CONSTRAINT "EngineeringToolValidation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "EngineeringToolValidation" ADD CONSTRAINT "EngineeringToolValidation_benchmarkId_fkey" FOREIGN KEY ("benchmarkId") REFERENCES "EngineeringBenchmark"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "EngineeringCurationJob" (
  "id" TEXT NOT NULL,
  "companyId" TEXT,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "progress" INTEGER NOT NULL DEFAULT 0,
  "statisticsJson" TEXT NOT NULL DEFAULT '{}',
  "errorsJson" TEXT NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "EngineeringCurationJob_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "EngineeringCurationJob_companyId_status_idx" ON "EngineeringCurationJob"("companyId", "status");
CREATE INDEX IF NOT EXISTS "EngineeringCurationJob_type_createdAt_idx" ON "EngineeringCurationJob"("type", "createdAt");
DO $$ BEGIN
  ALTER TABLE "EngineeringCurationJob" ADD CONSTRAINT "EngineeringCurationJob_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
