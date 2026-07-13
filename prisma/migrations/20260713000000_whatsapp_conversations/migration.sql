CREATE TABLE IF NOT EXISTS "WhatsAppConversation" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "fromNumber" TEXT NOT NULL,
  "pendingJson" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WhatsAppConversation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppConversation_companyId_fromNumber_key" ON "WhatsAppConversation"("companyId", "fromNumber");
CREATE INDEX IF NOT EXISTS "WhatsAppConversation_companyId_updatedAt_idx" ON "WhatsAppConversation"("companyId", "updatedAt");
DO $$ BEGIN
  ALTER TABLE "WhatsAppConversation" ADD CONSTRAINT "WhatsAppConversation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
