-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cuit" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Supplier_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SupplierPriceList" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'manual',
    "documentId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'ARS',
    "validFrom" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    CONSTRAINT "SupplierPriceList_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SupplierPriceList_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SupplierProductPrice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "priceListId" TEXT,
    "productId" TEXT,
    "supplierSku" TEXT,
    "rawName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'unidad',
    "currency" TEXT NOT NULL DEFAULT 'ARS',
    "price" DECIMAL NOT NULL,
    "taxIncluded" BOOLEAN NOT NULL DEFAULT false,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "observedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    CONSTRAINT "SupplierProductPrice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SupplierProductPrice_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "SupplierPriceList" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SupplierProductPrice_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Supplier_companyId_idx" ON "Supplier"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_companyId_name_key" ON "Supplier"("companyId", "name");

-- CreateIndex
CREATE INDEX "SupplierPriceList_companyId_idx" ON "SupplierPriceList"("companyId");

-- CreateIndex
CREATE INDEX "SupplierPriceList_supplierId_idx" ON "SupplierPriceList"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierProductPrice_companyId_idx" ON "SupplierProductPrice"("companyId");

-- CreateIndex
CREATE INDEX "SupplierProductPrice_supplierId_idx" ON "SupplierProductPrice"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierProductPrice_productId_idx" ON "SupplierProductPrice"("productId");

-- CreateIndex
CREATE INDEX "SupplierProductPrice_normalizedName_idx" ON "SupplierProductPrice"("normalizedName");
