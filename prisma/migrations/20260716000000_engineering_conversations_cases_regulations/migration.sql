CREATE TABLE IF NOT EXISTS "EngineeringConversation" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "userId" TEXT, "title" TEXT NOT NULL DEFAULT 'Nuevo caso de Ingeniería', "status" TEXT NOT NULL DEFAULT 'OPEN', "projectId" TEXT, "stateJson" TEXT NOT NULL DEFAULT '{}', "summaryJson" TEXT NOT NULL DEFAULT '{}', "previousResponseId" TEXT, "model" TEXT, "archivedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EngineeringConversation_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "EngineeringMessage" (
  "id" TEXT NOT NULL, "conversationId" TEXT NOT NULL, "role" TEXT NOT NULL, "content" TEXT NOT NULL, "model" TEXT, "responseId" TEXT, "tokenUsageJson" TEXT, "estimatedCost" DECIMAL(65,30), "structuredResultJson" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EngineeringMessage_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "EngineeringToolCall" (
  "id" TEXT NOT NULL, "conversationId" TEXT NOT NULL, "messageId" TEXT, "name" TEXT NOT NULL, "argumentsJson" TEXT NOT NULL, "resultJson" TEXT, "status" TEXT NOT NULL DEFAULT 'COMPLETED', "durationMs" INTEGER, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EngineeringToolCall_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "EngineeringCase" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "conversationId" TEXT NOT NULL, "name" TEXT NOT NULL, "projectType" TEXT NOT NULL DEFAULT 'OTHER', "customerName" TEXT, "location" TEXT, "status" TEXT NOT NULL DEFAULT 'DRAFT', "dataJson" TEXT NOT NULL DEFAULT '{}', "assumptionsJson" TEXT NOT NULL DEFAULT '[]', "calculationsJson" TEXT NOT NULL DEFAULT '[]', "sourcesJson" TEXT NOT NULL DEFAULT '[]', "regulationsJson" TEXT NOT NULL DEFAULT '[]', "bomJson" TEXT NOT NULL DEFAULT '[]', "costsJson" TEXT NOT NULL DEFAULT '{}', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EngineeringCase_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "EngineeringRegulation" (
  "id" TEXT NOT NULL, "companyId" TEXT, "code" TEXT NOT NULL, "title" TEXT NOT NULL, "jurisdiction" TEXT NOT NULL DEFAULT 'AR', "revision" TEXT, "publicationDate" TIMESTAMP(3), "effectiveDate" TIMESTAMP(3), "status" TEXT NOT NULL DEFAULT 'UNKNOWN', "sourceUrl" TEXT, "sourceDomain" TEXT, "localDocumentId" TEXT, "contentHash" TEXT, "retrievedAt" TIMESTAMP(3), "verifiedAt" TIMESTAMP(3), "verifiedBy" TEXT, "notes" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EngineeringRegulation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "EngineeringCase_conversationId_key" ON "EngineeringCase"("conversationId");
CREATE UNIQUE INDEX IF NOT EXISTS "EngineeringRegulation_companyId_code_revision_key" ON "EngineeringRegulation"("companyId", "code", "revision");
CREATE INDEX IF NOT EXISTS "EngineeringConversation_companyId_updatedAt_idx" ON "EngineeringConversation"("companyId", "updatedAt");
CREATE INDEX IF NOT EXISTS "EngineeringConversation_companyId_status_idx" ON "EngineeringConversation"("companyId", "status");
CREATE INDEX IF NOT EXISTS "EngineeringMessage_conversationId_createdAt_idx" ON "EngineeringMessage"("conversationId", "createdAt");
CREATE INDEX IF NOT EXISTS "EngineeringToolCall_conversationId_createdAt_idx" ON "EngineeringToolCall"("conversationId", "createdAt");
CREATE INDEX IF NOT EXISTS "EngineeringCase_companyId_status_idx" ON "EngineeringCase"("companyId", "status");
CREATE INDEX IF NOT EXISTS "EngineeringCase_companyId_projectType_idx" ON "EngineeringCase"("companyId", "projectType");
CREATE INDEX IF NOT EXISTS "EngineeringRegulation_companyId_status_idx" ON "EngineeringRegulation"("companyId", "status");
DO $$ BEGIN ALTER TABLE "EngineeringConversation" ADD CONSTRAINT "EngineeringConversation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "EngineeringConversation" ADD CONSTRAINT "EngineeringConversation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "EngineeringProject"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "EngineeringMessage" ADD CONSTRAINT "EngineeringMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "EngineeringConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "EngineeringToolCall" ADD CONSTRAINT "EngineeringToolCall_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "EngineeringConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "EngineeringCase" ADD CONSTRAINT "EngineeringCase_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "EngineeringCase" ADD CONSTRAINT "EngineeringCase_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "EngineeringConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "EngineeringRegulation" ADD CONSTRAINT "EngineeringRegulation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
