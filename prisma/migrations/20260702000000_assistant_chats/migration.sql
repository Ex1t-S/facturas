-- CreateTable
CREATE TABLE "AssistantChat" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Nuevo chat',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssistantChat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistantMessage" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "mode" TEXT,
    "sourcesJson" TEXT,
    "actionType" TEXT,
    "quoteId" TEXT,
    "documentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssistantChat_companyId_updatedAt_idx" ON "AssistantChat"("companyId", "updatedAt");

-- CreateIndex
CREATE INDEX "AssistantMessage_chatId_createdAt_idx" ON "AssistantMessage"("chatId", "createdAt");

-- CreateIndex
CREATE INDEX "AssistantMessage_quoteId_idx" ON "AssistantMessage"("quoteId");

-- CreateIndex
CREATE INDEX "AssistantMessage_documentId_idx" ON "AssistantMessage"("documentId");

-- AddForeignKey
ALTER TABLE "AssistantChat" ADD CONSTRAINT "AssistantChat_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantMessage" ADD CONSTRAINT "AssistantMessage_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "AssistantChat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
