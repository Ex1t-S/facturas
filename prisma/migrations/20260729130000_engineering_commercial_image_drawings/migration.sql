CREATE TABLE "EngineeringCommercialImageDrawing" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT,
    "quoteId" TEXT,
    "drawingType" TEXT NOT NULL,
    "projectName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "budgetNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "model" TEXT NOT NULL,
    "templateName" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "requestJson" TEXT NOT NULL,
    "evaluationJson" TEXT NOT NULL,
    "imageStoragePath" TEXT NOT NULL,
    "imageSha256" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "attempts" INTEGER NOT NULL,
    "generatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EngineeringCommercialImageDrawing_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EngineeringCommercialImageDrawing_companyId_createdAt_idx"
ON "EngineeringCommercialImageDrawing"("companyId", "createdAt");

CREATE INDEX "EngineeringCommercialImageDrawing_quoteId_idx"
ON "EngineeringCommercialImageDrawing"("quoteId");

CREATE INDEX "EngineeringCommercialImageDrawing_customerId_idx"
ON "EngineeringCommercialImageDrawing"("customerId");

CREATE INDEX "EngineeringCommercialImageDrawing_imageSha256_idx"
ON "EngineeringCommercialImageDrawing"("imageSha256");

ALTER TABLE "EngineeringCommercialImageDrawing"
ADD CONSTRAINT "EngineeringCommercialImageDrawing_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EngineeringCommercialImageDrawing"
ADD CONSTRAINT "EngineeringCommercialImageDrawing_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EngineeringCommercialImageDrawing"
ADD CONSTRAINT "EngineeringCommercialImageDrawing_quoteId_fkey"
FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
