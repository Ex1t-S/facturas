import { DocumentKind } from '../generated/postgres-client/index.js';
import fs from 'node:fs/promises';
import { nanoid } from 'nanoid';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { calculateQuoteTotals } from '../domain/money.js';
import {
  getOperationalWeakPoints,
  parseDateHints,
  parseDocumentKindFromMessage,
  searchBusinessKnowledge,
  type KnowledgeSource
} from './businessKnowledge.js';
import { safeFileName, writeDocumentFile } from './documentStorage.js';
import { convertDocxToPdf, renderFmhQuotePdf, writeFmhQuoteDocx, type QuoteWithDetails } from './fmhQuoteDocument.js';
import { renderFmhDeliveryNotePdf, writeFmhDeliveryNoteDocx } from './fmhDeliveryNoteDocument.js';
import { renderDocumentFromTemplate, type RendererUsed } from './documentTemplateRenderer.js';
import { renderDeliveryNotePdf, renderQuotePdf } from './pdf.js';
import { createDeliveryNoteRecord, listPendingDeliveryNotes, linkDeliveryNotesToQuote } from './deliveryNotes/deliveryNoteService.js';

const OPENAI_TIMEOUT_MS = 35_000;

function timeoutSignal(ms = OPENAI_TIMEOUT_MS) {
  return AbortSignal.timeout(ms);
}

export type AssistantMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type AssistantInput = {
  companyId?: string;
  message: string;
  history?: AssistantMessage[];
  pendingDeliveryDraft?: PendingDeliveryDraft;
};

export type AssistantResponse = {
  mode: 'local' | 'openai';
  answer: string;
  sources: KnowledgeSource[];
  suggestions: string[];
  previewDocument?: {
    buffer: Buffer;
    mimeType: string;
    filename: string;
  };
  action?: {
    type: 'quote_draft_created' | 'delivery_note_created' | 'document_draft_pending' | 'delivery_note_draft_pending' | 'invoice_unavailable';
    quoteId?: string;
    documentId?: string;
  };
  pendingDeliveryDraft?: PendingDeliveryDraft;
};

type DraftIntent = 'quote' | 'delivery_note' | 'invoice' | 'none';

type DraftItem = {
  description: string;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
  taxRate?: number;
};

type DraftPayload = {
  customerName?: string;
  customerCuit?: string;
  customerAddress?: string;
  currency?: string;
  notes?: string;
  items: DraftItem[];
};

export type PendingDeliveryDraft = {
  type: 'quote' | 'delivery_note';
  payload: DraftPayload;
  suggestedFileName: string;
  token: string;
  previewStoragePath: string;
  previewFileName: string;
  previewMimeType: string;
  sourceDeliveryNoteIds?: string[];
  status?: 'COLLECTING_INFORMATION' | 'READY_FOR_PREVIEW' | 'WAITING_CONFIRMATION' | 'CANCELLED' | 'EXPIRED';
  draftVersion?: number;
  previewVersion?: number;
  createdAt?: string;
  updatedAt?: string;
  expiresAt?: string;
  rawSourceMessages?: string[];
  rendererUsed?: RendererUsed;
  rendererError?: string;
};

function wantsCreation(message: string) {
  const normalized = message.toLocaleLowerCase('es-AR');
  if (/\b(lista|listar|pasame|mostrame|mostrar|ver|buscar|busca|quienes)\b/i.test(normalized)) return false;
  return /\b(arm|cre|gener|hac|prepar|carg|guard)/i.test(normalized);
}

export function detectDraftIntent(message: string): DraftIntent {
  const normalized = message.toLocaleLowerCase('es-AR');
  if (normalized.includes('factura')) return 'invoice';
  if (normalized.includes('remito') && (wantsCreation(normalized) || /\bremito\s+para\b/.test(normalized))) return 'delivery_note';
  if (normalized.includes('presupuesto') && (wantsCreation(normalized) || /\bpresupuesto\s+para\b/.test(normalized))) return 'quote';
  return 'none';
}

