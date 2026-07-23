import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { answerAssistant, type PendingDeliveryDraft } from '../services/assistant.js';
import {
  loadPersistedPendingDraft,
  persistCommercialDraftSnapshot
} from '../services/commercialAssistant/draftRepository.js';
import {
  isOutOfOrderMessage,
  providerTimestamp,
  safeProcessingError
} from '../services/commercialAssistant/webhookPolicy.js';
import { readStoredDocumentFile, writeDocumentFile } from '../services/documentStorage.js';
import {
  getWhatsAppMedia,
  sendWhatsAppDocument,
  sendWhatsAppText,
  transcribeWhatsAppAudio,
  uploadWhatsAppMedia,
  verifyMetaSignature
} from '../services/whatsapp.js';
import { allowedWhatsAppNumbers } from '../security.js';

const whatsappOperatorAllowlist = allowedWhatsAppNumbers(config.WHATSAPP_ALLOWED_FROM);

function maskedWhatsAppNumber(value: string) {
  const digits = value.replace(/\D/g, '');
  return digits.length <= 4 ? '***' : `***${digits.slice(-4)}`;
}

function isAllowedWhatsAppOperator(value: string) {
  return whatsappOperatorAllowlist.has(value.replace(/\D/g, ''));
}

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
                  timestamp: z.string().optional(),
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

export function buildWhatsAppHistory(
  messages: Array<{ direction: 'INBOUND' | 'OUTBOUND'; body: string | null; mediaDocument?: { fileName: string } | null }>
) {
  return messages
    .map((message) => ({
      role: message.direction === 'INBOUND' ? ('user' as const) : ('assistant' as const),
      content: message.body || (message.mediaDocument?.fileName ? '[Adjunto: ' + message.mediaDocument.fileName + ']' : '')
    }))
    .filter((message) => message.content.trim().length > 0);
}

async function resolveInboundHistory(conversationId: string) {
  const recent = await prisma.whatsAppMessage.findMany({
    where: { conversationId },
    include: { mediaDocument: true },
    orderBy: { createdAt: 'desc' },
    take: 20
  });
  return buildWhatsAppHistory(recent.reverse());
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
    operatorAllowlistConfigured: whatsappOperatorAllowlist.size > 0,
    canReceive: config.WHATSAPP_VERIFY_TOKEN !== 'change-me'
      && config.WHATSAPP_APP_SECRET !== 'change-me'
      && whatsappOperatorAllowlist.size > 0
      && Boolean(config.WHATSAPP_ACCESS_TOKEN && config.WHATSAPP_PHONE_NUMBER_ID),
    canSend: Boolean(config.WHATSAPP_ACCESS_TOKEN && config.WHATSAPP_PHONE_NUMBER_ID)
  };
}

type InboundMessage = {
  id: string;
  from: string;
  type: string;
  timestamp?: string;
  text?: { body: string };
  audio?: { id: string; mime_type?: string };
  document?: { id: string; filename?: string; mime_type?: string };
  image?: { id: string; mime_type?: string };
};

async function processIncomingMessage(input: { message: InboundMessage; phoneNumber: string }) {
  const { message, phoneNumber } = input;
  let claimed;
  try {
    claimed = await prisma.whatsAppMessage.create({
      data: {
        direction: 'INBOUND',
        fromNumber: message.from,
        toNumber: phoneNumber,
        providerMessageId: message.id,
        providerTimestamp: providerTimestamp(message.timestamp),
        messageType: message.type,
        body: message.text?.body ?? '',
        status: 'processing',
        processingStatus: 'PROCESSING',
        processingAttempts: 1,
        leaseUntil: new Date(Date.now() + 60_000)
      },
      include: { mediaDocument: true }
    });
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    if (code !== 'P2002') throw error;
    const duplicate = await prisma.whatsAppMessage.findUnique({
      where: { providerMessageId: message.id },
      include: { mediaDocument: true }
    });
    if (!duplicate) throw error;
    return { inbound: duplicate, duplicate: true };
  }
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

  const inbound = await prisma.whatsAppMessage.update({
    where: { id: claimed.id },
    data: {
      body,
      mediaDocumentId,
      status: 'processed',
      processingStatus: 'PROCESSED',
      processedAt: new Date(),
      leaseUntil: null
    },
    include: { mediaDocument: true }
  });
  return { inbound, duplicate: false };
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

function outboundWhatsAppNumber(value: string) {
  const digits = value.replace(/\D/g, '');
  return digits.startsWith('549') ? '54' + digits.slice(3) : digits;
}

function pendingDraftContentUrl(baseUrl: string, pending?: PendingDeliveryDraft) {
  return pending?.token && pending.previewStoragePath && pending.previewFileName
    ? baseUrl + '/api/whatsapp/drafts/' + pending.token + '/content'
    : '';
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
    if (pending?.token !== token) continue;
    if (!pending.expiresAt || new Date(pending.expiresAt).getTime() <= Date.now()) return null;
    return pending;
  }
  return null;
}

