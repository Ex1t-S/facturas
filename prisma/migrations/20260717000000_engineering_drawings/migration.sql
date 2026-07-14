CREATE TABLE IF NOT EXISTS "EngineeringDrawingTemplate" (
  "id" TEXT NOT NULL,
  "companyId" TEXT,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "version" TEXT,
  "sheetSize" TEXT,
  "titleBlockPosition" TEXT,
  "layoutJson" TEXT NOT NULL DEFAULT '{}',
  "sampleCount" INTEGER NOT NULL DEFAULT 0,
  "confidence" DECIMAL(65,30) NOT NULL DEFAULT 0,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EngineeringDrawingTemplate_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "EngineeringDrawingDocument" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "templateId" TEXT,
  "fileName" TEXT NOT NULL,
  "relativePath" TEXT NOT NULL,
  "sourcePath" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL DEFAULT 'application/pdf',
  "byteSize" INTEGER NOT NULL,
  "pageCount" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'DISCOVERED',
  "extractedText" TEXT,
  "extractionJson" TEXT NOT NULL DEFAULT '{}',
  "thumbnailPath" TEXT,
  "drawingNumber" TEXT,
  "projectName" TEXT,
  "customerName" TEXT,
  "projectType" TEXT,
  "drawingTitle" TEXT,
  "revision" TEXT,
  "drawingDate" TIMESTAMP(3),
  "sheetSize" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EngineeringDrawingDocument_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "EngineeringDrawingTemplate_companyId_code_key" ON "EngineeringDrawingTemplate"("companyId", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "EngineeringDrawingDocument_companyId_sha256_key" ON "EngineeringDrawingDocument"("companyId", "sha256");
CREATE INDEX IF NOT EXISTS "EngineeringDrawingTemplate_companyId_isDefault_idx" ON "EngineeringDrawingTemplate"("companyId", "isDefault");
CREATE INDEX IF NOT EXISTS "EngineeringDrawingDocument_companyId_status_idx" ON "EngineeringDrawingDocument"("companyId", "status");
CREATE INDEX IF NOT EXISTS "EngineeringDrawingDocument_companyId_projectType_idx" ON "EngineeringDrawingDocument"("companyId", "projectType");
CREATE INDEX IF NOT EXISTS "EngineeringDrawingDocument_companyId_customerName_idx" ON "EngineeringDrawingDocument"("companyId", "customerName");
DO $$ BEGIN ALTER TABLE "EngineeringDrawingTemplate" ADD CONSTRAINT "EngineeringDrawingTemplate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "EngineeringDrawingDocument" ADD CONSTRAINT "EngineeringDrawingDocument_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "EngineeringDrawingDocument" ADD CONSTRAINT "EngineeringDrawingDocument_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "EngineeringDrawingTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