function parseNumber(value?: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return undefined;
  const parsed = Number(value.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function explicitPrice(message: string) {
  const match = message.match(/(?:costo|precio|importe|valor)\s*[,=:]?\s*(?:de\s*)?(?:\$\s*)?([\d.,]+)/i);
  return match ? parseNumber(match[1]) : undefined;
}

function quoteWorkDescription(message: string) {
  const match = message.match(/presupuesto\s+para\s+(?:cliente\s+)?[^,.;]+[,;]\s*(.*?)(?:\.\s*(?:costo|precio|importe|valor)\b|\s*,\s*(?:costo|precio|importe|valor)\b)/i);
  return match?.[1]?.trim();
}

function firstCustomerGuess(message: string) {
  const match = message.match(/\b(?:para|cliente)\s+([^,.;\n]+?)(?:\s+con\b|\s+por\b|\s+de\b|,|\.|;|$)/i);
  return match?.[1]?.trim().replace(/^cliente\s+/i, '').trim();
}

function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es-AR');
}

function slugify(value: string) {
  const slug = normalizeText(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);
  return slug || 'remito';
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function suggestedDocumentFileName(type: PendingDeliveryDraft['type'], payload: DraftPayload, suffix?: string) {
  const base = type === 'quote' ? 'presupuesto' : 'remito';
  const customer = slugify(payload.customerName || 'cliente-pendiente');
  const extra = suffix ? '-' + slugify(suffix) : '';
  return safeFileName(base + '-' + customer + extra + '.pdf');
}

const conversationalInstruction = /\b(haceme|armame|generame|preparame|prepar[aá]melo|prepar[aá](?:\s+el)?\s+pdf|mandamelo|envialo|guardalo(?:\s+como)?|para\s+revisarlo|antes\s+de\s+guardarlo|confirmalo|haceme\s+un\s+(?:remito|presupuesto))\b/gi;

/** Second line of defense: document descriptions never contain chat control language. */
export function sanitizeDocumentInstructions(value: string) {
  return value
    .replace(conversationalInstruction, ' ')
    .replace(/\b(?:por\s+los\s+siguientes\s+trabajos|cantidad\s*:\s*\d+\s*trabajos?)\s*:?[\s]*/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[,;:.\-\s]+|[,;:.\-\s]+$/g, '')
    .trim();
}

function deliveryDescriptionsFromMessage(message: string) {
  const afterWorkLabel = message.match(/\b(?:por\s+los\s+siguientes\s+trabajos|trabajos\s+realizados)\s*:\s*([\s\S]*)$/i)?.[1];
  const customer = firstCustomerGuess(message);
  const afterCustomer = customer
    ? message.slice(message.toLocaleLowerCase('es-AR').indexOf(customer.toLocaleLowerCase('es-AR')) + customer.length).replace(/^\s*(?:por\s+)?/i, '')
    : message;
  let content = (afterWorkLabel || afterCustomer)
    .replace(/\b(?:prepar[aá](?:me)?\s+(?:el\s+)?pdf|mandamelo|envialo|guardalo|confirmalo|para\s+revisarlo|antes\s+de\s+guardarlo).*$/i, '');
  content = sanitizeDocumentInstructions(content);
  return content
    .split(/\s*,\s*|\s+y\s+(?=(?:realizar|hacer|revisar|soldar|cambiar|destapar|acortar|reparar|fabricar|instalar)\b)/i)
    .map((description) => sanitizeDocumentInstructions(description))
    .filter((description) => description.length >= 3);
}

export function structuredDeliveryItemsFromMessage(message: string): DraftItem[] {
  return deliveryDescriptionsFromMessage(message).map((description) => {
    const quantityMatch = description.match(/^(\d+(?:[,.]\d+)?)\s+(unidades?|horas?|metros?|mts|kg)\s+(?:de\s+)?(.+)$/i);
    return quantityMatch
      ? { quantity: parseNumber(quantityMatch[1]), unit: quantityMatch[2].toLocaleLowerCase('es-AR'), description: sanitizeDocumentInstructions(quantityMatch[3]) }
      : { description };
  });
}

export function validateGeneratedBusinessDocument(input: { customerName?: string; items: DraftItem[] }) {
  if (!input.customerName?.trim()) throw new Error('El documento no tiene cliente.');
  if (!input.items.length) throw new Error('El documento no tiene detalle comercial.');
  const combined = input.items.map((item) => item.description).join('\n');
  if (/\{\{[^}]+\}\}|\b(haceme|prepara(?:\s+el)?\s+pdf|guardalo|para\s+revisarlo|antes\s+de\s+guardarlo)\b/i.test(combined)) {
    throw new Error('El detalle contiene instrucciones conversacionales o placeholders.');
  }
}

function ensurePdfFileName(value: string) {
  const cleaned = safeFileName(value.trim().replace(/^["']|["']$/g, ''));
  if (!cleaned) return '';
  return cleaned.toLowerCase().endsWith('.pdf') ? cleaned : cleaned + '.pdf';
}

function extractRequestedFileName(message: string) {
  const match = message.match(/\b(?:como|nombre|archivo)\s+["']?([^"'\n]+?\.pdf|[^"'\n]+?)["']?\s*$/i);
  return match?.[1] ? ensurePdfFileName(match[1]) : undefined;
}

function confirmsPendingDraft(message: string) {
  const normalized = normalizeText(message);
  return /\b(guardar|guardalo|confirmar|confirmalo|crear|crealo|generar|generalo|dale|ok|listo|confirmado)\b/.test(normalized);
}

function requestsPreview(message: string) {
  return /\b(listo|terminamos|preparamelo|preparalo|prepara(?:me)?(?:\s+el)?\s+pdf|haceme\s+el\s+pdf|mostrame\s+como\s+quedo|mandame\s+el\s+borrador|quiero\s+revisarlo)\b/i.test(normalizeText(message));
}

function requestsDraftStatus(message: string) {
  return /\b(que\s+tenes\s+anotado|como\s+va\s+el\s+remito|mostrame\s+lo\s+que\s+anotaste)\b/i.test(normalizeText(message));
}

function cancelsDraft(message: string) {
  return /\b(cancela|cancelalo|cancela\s+el|borra\s+ese\s+borrador|empecemos\s+de\s+nuevo)\b/i.test(normalizeText(message));
}

function looksLikeUnrelatedQuestion(message: string) {
  return /^\s*(?:cuanto|que|qu[eé]|hay|tenemos|stock|precio|lista|buscar|mostra)/i.test(message) && !/\b(remito|presupuesto)\b/i.test(message);
}

function draftKindLabel(type: PendingDeliveryDraft['type']) {
  return type === 'quote' ? 'presupuesto' : 'remito';
}

function formatDocumentDraft(pending: PendingDeliveryDraft) {
  const items = pending.payload.items.length
    ? pending.payload.items.map((item, index) => (index + 1) + '. ' + (item.quantity || 1) + ' ' + (item.unit || 'unidad') + ' - ' + item.description).join('\n')
    : 'Sin items cargados.';
  return [
    'Borrador de ' + draftKindLabel(pending.type) + ':',
    'Cliente: ' + (pending.payload.customerName || 'Cliente pendiente'),
    'Items:',
    items,
    'Nombre sugerido: ' + pending.suggestedFileName,
    '',
    'Si esta bien, escribi "guardalo". Si queres cambiar el nombre, escribi por ejemplo: "guardalo como remito-mario-alvarez.pdf".'
  ].join('\n');
}

function wantsCustomerList(message: string) {
  const normalized = normalizeText(message);
  return /\b(clientes?|clietnnes|clietnes)\b/.test(normalized) && /\b(lista|listar|pasame|mostrame|mostrar|tenemos|cuales|quienes|ver)\b/.test(normalized);
}

function wantsCapabilities(message: string) {
  const normalized = normalizeText(message);
  return /\b(que podes hacer|que puedes hacer|ayuda|como me ayudas|para que servis|funciones)\b/.test(normalized);
}

function pendingDeliveryNote(history?: AssistantMessage[]) {
  const recent = (history ?? []).slice(-6).map((message) => normalizeText(message.content)).join('\n');
  return recent.includes('remito') && (recent.includes('necesito estos datos') || recent.includes('armar un remito') || recent.includes('borrador'));
}

function isCustomerOnlyDeliverySetup(message: string) {
  const normalized = normalizeText(message);
  const withoutCustomer = normalized
    .replace(/\b(vamos\s+a\s+armarlo|armarlo|lo\s+armamos|hacerlo|hacelo|hacer\s+remito|haceme|armame|generame|preparame|remito)\b/g, ' ')
    .replace(/\b(para|cliente)\s+[^,.;\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const hasCustomer = Boolean(firstCustomerGuess(message));
  const hasWorkVerb = /\b(retirar|retiramos|colocar|colocamos|atornillar|atornillamos|reparar|reparamos|entregar|entregamos|llevar|llevamos|instalar|instalamos|cambiar|cambiamos|hacer|hicimos|fabricar|fabricamos)\b/.test(normalized);
  return hasCustomer && !hasWorkVerb && withoutCustomer.length <= 8;
}

async function listCustomers(companyId: string) {
  const customers = await prisma.customer.findMany({
    where: { companyId },
    orderBy: { legalName: 'asc' },
    take: 80
  });
  if (!customers.length) return 'Todavia no hay clientes cargados.';

  return [
    `Clientes cargados (${customers.length}):`,
    ...customers.map((customer, index) => {
      const details = [customer.cuit ? `CUIT ${customer.cuit}` : undefined, customer.address].filter(Boolean).join(' - ');
      return `${index + 1}. ${customer.legalName}${details ? ` (${details})` : ''}`;
    })
  ].join('\n');
}

function parseLocalDraft(message: string): DraftPayload {
  const customerName = firstCustomerGuess(message);
  const currency = /\b(u\$s|usd|dolar|dolares)\b/i.test(message) ? 'USD' : 'ARS';
  const itemMatches = [...message.matchAll(/(\d+(?:[,.]\d+)?)\s*(unidades|unidad|mts|metros|kg|trabajos|trabajo|u)\s+(?:de\s+)?([^,.;\n]+?)(?:\s+(?:a|por|precio)\s*(?:\$|u\$s|usd)?\s*([\d.,]+))?(?=,|;|\.|\sy\s\d|$)/gi)];
  const items: DraftItem[] = itemMatches
    .map((match): DraftItem | null => {
      const description = match[3]?.trim();
      if (!description) return null;
      return {
      quantity: parseNumber(match[1]) ?? 1,
      unit: match[2]?.toLowerCase().startsWith('u') ? 'unidad' : match[2]?.toLowerCase() || 'unidad',
      description,
      unitPrice: parseNumber(match[4]),
      taxRate: 21
      };
    })
    .filter((item): item is DraftItem => item !== null);

  if (items.length === 0) items.push(...structuredDeliveryItemsFromMessage(message).map((item) => ({ ...item, unitPrice: 0, taxRate: 21 })));

  return { customerName, currency, items, notes: undefined };
}

export function parseFollowUpDeliveryNoteForTest(message: string): DraftPayload {
  const customerName = firstCustomerGuess(message);
  if (isCustomerOnlyDeliverySetup(message)) {
    return {
      customerName,
      currency: 'ARS',
      notes: 'Remito generado desde el asistente IA. Revisar antes de entregar.',
      items: []
    };
  }
  return {
    customerName,
    currency: 'ARS',
    notes: 'Remito generado desde el asistente IA. Revisar antes de entregar.',
    items: structuredDeliveryItemsFromMessage(message)
  };
}

async function parseOpenAiDraft(message: string, intent: DraftIntent): Promise<DraftPayload | null> {
  if (!config.OPENAI_API_KEY || intent === 'none') return null;

  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      customerName: { type: ['string', 'null'] },
      customerCuit: { type: ['string', 'null'] },
      customerAddress: { type: ['string', 'null'] },
      currency: { type: 'string', enum: ['ARS', 'USD'] },
      notes: { type: ['string', 'null'] },
      items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            description: { type: 'string' },
            quantity: { type: 'number' },
            unit: { type: 'string' },
            unitPrice: { type: ['number', 'null'] },
            taxRate: { type: ['number', 'null'] }
          },
          required: ['description', 'quantity', 'unit', 'unitPrice', 'taxRate']
        }
      }
    },
    required: ['customerName', 'customerCuit', 'customerAddress', 'currency', 'notes', 'items']
  };

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    signal: timeoutSignal(),
    headers: {
      Authorization: `Bearer ${config.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: config.OPENAI_MODEL,
      reasoning: { effort: 'low' },
      text: {
        verbosity: 'low',
        format: {
          type: 'json_schema',
          name: 'fmh_draft_request',
          strict: true,
          schema
        }
      },
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text: [
                'Extrae datos para crear un borrador operativo FMH.',
                'No inventes CUIT, precios ni direcciones.',
                'Si falta precio, usa null.',
                'Si falta cantidad, usa 1.',
                'Si falta unidad, usa "trabajo" para servicios o "unidad" para bienes.',
                'Nunca copies instrucciones conversacionales al detalle: haceme, prepará el PDF, mandamelo, guardalo o revisarlo no son ítems.'
              ].join('\n')
            }
          ]
        },
        { role: 'user', content: [{ type: 'input_text', text: `Tipo: ${intent}\nPedido: ${message}` }] }
      ],
      max_output_tokens: 700,
      store: false
    })
  });

  if (!response.ok) return null;
  const data = (await response.json()) as { output_text?: string };
  if (!data.output_text) return null;

  try {
    const parsed = JSON.parse(data.output_text) as DraftPayload;
    return {
      ...parsed,
      customerName: parsed.customerName || undefined,
      customerCuit: parsed.customerCuit || undefined,
      customerAddress: parsed.customerAddress || undefined,
      notes: parsed.notes ? sanitizeDocumentInstructions(parsed.notes) : undefined,
      items: (parsed.items || [])
        .map((item) => ({
          description: sanitizeDocumentInstructions(item.description),
          quantity: Number(item.quantity || 1),
          unit: item.unit || 'unidad',
          unitPrice: item.unitPrice === null ? undefined : parseNumber(item.unitPrice),
          taxRate: item.taxRate === null ? 21 : parseNumber(item.taxRate) ?? 21
        }))
        .filter((item) => item.description.length > 0)
        .flatMap((item) => {
          if (intent !== 'delivery_note') return [item];
          const split = structuredDeliveryItemsFromMessage(item.description);
          return split.length > 1 ? split.map((part) => ({ ...item, ...part })) : [item];
        })
    };
  } catch {
    return null;
  }
}

async function resolveCompany(companyId?: string) {
  return companyId ? prisma.company.findUnique({ where: { id: companyId } }) : prisma.company.findFirst();
}

async function resolveCustomer(input: { companyId: string; name?: string; cuit?: string; address?: string; source: string }) {
  if (input.cuit) {
    const byCuit = await prisma.customer.findFirst({ where: { companyId: input.companyId, cuit: input.cuit } });
    if (byCuit) return byCuit;
  }

  if (input.name) {
    const byName = await prisma.customer.findFirst({
      where: {
        companyId: input.companyId,
        OR: [{ legalName: { contains: input.name } }, { tradeName: { contains: input.name } }]
      }
    });
    if (byName) return byName;
  }

  return null;
}
function normalizeDraftItems(payload: DraftPayload, defaultUnitPrice: number) {
  return payload.items.map((item) => ({
    productId: undefined,
    description: item.description,
    quantity: Number(item.quantity || 1),
    unit: item.unit || 'unidad',
    unitPrice: Number(item.unitPrice ?? defaultUnitPrice),
    discount: 0,
    taxRate: Number(item.taxRate ?? 21)
  }));
}

async function createQuotePreviewDraft(companyId: string, message: string, payload: DraftPayload, suggestedFileName?: string, sourceDeliveryNoteIds?: string[]): Promise<AssistantResponse> {
  const customer = await resolveCustomer({
    companyId,
    name: payload.customerName,
    cuit: payload.customerCuit,
    address: payload.customerAddress,
    source: 'asistente IA'
  });
  const customerName = customer?.legalName || payload.customerName || 'Cliente pendiente';
  const price = explicitPrice(message);
  const description = quoteWorkDescription(message);
  const items = normalizeDraftItems({
    ...payload,
    items: payload.items.map((item) => ({
      ...item,
      description: description && (item.description.toLowerCase().includes('presupuesto') || item.description.toLowerCase().includes('costo')) ? description : item.description,
      unitPrice: item.unitPrice == null || Number(item.unitPrice) === 0 ? price : item.unitPrice
    }))
  }, 0);
  const totals = calculateQuoteTotals(items);
  const previewQuote = {
    id: 'preview', companyId, customerId: customer?.id || 'preview', number: 0, version: 1, status: 'DRAFT',
    issueDate: new Date(), validUntil: null, currency: payload.currency ?? 'ARS',
    subtotal: totals.subtotal, taxTotal: totals.taxTotal, total: totals.total, notes: payload.notes || 'Borrador para confirmacion.', createdById: null,
    customer: customer || { id: 'preview', companyId, legalName: customerName, tradeName: null, cuit: null, taxCondition: null, address: null, contactName: null, phone: null, email: null, paymentTerms: null, notes: null, createdAt: new Date() },
    items: items.map((item) => ({ id: 'preview', quoteId: 'preview', productId: null, description: item.description, quantity: item.quantity, unit: item.unit, unitPrice: item.unitPrice, discount: 0, taxRate: item.taxRate, total: item.quantity * item.unitPrice }))
  } as unknown as QuoteWithDetails;
  validateGeneratedBusinessDocument({ customerName, items });
  const rendered = await renderDocumentFromTemplate({ templateType: 'QUOTE', quote: previewQuote });
  let pdf: Buffer | null = rendered.pdf;
  if (!pdf) console.warn({ templateType: 'QUOTE', reason: rendered.fallbackReason }, 'FMH template renderer fell back to generic PDF');
  pdf ??= await renderQuotePdf({ number: 0, customerName, issueDate: new Date(), validUntil: undefined, currency: payload.currency ?? 'ARS', subtotal: totals.subtotal, taxTotal: totals.taxTotal, total: totals.total, notes: payload.notes || 'Borrador para confirmacion.', items: items.map((item) => ({ description: item.description, quantity: item.quantity.toString(), unit: item.unit, unitPrice: item.unitPrice.toString(), total: (item.quantity * item.unitPrice).toString() })) });
  const previewFileName = ensurePdfFileName(suggestedFileName || suggestedDocumentFileName('quote', payload));
  const stored = await writeDocumentFile({
    buffer: pdf,
    filename: previewFileName,
    mimeType: 'application/pdf',
    sourceType: 'ai_generated',
    companyId
  });
  const pending: PendingDeliveryDraft = {
    type: 'quote',
    payload,
    suggestedFileName: previewFileName,
    token: nanoid(),
    previewStoragePath: stored.storagePath,
    previewFileName,
    previewMimeType: 'application/pdf',
    sourceDeliveryNoteIds,
    status: 'WAITING_CONFIRMATION',
    draftVersion: 1,
    previewVersion: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + config.WHATSAPP_DOCUMENT_DRAFT_TTL_HOURS * 3600_000).toISOString(),
    rawSourceMessages: [message],
    rendererUsed: pdf && rendered.rendererUsed === 'FMH_TEMPLATE' ? 'FMH_TEMPLATE' : 'GENERIC_FALLBACK',
    rendererError: rendered.fallbackReason
  };
  return {
    mode: config.OPENAI_API_KEY ? 'openai' : 'local',
    answer: [
      'Te mande el PDF del presupuesto para ' + customerName + '.',
      'Si esta bien, respondeme "guardalo". Nombre sugerido: ' + previewFileName,
      'Si queres cambiar el nombre, respondeme "guardalo como ...".'
    ].join('\n'),
    sources: [],
    suggestions: [],
    previewDocument: {
      buffer: pdf,
      mimeType: 'application/pdf',
      filename: previewFileName
    },
    pendingDeliveryDraft: pending,
    action: { type: 'document_draft_pending' }
  };
}

async function createDeliveryNotePreviewDraft(companyId: string, message: string, payload: DraftPayload, suggestedFileName?: string): Promise<AssistantResponse> {
  const customer = await resolveCustomer({
    companyId,
    name: payload.customerName,
    cuit: payload.customerCuit,
    address: payload.customerAddress,
    source: 'remito generado por asistente IA'
  });
  const customerName = customer?.legalName || payload.customerName || 'Cliente pendiente';
  const items = payload.items.length ? payload.items : structuredDeliveryItemsFromMessage(message);
  validateGeneratedBusinessDocument({ customerName, items });
  const deliveryNoteInput = {
    number: 'borrador',
    customerName,
    issueDate: new Date(),
    notes: payload.notes,
    items: items.map((item) => ({ description: item.description, quantity: item.quantity ?? '', unit: item.unit || '' }))
  };
  const rendered = await renderDocumentFromTemplate({ templateType: 'DELIVERY_NOTE', deliveryNote: deliveryNoteInput });
  let pdf: Buffer | null = rendered.pdf;
  if (!pdf) console.warn({ templateType: 'DELIVERY_NOTE', reason: rendered.fallbackReason }, 'FMH template renderer fell back to generic PDF');
  pdf ??= await renderDeliveryNotePdf(deliveryNoteInput);
  const previewFileName = ensurePdfFileName(suggestedFileName || suggestedDocumentFileName('delivery_note', payload));
  const stored = await writeDocumentFile({
    buffer: pdf,
    filename: previewFileName,
    mimeType: 'application/pdf',
    sourceType: 'ai_generated',
    companyId
  });
  const pending: PendingDeliveryDraft = {
    type: 'delivery_note',
    payload: { ...payload, items },
    suggestedFileName: previewFileName,
    token: nanoid(),
    previewStoragePath: stored.storagePath,
    previewFileName,
    previewMimeType: 'application/pdf',
    status: 'WAITING_CONFIRMATION',
    draftVersion: 1,
    previewVersion: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + config.WHATSAPP_DOCUMENT_DRAFT_TTL_HOURS * 3600_000).toISOString(),
    rawSourceMessages: [message],
    rendererUsed: pdf && rendered.rendererUsed === 'FMH_TEMPLATE' ? 'FMH_TEMPLATE' : 'GENERIC_FALLBACK',
    rendererError: rendered.fallbackReason
  };
  return {
    mode: config.OPENAI_API_KEY ? 'openai' : 'local',
    answer: [
      'Te mande el PDF del remito para ' + customerName + '.',
      'Si esta bien, respondeme "guardalo". Nombre sugerido: ' + previewFileName,
      'Si queres cambiar el nombre, respondeme "guardalo como ...".'
    ].join('\n'),
    sources: [],
    suggestions: [],
    previewDocument: {
      buffer: pdf,
      mimeType: 'application/pdf',
      filename: previewFileName
    },
    pendingDeliveryDraft: pending,
    action: { type: 'document_draft_pending' }
  };
}

async function createQuoteDraft(companyId: string, message: string, payload: DraftPayload, fileName?: string, sourceDeliveryNoteIds?: string[]): Promise<AssistantResponse['action'] & { answer: string; sources: KnowledgeSource[] }> {
  const customer = await resolveCustomer({
    companyId,
    name: payload.customerName,
    cuit: payload.customerCuit,
    address: payload.customerAddress,
    source: 'asistente IA'
  });
  if (!customer) throw new Error('El cliente no está registrado. Confirmá el CUIT antes de guardar el presupuesto.');
  const items = normalizeDraftItems(payload, 0);
  const totals = calculateQuoteTotals(items);
  const last = await prisma.quote.findFirst({ where: { companyId }, orderBy: { number: 'desc' } });
  const number = (last?.number ?? 0) + 1;

  const quote = await prisma.quote.create({
    data: {
      companyId,
      customerId: customer.id,
      number,
      status: 'DRAFT',
      currency: payload.currency ?? 'ARS',
      notes: [payload.notes, `Origen IA: ${message}`].filter(Boolean).join('\n'),
      subtotal: totals.subtotal,
      taxTotal: totals.taxTotal,
      total: totals.total,
      items: {
        create: items.map((item, index) => ({ ...item, total: totals.lines[index]?.total ?? 0 }))
      }
    },
    include: { customer: true, items: true }
  });

  let pdf: Buffer | null = null;
  try {
    const docxPath = await writeFmhQuoteDocx(quote);
    const convertedPdfPath = await convertDocxToPdf(docxPath);
    if (convertedPdfPath) pdf = await fs.readFile(convertedPdfPath);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
  }
  pdf ??= await renderQuotePdf({
    number: quote.number,
    customerName: quote.customer.legalName,
    issueDate: quote.issueDate,
    validUntil: quote.validUntil,
    currency: quote.currency,
    subtotal: quote.subtotal.toString(),
    taxTotal: quote.taxTotal.toString(),
    total: quote.total.toString(),
    notes: quote.notes,
    items: quote.items.map((item) => ({
      description: item.description,
      quantity: item.quantity.toString(),
      unit: item.unit,
      unitPrice: item.unitPrice.toString(),
      total: item.total.toString()
    }))
  });
  const finalFileName = ensurePdfFileName(fileName || 'presupuesto-' + slugify(quote.customer.legalName) + '-' + String(quote.number).padStart(5, '0') + '.pdf') || 'presupuesto-' + slugify(quote.customer.legalName) + '-' + String(quote.number).padStart(5, '0') + '.pdf';
  const stored = await writeDocumentFile({
    buffer: pdf,
    filename: finalFileName,
    mimeType: 'application/pdf',
    sourceType: 'ai_generated',
    companyId
  });
  const document = await prisma.document.create({
    data: {
      companyId,
      kind: 'QUOTE',
      sourceType: 'ai_generated',
      fileName: finalFileName,
      mimeType: 'application/pdf',
      storagePath: stored.storagePath,
      sha256: stored.sha256,
      status: 'PENDING_REVIEW',
      extractionStatus: 'STRUCTURED',
      documentDate: quote.issueDate,
      issuerName: quote.customer.legalName,
      externalNumber: String(quote.number),
      currency: quote.currency,
      total: quote.total,
      extraction: {
        create: {
          engine: 'assistant-draft-v1',
          rawText: message,
          extractedJson: JSON.stringify({ quoteId: quote.id, payload }),
          normalizedJson: JSON.stringify({ quoteId: quote.id, payload }),
          confidence: 0.8
        }
      }
    }
  });
  if (sourceDeliveryNoteIds?.length) await linkDeliveryNotesToQuote(companyId, quote.id, sourceDeliveryNoteIds);
  return {
    type: 'quote_draft_created',
    quoteId: quote.id,
    documentId: document.id,
    answer: [
      `Listo. Cree el presupuesto borrador #${quote.number} para ${quote.customer.legalName}.`,
      `Total estimado: ${quote.currency} ${Number(quote.total).toLocaleString('es-AR')}.`,
      'Quedo guardado como borrador editable y tambien como PDF para reenviar desde WhatsApp.'
    ].join('\n'),
    sources: [
      { type: 'quote', id: quote.id, title: `Presupuesto #${quote.number}`, subtitle: quote.customer.legalName },
      { type: 'document', id: document.id, title: document.fileName, subtitle: 'Presupuesto PDF / Estructurado', url: `/api/documents/${document.id}/content` }
    ]
  };
}

async function createDeliveryNote(companyId: string, message: string, payload: DraftPayload, fileName?: string): Promise<AssistantResponse['action'] & { answer: string; sources: KnowledgeSource[] }> {
  const customer = await resolveCustomer({
    companyId,
    name: payload.customerName,
    cuit: payload.customerCuit,
    address: payload.customerAddress,
    source: 'remito generado por asistente IA'
  });
  if (!customer) throw new Error('El cliente no está registrado. Confirmá el CUIT antes de guardar el remito.');
  const count = await prisma.document.count({ where: { companyId, kind: DocumentKind.DELIVERY_NOTE, sourceType: 'ai_generated' } });
  const number = String(count + 1).padStart(5, '0');
  const items = payload.items.length ? payload.items : [{ description: message, quantity: 1, unit: 'trabajo' }];
  const issueDate = new Date();
  const deliveryNoteInput = {
    number,
    customerName: customer.legalName,
    issueDate,
    notes: payload.notes || 'Remito generado desde el asistente IA. Revisar antes de entregar.',
    items: items.map((item) => ({ description: item.description, quantity: item.quantity || 1, unit: item.unit || 'unidad' }))
  };
  let pdf: Buffer | null = null;
  try {
    const docxPath = await writeFmhDeliveryNoteDocx(deliveryNoteInput, `draft-${Date.now()}`);
    const convertedPdfPath = await convertDocxToPdf(docxPath);
    if (convertedPdfPath) pdf = await fs.readFile(convertedPdfPath);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
  }
  pdf ??= await renderDeliveryNotePdf(deliveryNoteInput);
  const filename = ensurePdfFileName(fileName || suggestedDocumentFileName('delivery_note', payload, number)) || 'remito-' + slugify(customer.legalName) + '-' + number + '.pdf';
  const stored = await writeDocumentFile({
    buffer: pdf,
    filename,
    mimeType: 'application/pdf',
    sourceType: 'ai_generated',
    companyId
  });
  const document = await prisma.document.create({
    data: {
      companyId,
      kind: 'DELIVERY_NOTE',
      sourceType: 'ai_generated',
      fileName: filename,
      mimeType: 'application/pdf',
      storagePath: stored.storagePath,
      sha256: stored.sha256,
      status: 'PENDING_REVIEW',
      extractionStatus: 'STRUCTURED',
      documentDate: issueDate,
      issuerName: customer.legalName,
      externalNumber: number,
      currency: payload.currency ?? 'ARS',
      extraction: {
        create: {
          engine: 'assistant-draft-v1',
          rawText: message,
          extractedJson: JSON.stringify({ customerId: customer.id, payload: { ...payload, items } }),
          normalizedJson: JSON.stringify({ customerId: customer.id, payload: { ...payload, items } }),
          confidence: 0.8
        }
      }
    }
  });
  const deliveryNote = await createDeliveryNoteRecord({
    companyId,
    customerId: customer.id,
    documentId: document.id,
    items: items.map((item) => ({ description: item.description, quantity: Number(item.quantity || 1), unit: item.unit || 'unidad', unitPrice: item.unitPrice, taxRate: item.taxRate })),
    notes: payload.notes,
    currency: payload.currency ?? 'ARS'
  });

  return {
    type: 'delivery_note_created',
    documentId: document.id,
    answer: [
      `Listo. Guardé el remito #${String(deliveryNote.number).padStart(5, '0')} para ${customer.legalName}.`,
      'Estado: pendiente de presupuestar o facturar.'
    ].join('\n'),
    sources: [{ type: 'document', id: document.id, title: document.fileName, subtitle: 'Remito / Estructurado', url: `/api/documents/${document.id}/content` }]
  };
}

async function buildBusinessContext(companyId?: string) {
  const company = await resolveCompany(companyId);
  if (!company) return 'No hay empresa activa cargada.';

  const [products, customers, quotes, recentDocuments] = await Promise.all([
    prisma.product.findMany({ where: { companyId: company.id, active: true }, orderBy: { name: 'asc' }, take: 80 }),
    prisma.customer.findMany({ where: { companyId: company.id }, orderBy: { legalName: 'asc' }, take: 40 }),
    prisma.quote.findMany({ where: { companyId: company.id }, include: { customer: true, items: true }, orderBy: { issueDate: 'desc' }, take: 10 }),
    prisma.document.findMany({
      where: { OR: [{ companyId: company.id }, { companyId: null }], kind: { in: ['QUOTE', 'DELIVERY_NOTE'] } },
      orderBy: { createdAt: 'desc' },
      take: 16
    })
  ]);

  return [
    `Empresa: ${company.legalName}${company.tradeName ? ` (${company.tradeName})` : ''}. CUIT: ${company.cuit}.`,
    `Clientes cargados: ${customers.map((customer) => `${customer.legalName}${customer.cuit ? ` CUIT ${customer.cuit}` : ''}`).join('; ') || 'sin clientes'}.`,
    `Productos y servicios frecuentes: ${products.map((product) => `${product.name}${product.category ? ` [${product.category}]` : ''}`).join('; ') || 'sin productos'}.`,
    `Presupuestos recientes: ${quotes.map((quote) => `#${quote.number} ${quote.customer.legalName} total ${quote.currency} ${quote.total}`).join('; ') || 'sin presupuestos'}.`,
    `Presupuestos/remitos recientes en documentos: ${recentDocuments.map((document) => `${document.fileName} (${document.kind}/${document.extractionStatus})`).join('; ') || 'sin documentos recientes'}.`
  ].join('\n');
}

function pendingCustomerGuess(message: string) {
  const match = message.match(/remitos?\s+(?:pendientes?\s+)?(?:de|del|para)\s+([^?.,;\n]+)/i) || message.match(/pendientes?\s+(?:de|del|para)\s+([^?.,;\n]+)/i);
  return match?.[1]?.trim().replace(/^cliente\s+/i, '');
}

function asksPendingDeliveryNotes(message: string) {
  const normalized = normalizeText(message);
  return normalized.includes('remito') && (normalized.includes('pendiente') || normalized.includes('pendientes')) && !/(junt|agrup|presupuesto|factur)/i.test(normalized);
}

function asksQuoteFromPendingDeliveryNotes(message: string) {
  const normalized = normalizeText(message);
  return normalized.includes('remito') && /(junt|agrup|consolid|presupuesto|factur)/i.test(normalized);
}

async function resolveCustomerForPending(companyId: string, message: string) {
  const name = pendingCustomerGuess(message) || firstCustomerGuess(message);
  if (!name) return { name: undefined, matches: [] as Array<{ id: string; legalName: string; tradeName: string | null }> };
  const matches = await prisma.customer.findMany({ where: { companyId, OR: [{ legalName: { contains: name } }, { tradeName: { contains: name } }] }, select: { id: true, legalName: true, tradeName: true }, take: 10 });
  return { name, matches };
}

async function answerPendingDeliveryNotes(companyId: string, message: string) {
  const resolved = await resolveCustomerForPending(companyId, message);
  if (!resolved.matches.length) return 'No encontré un cliente registrado con ese nombre.';
  if (resolved.matches.length > 1) return ['Encontré varios clientes:', ...resolved.matches.map((customer, index) => `${index + 1}. ${customer.legalName}${customer.tradeName ? ` (${customer.tradeName})` : ''}`), 'Decime cuál querés usar.'].join('\n');
  const notes = await listPendingDeliveryNotes(companyId, resolved.matches[0].id);
  if (!notes.length) return `No hay remitos pendientes de ${resolved.matches[0].legalName}.`;
  return [`Tenés ${notes.length} remito${notes.length === 1 ? '' : 's'} pendiente${notes.length === 1 ? '' : 's'} de ${resolved.matches[0].legalName}:`, ...notes.map((note) => `${note.number}. ${new Date(note.issueDate).toLocaleDateString('es-AR')} - ${note.items.map((item) => item.description).join('; ')}`), 'Si querés, puedo armar un presupuesto con ellos.'].join('\n');
}

async function prepareQuoteFromPendingDeliveryNotes(companyId: string, message: string) {
  const resolved = await resolveCustomerForPending(companyId, message);
  if (!resolved.matches.length) return { answer: 'No encontré un cliente registrado con ese nombre.' };
  if (resolved.matches.length > 1) return { answer: ['Encontré varios clientes:', ...resolved.matches.map((customer, index) => `${index + 1}. ${customer.legalName}`), 'Decime cuál querés usar.'].join('\n') };
  const notes = await listPendingDeliveryNotes(companyId, resolved.matches[0].id);
  if (!notes.length) return { answer: `No hay remitos pendientes de ${resolved.matches[0].legalName}.` };
  const items = notes.flatMap((note) => note.items.map((item) => ({ description: item.description, quantity: Number(item.quantity), unit: item.unit, unitPrice: item.unitPrice == null ? undefined : Number(item.unitPrice), taxRate: Number(item.taxRate) })));
  const missing = items.filter((item) => item.unitPrice == null);
  if (missing.length) return { answer: [`Encontré ${notes.length} remito${notes.length === 1 ? '' : 's'} pendientes de ${resolved.matches[0].legalName}.`, `Faltan precios para: ${missing.map((item) => item.description).join('; ')}.`, 'Indicame esos precios y preparo el PDF.'].join('\n') };
  const payload: DraftPayload = { customerName: resolved.matches[0].legalName, currency: 'ARS', items, notes: `Presupuesto consolidado desde remitos: ${notes.map((note) => note.number).join(', ')}.` };
  return createQuotePreviewDraft(companyId, message, payload, suggestedDocumentFileName('quote', payload, notes.map((note) => note.number).join('-')), notes.map((note) => note.id));
}

function localAssistant(input: AssistantInput, knowledge: string, weakPoints: string) {
  const message = input.message.toLowerCase();
  const evidence = knowledge && !knowledge.startsWith('No encontre') ? `\n\nDatos encontrados:\n${knowledge}` : '';

  if (message.includes('presupuesto')) {
    return [
      'Puedo ayudarte a armar un presupuesto FMH como borrador editable. Necesito cliente, descripcion de trabajos o productos, cantidades y precios si ya los tenes.',
      'Si faltan precios, puedo dejar lineas en cero para revisar antes de enviar.',
      evidence || 'Decime cliente, descripcion, cantidad y precio si lo tenes.'
    ].join('\n\n');
  }

  if (message.includes('remito')) {
    return [
      'Puedo armar un remito borrador y guardarlo como PDF en Documentos. Necesito cliente, cantidades y descripcion de lo entregado.',
      evidence || 'Decime cliente, cantidades y descripcion de lo entregado.'
    ].join('\n\n');
  }

  if (message.includes('arca') || message.includes('factura')) {
    return [
      'Facturas no estan disponibles por ahora desde la IA. Puedo ayudarte a preparar un presupuesto o remito borrador.',
      ''
    ].join('\n\n');
  }

  if (message.includes('debil') || message.includes('mejorar') || message.includes('problema') || message.includes('analisis')) {
    return ['Analisis operativo de puntos debiles:', weakPoints].join('\n\n');
  }

  return [
    'Puedo responder consultas y buscar datos internos de clientes, documentos, productos, precios, presupuestos y remitos.',
    config.OPENAI_API_KEY ? '' : 'Ahora estoy en modo ayuda local porque no hay OPENAI_API_KEY configurada.'
  ]
    .filter(Boolean)
    .join('\n\n');
}

async function answerWithOpenAi(input: AssistantInput, context: string, knowledge: string, weakPoints: string) {
  const system = [
    'Sos un asistente operativo para FMH/metalurgica.',
    'Ayudas con presupuestos, remitos, inventario, clientes, WhatsApp y documentos.',
    'Facturas no estan disponibles: no crees ni prometas facturas.',
    'Usa la informacion interna para responder, pero no pegues bloques crudos de contexto ni nombres de campos tecnicos.',
    'No muestres secciones de fuentes.',
    'Si faltan datos para crear un borrador, pedilos de forma concreta.',
    'Los remitos confirmados representan trabajo registrado pendiente de cobro y deben quedar pendientes hasta asociarse a un presupuesto o borrador de factura.',
    'Para consultar remitos pendientes usa únicamente los datos reales que entregue el sistema; no inventes números, fechas, clientes ni importes.',
    'Si el usuario dice guardalo, confirmado, ok o una variante equivalente, confirma el documento pendiente. La confirmación puede llegar escrita o transcripta desde un audio.',
    'Durante la preparación usa respuestas breves y claras: recibí el audio, estoy transcribiendo, estoy preparando el PDF, te lo envío para revisar.',
    'Responde en espanol argentino, claro y breve.'
  ].join('\n');

  const history = (input.history ?? []).slice(-10).map((message) => ({
    role: message.role,
    content: [{ type: 'input_text', text: message.content }]
  }));

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    signal: timeoutSignal(),
    headers: {
      Authorization: `Bearer ${config.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: config.OPENAI_MODEL,
      reasoning: { effort: 'low' },
      text: { verbosity: 'low' },
      input: [
        { role: 'system', content: [{ type: 'input_text', text: system }] },
        { role: 'user', content: [{ type: 'input_text', text: `Contexto estable:\n${context}` }] },
        { role: 'user', content: [{ type: 'input_text', text: `Busqueda interna:\n${knowledge}\n\nPuntos debiles:\n${weakPoints}` }] },
        ...history,
        { role: 'user', content: [{ type: 'input_text', text: input.message }] }
      ],
      max_output_tokens: 1000,
      store: false
    })
  });

  if (!response.ok) return null;
  const data = (await response.json()) as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
  return data.output_text ?? data.output?.flatMap((item) => item.content ?? []).map((item) => item.text).filter(Boolean).join('\n') ?? null;
}

export async function answerAssistant(input: AssistantInput): Promise<AssistantResponse> {
  const company = await resolveCompany(input.companyId);
  const companyId = company?.id;
  const suggestions = ['Buscar remitos de un cliente', 'Armar remito borrador', 'Armar presupuesto borrador', 'Analizar puntos debiles'];
  const intent = detectDraftIntent(input.message);

  if (!companyId) {
    return { mode: 'local', answer: 'No hay empresa activa cargada para consultar o guardar datos.', sources: [], suggestions };
  }

  // Un pedido explicito de un documento nuevo reemplaza cualquier borrador
  // pendiente anterior. Las confirmaciones y ajustes sin una nueva intencion
  // siguen operando sobre el borrador pendiente.
  if (input.pendingDeliveryDraft && intent === 'none') {
    const pending = input.pendingDeliveryDraft;
    if (cancelsDraft(input.message)) {
      return { mode: 'local', answer: `Cancelé el borrador de ${draftKindLabel(pending.type)}.`, sources: [], suggestions };
    }
    if (requestsDraftStatus(input.message)) {
      return {
        mode: 'local',
        answer: `${formatDocumentDraft(pending).replace(/\nNombre sugerido:[\s\S]*/m, '')}\n\nTodavía no generé el PDF.`,
        sources: [],
        suggestions,
        pendingDeliveryDraft: pending
      };
    }
    if (!requestsPreview(input.message) && !looksLikeUnrelatedQuestion(input.message)) {
      const appended = structuredDeliveryItemsFromMessage(input.message);
      if (appended.length && pending.type === 'delivery_note') {
        const correction = /\b(perdon|en realidad|fueron|corregi|reemplaza)\b/i.test(normalizeText(input.message));
        const nextItems = correction && pending.payload.items.length
          ? [...pending.payload.items.slice(0, -1), ...appended]
          : [...pending.payload.items, ...appended];
        const next: PendingDeliveryDraft = {
          ...pending,
          payload: { ...pending.payload, items: nextItems },
          status: 'COLLECTING_INFORMATION',
          draftVersion: (pending.draftVersion ?? 1) + 1,
          previewVersion: undefined,
          updatedAt: new Date().toISOString(),
          rawSourceMessages: [...(pending.rawSourceMessages ?? []), input.message]
        };
        return {
          mode: 'local',
          answer: correction ? 'Corregido en el remito. Cuando quieras, pedime el PDF.' : 'Agregado al remito. Cuando quieras, pedime el PDF.',
          sources: [], suggestions, pendingDeliveryDraft: next
        };
      }
    }
    const requestedFileName = extractRequestedFileName(input.message);
    if ((confirmsPendingDraft(input.message) || requestedFileName) && pending.status !== 'COLLECTING_INFORMATION') {
      const nextFileName = requestedFileName || input.pendingDeliveryDraft.suggestedFileName;
      const created = input.pendingDeliveryDraft.type === 'quote'
        ? await createQuoteDraft(companyId, input.message, input.pendingDeliveryDraft.payload, nextFileName, input.pendingDeliveryDraft.sourceDeliveryNoteIds)
        : await createDeliveryNote(companyId, input.message, input.pendingDeliveryDraft.payload, nextFileName);
      return {
        mode: config.OPENAI_API_KEY ? 'openai' : 'local',
        answer: created.answer,
        sources: created.sources,
        suggestions,
        action: {
          type: created.type,
          documentId: created.documentId
        }
      };
    }

    if (!requestsPreview(input.message)) {
      return { mode: 'local', answer: 'El borrador sigue abierto. Decime los trabajos, pedime el PDF o cancelalo.', sources: [], suggestions, pendingDeliveryDraft: pending };
    }
    const fileName = requestedFileName || pending.suggestedFileName;
    const preview = pending.type === 'quote'
      ? await createQuotePreviewDraft(
          companyId,
          input.message,
          pending.payload,
          fileName,
          pending.sourceDeliveryNoteIds
        )
      : await createDeliveryNotePreviewDraft(companyId, input.message, pending.payload, fileName);
    if (preview.pendingDeliveryDraft) {
      preview.pendingDeliveryDraft.draftVersion = pending.draftVersion ?? 1;
      preview.pendingDeliveryDraft.previewVersion = pending.draftVersion ?? 1;
      preview.pendingDeliveryDraft.rawSourceMessages = [...(pending.rawSourceMessages ?? []), input.message];
    }
    return preview;
  }

  if (asksPendingDeliveryNotes(input.message)) {
    return { mode: config.OPENAI_API_KEY ? 'openai' : 'local', answer: await answerPendingDeliveryNotes(companyId, input.message), sources: [], suggestions };
  }

  if (asksQuoteFromPendingDeliveryNotes(input.message)) {
    const prepared = await prepareQuoteFromPendingDeliveryNotes(companyId, input.message);
    if ('pendingDeliveryDraft' in prepared) return prepared;
    return { mode: config.OPENAI_API_KEY ? 'openai' : 'local', answer: prepared.answer, sources: [], suggestions };
  }

  if (wantsCustomerList(input.message)) {
    return {
      mode: config.OPENAI_API_KEY ? 'openai' : 'local',
      answer: await listCustomers(companyId),
      sources: [],
      suggestions
    };
  }

  if (wantsCapabilities(input.message)) {
    return {
      mode: config.OPENAI_API_KEY ? 'openai' : 'local',
      answer: [
        'Puedo ayudarte con:',
        '- buscar clientes, presupuestos, remitos, documentos y productos cargados',
        '- listar clientes o datos operativos de la base',
        '- armar borradores de remitos y presupuestos',
        '- revisar faltantes de inventario, precios o proveedores',
        '- preparar textos breves para trabajo interno o WhatsApp',
        '',
        'Por ahora no genero facturas.'
      ].join('\n'),
      sources: [],
      suggestions
    };
  }

  if (intent === 'invoice') {
    return {
      mode: config.OPENAI_API_KEY ? 'openai' : 'local',
      answer: 'Facturas no estan disponibles por ahora desde la IA. Puedo ayudarte a preparar un presupuesto o un remito borrador y dejarlo guardado en Documentos.',
      sources: [],
      suggestions,
      action: { type: 'invoice_unavailable' }
    };
  }

  if (intent === 'quote' || intent === 'delivery_note' || (pendingDeliveryNote(input.history) && firstCustomerGuess(input.message))) {
    const effectiveIntent: DraftIntent = intent === 'none' ? 'delivery_note' : intent;
    const payload =
      effectiveIntent === 'delivery_note' && (intent === 'none' || isCustomerOnlyDeliverySetup(input.message))
        ? parseFollowUpDeliveryNoteForTest(input.message)
        : (await parseOpenAiDraft(input.message, effectiveIntent)) ?? parseLocalDraft(input.message);
    const matchedCustomer = (payload.customerName || payload.customerCuit)
      ? await resolveCustomer({ companyId, name: payload.customerName, cuit: payload.customerCuit, address: payload.customerAddress, source: 'asistente IA' })
      : null;
    const missing: string[] = [];
    if (!payload.customerName && !payload.customerCuit) missing.push('cliente y CUIT');
    if (payload.items.length === 0) missing.push('items o descripcion');
      if (missing.length) {
      const answer =
        effectiveIntent === 'delivery_note' && payload.customerName && missing.length === 1 && missing[0] === 'items o descripcion'
          ? 'Perfecto, lo armamos para ' + payload.customerName + '. Decime que tenemos que agregar al remito: trabajos, materiales, cantidades o descripcion.'
          : 'Para crear el ' + (effectiveIntent === 'quote' ? 'presupuesto' : 'remito') + ' necesito estos datos: ' + missing.join(', ') + '. Pasamelos en un mensaje y lo guardo como borrador editable.';
      const collecting: PendingDeliveryDraft | undefined = effectiveIntent === 'delivery_note' && payload.customerName && missing.length === 1
        ? {
            type: 'delivery_note', payload, suggestedFileName: suggestedDocumentFileName('delivery_note', payload), token: nanoid(),
            previewStoragePath: '', previewFileName: '', previewMimeType: 'application/pdf', status: 'COLLECTING_INFORMATION',
            draftVersion: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + config.WHATSAPP_DOCUMENT_DRAFT_TTL_HOURS * 3600_000).toISOString(), rawSourceMessages: [input.message]
          }
        : undefined;
      return {
        mode: config.OPENAI_API_KEY ? 'openai' : 'local',
        answer,
        sources: [],
        suggestions,
        pendingDeliveryDraft: collecting
      };
    }

    if (effectiveIntent === 'delivery_note') {
      return await createDeliveryNotePreviewDraft(companyId, input.message, payload, suggestedDocumentFileName('delivery_note', payload));
    }

    return await createQuotePreviewDraft(companyId, input.message, payload, suggestedDocumentFileName('quote', payload));
  }

  const [context, knowledge, weakPoints] = await Promise.all([
    buildBusinessContext(companyId),
    searchBusinessKnowledge({
      companyId,
      q: input.message,
      kind: parseDocumentKindFromMessage(input.message),
      ...parseDateHints(input.message),
      take: 12
    }),
    getOperationalWeakPoints(companyId)
  ]);

  if (!config.OPENAI_API_KEY) {
    return { mode: 'local', answer: localAssistant(input, knowledge.summary, weakPoints), sources: knowledge.sources, suggestions };
  }

  const openAiAnswer = await answerWithOpenAi(input, context, knowledge.summary, weakPoints);
  return {
    mode: openAiAnswer ? 'openai' : 'local',
    answer: openAiAnswer || localAssistant(input, knowledge.summary, weakPoints),
    sources: knowledge.sources,
    suggestions
  };
}
