import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { answerAssistant, type AssistantMessage, type PendingDeliveryDraft } from '../services/assistant.js';

const assistantSchema = z.object({
  companyId: z.string().optional(),
  message: z.string().trim().min(1).max(3000),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(3000)
      })
    )
    .max(12)
    .optional()
});

const createChatSchema = z.object({
  companyId: z.string(),
  title: z.string().trim().min(1).max(90).optional()
});

const createMessageSchema = z.object({
  message: z.string().trim().min(1).max(3000)
});

function chatTitleFromMessage(message: string) {
  const cleaned = message.replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'Nuevo chat';
  return cleaned.length > 64 ? `${cleaned.slice(0, 61)}...` : cleaned;
}

function parseSources(value?: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : parsed.sources ?? [];
  } catch {
    return [];
  }
}

function parsePendingDeliveryDraft(value?: string | null): PendingDeliveryDraft | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    return parsed.pendingDeliveryDraft;
  } catch {
    return undefined;
  }
}

function serializeMessage(message: {
  id: string;
  role: string;
  content: string;
  mode?: string | null;
  sourcesJson?: string | null;
  actionType?: string | null;
  quoteId?: string | null;
  documentId?: string | null;
  createdAt: Date;
}) {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    mode: message.mode,
    sources: parseSources(message.sourcesJson),
    actionType: message.actionType,
    quoteId: message.quoteId,
    documentId: message.documentId,
    createdAt: message.createdAt
  };
}

export const assistantRoutes: FastifyPluginAsync = async (app) => {
  app.post('/assistant', async (request) => {
    const body = assistantSchema.parse(request.body);
    return answerAssistant(body);
  });

  app.get('/assistant/chats', async (request) => {
    const query = z.object({ companyId: z.string() }).parse(request.query);
    const chats = await prisma.assistantChat.findMany({
      where: { companyId: query.companyId },
      include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
      orderBy: { updatedAt: 'desc' },
      take: 80
    });

    return chats.map((chat) => ({
      id: chat.id,
      companyId: chat.companyId,
      title: chat.title,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
      lastMessage: chat.messages[0] ? serializeMessage(chat.messages[0]) : null
    }));
  });

  app.post('/assistant/chats', async (request, reply) => {
    const body = createChatSchema.parse(request.body);
    const chat = await prisma.assistantChat.create({
      data: {
        companyId: body.companyId,
        title: body.title ?? 'Nuevo chat'
      }
    });
    return reply.code(201).send(chat);
  });

  app.get('/assistant/chats/:id/messages', async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const chat = await prisma.assistantChat.findUnique({
      where: { id: params.id },
      include: { messages: { orderBy: { createdAt: 'asc' } } }
    });
    if (!chat) return reply.code(404).send({ error: 'Chat not found' });
    return {
      id: chat.id,
      companyId: chat.companyId,
      title: chat.title,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
      messages: chat.messages.map(serializeMessage)
    };
  });

  app.post('/assistant/chats/:id/messages', async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = createMessageSchema.parse(request.body);
    const chat = await prisma.assistantChat.findUnique({
      where: { id: params.id },
      include: { messages: { orderBy: { createdAt: 'asc' }, take: 20 } }
    });
    if (!chat) return reply.code(404).send({ error: 'Chat not found' });

    const userMessage = await prisma.assistantMessage.create({
      data: {
        chatId: chat.id,
        role: 'user',
        content: body.message
      }
    });

    const history: AssistantMessage[] = chat.messages
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .slice(-12)
      .map((message) => ({ role: message.role as AssistantMessage['role'], content: message.content }));
    const latestDeliveryAction = [...chat.messages]
      .reverse()
      .find((message) => message.role === 'assistant' && (message.actionType === 'delivery_note_draft_pending' || message.actionType === 'delivery_note_created'));
    const pendingDeliveryDraft = latestDeliveryAction?.actionType === 'delivery_note_draft_pending' ? latestDeliveryAction : undefined;

    const response = await answerAssistant({
      companyId: chat.companyId,
      message: body.message,
      history: [...history, { role: 'user', content: body.message }],
      pendingDeliveryDraft: parsePendingDeliveryDraft(pendingDeliveryDraft?.sourcesJson)
    });

    const assistantMessage = await prisma.assistantMessage.create({
      data: {
        chatId: chat.id,
        role: 'assistant',
        content: response.answer,
        mode: response.mode,
        sourcesJson: JSON.stringify({ sources: response.sources ?? [], pendingDeliveryDraft: response.pendingDeliveryDraft }),
        actionType: response.action?.type,
        quoteId: response.action?.quoteId,
        documentId: response.action?.documentId
      }
    });

    const hasOnlyOneUserMessage = chat.messages.filter((message) => message.role === 'user').length === 0;
    await prisma.assistantChat.update({
      where: { id: chat.id },
      data: {
        title: hasOnlyOneUserMessage && chat.title === 'Nuevo chat' ? chatTitleFromMessage(body.message) : chat.title
      }
    });

    return reply.code(201).send({
      userMessage: serializeMessage(userMessage),
      assistantMessage: serializeMessage(assistantMessage),
      response
    });
  });
};
