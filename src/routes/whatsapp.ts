import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { answerAssistant, type PendingDeliveryDraft } from '../services/assistant.js';
import { writeDocumentFile } from '../services/documentStorage.js';
import {
  getWhatsAppMedia,
  sendWhatsAppDocument,
  sendWhatsAppText,
  transcribeWhatsAppAudio,
  verifyMetaSignature
} from '../services/whatsapp.js';

const metaWebhookSchema = z.object({
  entry: z.array(
    z.object({
      changes: z.array(
        z.object({
          value: z.object({
            messages: z
              .array(
                z.object({
                  id: z.string(),
                  from: z.string(),
                  type: z.string(),
                  text: z.object({ body: z.string() }).optional(),
                  audio: z.object({ id: z.string(), mime_type: z.string().optional() }).optional(),
                  document: z.object({ id: z.string(), filename: z.string().optional(), mime_type: z.string().optional() }).optional(),
                  image: z.object({ id: z.string(), mime_type: z.string().optional() }).optional()
                })
              )
              .optional(),
            metadata: z.object({ phone_number_id: z.string().optional(), display_phone_number: z.string().optional() }).optional()
          })
        })
      )
    })
  )
});

function buildWhatsAppHistory(
  messages: Array<{ direction: 'INBOUND' | 'OUTBOUND'; body: string | null; mediaDocument?: { fileName: string } | null }>
) {
  return messages
    .map((message) => ({
      role: message.direction === 'INBOUND' ? ('user' as const) : ('assistant' as const),
      content: message.body || (message.mediaDocument?.fileName ? '[Adjunto: ' + message.mediaDocument.fileName + ']' : '')
    }))
    .filter((message) => message.content.trim().length > 0);
}

async function resolveInboundHistory(fromNumber: string) {
  const recent = await prisma.whatsAppMessage.findMany({
    where: { fromNumber },
    include: { mediaDocument: true },
    orderBy: { createdAt: 'asc' },
    take: 12
  });
  return buildWhatsAppHistory(recent);
}

function whatsappConfigStatus() {
  const publicBaseUrl = config.PUBLIC_BASE_URL.replace(/\/$/, '');
  return {
    publicBaseUrl,
    webhookUrl: publicBaseUrl + '/webhooks/whatsapp',
    verifyTokenConfigured: config.WHATSAPP_VERIFY_TOKEN !== 'change-me',
    appSecretConfigured: config.WHATSAPP_APP_SECRET !== 'change-me',
    accessTokenConfigured: Boolean(config.WHATSAPP_ACCESS_TOKEN),
    phoneNumberIdConfigured: Boolean(config.WHATSAPP_PHONE_NUMBER_ID),
    appId: config.WHATSAPP_APP_ID || '',
    wabaId: config.WHATSAPP_WABA_ID || '',
    audioConfigured: Boolean(config.OPENAI_API_KEY),
    canReceive: config.WHATSAPP_VERIFY_TOKEN !== 'change-me' && Boolean(config.WHATSAPP_ACCESS_TOKEN && config.WHATSAPP_PHONE_NUMBER_ID),
    canSend: Boolean(config.WHATSAPP_ACCESS_TOKEN && config.WHATSAPP_PHONE_NUMBER_ID)
  };
}

type InboundMessage = {
  id: string;
  from: string;
  type: string;
  text?: { body: string };
  audio?: { id: string; mime_type?: string };
  document?: { id: string; filename?: string; mime_type?: string };
  image?: { id: string; mime_type?: string };
};

async function processIncomingMessage(input: { message: InboundMessage; phoneNumber: string }) {
  const { message, phoneNumber } = input;
  let mediaDocumentId: string | undefined;
  let body = message.text?.body ?? '';
  const mediaId = message.audio?.id ?? message.document?.id ?? message.image?.id;

  if (mediaId) {
    try {
      const media = await getWhatsAppMedia(mediaId);
      const mimeType = message.audio?.mime_type ?? message.document?.mime_type ?? message.image?.mime_type ?? media.mimeType;
      const filename = message.document?.filename ?? media.filename;
      if (message.audio) {
        body = await transcribeWhatsAppAudio(media.buffer, mimeType);
      }
      const stored = await writeDocumentFile({
        buffer: media.buffer,
        filename,
        mimeType,
        sourceType: 'whatsapp'
      });
      const mediaDocument = await prisma.document.create({
        data: {
          sourceType: 'whatsapp',
          fileName: filename,
          mimeType,
          storagePath: stored.storagePath,
          sha256: stored.sha256,
          extraction: {
            create: {
              rawText: body,
              extractedJson: JSON.stringify({ status: message.audio ? 'transcribed' : 'pending_ocr', whatsappMediaId: mediaId }),
              confidence: message.audio ? 0.85 : 0
            }
          }
        }
      });
      mediaDocumentId = mediaDocument.id;
    } catch (error) {
      appLog(error);
      body = body || 'No pude leer el audio o adjunto. Mandalo nuevamente o escribime el dato.';
    }
  }

  return prisma.whatsAppMessage.upsert({
    where: { providerMessageId: message.id },
    update: { body, mediaDocumentId, status: 'processed' },
    create: {
      direction: 'INBOUND',
      fromNumber: message.from,
      toNumber: phoneNumber,
      providerMessageId: message.id,
      messageType: message.type,
      body,
      mediaDocumentId,
      status: 'processed'
    },
    include: { mediaDocument: true }
  });
}

function appLog(error: unknown) {
  console.error(error instanceof Error ? error.message : error);
}

