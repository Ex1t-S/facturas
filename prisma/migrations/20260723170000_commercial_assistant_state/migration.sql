-- Additive migration: the legacy WhatsAppConversation.pendingJson snapshot is
-- retained during rollout and mirrored into these normalized tables.

ALTER TABLE "Quote" ADD COLUMN "commercialDraftId" TEXT;
ALTER TABLE "DeliveryNote" ADD COLUMN "commercialDraftId" TEXT;
ALTER TABLE "Document" ADD COLUMN "commercialDraftId" TEXT;

CREATE UNIQUE INDEX "Quote_commercialDraftId_key" ON "Quote"("commercialDraftId");
CREATE UNIQUE INDEX "DeliveryNote_commercialDraftId_key" ON "DeliveryNote"("commercialDraftId");
CREATE UNIQUE INDEX "Document_commercialDraftId_key" ON "Document"("commercialDraftId");

ALTER TABLE "WhatsAppMessage"
  ADD COLUMN "processingStatus" TEXT NOT NULL DEFAULT 'RECEIVED',
  ADD COLUMN "processingAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "leaseUntil" TIMESTAMP(3),
  ADD COLUMN "processedAt" TIMESTAMP(3),
  ADD COLUMN "providerTimestamp" TIMESTAMP(3),
  ADD COLUMN "lastError" TEXT,
  ADD COLUMN "actionType" TEXT,
  ADD COLUMN "draftId" TEXT,
  ADD COLUMN "draftVersionBefore" INTEGER,
  ADD COLUMN "draftVersionAfter" INTEGER;

CREATE TABLE "CommercialDraft" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "activeSlot" INTEGER,
  "documentType" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "customerId" TEXT,
  "customerSearchQuery" TEXT,
  "currency" TEXT,
  "suggestedFileName" TEXT NOT NULL,
  "requestedFileName" TEXT,
  "draftVersion" INTEGER NOT NULL DEFAULT 1,
  "previewVersion" INTEGER,
  "previewStoragePath" TEXT,
  "previewFileName" TEXT,
  "previewMimeType" TEXT,
  "awaiting" TEXT,
  "finalDocumentId" TEXT,
  "legacyPayloadJson" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommercialDraft_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommercialDraftItem" (
  "id" TEXT NOT NULL,
  "draftId" TEXT NOT NULL,
  "lineId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "description" TEXT NOT NULL,
  "quantity" DECIMAL(65,30) NOT NULL,
  "unit" TEXT NOT NULL,
  "unitPrice" DECIMAL(65,30),
  "taxRate" DECIMAL(65,30),
  "sourceMessageId" TEXT,
  CONSTRAINT "CommercialDraftItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommercialDraft_conversationId_activeSlot_key"
  ON "CommercialDraft"("conversationId", "activeSlot");
CREATE INDEX "CommercialDraft_companyId_status_idx" ON "CommercialDraft"("companyId", "status");
CREATE INDEX "CommercialDraft_expiresAt_idx" ON "CommercialDraft"("expiresAt");
CREATE UNIQUE INDEX "CommercialDraftItem_draftId_lineId_key"
  ON "CommercialDraftItem"("draftId", "lineId");
CREATE UNIQUE INDEX "CommercialDraftItem_draftId_position_key"
  ON "CommercialDraftItem"("draftId", "position");
CREATE INDEX "CommercialDraftItem_draftId_idx" ON "CommercialDraftItem"("draftId");

ALTER TABLE "CommercialDraft"
  ADD CONSTRAINT "CommercialDraft_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "WhatsAppConversation"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommercialDraft"
  ADD CONSTRAINT "CommercialDraft_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommercialDraft"
  ADD CONSTRAINT "CommercialDraft_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CommercialDraftItem"
  ADD CONSTRAINT "CommercialDraftItem_draftId_fkey"
  FOREIGN KEY ("draftId") REFERENCES "CommercialDraft"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