export const whatsappRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/whatsapp/messages', async (request) => {
    const query = z.object({ companyId: z.string() }).parse(request.query);
    return prisma.whatsAppMessage.findMany({
      where: { conversation: { companyId: query.companyId } },
      include: {
        mediaDocument: { select: { id: true, fileName: true, mimeType: true, kind: true, extractionStatus: true } },
        customer: true
      },
      orderBy: { createdAt: 'desc' },
      take: 50
    });
  });

  app.get('/api/whatsapp/conversations', async (request) => {
    const query = z.object({ companyId: z.string() }).parse(request.query);
    return prisma.whatsAppConversation.findMany({
      where: { companyId: query.companyId },
      include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
      orderBy: { lastMessageAt: 'desc' },
      take: 100
    });
  });

  app.get('/api/whatsapp/conversations/:id/messages', async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const query = z.object({ companyId: z.string() }).parse(request.query);
    const conversation = await prisma.whatsAppConversation.findFirst({
      where: { id: params.id, companyId: query.companyId },
      include: {
        messages: {
          include: { mediaDocument: { select: { id: true, fileName: true, mimeType: true, kind: true, extractionStatus: true } } },
          orderBy: { createdAt: 'asc' }
        }
      }
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
      .header('Cache-Control', 'no-store, private')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Type', pending.previewMimeType || 'application/pdf')
      .header('Content-Disposition', 'inline; filename="' + encodeURIComponent(pending.previewFileName || pending.suggestedFileName || 'borrador.pdf') + '"')
      .send(buffer);
  });

  async function sendAssistantReply(input: {
    company: { id: string };
    inbound: { id: string; body: string | null };
    fromNumber: string;
    phoneNumber: string;
    conversation: { id: string; pendingJson: string | null };
  }) {
    const outboundTo = outboundWhatsAppNumber(input.fromNumber);
    async function recordOutboundFailure(messageType: string, body: string, error: unknown) {
      await prisma.whatsAppMessage.create({
        data: {
          direction: 'OUTBOUND',
          fromNumber: input.phoneNumber,
          toNumber: outboundTo,
          messageType,
          body: body + '\n\n[El envío por WhatsApp falló. Reintentá desde la bandeja.]',
          status: 'failed',
          conversationId: input.conversation.id
        }
      });
      app.log.error({ err: error, conversationId: input.conversation.id }, 'whatsapp outbound failed');
    }

    app.log.info({ conversationId: input.conversation.id, fromNumber: maskedWhatsAppNumber(input.fromNumber) }, 'whatsapp assistant reply started');
    const history = await resolveInboundHistory(input.conversation.id);
    app.log.info({ conversationId: input.conversation.id, history: history.length }, 'whatsapp assistant history loaded');
    const previousPending =
      parsePending(input.conversation.pendingJson) ??
      await loadPersistedPendingDraft(input.conversation.id);
    const assistantResponse = await answerAssistant({
      companyId: input.company.id,
      conversationId: input.conversation.id,
      messageId: input.inbound.id,
      message: input.inbound.body ?? '',
      history,
      pendingDeliveryDraft: previousPending
    });
    app.log.info({ conversationId: input.conversation.id, action: assistantResponse.action?.type }, 'whatsapp assistant response generated');
    await persistCommercialDraftSnapshot({
      conversationId: input.conversation.id,
      pending: assistantResponse.pendingDeliveryDraft,
      expectedDraftVersion: previousPending?.commercialDraft?.draftVersion ?? previousPending?.draftVersion
    });
    await prisma.whatsAppMessage.update({
      where: { id: input.inbound.id },
      data: {
        actionType:
          assistantResponse.pendingDeliveryDraft?.commercialDraft?.status ??
          assistantResponse.action?.type,
        draftId: assistantResponse.pendingDeliveryDraft?.commercialDraft?.id,
        draftVersionBefore:
          previousPending?.commercialDraft?.draftVersion ??
          previousPending?.draftVersion,
        draftVersionAfter:
          assistantResponse.pendingDeliveryDraft?.commercialDraft?.draftVersion ??
          assistantResponse.pendingDeliveryDraft?.draftVersion
      }
    });
    app.log.info({
      conversationId: input.conversation.id,
      messageId: input.inbound.id,
      draftId: assistantResponse.pendingDeliveryDraft?.commercialDraft?.id,
      draftVersion: assistantResponse.pendingDeliveryDraft?.commercialDraft?.draftVersion,
      action: assistantResponse.action?.type
    }, 'whatsapp commercial transition persisted');

    const publicBaseUrl = config.PUBLIC_BASE_URL.replace(/\/$/, '');
    const draftUrl = assistantResponse.previewDocument
      ? pendingDraftContentUrl(publicBaseUrl, assistantResponse.pendingDeliveryDraft)
      : null;
    const finalDocumentUrl = assistantResponse.action?.documentId
      ? publicBaseUrl + '/api/documents/' + assistantResponse.action.documentId + '/content?companyId=' + encodeURIComponent(input.company.id)
      : '';
    const documentUrl = draftUrl || finalDocumentUrl;
    const storedDocument = assistantResponse.action?.documentId
      ? await prisma.document.findUnique({ where: { id: assistantResponse.action.documentId } })
      : null;
    let documentSendFailed = false;

    async function storedBuffer(storagePath: string) {
      try {
        return await readStoredDocumentFile(storagePath);
      } catch (error) {
        app.log.warn({ error: errorText(error), storagePath }, 'whatsapp document unavailable in local storage');
        return null;
      }
    }

    const pendingDraft = assistantResponse.pendingDeliveryDraft;
    const finalBuffer = !assistantResponse.previewDocument && !pendingDraft && storedDocument
      ? await storedBuffer(storedDocument.storagePath)
      : null;
    const outboundDocument = assistantResponse.previewDocument
      ? {
          ...assistantResponse.previewDocument,
          documentId: undefined as string | undefined
        }
      : storedDocument && finalBuffer
        ? {
            buffer: finalBuffer,
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
          to: outboundTo,
          mediaId: media.mediaId,
          filename: outboundDocument.filename,
          caption: assistantResponse.answer.slice(0, 900)
        });
        await prisma.whatsAppMessage.create({
          data: {
            direction: 'OUTBOUND',
            fromNumber: input.phoneNumber,
            toNumber: outboundTo,
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
          to: outboundTo,
          documentUrl,
          filename: assistantResponse.pendingDeliveryDraft?.previewFileName || storedDocument?.fileName || 'documento.pdf',
          caption: assistantResponse.answer.slice(0, 900)
        });
        await prisma.whatsAppMessage.create({
          data: {
            direction: 'OUTBOUND',
            fromNumber: input.phoneNumber,
            toNumber: outboundTo,
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
      const sent = await sendWhatsAppText({ to: outboundTo, body: fallbackAnswer });
      await prisma.whatsAppMessage.create({
        data: {
          direction: 'OUTBOUND',
          fromNumber: input.phoneNumber,
          toNumber: outboundTo,
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
    const body = z.object({ companyId: z.string() }).parse(request.body);
    const company = await prisma.company.findUnique({ where: { id: body.companyId } });
    if (!company) return reply.code(409).send({ error: 'No company configured' });
    const inbound = await prisma.whatsAppMessage.findFirst({
      where: { id: params.id, conversation: { companyId: body.companyId } },
      include: { conversation: true }
    });
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
      await prisma.whatsAppMessage.update({
        where: { id: inbound.id },
        data: {
          processingStatus: 'PROCESSING',
          processingAttempts: { increment: 1 },
          leaseUntil: new Date(Date.now() + 60_000),
          lastError: null
        }
      });
      await sendAssistantReply({ company, inbound, fromNumber: inbound.fromNumber, phoneNumber: inbound.toNumber, conversation });
      await prisma.whatsAppMessage.update({
        where: { id: inbound.id },
        data: { processingStatus: 'COMPLETED', processedAt: new Date(), leaseUntil: null }
      });
      return { ok: true };
    } catch (error) {
      app.log.error(error);
      await prisma.whatsAppMessage.update({
        where: { id: inbound.id },
        data: {
          processingStatus: 'FAILED',
          lastError: safeProcessingError(error),
          leaseUntil: null
        }
      });
      return reply.code(500).send({ error: error instanceof Error ? error.message : 'Reprocess failed' });
    }
  });

  app.get('/webhooks/whatsapp', async (request, reply) => {
    if (config.WHATSAPP_VERIFY_TOKEN === 'change-me') {
      return reply.code(503).send({ error: 'WhatsApp webhook is not configured' });
    }
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
    if (config.WHATSAPP_APP_SECRET === 'change-me' || !config.WHATSAPP_APP_SECRET.trim()) {
      return reply.code(503).send({ error: 'WhatsApp webhook signature is not configured' });
    }
    const parsedBody = request.body as Record<string, unknown> & { __rawBody?: Buffer };
    const rawBody = parsedBody?.__rawBody ?? Buffer.from(JSON.stringify(request.body ?? {}));
    const signature = request.headers['x-hub-signature-256'];
    if (!verifyMetaSignature(rawBody, Array.isArray(signature) ? signature[0] : signature)) {
      return reply.code(401).send({ error: 'Invalid signature' });
    }

    const payload = metaWebhookSchema.parse(request.body);
    const wrongPhoneNumber = payload.entry.some((entry) =>
      entry.changes.some((change) =>
        Boolean(config.WHATSAPP_PHONE_NUMBER_ID)
        && change.value.metadata?.phone_number_id !== config.WHATSAPP_PHONE_NUMBER_ID
      )
    );
    if (wrongPhoneNumber) return reply.code(403).send({ error: 'Unexpected WhatsApp phone number id' });

    const company = await prisma.company.findFirst();

    for (const entry of payload.entry) {
      for (const change of entry.changes) {
        const phoneNumber = change.value.metadata?.display_phone_number ?? change.value.metadata?.phone_number_id ?? '';
        for (const message of change.value.messages ?? []) {
          if (!isAllowedWhatsAppOperator(message.from)) {
            app.log.warn({ fromNumber: maskedWhatsAppNumber(message.from) }, 'ignored whatsapp message from non-operator number');
            continue;
          }
          const claimed = await processIncomingMessage({ message, phoneNumber });
          if (claimed.duplicate) {
            app.log.info({ messageId: message.id }, 'ignored duplicate whatsapp message');
            continue;
          }
          const inbound = claimed.inbound;
          if (!company || !inbound.body?.trim()) continue;

          const conversation = await prisma.whatsAppConversation.upsert({
            where: { companyId_fromNumber: { companyId: company.id, fromNumber: message.from } },
            update: { toNumber: phoneNumber, messageCount: { increment: 1 }, lastMessageAt: new Date() },
            create: { companyId: company.id, fromNumber: message.from, toNumber: phoneNumber, messageCount: 1, lastMessageAt: new Date() }
          });
          await prisma.whatsAppMessage.update({ where: { id: inbound.id }, data: { conversationId: conversation.id } });
          const latestCompleted = inbound.providerTimestamp
            ? await prisma.whatsAppMessage.findFirst({
                where: {
                  conversationId: conversation.id,
                  direction: 'INBOUND',
                  processingStatus: 'COMPLETED',
                  providerTimestamp: { gt: inbound.providerTimestamp }
                },
                select: { providerTimestamp: true },
                orderBy: { providerTimestamp: 'desc' }
              })
            : null;
          if (isOutOfOrderMessage(inbound.providerTimestamp, latestCompleted?.providerTimestamp)) {
            await prisma.whatsAppMessage.update({
              where: { id: inbound.id },
              data: {
                processingStatus: 'OUT_OF_ORDER',
                status: 'ignored',
                processedAt: new Date(),
                leaseUntil: null
              }
            });
            app.log.warn({
              conversationId: conversation.id,
              messageId: inbound.id
            }, 'ignored out-of-order whatsapp message');
            continue;
          }

          try {
            await sendAssistantReply({ company, inbound, fromNumber: message.from, phoneNumber, conversation });
            await prisma.whatsAppMessage.update({
              where: { id: inbound.id },
              data: { processingStatus: 'COMPLETED', processedAt: new Date(), leaseUntil: null }
            });
          } catch (error) {
            app.log.error(error);
            await prisma.whatsAppMessage.update({
              where: { id: inbound.id },
              data: {
                processingStatus: 'FAILED',
                lastError: safeProcessingError(error),
                leaseUntil: null
              }
            });
            const body = 'Recibi el mensaje, pero no pude generar la respuesta automatica. Revisame configuracion de audio/PDF y volve a enviar el pedido.';
            const sent = await sendWhatsAppText({ to: outboundWhatsAppNumber(message.from), body });
            await prisma.whatsAppMessage.create({
              data: {
                direction: 'OUTBOUND',
                fromNumber: phoneNumber,
                toNumber: outboundWhatsAppNumber(message.from),
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

    return { ok: true };
  });
};
