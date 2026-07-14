import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { answerAssistant, type PendingDeliveryDraft } from '../services/assistant.js';
import { readStoredDocumentFile, writeDocumentFile } from '../services/documentStorage.js';
import {
  getWhatsAppMedia,
  sendWhatsAppDocument,
  sendWhatsAppText,
  transcribeWhatsAppAudio,
  uploadWhatsAppMedia,
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

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function pendingDraftContentUrl(baseUrl: string, pending?: PendingDeliveryDraft) {
  return pending?.token ? baseUrl + '/api/whatsapp/drafts/' + pending.token + '/content' : '';
}

function isPublicDocumentUrl(url: string) {
  try {
    const parsed = new URL(url);
    return !['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

async function findPendingDraftByToken(token: string) {
  const conversations = await prisma.whatsAppConversation.findMany({
    where: { pendingJson: { not: null } },
    select: { pendingJson: true },
    take: 200
  });
  for (const conversation of conversations) {
    const pending = parsePending(conversation.pendingJson);
    if (pending?.token === token) return pending;
  }
  return null;
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

  app.get('/api/whatsapp/drafts/:token/content', async (request, reply) => {
    const params = z.object({ token: z.string() }).parse(request.params);
    const pending = await findPendingDraftByToken(params.token);
    if (!pending) return reply.code(404).send({ error: 'Draft not found' });
    const buffer = await readStoredDocumentFile(pending.previewStoragePath);
    return reply
      .header('Content-Type', pending.previewMimeType || 'application/pdf')
      .header('Content-Disposition', 'inline; filename="' + encodeURIComponent(pending.previewFileName || pending.suggestedFileName || 'borrador.pdf') + '"')
      .send(buffer);
  });

  async function sendAssistantReply(input: {
    company: { id: string };
    inbound: { body: string | null };
    fromNumber: string;
    phoneNumber: string;
    conversation: { id: string; pendingJson: string | null };
  }) {
    async function recordOutboundFailure(messageType: string, body: string, error: unknown) {
      await prisma.whatsAppMessage.create({
        data: {
          direction: 'OUTBOUND',
          fromNumber: input.phoneNumber,
          toNumber: input.fromNumber,
          messageType,
          body: body + '\n\n[Error de envio WhatsApp: ' + errorText(error).slice(0, 900) + ']',
          status: 'failed',
          conversationId: input.conversation.id
        }
      });
    }

    app.log.info({ conversationId: input.conversation.id, fromNumber: input.fromNumber }, 'whatsapp assistant reply started');
    const history = await resolveInboundHistory(input.fromNumber);
    app.log.info({ conversationId: input.conversation.id, history: history.length }, 'whatsapp assistant history loaded');
    const assistantResponse = await answerAssistant({
      companyId: input.company.id,
      message: input.inbound.body ?? '',
      history,
      pendingDeliveryDraft: parsePending(input.conversation.pendingJson)
    });
    app.log.info({ conversationId: input.conversation.id, action: assistantResponse.action?.type }, 'whatsapp assistant response generated');
    await prisma.whatsAppConversation.update({
      where: { id: input.conversation.id },
      data: { pendingJson: assistantResponse.pendingDeliveryDraft ? JSON.stringify(assistantResponse.pendingDeliveryDraft) : null }
    });

    const publicBaseUrl = config.PUBLIC_BASE_URL.replace(/\/$/, '');
    const draftUrl = pendingDraftContentUrl(publicBaseUrl, assistantResponse.pendingDeliveryDraft);
    const finalDocumentUrl = assistantResponse.action?.documentId
      ? publicBaseUrl + '/api/documents/' + assistantResponse.action.documentId + '/content'
      : '';
    const documentUrl = draftUrl || finalDocumentUrl;
    const storedDocument = assistantResponse.action?.documentId
      ? await prisma.document.findUnique({ where: { id: assistantResponse.action.documentId } })
      : null;
    let documentSendFailed = false;

    const pendingDraft = assistantResponse.pendingDeliveryDraft;
    const outboundDocument = pendingDraft
      ? {
          buffer: await readStoredDocumentFile(pendingDraft.previewStoragePath),
          mimeType: pendingDraft.previewMimeType || 'application/pdf',
          filename: pendingDraft.previewFileName || pendingDraft.suggestedFileName || 'borrador.pdf',
          documentId: undefined as string | undefined
        }
      : storedDocument
        ? {
            buffer: await readStoredDocumentFile(storedDocument.storagePath),
            mimeType: storedDocument.mimeType,
            filename: storedDocument.fileName,
            documentId: storedDocument.id
          }
        : null;

    if (outboundDocument) {
      try {
        app.log.info({ conversationId: input.conversation.id, filename: outboundDocument.filename }, 'whatsapp uploading pdf media');
        const media = await uploadWhatsAppMedia({
          buffer: outboundDocument.buffer,
          mimeType: outboundDocument.mimeType,
          filename: outboundDocument.filename
        });
        const sent = await sendWhatsAppDocument({
          to: input.fromNumber,
          mediaId: media.mediaId,
          filename: outboundDocument.filename,
          caption: assistantResponse.answer.slice(0, 900)
        });
        await prisma.whatsAppMessage.create({
          data: {
            direction: 'OUTBOUND',
            fromNumber: input.phoneNumber,
            toNumber: input.fromNumber,
            providerMessageId: sent.providerMessageId,
            messageType: 'document',
            body: assistantResponse.answer,
            mediaDocumentId: outboundDocument.documentId,
            conversationId: input.conversation.id
          }
        });
        app.log.info({ conversationId: input.conversation.id }, 'whatsapp pdf document sent');
        return;
      } catch (error) {
        app.log.error(error);
        await recordOutboundFailure('document', assistantResponse.answer, error);
        documentSendFailed = true;
      }
    }

    if (documentUrl && isPublicDocumentUrl(documentUrl)) {
      try {
        const sent = await sendWhatsAppDocument({
          to: input.fromNumber,
          documentUrl,
          filename: assistantResponse.pendingDeliveryDraft?.previewFileName || storedDocument?.fileName || 'documento.pdf',
          caption: assistantResponse.answer.slice(0, 900)
        });
        await prisma.whatsAppMessage.create({
          data: {
            direction: 'OUTBOUND',
            fromNumber: input.phoneNumber,
            toNumber: input.fromNumber,
            providerMessageId: sent.providerMessageId,
            messageType: 'document',
            body: assistantResponse.answer,
            mediaDocumentId: assistantResponse.action?.documentId,
            conversationId: input.conversation.id
          }
        });
        app.log.info({ conversationId: input.conversation.id }, 'whatsapp pdf link sent');
        return;
      } catch (error) {
        app.log.error(error);
        await recordOutboundFailure('document', assistantResponse.answer, error);
        documentSendFailed = true;
      }
    }

    const fallbackAnswer = outboundDocument || documentSendFailed
      ? assistantResponse.answer + '\n\nNo pude adjuntar el PDF por WhatsApp. El borrador quedo generado; revisa la configuracion de WhatsApp/Media y reintenta.'
      : documentUrl && !isPublicDocumentUrl(documentUrl)
        ? assistantResponse.answer + '\n\nNo pude adjuntar el PDF porque PUBLIC_BASE_URL no es una URL publica accesible por WhatsApp. Configurala con la URL de Render/produccion y reintenta.'
        : assistantResponse.answer;
    try {
      const sent = await sendWhatsAppText({ to: input.fromNumber, body: fallbackAnswer });
      await prisma.whatsAppMessage.create({
        data: {
          direction: 'OUTBOUND',
          fromNumber: input.phoneNumber,
          toNumber: input.fromNumber,
          providerMessageId: sent.providerMessageId,
          messageType: 'text',
          body: fallbackAnswer,
          conversationId: input.conversation.id
        }
      });
      app.log.info({ conversationId: input.conversation.id }, 'whatsapp text sent');
    } catch (error) {
      app.log.error(error);
      await recordOutboundFailure('text', fallbackAnswer, error);
      throw error;
    }
  }

  app.post('/api/whatsapp/messages/:id/reprocess', async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const company = await prisma.company.findFirst();
    if (!company) return reply.code(409).send({ error: 'No company configured' });
    const inbound = await prisma.whatsAppMessage.findUnique({ where: { id: params.id }, include: { conversation: true } });
    if (!inbound || inbound.direction !== 'INBOUND') return reply.code(404).send({ error: 'Inbound WhatsApp message not found' });
    if (!inbound.body?.trim()) return reply.code(409).send({ error: 'Inbound WhatsApp message has no body' });
    const conversation =
      inbound.conversation ??
      (await prisma.whatsAppConversation.upsert({
        where: { companyId_fromNumber: { companyId: company.id, fromNumber: inbound.fromNumber } },
        update: { toNumber: inbound.toNumber, lastMessageAt: new Date() },
        create: { companyId: company.id, fromNumber: inbound.fromNumber, toNumber: inbound.toNumber, messageCount: 1, lastMessageAt: new Date() }
      }));
    if (!inbound.conversationId) await prisma.whatsAppMessage.update({ where: { id: inbound.id }, data: { conversationId: conversation.id } });
    try {
      await sendAssistantReply({ company, inbound, fromNumber: inbound.fromNumber, phoneNumber: inbound.toNumber, conversation });
      return { ok: true };
    } catch (error) {
      app.log.error(error);
      const body = 'Recibi el mensaje, pero no pude generar la respuesta automatica. Revisame configuracion de audio/PDF y volve a enviar el pedido.';
      const sent = await sendWhatsAppText({ to: inbound.fromNumber, body });
      await prisma.whatsAppMessage.create({
        data: {
          direction: 'OUTBOUND',
          fromNumber: inbound.toNumber,
          toNumber: inbound.fromNumber,
          providerMessageId: sent.providerMessageId,
          messageType: 'text',
          body,
          conversationId: conversation.id
        }
      });
      return reply.code(500).send({ error: error instanceof Error ? error.message : 'Reprocess failed' });
    }
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
    const parsedBody = request.body as Record<string, unknown> & { __rawBody?: Buffer };
    const rawBody = parsedBody?.__rawBody ?? Buffer.from(JSON.stringify(request.body ?? {}));
    const signature = request.headers['x-hub-signature-256'];
    if (config.WHATSAPP_APP_SECRET !== 'change-me' && !verifyMetaSignature(rawBody, Array.isArray(signature) ? signature[0] : signature)) {
      return reply.code(401).send({ error: 'Invalid signature' });
    }

    const payload = metaWebhookSchema.parse(request.body);

    void (async () => {
    const company = await prisma.company.findFirst();

    for (const entry of payload.entry) {
      for (const change of entry.changes) {
        const phoneNumber = change.value.metadata?.display_phone_number ?? change.value.metadata?.phone_number_id ?? '';
        for (const message of change.value.messages ?? []) {
          if (config.WHATSAPP_ALLOWED_FROM && message.from !== config.WHATSAPP_ALLOWED_FROM) continue;
          const inbound = await processIncomingMessage({ message, phoneNumber });
          if (!company || !inbound.body?.trim()) continue;

          const conversation = await prisma.whatsAppConversation.upsert({
            where: { companyId_fromNumber: { companyId: company.id, fromNumber: message.from } },
            update: { toNumber: phoneNumber, messageCount: { increment: 1 }, lastMessageAt: new Date() },
            create: { companyId: company.id, fromNumber: message.from, toNumber: phoneNumber, messageCount: 1, lastMessageAt: new Date() }
          });
          await prisma.whatsAppMessage.update({ where: { id: inbound.id }, data: { conversationId: conversation.id } });

          if (config.WHATSAPP_TEST_MODE) continue;

          try {
            await sendAssistantReply({ company, inbound, fromNumber: message.from, phoneNumber, conversation });
          } catch (error) {
            app.log.error(error);
            const body = 'Recibi el mensaje, pero no pude generar la respuesta automatica. Revisame configuracion de audio/PDF y volve a enviar el pedido.';
            const sent = await sendWhatsAppText({ to: message.from, body });
            await prisma.whatsAppMessage.create({
              data: {
                direction: 'OUTBOUND',
                fromNumber: phoneNumber,
                toNumber: message.from,
                providerMessageId: sent.providerMessageId,
                messageType: 'text',
                body,
                conversationId: conversation.id
              }
            });
          }
        }
      }
    }
    })().catch((error) => app.log.error(error));

    return { ok: true };
  });
};
