CREATE TABLE IF NOT EXISTS "StructuralSection" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "designation" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "material" TEXT,
  "width" DOUBLE PRECISION,
  "height" DOUBLE PRECISION,
  "diameter" DOUBLE PRECISION,
  "thickness" DOUBLE PRECISION,
  "area" DOUBLE PRECISION,
  "massPerMeter" DOUBLE PRECISION,
  "ix" DOUBLE PRECISION,
  "iy" DOUBLE PRECISION,
  "rx" DOUBLE PRECISION,
  "ry" DOUBLE PRECISION,
  "yieldStrength" DOUBLE PRECISION,
  "commercialLength" DOUBLE PRECISION,
  "source" TEXT NOT NULL,
  "sourceDocumentId" TEXT,
  "verified" BOOLEAN NOT NULL DEFAULT false,
  "verifiedAt" TIMESTAMP(3),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StructuralSection_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StructuralSection_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "StructuralSection_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "EngineeringKnowledgeDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "StructuralSection_companyId_designation_source_key" ON "StructuralSection"("companyId", "designation", "source");
CREATE INDEX IF NOT EXISTS "StructuralSection_companyId_type_idx" ON "StructuralSection"("companyId", "type");
CREATE INDEX IF NOT EXISTS "StructuralSection_companyId_verified_idx" ON "StructuralSection"("companyId", "verified");
CREATE INDEX IF NOT EXISTS "StructuralSection_sourceDocumentId_idx" ON "StructuralSection"("sourceDocumentId");
