ALTER TABLE "WhatsAppConversation"
  ADD COLUMN IF NOT EXISTS "toNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "displayName" TEXT,
  ADD COLUMN IF NOT EXISTS "messageCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "WhatsAppMessage"
  ADD COLUMN IF NOT EXISTS "conversationId" TEXT;

CREATE INDEX IF NOT EXISTS "WhatsAppMessage_conversationId_createdAt_idx"
  ON "WhatsAppMessage"("conversationId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "WhatsAppMessage"
    ADD CONSTRAINT "WhatsAppMessage_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "WhatsAppConversation"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
