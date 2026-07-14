CREATE TYPE "DeliveryNoteStatus" AS ENUM ('DRAFT', 'PENDING', 'QUOTED', 'INVOICED', 'CANCELLED');

CREATE TABLE "DeliveryNote" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "documentId" TEXT,
  "number" INTEGER NOT NULL,
  "status" "DeliveryNoteStatus" NOT NULL DEFAULT 'PENDING',
  "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "projectName" TEXT,
  "currency" TEXT NOT NULL DEFAULT 'ARS',
  "total" DECIMAL(65,30),
  "notes" TEXT,
  CONSTRAINT "DeliveryNote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeliveryNoteItem" (
  "id" TEXT NOT NULL,
  "deliveryNoteId" TEXT NOT NULL,
  "productId" TEXT,
  "description" TEXT NOT NULL,
  "quantity" DECIMAL(65,30) NOT NULL,
  "convertedQuantity" DECIMAL(65,30) NOT NULL DEFAULT 0,
  "unit" TEXT NOT NULL DEFAULT 'unidad',
  "unitPrice" DECIMAL(65,30),
  "priceOrigin" TEXT,
  "taxRate" DECIMAL(65,30) NOT NULL DEFAULT 21,
  CONSTRAINT "DeliveryNoteItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeliveryNoteQuote" (
  "id" TEXT NOT NULL,
  "deliveryNoteId" TEXT NOT NULL,
  "quoteId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeliveryNoteQuote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeliveryNote_documentId_key" ON "DeliveryNote"("documentId");
CREATE UNIQUE INDEX "DeliveryNote_companyId_number_key" ON "DeliveryNote"("companyId", "number");
CREATE INDEX "DeliveryNote_companyId_customerId_status_idx" ON "DeliveryNote"("companyId", "customerId", "status");
CREATE INDEX "DeliveryNote_companyId_issueDate_idx" ON "DeliveryNote"("companyId", "issueDate");
CREATE INDEX "DeliveryNoteItem_deliveryNoteId_idx" ON "DeliveryNoteItem"("deliveryNoteId");
CREATE UNIQUE INDEX "DeliveryNoteQuote_deliveryNoteId_quoteId_key" ON "DeliveryNoteQuote"("deliveryNoteId", "quoteId");
CREATE INDEX "DeliveryNoteQuote_quoteId_idx" ON "DeliveryNoteQuote"("quoteId");

ALTER TABLE "DeliveryNote" ADD CONSTRAINT "DeliveryNote_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryNote" ADD CONSTRAINT "DeliveryNote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DeliveryNote" ADD CONSTRAINT "DeliveryNote_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DeliveryNoteItem" ADD CONSTRAINT "DeliveryNoteItem_deliveryNoteId_fkey" FOREIGN KEY ("deliveryNoteId") REFERENCES "DeliveryNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryNoteItem" ADD CONSTRAINT "DeliveryNoteItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DeliveryNoteQuote" ADD CONSTRAINT "DeliveryNoteQuote_deliveryNoteId_fkey" FOREIGN KEY ("deliveryNoteId") REFERENCES "DeliveryNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryNoteQuote" ADD CONSTRAINT "DeliveryNoteQuote_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
