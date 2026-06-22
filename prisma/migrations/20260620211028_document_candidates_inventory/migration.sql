-- CreateTable
CREATE TABLE "DocumentItemCandidate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "rawDescription" TEXT NOT NULL,
    "normalizedName" TEXT,
    "quantity" DECIMAL,
    "unit" TEXT,
    "unitPrice" DECIMAL,
    "total" DECIMAL,
    "taxRate" DECIMAL,
    "sku" TEXT,
    "category" TEXT,
    "entityType" TEXT NOT NULL DEFAULT 'PRODUCT',
    "matchedProductId" TEXT,
    "confidence" DECIMAL NOT NULL DEFAULT 0,
    "decision" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewNotes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocumentItemCandidate_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DocumentItemCandidate_matchedProductId_fkey" FOREIGN KEY ("matchedProductId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CustomerCandidate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "legalName" TEXT,
    "tradeName" TEXT,
    "cuit" TEXT,
    "taxCondition" TEXT,
    "address" TEXT,
    "matchedCustomerId" TEXT,
    "confidence" DECIMAL NOT NULL DEFAULT 0,
    "decision" TEXT NOT NULL DEFAULT 'PENDING',
    CONSTRAINT "CustomerCandidate_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CustomerCandidate_matchedCustomerId_fkey" FOREIGN KEY ("matchedCustomerId") REFERENCES "Customer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InventoryStock" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL NOT NULL DEFAULT 0,
    "reserved" DECIMAL NOT NULL DEFAULT 0,
    "minQuantity" DECIMAL,
    "location" TEXT NOT NULL DEFAULT 'principal',
    CONSTRAINT "InventoryStock_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "documentId" TEXT,
    "quoteId" TEXT,
    "invoiceId" TEXT,
    "quantity" DECIMAL NOT NULL,
    "unitCost" DECIMAL,
    "source" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StockMovement_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Document" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "sourceType" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "extractionStatus" TEXT NOT NULL DEFAULT 'UPLOADED',
    "documentDate" DATETIME,
    "issuerName" TEXT,
    "issuerCuit" TEXT,
    "externalNumber" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'ARS',
    "total" DECIMAL,
    "uploadedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Document" ("createdAt", "fileName", "id", "mimeType", "sha256", "sourceType", "status", "storagePath", "uploadedBy") SELECT "createdAt", "fileName", "id", "mimeType", "sha256", "sourceType", "status", "storagePath", "uploadedBy" FROM "Document";
DROP TABLE "Document";
ALTER TABLE "new_Document" RENAME TO "Document";
CREATE TABLE "new_DocumentExtraction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "engine" TEXT,
    "schemaVersion" TEXT NOT NULL DEFAULT 'v1',
    "rawText" TEXT,
    "rawJson" TEXT,
    "normalizedJson" TEXT,
    "extractedJson" TEXT,
    "confidence" DECIMAL NOT NULL DEFAULT 0,
    "fieldConfidence" TEXT,
    "errorMessage" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" DATETIME,
    CONSTRAINT "DocumentExtraction_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_DocumentExtraction" ("confidence", "documentId", "extractedJson", "id", "rawText", "reviewedAt", "reviewedBy") SELECT "confidence", "documentId", "extractedJson", "id", "rawText", "reviewedAt", "reviewedBy" FROM "DocumentExtraction";
DROP TABLE "DocumentExtraction";
ALTER TABLE "new_DocumentExtraction" RENAME TO "DocumentExtraction";
CREATE UNIQUE INDEX "DocumentExtraction_documentId_key" ON "DocumentExtraction"("documentId");
CREATE TABLE "new_Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "sku" TEXT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'PRODUCT',
    "normalizedName" TEXT,
    "aliasesJson" TEXT,
    "metadataJson" TEXT,
    "description" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'unidad',
    "category" TEXT,
    "baseCost" DECIMAL NOT NULL DEFAULT 0,
    "lastCost" DECIMAL,
    "price" DECIMAL NOT NULL,
    "taxRate" DECIMAL NOT NULL DEFAULT 21,
    "stockTracked" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Product_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Product" ("active", "baseCost", "category", "companyId", "createdAt", "description", "id", "name", "price", "sku", "taxRate", "unit") SELECT "active", "baseCost", "category", "companyId", "createdAt", "description", "id", "name", "price", "sku", "taxRate", "unit" FROM "Product";
DROP TABLE "Product";
ALTER TABLE "new_Product" RENAME TO "Product";
CREATE INDEX "Product_companyId_idx" ON "Product"("companyId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "DocumentItemCandidate_documentId_idx" ON "DocumentItemCandidate"("documentId");

-- CreateIndex
CREATE INDEX "DocumentItemCandidate_matchedProductId_idx" ON "DocumentItemCandidate"("matchedProductId");

-- CreateIndex
CREATE INDEX "CustomerCandidate_documentId_idx" ON "CustomerCandidate"("documentId");

-- CreateIndex
CREATE INDEX "CustomerCandidate_matchedCustomerId_idx" ON "CustomerCandidate"("matchedCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryStock_companyId_productId_location_key" ON "InventoryStock"("companyId", "productId", "location");

-- CreateIndex
CREATE INDEX "StockMovement_companyId_idx" ON "StockMovement"("companyId");

-- CreateIndex
CREATE INDEX "StockMovement_productId_idx" ON "StockMovement"("productId");
