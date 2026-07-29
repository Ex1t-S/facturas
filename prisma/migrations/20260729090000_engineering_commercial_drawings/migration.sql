-- Additive migration for generated commercial engineering drawings.
CREATE TABLE "EngineeringCommercialDrawing" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT,
    "quoteId" TEXT,
    "conversationId" TEXT,
    "projectName" TEXT NOT NULL,
    "drawingNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "latestRevision" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EngineeringCommercialDrawing_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EngineeringCommercialDrawingRevision" (
    "id" TEXT NOT NULL,
    "drawingId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "revision" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "designPackId" TEXT NOT NULL,
    "designPackVersion" TEXT NOT NULL,
    "requestJson" TEXT NOT NULL,
    "resultJson" TEXT NOT NULL,
    "sceneJson" TEXT NOT NULL,
    "assumptionsJson" TEXT NOT NULL DEFAULT '{}',
    "svg" TEXT NOT NULL,
    "pdfStoragePath" TEXT,
    "pdfSha256" TEXT,
    "previewStoragePath" TEXT,
    "contentHash" TEXT NOT NULL,
    "generatedBy" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EngineeringCommercialDrawingRevision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EngineeringCommercialDrawing_companyId_drawingNumber_key"
ON "EngineeringCommercialDrawing"("companyId", "drawingNumber");
CREATE INDEX "EngineeringCommercialDrawing_companyId_status_updatedAt_idx"
ON "EngineeringCommercialDrawing"("companyId", "status", "updatedAt");
CREATE INDEX "EngineeringCommercialDrawing_quoteId_idx" ON "EngineeringCommercialDrawing"("quoteId");
CREATE INDEX "EngineeringCommercialDrawing_customerId_idx" ON "EngineeringCommercialDrawing"("customerId");
CREATE INDEX "EngineeringCommercialDrawing_conversationId_idx" ON "EngineeringCommercialDrawing"("conversationId");

CREATE UNIQUE INDEX "EngineeringCommercialDrawingRevision_drawingId_revisionNumber_key"
ON "EngineeringCommercialDrawingRevision"("drawingId", "revisionNumber");
CREATE UNIQUE INDEX "EngineeringCommercialDrawingRevision_drawingId_revision_key"
ON "EngineeringCommercialDrawingRevision"("drawingId", "revision");
CREATE INDEX "EngineeringCommercialDrawingRevision_drawingId_generatedAt_idx"
ON "EngineeringCommercialDrawingRevision"("drawingId", "generatedAt");
CREATE INDEX "EngineeringCommercialDrawingRevision_contentHash_idx"
ON "EngineeringCommercialDrawingRevision"("contentHash");

ALTER TABLE "EngineeringCommercialDrawing"
ADD CONSTRAINT "EngineeringCommercialDrawing_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EngineeringCommercialDrawing"
ADD CONSTRAINT "EngineeringCommercialDrawing_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EngineeringCommercialDrawing"
ADD CONSTRAINT "EngineeringCommercialDrawing_quoteId_fkey"
FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EngineeringCommercialDrawing"
ADD CONSTRAINT "EngineeringCommercialDrawing_conversationId_fkey"
FOREIGN KEY ("conversationId") REFERENCES "EngineeringConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EngineeringCommercialDrawingRevision"
ADD CONSTRAINT "EngineeringCommercialDrawingRevision_drawingId_fkey"
FOREIGN KEY ("drawingId") REFERENCES "EngineeringCommercialDrawing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