function parsePending(value: string | null | undefined): PendingDeliveryDraft | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as PendingDeliveryDraft;
  } catch {
    return undefined;
  }
}

export const whatsappRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/whatsapp/messages', async () => {
    return prisma.whatsAppMessage.findMany({
      include: { mediaDocument: true, customer: true },
      orderBy: { createdAt: 'desc' },
      take: 50
    });
  });

  app.get('/api/whatsapp/conversations', async (request) => {
    const query = z.object({ companyId: z.string().optional() }).parse(request.query);
    const company = query.companyId ?? (await prisma.company.findFirst())?.id;
    if (!company) return [];
    return prisma.whatsAppConversation.findMany({
      where: { companyId: company },
      include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
      orderBy: { lastMessageAt: 'desc' },
      take: 100
    });
  });

  app.get('/api/whatsapp/conversations/:id/messages', async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const conversation = await prisma.whatsAppConversation.findUnique({
      where: { id: params.id },
      include: { messages: { include: { mediaDocument: true }, orderBy: { createdAt: 'asc' } } }
    });
    if (!conversation) return reply.code(404).send({ error: 'Conversation not found' });
    return conversation;
  });

  app.get('/api/whatsapp/config', async () => whatsappConfigStatus());

  app.get('/webhooks/whatsapp', async (request, reply) => {
    const query = z
      .object({
        'hub.mode': z.string(),
        'hub.verify_token': z.string(),
        'hub.challenge': z.string()
      })
      .parse(request.query);

    if (query['hub.mode'] === 'subscribe' && query['hub.verify_token'] === config.WHATSAPP_VERIFY_TOKEN) {
      return reply.type('text/plain').send(query['hub.challenge']);
    }
    return reply.code(403).send({ error: 'Invalid verify token' });
  });

  app.post('/webhooks/whatsapp', async (request, reply) => {
    const rawBody = Buffer.isBuffer(request.body) ? request.body : Buffer.from(JSON.stringify(request.body ?? {}));
    const signature = request.headers['x-hub-signature-256'];
    if (config.WHATSAPP_APP_SECRET !== 'change-me' && !verifyMetaSignature(rawBody, Array.isArray(signature) ? signature[0] : signature)) {
      return reply.code(401).send({ error: 'Invalid signature' });
    }

    const payload = metaWebhookSchema.parse(typeof request.body === 'string' ? JSON.parse(request.body) : request.body);
    const company = await prisma.company.findFirst();
    const stored: string[] = [];

    for (const entry of payload.entry) {
      for (const change of entry.changes) {
        const phoneNumber = change.value.metadata?.display_phone_number ?? change.value.metadata?.phone_number_id ?? '';
        for (const message of change.value.messages ?? []) {
          if (config.WHATSAPP_ALLOWED_FROM && message.from !== config.WHATSAPP_ALLOWED_FROM) continue;
          const inbound = await processIncomingMessage({ message, phoneNumber });
          stored.push(inbound.id);
          if (!company || !inbound.body?.trim()) continue;

          const conversation = await prisma.whatsAppConversation.upsert({
            where: { companyId_fromNumber: { companyId: company.id, fromNumber: message.from } },
            update: { toNumber: phoneNumber, messageCount: { increment: 1 }, lastMessageAt: new Date() },
            create: { companyId: company.id, fromNumber: message.from, toNumber: phoneNumber, messageCount: 1, lastMessageAt: new Date() }
          });
          await prisma.whatsAppMessage.update({ where: { id: inbound.id }, data: { conversationId: conversation.id } });

          if (config.WHATSAPP_TEST_MODE) continue;

          const history = await resolveInboundHistory(message.from);
          const assistantResponse = await answerAssistant({
            companyId: company.id,
            message: inbound.body,
            history,
            pendingDeliveryDraft: parsePending(conversation.pendingJson)
          });
          await prisma.whatsAppConversation.update({
            where: { id: conversation.id },
            data: { pendingJson: assistantResponse.pendingDeliveryDraft ? JSON.stringify(assistantResponse.pendingDeliveryDraft) : null }
          });

          const publicBaseUrl = config.PUBLIC_BASE_URL.replace(/\/$/, '');
          const documentUrl = assistantResponse.action?.documentId
            ? publicBaseUrl + '/api/documents/' + assistantResponse.action.documentId + '/content'
            : '';

          if (assistantResponse.action?.documentId && documentUrl) {
            const storedDocument = await prisma.document.findUnique({ where: { id: assistantResponse.action.documentId } });
            const sent = await sendWhatsAppDocument({
              to: message.from,
              documentUrl,
              filename: storedDocument?.fileName ?? 'documento.pdf',
              caption: assistantResponse.answer.slice(0, 900)
            });
            await prisma.whatsAppMessage.create({
              data: {
                direction: 'OUTBOUND',
                fromNumber: phoneNumber,
                toNumber: message.from,
                providerMessageId: sent.providerMessageId,
                messageType: 'document',
                body: assistantResponse.answer,
                mediaDocumentId: assistantResponse.action.documentId,
                conversationId: conversation.id
              }
            });
          } else {
            const sent = await sendWhatsAppText({ to: message.from, body: assistantResponse.answer });
            await prisma.whatsAppMessage.create({
              data: {
                direction: 'OUTBOUND',
                fromNumber: phoneNumber,
                toNumber: message.from,
                providerMessageId: sent.providerMessageId,
                messageType: 'text',
                body: assistantResponse.answer
              }
            });
          }
        }
      }
    }
    return { ok: true, stored };
  });
};
