import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { answerAssistant } from '../services/assistant.js';
import { writeDocumentFile } from '../services/documentStorage.js';
import { getWhatsAppMedia, sendWhatsAppDocument, sendWhatsAppText, verifyMetaSignature } from '../services/whatsapp.js';

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

function buildWhatsAppHistory(messages: Array<{ direction: 'INBOUND' | 'OUTBOUND'; body: string | null; mediaDocument?: { fileName: string } | null }>) {
  return messages
    .map((message) => ({
      role: message.direction === 'INBOUND' ? ('user' as const) : ('assistant' as const),
      content: message.body || (message.mediaDocument?.fileName ? `[Adjunto: ${message.mediaDocument.fileName}]` : '')
    }))
    .filter((message) => message.content.trim().length > 0);
}

async function resolveInboundHistory(fromNumber: string) {
  const recent = await prisma.whatsAppMessage.findMany({
    where: { fromNumber },
    include: { mediaDocument: true },
    orderBy: { createdAt: 'asc' },
    take: 10
  });
  return buildWhatsAppHistory(recent);
}

function whatsappConfigStatus() {
  const publicBaseUrl = config.PUBLIC_BASE_URL.replace(/\/$/, '');
  return {
    publicBaseUrl,
    webhookUrl: `${publicBaseUrl}/webhooks/whatsapp`,
    verifyTokenConfigured: config.WHATSAPP_VERIFY_TOKEN !== 'change-me',
    appSecretConfigured: config.WHATSAPP_APP_SECRET !== 'change-me',
    accessTokenConfigured: Boolean(config.WHATSAPP_ACCESS_TOKEN),
    phoneNumberIdConfigured: Boolean(config.WHATSAPP_PHONE_NUMBER_ID),
    appId: config.WHATSAPP_APP_ID || '',
    wabaId: config.WHATSAPP_WABA_ID || '',
    canReceive: config.WHATSAPP_VERIFY_TOKEN !== 'change-me' && config.WHATSAPP_APP_SECRET !== 'change-me',
    canSend: Boolean(config.WHATSAPP_ACCESS_TOKEN && config.WHATSAPP_PHONE_NUMBER_ID)
  };
}

async function processIncomingMessage(input: {
  message: { id: string; from: string; type: string; text?: { body: string }; document?: { id: string; filename?: string; mime_type?: string }; image?: { id: string; mime_type?: string } };
  phoneNumber: string;
}) {
  const { message, phoneNumber } = input;
  let mediaDocumentId: string | undefined;
  let body = message.text?.body ?? '';

  const mediaId = message.document?.id ?? message.image?.id;
  if (mediaId) {
    try {
      const media = await getWhatsAppMedia(mediaId);
      const filename = message.document?.filename ?? media.filename;
      body = body || `[Adjunto: ${filename}]`;
      const stored = await writeDocumentFile({
        buffer: media.buffer,
        filename,
        mimeType: message.document?.mime_type ?? message.image?.mime_type ?? media.mimeType,
        sourceType: 'whatsapp'
      });
      const mediaDocument = await prisma.document.create({
        data: {
          sourceType: 'whatsapp',
          fileName: filename,
          mimeType: message.document?.mime_type ?? message.image?.mime_type ?? media.mimeType,
          storagePath: stored.storagePath,
          sha256: stored.sha256,
          extraction: {
            create: {
              rawText: '',
              extractedJson: JSON.stringify({ status: 'pending_ocr', whatsappMediaId: mediaId }),
              confidence: 0
            }
          }
        }
      });
      mediaDocumentId = mediaDocument.id;
    } catch (error) {
      appLog(error);
    }
  }

  const inbound = await prisma.whatsAppMessage.upsert({
    where: { providerMessageId: message.id },
    update: { body, mediaDocumentId },
    create: {
      direction: 'INBOUND',
      fromNumber: message.from,
      toNumber: phoneNumber,
      providerMessageId: message.id,
      messageType: message.type,
      body,
      mediaDocumentId
    },
    include: { mediaDocument: true }
  });

  return inbound;
}

function appLog(error: unknown) {
  if (error instanceof Error) {
    console.error(error.message);
    return;
  }
  console.error(error);
}

export const whatsappRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/whatsapp/messages', async () => {
    return prisma.whatsAppMessage.findMany({
      include: { mediaDocument: true, customer: true },
      orderBy: { createdAt: 'desc' },
      take: 50
    });
  });

  app.get('/api/whatsapp/config', async () => {
    return whatsappConfigStatus();
  });

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
          const inbound = await processIncomingMessage({ message, phoneNumber });
          stored.push(inbound.id);

          const hasText = Boolean(message.text?.body?.trim());
          if (!company || !hasText) continue;

          const history = await resolveInboundHistory(message.from);
          const assistantResponse = await answerAssistant({ companyId: company.id, message: message.text?.body ?? '', history });
          const publicBaseUrl = config.PUBLIC_BASE_URL.replace(/\/$/, '');
          const documentUrl = assistantResponse.action?.documentId ? `${publicBaseUrl}/api/documents/${assistantResponse.action.documentId}/content` : '';

          if (assistantResponse.action?.documentId && documentUrl) {
            const storedDocument = await prisma.document.findUnique({ where: { id: assistantResponse.action.documentId } });
            const caption = assistantResponse.answer.slice(0, 900);
            const sent = await sendWhatsAppDocument({
              to: message.from,
              documentUrl,
              filename: storedDocument?.fileName ?? 'documento.pdf',
              caption
            });
            await prisma.whatsAppMessage.create({
              data: {
                direction: 'OUTBOUND',
                fromNumber: phoneNumber,
                toNumber: message.from,
                providerMessageId: sent.providerMessageId,
                messageType: 'document',
                body: assistantResponse.answer,
                mediaDocumentId: assistantResponse.action.documentId
              }
            });
            continue;
          }

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

    return { ok: true, stored };
  });
};