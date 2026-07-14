CREATE TABLE IF NOT EXISTS "EngineeringKnowledgeDocument" (
  "id" TEXT NOT NULL,
  "companyId" TEXT,
  "sourceDocumentId" TEXT,
  "fileName" TEXT NOT NULL,
  "relativePath" TEXT,
  "extension" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DISCOVERED',
  "documentType" TEXT NOT NULL DEFAULT 'OTHER',
  "projectType" TEXT NOT NULL DEFAULT 'OTHER',
  "projectName" TEXT,
  "customerName" TEXT,
  "documentDate" TIMESTAMP(3),
  "rawText" TEXT,
  "structuredJson" TEXT,
  "metadataJson" TEXT,
  "extractorVersion" TEXT NOT NULL DEFAULT 'engineering-extractor-v1',
  "promptVersion" TEXT,
  "model" TEXT,
  "confidence" DECIMAL(65,30) NOT NULL DEFAULT 0,
  "errorMessage" TEXT,
  "verified" BOOLEAN NOT NULL DEFAULT false,
  "reviewNotes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EngineeringKnowledgeDocument_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "EngineeringProject" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "projectType" TEXT NOT NULL DEFAULT 'OTHER',
  "customerName" TEXT,
  "projectDate" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'SUGGESTED',
  "description" TEXT,
  "technicalJson" TEXT,
  "notes" TEXT,
  "verified" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EngineeringProject_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "EngineeringProjectDocument" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "knowledgeId" TEXT NOT NULL,
  CONSTRAINT "EngineeringProjectDocument_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "EngineeringCalculation" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "formula" TEXT,
  "inputsJson" TEXT NOT NULL,
  "resultJson" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'CALCULATED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EngineeringCalculation_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "EngineeringReview" (
  "id" TEXT NOT NULL,
  "companyId" TEXT,
  "knowledgeId" TEXT,
  "projectId" TEXT,
  "originalJson" TEXT,
  "correctedJson" TEXT,
  "status" TEXT NOT NULL DEFAULT 'VERIFIED',
  "note" TEXT,
  "reviewerName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EngineeringReview_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "EngineeringIngestionRun" (
  "id" TEXT NOT NULL,
  "companyId" TEXT,
  "rootPath" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RUNNING',
  "foundCount" INTEGER NOT NULL DEFAULT 0,
  "newCount" INTEGER NOT NULL DEFAULT 0,
  "unchangedCount" INTEGER NOT NULL DEFAULT 0,
  "modifiedCount" INTEGER NOT NULL DEFAULT 0,
  "processedCount" INTEGER NOT NULL DEFAULT 0,
  "pendingCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "EngineeringIngestionRun_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "EngineeringVectorIndex" (
  "id" TEXT NOT NULL,
  "knowledgeId" TEXT NOT NULL,
  "vectorStoreId" TEXT NOT NULL,
  "openaiFileId" TEXT,
  "localHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "indexedAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  CONSTRAINT "EngineeringVectorIndex_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "EngineeringKnowledgeDocument_companyId_sha256_key" ON "EngineeringKnowledgeDocument"("companyId", "sha256");
CREATE UNIQUE INDEX IF NOT EXISTS "EngineeringProjectDocument_projectId_knowledgeId_key" ON "EngineeringProjectDocument"("projectId", "knowledgeId");
CREATE UNIQUE INDEX IF NOT EXISTS "EngineeringVectorIndex_knowledgeId_vectorStoreId_key" ON "EngineeringVectorIndex"("knowledgeId", "vectorStoreId");
CREATE INDEX IF NOT EXISTS "EngineeringKnowledgeDocument_companyId_status_idx" ON "EngineeringKnowledgeDocument"("companyId", "status");
CREATE INDEX IF NOT EXISTS "EngineeringKnowledgeDocument_companyId_projectType_idx" ON "EngineeringKnowledgeDocument"("companyId", "projectType");
CREATE INDEX IF NOT EXISTS "EngineeringKnowledgeDocument_companyId_documentType_idx" ON "EngineeringKnowledgeDocument"("companyId", "documentType");
CREATE INDEX IF NOT EXISTS "EngineeringProject_companyId_projectType_idx" ON "EngineeringProject"("companyId", "projectType");
CREATE INDEX IF NOT EXISTS "EngineeringProject_companyId_status_idx" ON "EngineeringProject"("companyId", "status");
CREATE INDEX IF NOT EXISTS "EngineeringCalculation_companyId_createdAt_idx" ON "EngineeringCalculation"("companyId", "createdAt");
CREATE INDEX IF NOT EXISTS "EngineeringIngestionRun_companyId_startedAt_idx" ON "EngineeringIngestionRun"("companyId", "startedAt");
CREATE INDEX IF NOT EXISTS "EngineeringVectorIndex_vectorStoreId_status_idx" ON "EngineeringVectorIndex"("vectorStoreId", "status");
DO $$ BEGIN
  ALTER TABLE "EngineeringKnowledgeDocument" ADD CONSTRAINT "EngineeringKnowledgeDocument_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "EngineeringProject" ADD CONSTRAINT "EngineeringProject_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "EngineeringProjectDocument" ADD CONSTRAINT "EngineeringProjectDocument_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "EngineeringProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "EngineeringProjectDocument" ADD CONSTRAINT "EngineeringProjectDocument_knowledgeId_fkey" FOREIGN KEY ("knowledgeId") REFERENCES "EngineeringKnowledgeDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "EngineeringCalculation" ADD CONSTRAINT "EngineeringCalculation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "EngineeringReview" ADD CONSTRAINT "EngineeringReview_knowledgeId_fkey" FOREIGN KEY ("knowledgeId") REFERENCES "EngineeringKnowledgeDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "EngineeringReview" ADD CONSTRAINT "EngineeringReview_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "EngineeringProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "EngineeringIngestionRun" ADD CONSTRAINT "EngineeringIngestionRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "EngineeringVectorIndex" ADD CONSTRAINT "EngineeringVectorIndex_knowledgeId_fkey" FOREIGN KEY ("knowledgeId") REFERENCES "EngineeringKnowledgeDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
