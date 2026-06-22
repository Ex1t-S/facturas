import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { writeDocumentFile } from '../services/documentStorage.js';
import { getWhatsAppMedia, verifyMetaSignature } from '../services/whatsapp.js';

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

export const whatsappRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/whatsapp/messages', async () => {
    return prisma.whatsAppMessage.findMany({
      include: { mediaDocument: true, customer: true },
      orderBy: { createdAt: 'desc' },
      take: 50
    });
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
    const stored = [];
    for (const entry of payload.entry) {
      for (const change of entry.changes) {
        for (const message of change.value.messages ?? []) {
          let mediaDocumentId: string | undefined;
          const mediaId = message.document?.id ?? message.image?.id;
          if (mediaId) {
            try {
              const media = await getWhatsAppMedia(mediaId);
              const filename = message.document?.filename ?? media.filename;
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
              app.log.error(error);
            }
          }

          const saved = await prisma.whatsAppMessage.upsert({
            where: { providerMessageId: message.id },
            update: { mediaDocumentId },
            create: {
              direction: 'INBOUND',
              fromNumber: message.from,
              toNumber: change.value.metadata?.display_phone_number ?? change.value.metadata?.phone_number_id ?? '',
              providerMessageId: message.id,
              messageType: message.type,
              body: message.text?.body,
              mediaDocumentId
            }
          });
          stored.push(saved.id);
        }
      }
    }

    return { ok: true, stored };
  });
};
