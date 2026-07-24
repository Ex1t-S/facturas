import type { Customer, Prisma } from '../generated/postgres-client/index.js';
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
import { runSerializableTransaction } from './transaction.js';
import {
  resolveDocumentConversationMessage,
  unsupportedWhatsAppAnswer,
  type DocumentConversationAction,
  type DocumentConversationResolution
} from './documentConversationResolver.js';
import {
  applyCommercialDraftMutation,
  commercialMenu,
  customerChangeQuery,
  documentNameChangeQuery,
  isCommercialMenuRequest,
  menuSelection,
  normalizeCommercialText,
  type CommercialDraftItem
} from './commercialConversation.js';
import { processCommercialMessageWithGraph } from './commercialAssistant/graph.js';
import type {
  CommercialConversationState,
  CommercialDraft,
  CommercialCustomer
} from './commercialAssistant/types.js';
import {
  isWhatsAppMenuRequest,
  menuState,
  parseWhatsAppCustomerInput,
  parseWhatsAppDocumentQuery,
  whatsappMainMenu,
  whatsappMenuSelection,
  type WhatsAppMenuState
} from './whatsappMenu.js';

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
  conversationId?: string;
  messageId?: string;
  message: string;
  history?: AssistantMessage[];
  pendingDeliveryDraft?: PendingDeliveryDraft;
  channel?: 'web' | 'whatsapp';
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

type DraftItem = CommercialDraftItem;

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
  status?: 'COLLECTING_INFORMATION' | 'READY_FOR_PREVIEW' | 'WAITING_CONFIRMATION' | 'FINALIZED' | 'CANCELLED' | 'EXPIRED';
  draftVersion?: number;
  previewVersion?: number;
  createdAt?: string;
  updatedAt?: string;
  expiresAt?: string;
  rawSourceMessages?: string[];
  rendererUsed?: RendererUsed;
  rendererError?: string;
  lastConversationAction?: DocumentConversationAction;
  lastConversationConfidence?: DocumentConversationResolution['confidence'];
  lastConversationReason?: string;
  awaiting?: 'customer' | 'customer_selection' | 'items' | 'prices' | 'review';
  customerCandidates?: Array<{ id: string; legalName: string; cuit?: string | null; address?: string | null }>;
  /**
   * Snapshot v2 used by the deterministic commercial state machine. The
   * legacy fields above are kept during the additive migration and remain
   * readable by previous deployments.
   */
  commercialDraft?: CommercialDraft;
  /** Persisted WhatsApp navigation state when no commercial draft is open. */
  menuState?: WhatsAppMenuState;
};

function withConversationResolution(pending: PendingDeliveryDraft, resolution: DocumentConversationResolution): PendingDeliveryDraft {
  return {
    ...pending,
    lastConversationAction: resolution.action,
    lastConversationConfidence: resolution.confidence,
    lastConversationReason: resolution.reason,
    updatedAt: new Date().toISOString()
  };
}

function wantsCreation(message: string) {
  const normalized = message.toLocaleLowerCase('es-AR');
  if (/\b(lista|listar|pasame|mostrame|mostrar|ver|buscar|busca|quienes)\b/i.test(normalized)) return false;
  return /\b(arm|cre|gener|hac|prepar|carg)/i.test(normalized);
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

const conversationalInstruction = /\b(haceme|armame|generame|preparame|prepar[aá]melo|prepar[aá](?:\s+el)?\s+pdf|(?:dame|pasame|mandame|enviame|quiero\s+que\s+me\s+pases)\s+(?:el\s+)?pdf(?:\s+final)?|mandamelo|envialo|guardalo(?:\s+como)?|para\s+revisarlo|antes\s+de\s+guardarlo|confirmalo|haceme\s+un\s+(?:remito|presupuesto))\b/gi;

/** Second line of defense: document descriptions never contain chat control language. */
export function sanitizeDocumentInstructions(value: string) {
  return value
    .replace(/^(?:agrega|agregá|agregale|agregále|añade|añadí|sumale|sumále|inclui|incluí|incluye)\s+(?:que\s+)?/i, '')
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
  const workVerb = '(?:realiz(?:ar|amos|aron|ó)|hac(?:er|emos|en)|revis(?:ar|amos|aron|ó)|sold(?:ar|amos|aron|ó)|cambi(?:ar|amos|aron|ó)|destap(?:ar|amos|aron|ó)|acort(?:ar|amos|aron|ó)|repar(?:ar|amos|aron|ó)|fabric(?:ar|amos|aron|ó)|instal(?:ar|amos|aron|ó)|abulon(?:ar|amos|aron|ó)|levant(?:ar|amos|aron|ó)|limpi(?:ar|amos|aron|ó)|coloc(?:ar|amos|aron|ó)|retir(?:ar|amos|aron|ó)|mont(?:ar|amos|aron|ó))';
  const itemSeparator = new RegExp(`\\s*[,;\\n]\\s*|\\s+(?:y|e)\\s+(?=${workVerb}\\b)|\\.\\s+(?=${workVerb}\\b)`, 'i');
  return content
    .split(itemSeparator)
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

export function requestsPreview(message: string) {
  return /\b(listo|terminamos|preparamelo|preparalo|prepara(?:me)?(?:\s+el)?\s+pdf|haceme\s+el\s+pdf|(?:dame|pasame|mandame|enviame|quiero\s+que\s+me\s+pases)\s+(?:el\s+)?pdf(?:\s+final)?|mostrame\s+como\s+quedo|mandame\s+el\s+borrador|quiero\s+revisarlo)\b/i.test(normalizeText(message));
}

function draftKindLabel(type: PendingDeliveryDraft['type']) {
  return type === 'quote' ? 'presupuesto' : 'remito';
}

function formatDocumentDraft(pending: PendingDeliveryDraft) {
  const items = pending.payload.items.length
    ? pending.payload.items.map((item, index) => {
        const price = pending.type === 'quote' ? ` — $${Number(item.unitPrice || 0).toLocaleString('es-AR')}` : '';
        return (index + 1) + '. ' + (item.quantity || 1) + ' ' + (item.unit || 'unidad') + ' - ' + item.description + price;
      }).join('\n')
    : 'Sin items cargados.';
  return [
    'Borrador de ' + draftKindLabel(pending.type) + ':',
    'Cliente: ' + (pending.payload.customerName || 'Cliente pendiente'),
    'Items:',
    items,
    'Nombre sugerido: ' + pending.suggestedFileName,
    '',
    pending.status === 'WAITING_CONFIRMATION'
      ? 'Si está bien, escribí "guardalo". Para cambiar algo, indicá el ítem y el cambio.'
      : 'Podés agregar, cambiar o borrar ítems. Cuando esté listo, pedime el PDF.'
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
  if (/\d|\$|\b(?:unidad(?:es)?|kg|metros?|mts|trabajos?|a\s+\d|por\s+\d)\b/.test(normalized)) return false;
  const withoutCustomer = normalized
    .replace(/\b(vamos\s+a\s+armarlo|armarlo|lo\s+armamos|hacerlo|hacelo|hacer\s+(?:remito|presupuesto)|haceme|armame|generame|preparame|remito|presupuesto|un)\b/g, ' ')
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

export function parseLocalDraft(message: string): DraftPayload {
  const customerName = firstCustomerGuess(message);
  const currency = /\b(u\$s|usd|dolar|dolares)\b/i.test(message) ? 'USD' : 'ARS';
  const documentOnlyRequest = /\b(?:presupuesto|remito)\b/i.test(message)
    && !/\d|\b(?:unidad(?:es)?|kg|metros?|mts|trabajo(?:s)?|material(?:es)?|item|rodamiento(?:s)?|ruleman(?:es)?|motor(?:es)?|reparaci[oó]n|soldadura|instalaci[oó]n|fabricaci[oó]n|cambio|revisi[oó]n|noria|cinta|soporte|chapa|perfil|traslado)\b/i.test(message);
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

  if (items.length === 0 && !documentOnlyRequest) items.push(...structuredDeliveryItemsFromMessage(message).map((item) => ({ ...item, unitPrice: 0, taxRate: 21 })));

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

  if (input.name) return (await resolveCustomerChoice(input.companyId, input.name)).selected;

  return null;
}

type CustomerChoice = {
  selected: Customer | null;
  candidates: Customer[];
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
};

async function resolveCustomerChoice(companyId: string, query: string): Promise<CustomerChoice> {
  const needle = normalizeCommercialText(query).replace(/\b(?:srl|sa|sas|sh)\b/g, '').trim();
  if (!needle) return { selected: null, candidates: [], confidence: 'LOW' };
  const customers = await prisma.customer.findMany({ where: { companyId }, orderBy: { legalName: 'asc' }, take: 300 });
  const normalizedCuit = query.replace(/\D/g, '');
  const exact = customers.filter((customer) => {
    const names = [customer.legalName, customer.tradeName].filter(Boolean).map((value) => normalizeCommercialText(String(value)).replace(/\b(?:srl|sa|sas|sh)\b/g, '').trim());
    return names.includes(needle) || (normalizedCuit.length >= 8 && customer.cuit?.replace(/\D/g, '') === normalizedCuit);
  });
  if (exact.length === 1) return { selected: exact[0]!, candidates: exact, confidence: 'HIGH' };
  if (exact.length > 1) return { selected: null, candidates: exact.slice(0, 5), confidence: 'MEDIUM' };

  const tokens = needle.split(' ').filter((token) => token.length >= 2);
  const partial = customers.filter((customer) => {
    const haystack = normalizeCommercialText([customer.legalName, customer.tradeName, customer.cuit].filter(Boolean).join(' '));
    return haystack.includes(needle) || (tokens.length > 0 && tokens.every((token) => haystack.includes(token)));
  });
  if (partial.length === 1) return { selected: partial[0]!, candidates: partial, confidence: 'HIGH' };
  return { selected: null, candidates: partial.slice(0, 5), confidence: partial.length ? 'MEDIUM' : 'LOW' };
}

function applyCustomerToPayload(payload: DraftPayload, customer: Customer): DraftPayload {
  return {
    ...payload,
    customerName: customer.legalName,
    customerCuit: customer.cuit || undefined,
    customerAddress: customer.address || undefined
  };
}

function withStableLineIds(items: DraftItem[]) {
  return items.map((item) => ({ ...item, lineId: item.lineId || nanoid(8) }));
}

function customerCandidatesAnswer(candidates: Customer[]) {
  return [
    'Encontré más de un cliente posible:',
    ...candidates.map((customer, index) => `${index + 1}. ${customer.legalName}${customer.cuit ? ` — CUIT ${customer.cuit}` : ''}`),
    'Respondeme con el número correcto.'
  ].join('\n');
}

function isLikelyCommercialItemEntry(message: string) {
  const normalized = normalizeCommercialText(message);
  return /\d|\b(?:unidad(?:es)?|item|material(?:es)?|trabajo(?:s)?|precio|importe|rodamiento(?:s)?|ruleman(?:es)?|motor(?:es)?|reparaci[oó]n|soldadura|instalaci[oó]n|fabricaci[oó]n|cambio|revisi[oó]n|noria|cinta|soporte|ca[nñ]o|chapa|perfil|traslado)\b/.test(normalized);
}

function createCollectingDraft(input: {
  type: 'quote' | 'delivery_note';
  payload: DraftPayload;
  sourceMessage: string;
  awaiting: PendingDeliveryDraft['awaiting'];
  candidates?: Customer[];
}): PendingDeliveryDraft {
  const now = new Date();
  const payload = { ...input.payload, items: withStableLineIds(input.payload.items) };
  return {
    type: input.type,
    payload,
    suggestedFileName: suggestedDocumentFileName(input.type, payload),
    token: nanoid(),
    previewStoragePath: '',
    previewFileName: '',
    previewMimeType: 'application/pdf',
    status: 'COLLECTING_INFORMATION',
    awaiting: input.awaiting,
    customerCandidates: input.candidates?.map(({ id, legalName, cuit, address }) => ({ id, legalName, cuit, address })),
    draftVersion: 1,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + config.WHATSAPP_DOCUMENT_DRAFT_TTL_HOURS * 3600_000).toISOString(),
    rawSourceMessages: [input.sourceMessage]
  };
}
function normalizeDraftItems(payload: DraftPayload, defaultUnitPrice: number) {
  return payload.items.map((item) => ({
    lineId: item.lineId || nanoid(8),
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
      'Preparé el remito para ' + customerName + '.',
      'Te envío el PDF para revisar.',
      '¿Lo guardo así? Nombre sugerido: ' + previewFileName,
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

async function createQuoteDraft(companyId: string, message: string, payload: DraftPayload, fileName?: string, sourceDeliveryNoteIds?: string[], commercialDraftId?: string): Promise<AssistantResponse['action'] & { answer: string; sources: KnowledgeSource[] }> {
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
  const quote = await runSerializableTransaction(async (tx) => {
    if (commercialDraftId) {
      const existing = await tx.quote.findUnique({
        where: { commercialDraftId },
        include: { customer: true, items: true }
      });
      if (existing) return existing;
    }
    const last = await tx.quote.findFirst({ where: { companyId }, orderBy: { number: 'desc' } });
    return tx.quote.create({
      data: {
        companyId,
        commercialDraftId,
        customerId: customer.id,
        number: (last?.number ?? 0) + 1,
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
  }, { retryUniqueConflict: true });

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
  const documentData = {
      companyId,
      commercialDraftId,
      kind: 'QUOTE' as const,
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
    } satisfies Prisma.DocumentUncheckedCreateInput;
  const document = commercialDraftId
    ? await prisma.document.upsert({
        where: { commercialDraftId },
        update: {},
        create: documentData
      })
    : await prisma.document.create({ data: documentData });
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
      { type: 'document', id: document.id, title: document.fileName, subtitle: 'Presupuesto PDF / Estructurado', url: `/api/documents/${document.id}/content?companyId=${encodeURIComponent(companyId)}` }
    ]
  };
}

async function createDeliveryNote(companyId: string, message: string, payload: DraftPayload, fileName?: string, commercialDraftId?: string): Promise<AssistantResponse['action'] & { answer: string; sources: KnowledgeSource[] }> {
  const customer = await resolveCustomer({
    companyId,
    name: payload.customerName,
    cuit: payload.customerCuit,
    address: payload.customerAddress,
    source: 'remito generado por asistente IA'
  });
  if (!customer) throw new Error('El cliente no está registrado. Confirmá el CUIT antes de guardar el remito.');
  const items = payload.items.length ? payload.items : [{ description: message, quantity: 1, unit: 'trabajo' }];
  const deliveryNote = await createDeliveryNoteRecord({
    companyId,
    customerId: customer.id,
    commercialDraftId,
    items: items.map((item) => ({ description: item.description, quantity: Number(item.quantity || 1), unit: item.unit || 'unidad', unitPrice: item.unitPrice, taxRate: item.taxRate })),
    notes: payload.notes,
    currency: payload.currency ?? 'ARS'
  });
  const number = String(deliveryNote.number).padStart(5, '0');
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
  const documentData = {
      companyId,
      commercialDraftId,
      kind: 'DELIVERY_NOTE' as const,
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
    } satisfies Prisma.DocumentUncheckedCreateInput;
  const document = commercialDraftId
    ? await prisma.document.upsert({
        where: { commercialDraftId },
        update: {},
        create: documentData
      })
    : await prisma.document.create({ data: documentData });
  await prisma.deliveryNote.update({ where: { id: deliveryNote.id }, data: { documentId: document.id } });

  return {
    type: 'delivery_note_created',
    documentId: document.id,
    answer: [
      `Listo. Guardé el remito #${String(deliveryNote.number).padStart(5, '0')} para ${customer.legalName}.`,
      'Estado: pendiente de presupuestar o facturar.'
    ].join('\n'),
    sources: [{ type: 'document', id: document.id, title: document.fileName, subtitle: 'Remito / Estructurado', url: `/api/documents/${document.id}/content?companyId=${encodeURIComponent(companyId)}` }]
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

function commercialStateFromLegacy(
  pending: PendingDeliveryDraft,
  customerId: string | undefined
): CommercialConversationState {
  if (pending.status === 'WAITING_CONFIRMATION') return 'WAITING_CONFIRMATION';
  if (pending.status === 'FINALIZED') return 'FINALIZED';
  if (pending.status === 'CANCELLED') return 'CANCELLED';
  if (pending.status === 'EXPIRED') return 'EXPIRED';
  if (!customerId) return pending.awaiting === 'customer_selection' ? 'SELECTING_CUSTOMER' : 'COLLECTING_CUSTOMER';
  if (!pending.payload.items.length) return 'COLLECTING_ITEMS';
  if (
    pending.type === 'quote' &&
    pending.payload.items.some((item) => item.unitPrice === undefined)
  ) {
    return 'COLLECTING_PRICES';
  }
  return 'READY_FOR_PREVIEW';
}

function hydrateCommercialDraft(value: CommercialDraft): CommercialDraft {
  return {
    ...value,
    createdAt: new Date(value.createdAt),
    updatedAt: new Date(value.updatedAt),
    expiresAt: new Date(value.expiresAt),
    items: value.items.map((item) => ({ ...item })),
    customerCandidates: value.customerCandidates?.map((customer) => ({ ...customer }))
  };
}

function commercialDraftFromPending(input: {
  pending?: PendingDeliveryDraft;
  companyId: string;
  conversationId: string;
  customers: CommercialCustomer[];
}): CommercialDraft | null {
  const pending = input.pending;
  if (!pending) return null;
  if (pending.commercialDraft) return hydrateCommercialDraft(pending.commercialDraft);
  const customer = input.customers.find((candidate) => {
    const cuitMatches = pending.payload.customerCuit &&
      candidate.cuit?.replace(/\D/g, '') === pending.payload.customerCuit.replace(/\D/g, '');
    return cuitMatches ||
      normalizeText(candidate.legalName) === normalizeText(pending.payload.customerName || '') ||
      normalizeText(candidate.tradeName || '') === normalizeText(pending.payload.customerName || '');
  });
  const now = new Date();
  const createdAt = pending.createdAt ? new Date(pending.createdAt) : now;
  const updatedAt = pending.updatedAt ? new Date(pending.updatedAt) : now;
  const expiresAt = pending.expiresAt
    ? new Date(pending.expiresAt)
    : new Date(now.getTime() + config.WHATSAPP_DOCUMENT_DRAFT_TTL_HOURS * 3600_000);
  const draft: CommercialDraft = {
    schemaVersion: 2,
    id: pending.token || nanoid(),
    conversationId: input.conversationId,
    companyId: input.companyId,
    documentType: pending.type === 'quote' ? 'QUOTE' : 'DELIVERY_NOTE',
    status: commercialStateFromLegacy(pending, customer?.id),
    customerId: customer?.id,
    customerName: customer?.legalName || pending.payload.customerName,
    customerSearchQuery: pending.payload.customerName,
    customerCandidates: pending.customerCandidates?.map((candidate) => ({
      id: candidate.id,
      legalName: candidate.legalName,
      cuit: candidate.cuit,
      address: candidate.address
    })),
    currency: pending.payload.currency === 'USD' ? 'USD' : 'ARS',
    items: pending.payload.items.map((item, index) => ({
      lineId: item.lineId || nanoid(8),
      position: index + 1,
      description: item.description,
      quantity: Number(item.quantity ?? 1),
      unit: item.unit || 'unidad',
      unitPrice: item.unitPrice === undefined ? undefined : Number(item.unitPrice),
      taxRate: item.taxRate === undefined ? undefined : Number(item.taxRate)
    })),
    suggestedFileName: pending.suggestedFileName,
    requestedFileName: pending.suggestedFileName,
    draftVersion: pending.draftVersion ?? 1,
    previewVersion: pending.previewVersion,
    previewStoragePath: pending.previewStoragePath || undefined,
    previewFileName: pending.previewFileName || undefined,
    previewMimeType: pending.previewMimeType || undefined,
    awaiting:
      pending.awaiting === 'customer' ? 'CUSTOMER' :
      pending.awaiting === 'customer_selection' ? 'CUSTOMER_SELECTION' :
      pending.awaiting === 'items' ? 'ITEMS' :
      pending.awaiting === 'prices' ? 'PRICES' :
      pending.status === 'WAITING_CONFIRMATION' ? 'CONFIRMATION' :
      undefined,
    createdAt,
    updatedAt,
    expiresAt
  };
  return draft;
}

function pendingFromCommercialDraft(
  draft: CommercialDraft,
  previous: PendingDeliveryDraft | undefined,
  customers: CommercialCustomer[],
  renderer?: Pick<PendingDeliveryDraft, 'rendererUsed' | 'rendererError'>
): PendingDeliveryDraft {
  const customer = customers.find((candidate) => candidate.id === draft.customerId);
  const status: PendingDeliveryDraft['status'] =
    draft.status === 'WAITING_CONFIRMATION' ? 'WAITING_CONFIRMATION' :
    draft.status === 'FINALIZED' ? 'FINALIZED' :
    draft.status === 'CANCELLED' ? 'CANCELLED' :
    draft.status === 'EXPIRED' ? 'EXPIRED' :
    draft.status === 'READY_FOR_PREVIEW' ? 'READY_FOR_PREVIEW' :
    'COLLECTING_INFORMATION';
  const awaiting: PendingDeliveryDraft['awaiting'] =
    draft.awaiting === 'CUSTOMER' ? 'customer' :
    draft.awaiting === 'CUSTOMER_SELECTION' ? 'customer_selection' :
    draft.awaiting === 'ITEMS' ? 'items' :
    draft.awaiting === 'PRICES' ? 'prices' :
    draft.awaiting === 'CONFIRMATION' ? 'review' :
    undefined;
  return {
    type: draft.documentType === 'QUOTE' ? 'quote' : 'delivery_note',
    payload: {
      customerName: draft.customerName,
      customerCuit: customer?.cuit || undefined,
      customerAddress: customer?.address || undefined,
      currency: draft.currency,
      notes: previous?.payload.notes,
      items: draft.items.map((item) => ({
        lineId: item.lineId,
        description: item.description,
        quantity: item.quantity,
        unit: item.unit,
        unitPrice: item.unitPrice,
        taxRate: item.taxRate
      }))
    },
    suggestedFileName: draft.requestedFileName || draft.suggestedFileName,
    token: draft.id,
    previewStoragePath: draft.previewStoragePath || '',
    previewFileName: draft.previewFileName || '',
    previewMimeType: draft.previewMimeType || 'application/pdf',
    sourceDeliveryNoteIds: previous?.sourceDeliveryNoteIds,
    status,
    draftVersion: draft.draftVersion,
    previewVersion: draft.previewVersion,
    createdAt: draft.createdAt.toISOString(),
    updatedAt: draft.updatedAt.toISOString(),
    expiresAt: draft.expiresAt.toISOString(),
    rawSourceMessages: previous?.rawSourceMessages,
    rendererUsed: renderer?.rendererUsed ?? previous?.rendererUsed,
    rendererError: renderer?.rendererError ?? previous?.rendererError,
    awaiting,
    customerCandidates: draft.customerCandidates?.map((candidate) => ({
      id: candidate.id,
      legalName: candidate.legalName,
      cuit: candidate.cuit,
      address: candidate.address
    })),
    commercialDraft: draft
  };
}

async function runCommercialAssistant(
  input: AssistantInput,
  companyId: string,
  suggestions: string[]
): Promise<AssistantResponse | null> {
  let customers = await prisma.customer.findMany({
    where: { companyId },
    select: { id: true, legalName: true, tradeName: true, cuit: true, address: true }
  });
  const conversationId = input.conversationId || `assistant:${companyId}`;
  const current = commercialDraftFromPending({
    pending: input.pendingDeliveryDraft,
    companyId,
    conversationId,
    customers
  });
  let generatedPreview: AssistantResponse | undefined;
  let finalizedResponse:
    | (AssistantResponse['action'] & { answer: string; sources: KnowledgeSource[] })
    | undefined;
  const result = await processCommercialMessageWithGraph({
    companyId,
    conversationId,
    messageId: input.messageId,
    message: input.message,
    draft: current,
    adapters: {
      customers,
      defaultCurrency: 'ARS',
      createId: () => nanoid(),
      generatePreview: async (draft, fileName) => {
        const payload: DraftPayload = {
          customerName: draft.customerName,
          customerCuit: customers.find((customer) => customer.id === draft.customerId)?.cuit || undefined,
          customerAddress: customers.find((customer) => customer.id === draft.customerId)?.address || undefined,
          currency: draft.currency,
          notes: input.pendingDeliveryDraft?.payload.notes,
          items: draft.items.map((item) => ({
            lineId: item.lineId,
            description: item.description,
            quantity: item.quantity,
            unit: item.unit,
            unitPrice: item.unitPrice,
            taxRate: item.taxRate
          }))
        };
        generatedPreview = draft.documentType === 'QUOTE'
          ? await createQuotePreviewDraft(companyId, input.message, payload, fileName, input.pendingDeliveryDraft?.sourceDeliveryNoteIds)
          : await createDeliveryNotePreviewDraft(companyId, input.message, payload, fileName);
        const pending = generatedPreview.pendingDeliveryDraft;
        if (!pending || !generatedPreview.previewDocument) throw new Error('La generación del preview no devolvió un PDF.');
        return {
          buffer: generatedPreview.previewDocument.buffer,
          storagePath: pending.previewStoragePath,
          fileName: generatedPreview.previewDocument.filename,
          mimeType: generatedPreview.previewDocument.mimeType
        };
      },
      finalizeDocument: async (draft, fileName) => {
        const customer = customers.find((candidate) => candidate.id === draft.customerId);
        const payload: DraftPayload = {
          customerName: draft.customerName,
          customerCuit: customer?.cuit || undefined,
          customerAddress: customer?.address || undefined,
          currency: draft.currency,
          notes: input.pendingDeliveryDraft?.payload.notes,
          items: draft.items.map((item) => ({
            lineId: item.lineId,
            description: item.description,
            quantity: item.quantity,
            unit: item.unit,
            unitPrice: item.unitPrice,
            taxRate: item.taxRate
          }))
        };
        finalizedResponse = draft.documentType === 'QUOTE'
          ? await createQuoteDraft(companyId, input.message, payload, fileName, input.pendingDeliveryDraft?.sourceDeliveryNoteIds, draft.id)
          : await createDeliveryNote(companyId, input.message, payload, fileName, draft.id);
        if (!finalizedResponse.documentId) throw new Error('La confirmación no devolvió el documento definitivo.');
        return { documentId: finalizedResponse.documentId };
      }
    }
  });
  if (!result.handled || result.classification.type === 'BUSINESS_QUERY') return null;
  const renderer = generatedPreview?.pendingDeliveryDraft
    ? {
        rendererUsed: generatedPreview.pendingDeliveryDraft.rendererUsed,
        rendererError: generatedPreview.pendingDeliveryDraft.rendererError
      }
    : undefined;
  const pending = result.draft
    ? pendingFromCommercialDraft(result.draft, input.pendingDeliveryDraft, customers, renderer)
    : undefined;
  return {
    mode: config.OPENAI_API_KEY ? 'openai' : 'local',
    answer: finalizedResponse?.answer || result.answer,
    sources: finalizedResponse?.sources || [],
    suggestions,
    previewDocument: result.preview?.buffer
      ? {
          buffer: result.preview.buffer,
          mimeType: result.preview.mimeType,
          filename: result.preview.fileName
        }
      : undefined,
    action: finalizedResponse
      ? {
          type: finalizedResponse.type,
          quoteId: finalizedResponse.quoteId,
          documentId: finalizedResponse.documentId
        }
      : result.preview
        ? { type: 'document_draft_pending' }
        : result.draft
          ? { type: 'document_draft_pending' }
          : undefined,
    pendingDeliveryDraft: pending
  };
}

function menuOnlyPending(state: WhatsAppMenuState): PendingDeliveryDraft {
  return { menuState: state } as PendingDeliveryDraft;
}

function pendingMenuState(pending?: PendingDeliveryDraft) {
  return pending && !pending.commercialDraft && !pending.type ? pending.menuState : undefined;
}

function formatWhatsAppDate(value: Date) {
  return value.toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
}

function parseQueryDate(value?: string) {
  if (!value) return undefined;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const start = new Date(year, month - 1, day);
  if (start.getFullYear() !== year || start.getMonth() !== month - 1 || start.getDate() !== day) return undefined;
  const end = new Date(year, month - 1, day + 1);
  return { start, end };
}

async function answerWhatsAppDocumentQuery(companyId: string, state: WhatsAppMenuState, message: string) {
  const parsed = parseWhatsAppDocumentQuery(message);
  const customerQuery = parsed.customerQuery || state.customerQuery;
  const date = parsed.date || state.date;
  if (!customerQuery) {
    return { answer: 'Para consultar, escribi el nombre del cliente. Tambien necesito la fecha (DD/MM/AAAA).', state: menuState('DOCUMENT_QUERY') };
  }
  if (!date) {
    return { answer: `Cliente: ${customerQuery}. Ahora escribi la fecha en formato DD/MM/AAAA.`, state: menuState('DOCUMENT_QUERY', { customerQuery }) };
  }
  const range = parseQueryDate(date);
  if (!range) return { answer: 'No pude interpretar la fecha. Usá el formato DD/MM/AAAA, por ejemplo 23/07/2026.', state: menuState('DOCUMENT_QUERY', { customerQuery }) };

  let customers = await prisma.customer.findMany({
    where: {
      companyId,
      OR: [
        { legalName: { contains: customerQuery } },
        { tradeName: { contains: customerQuery } }
      ]
    },
    select: { id: true, legalName: true, tradeName: true },
    take: 10,
    orderBy: { legalName: 'asc' }
  });
  if (!customers.length) {
    const normalizedQuery = normalizeText(customerQuery).trim();
    const fallback = await prisma.customer.findMany({
      where: { companyId },
      select: { id: true, legalName: true, tradeName: true },
      take: 1000,
      orderBy: { legalName: 'asc' }
    });
    customers = fallback.filter((customer) =>
      normalizeText(customer.legalName).includes(normalizedQuery)
      || Boolean(customer.tradeName && normalizeText(customer.tradeName).includes(normalizedQuery))
    ).slice(0, 10);
  }
  if (!customers.length) {
    return { answer: `No encontre un cliente que coincida con "${customerQuery}". Revisá el nombre e intentá de nuevo.`, state: menuState('DOCUMENT_QUERY') };
  }
  const customerIds = customers.map((customer) => customer.id);
  const [quotes, deliveryNotes] = await Promise.all([
    prisma.quote.findMany({
      where: { companyId, customerId: { in: customerIds }, issueDate: { gte: range.start, lt: range.end } },
      select: { number: true, status: true, currency: true, total: true, issueDate: true, customer: { select: { legalName: true } } },
      orderBy: { issueDate: 'desc' }
    }),
    prisma.deliveryNote.findMany({
      where: { companyId, customerId: { in: customerIds }, issueDate: { gte: range.start, lt: range.end } },
      select: { number: true, status: true, issueDate: true, projectName: true, customer: { select: { legalName: true } }, items: { select: { description: true }, take: 5 } },
      orderBy: { issueDate: 'desc' }
    })
  ]);
  const lines = [`Consulta para ${customers[0]!.legalName} · ${formatWhatsAppDate(range.start)}`];
  if (quotes.length) {
    lines.push('', 'Presupuestos:');
    for (const quote of quotes) lines.push(`- #${quote.number} · ${quote.status} · ${quote.currency} ${Number(quote.total).toLocaleString('es-AR')}`);
  }
  if (deliveryNotes.length) {
    lines.push('', 'Remitos:');
    for (const note of deliveryNotes) lines.push(`- #${note.number} · ${note.status}${note.projectName ? ` · ${note.projectName}` : ''}${note.items.length ? ` · ${note.items.map((item) => item.description).join('; ')}` : ''}`);
  }
  if (!quotes.length && !deliveryNotes.length) lines.push('', 'No hay remitos ni presupuestos para ese cliente en esa fecha.');
  return { answer: lines.join('\n'), state: undefined };
}

async function answerWhatsAppMenuFlow(input: AssistantInput, companyId: string, suggestions: string[]) {
  const currentState = pendingMenuState(input.pendingDeliveryDraft);
  const route = whatsappMenuSelection(input.message, currentState, input.history);
  if (isWhatsAppMenuRequest(input.message) || route === 'menu') {
    const pending = input.pendingDeliveryDraft?.commercialDraft ? input.pendingDeliveryDraft : menuOnlyPending(menuState('ROOT'));
    return { mode: 'local' as const, answer: whatsappMainMenu, sources: [] as KnowledgeSource[], suggestions, pendingDeliveryDraft: pending };
  }
  if (route === 'delivery_note' || route === 'quote') {
    if (input.pendingDeliveryDraft?.commercialDraft) {
      return { mode: 'local' as const, answer: 'Ya tenés un borrador abierto. Guardalo o cancelalo antes de iniciar otro documento.', sources: [] as KnowledgeSource[], suggestions, pendingDeliveryDraft: input.pendingDeliveryDraft };
    }
    const started = await answerAssistant({
      ...input,
      channel: 'whatsapp',
      message: route === 'quote' ? 'Quiero armar un presupuesto' : 'Quiero armar un remito',
      pendingDeliveryDraft: undefined
    });
    const instruction = route === 'quote'
      ? 'Podés escribir el cliente y los trabajos/productos del presupuesto.'
      : 'Podés enviarme un audio con el remito o escribir los trabajos realizados.';
    return { ...started, answer: `${started.answer}\n\n${instruction}` };
  }
  if (route === 'customers') {
    return { mode: 'local' as const, answer: 'Agregar cliente. Escribí el nombre y, si querés, CUIT, teléfono, email y domicilio. Ejemplo: Mario Alvarez, CUIT 20-12345678-9, teléfono 2923 555555.', sources: [], suggestions, pendingDeliveryDraft: menuOnlyPending(menuState('CUSTOMER_ADD')) };
  }
  if (route === 'document_query') {
    return { mode: 'local' as const, answer: 'Consulta de documentos. Escribí nombre del cliente y fecha (DD/MM/AAAA). Ejemplo: Mario Alvarez 23/07/2026.', sources: [], suggestions, pendingDeliveryDraft: menuOnlyPending(menuState('DOCUMENT_QUERY')) };
  }
  if (currentState?.mode === 'CUSTOMER_ADD') {
    const customer = parseWhatsAppCustomerInput(input.message);
    if (!customer) return { mode: 'local' as const, answer: 'Necesito al menos el nombre del cliente.', sources: [], suggestions, pendingDeliveryDraft: menuOnlyPending(currentState) };
    const created = await prisma.customer.create({
      data: {
        companyId,
        legalName: customer.legalName,
        cuit: customer.cuit && customer.cuit.length === 11 ? customer.cuit : undefined,
        phone: customer.phone,
        email: customer.email,
        address: customer.address
      },
      select: { id: true, legalName: true, cuit: true }
    });
    return { mode: 'local' as const, answer: `Cliente agregado: ${created.legalName}${created.cuit ? ` · CUIT ${created.cuit}` : ''}.`, sources: [], suggestions };
  }
  if (currentState?.mode === 'DOCUMENT_QUERY') {
    const result = await answerWhatsAppDocumentQuery(companyId, currentState, input.message);
    return { mode: 'local' as const, answer: result.answer, sources: [], suggestions, pendingDeliveryDraft: result.state ? menuOnlyPending(result.state) : undefined };
  }
  return null;
}

export async function answerAssistant(input: AssistantInput): Promise<AssistantResponse> {
  const company = await resolveCompany(input.companyId);
  const companyId = company?.id;
  const suggestions = ['Buscar remitos de un cliente', 'Armar remito borrador', 'Armar presupuesto borrador', 'Analizar puntos debiles'];
  const selectedMenuOption = menuSelection(input.message, input.history);
  const intent: DraftIntent = selectedMenuOption === 'quote' || selectedMenuOption === 'delivery_note' || selectedMenuOption === 'invoice'
    ? selectedMenuOption
    : detectDraftIntent(input.message);

  if (!companyId) {
    return { mode: 'local', answer: 'No hay empresa activa cargada para consultar o guardar datos.', sources: [], suggestions };
  }

  if (input.channel === 'whatsapp') {
    const whatsappResponse = await answerWhatsAppMenuFlow(input, companyId, suggestions);
    if (whatsappResponse) return whatsappResponse;
  }

  if (isCommercialMenuRequest(input.message) || selectedMenuOption === 'menu') {
    return { mode: 'local', answer: commercialMenu, sources: [], suggestions, pendingDeliveryDraft: input.pendingDeliveryDraft };
  }
  if (selectedMenuOption === 'pending_documents') {
    return { mode: 'local', answer: 'Decime el cliente y te muestro sus remitos o presupuestos pendientes.', sources: [], suggestions };
  }
  if (selectedMenuOption === 'search') {
    return { mode: 'local', answer: 'Decime qué cliente o producto querés buscar.', sources: [], suggestions };
  }

  const conversationResolution = resolveDocumentConversationMessage({
    message: input.message,
    hasActiveDraft: Boolean(input.pendingDeliveryDraft),
    waitingConfirmation: input.pendingDeliveryDraft?.status === 'WAITING_CONFIRMATION'
  });

  if (conversationResolution.action === 'UNSUPPORTED') {
    return {
      mode: 'local',
      answer: unsupportedWhatsAppAnswer(conversationResolution.reason),
      sources: [],
      suggestions,
      pendingDeliveryDraft: input.pendingDeliveryDraft
        ? withConversationResolution(input.pendingDeliveryDraft, conversationResolution)
        : undefined
    };
  }

  // La cancelación se procesa dentro de runCommercialAssistant para que la
  // transición CANCEL_DRAFT se persista también en CommercialDraft. Antes se
  // devolvía undefined aquí y quedaba un borrador activo fantasma en la base.
  if (!input.pendingDeliveryDraft && conversationResolution.action === 'CANCEL_DOCUMENT') {
    return {
      mode: 'local',
      answer: 'No hay un borrador activo. Si querés, elegí Remito o Presupuesto para empezar uno nuevo.',
      sources: [],
      suggestions
    };
  }

  // Una consulta se responde fuera del borrador y luego se restaura su contexto.
  // Así una pregunta de stock o documentos nunca termina dentro del detalle.
  if (input.pendingDeliveryDraft && conversationResolution.action === 'QUERY') {
    const queryResponse = await answerAssistant({ ...input, pendingDeliveryDraft: undefined });
    return {
      ...queryResponse,
      pendingDeliveryDraft: withConversationResolution(input.pendingDeliveryDraft, conversationResolution)
    };
  }

  // Commercial creation and every mutation of an active draft go through the
  // same deterministic classifier/state machine. Legacy code below remains as
  // a compatibility fallback for non-commercial assistant features.
  const commercialResponse = await runCommercialAssistant(input, companyId, suggestions);
  if (commercialResponse) return commercialResponse;

  if (input.pendingDeliveryDraft?.awaiting === 'customer_selection' && input.pendingDeliveryDraft.customerCandidates?.length) {
    const selectedIndex = Number(normalizeCommercialText(input.message)) - 1;
    const selected = input.pendingDeliveryDraft.customerCandidates[selectedIndex];
    if (!selected) {
      return {
        mode: 'local',
        answer: 'Elegí uno de los números de cliente que te mostré, o escribí "cancelar".',
        sources: [], suggestions, pendingDeliveryDraft: input.pendingDeliveryDraft
      };
    }
    const nextPayload = {
      ...input.pendingDeliveryDraft.payload,
      customerName: selected.legalName,
      customerCuit: selected.cuit || undefined,
      customerAddress: selected.address || undefined
    };
    const next = {
      ...input.pendingDeliveryDraft,
      payload: nextPayload,
      customerCandidates: undefined,
      awaiting: nextPayload.items.length ? ('review' as const) : ('items' as const),
      suggestedFileName: suggestedDocumentFileName(input.pendingDeliveryDraft.type, nextPayload),
      updatedAt: new Date().toISOString()
    };
    return {
      mode: 'local',
      answer: `Seleccioné a ${selected.legalName}. ${nextPayload.items.length ? 'Revisá los ítems o pedime el PDF.' : 'Ahora decime los ítems o trabajos.'}`,
      sources: [], suggestions, pendingDeliveryDraft: next
    };
  }

  if (input.pendingDeliveryDraft?.awaiting === 'customer') {
    const query = firstCustomerGuess(input.message) || input.message.trim();
    const choice = await resolveCustomerChoice(companyId, query);
    if (choice.selected) {
      const nextPayload = applyCustomerToPayload(input.pendingDeliveryDraft.payload, choice.selected);
      const next = {
        ...input.pendingDeliveryDraft,
        payload: nextPayload,
        awaiting: nextPayload.items.length ? ('review' as const) : ('items' as const),
        suggestedFileName: suggestedDocumentFileName(input.pendingDeliveryDraft.type, nextPayload),
        updatedAt: new Date().toISOString()
      };
      return { mode: 'local', answer: `Seleccioné a ${choice.selected.legalName}. Ahora decime los ítems o trabajos.`, sources: [], suggestions, pendingDeliveryDraft: next };
    }
    if (choice.candidates.length) {
      return {
        mode: 'local', answer: customerCandidatesAnswer(choice.candidates), sources: [], suggestions,
        pendingDeliveryDraft: { ...input.pendingDeliveryDraft, awaiting: 'customer_selection', customerCandidates: choice.candidates }
      };
    }
    return { mode: 'local', answer: `No encontré un cliente registrado que coincida con "${query}". Probá con la razón social, alias o CUIT.`, sources: [], suggestions, pendingDeliveryDraft: input.pendingDeliveryDraft };
  }

  if (input.pendingDeliveryDraft) {
    const requestedName = documentNameChangeQuery(input.message);
    if (requestedName) {
      const nextFileName = ensurePdfFileName(requestedName);
      const next = {
        ...input.pendingDeliveryDraft,
        suggestedFileName: nextFileName,
        updatedAt: new Date().toISOString()
      };
      return {
        mode: 'local',
        answer: `Cambié el nombre sugerido a ${nextFileName}. Cuando quieras, pedime el PDF o decime "guardalo".`,
        sources: [], suggestions,
        pendingDeliveryDraft: next
      };
    }
    const changedCustomer = customerChangeQuery(input.message);
    if (changedCustomer) {
      const choice = await resolveCustomerChoice(companyId, changedCustomer);
      if (choice.selected) {
        const payload = applyCustomerToPayload(input.pendingDeliveryDraft.payload, choice.selected);
        const next = {
          ...input.pendingDeliveryDraft,
          payload,
          suggestedFileName: suggestedDocumentFileName(input.pendingDeliveryDraft.type, payload),
          status: 'COLLECTING_INFORMATION' as const,
          awaiting: payload.items.length ? ('review' as const) : ('items' as const),
          draftVersion: (input.pendingDeliveryDraft.draftVersion ?? 1) + 1,
          previewVersion: undefined,
          updatedAt: new Date().toISOString()
        };
        return { mode: 'local', answer: `Cambié el cliente a ${choice.selected.legalName}. El preview anterior quedó invalidado.`, sources: [], suggestions, pendingDeliveryDraft: next };
      }
      if (choice.candidates.length) {
        return {
          mode: 'local', answer: customerCandidatesAnswer(choice.candidates), sources: [], suggestions,
          pendingDeliveryDraft: { ...input.pendingDeliveryDraft, awaiting: 'customer_selection', customerCandidates: choice.candidates }
        };
      }
      return { mode: 'local', answer: `No encontré el cliente "${changedCustomer}". No modifiqué el borrador.`, sources: [], suggestions, pendingDeliveryDraft: input.pendingDeliveryDraft };
    }

    const mutation = applyCommercialDraftMutation(input.message, input.pendingDeliveryDraft.payload.items);
    if (mutation.status !== 'not_a_mutation') {
      if (mutation.status !== 'applied') {
        return { mode: 'local', answer: mutation.message || 'No pude identificar el ítem.', sources: [], suggestions, pendingDeliveryDraft: input.pendingDeliveryDraft };
      }
      const next = {
        ...input.pendingDeliveryDraft,
        payload: { ...input.pendingDeliveryDraft.payload, items: mutation.items as DraftItem[] },
        status: 'COLLECTING_INFORMATION' as const,
        awaiting: mutation.items.length ? ('review' as const) : ('items' as const),
        draftVersion: (input.pendingDeliveryDraft.draftVersion ?? 1) + 1,
        previewVersion: undefined,
        updatedAt: new Date().toISOString(),
        rawSourceMessages: [...(input.pendingDeliveryDraft.rawSourceMessages ?? []), input.message]
      };
      return { mode: 'local', answer: `${mutation.message} Cuando quieras, pedime el resumen o el PDF actualizado.`, sources: [], suggestions, pendingDeliveryDraft: next };
    }
  }

  const collectingItemEntry = Boolean(
    input.pendingDeliveryDraft &&
    (input.pendingDeliveryDraft.awaiting === 'items' || input.pendingDeliveryDraft.awaiting === 'prices') &&
    isLikelyCommercialItemEntry(input.message)
  );

  if (
    input.pendingDeliveryDraft &&
    conversationResolution.action === 'AMBIGUOUS' &&
    !collectingItemEntry
  ) {
    return {
      mode: 'local',
      answer: `No estoy seguro de si eso va en el ${draftKindLabel(input.pendingDeliveryDraft.type)} abierto o si es otra consulta. Decime si querés que lo agregue.`,
      sources: [],
      suggestions,
      pendingDeliveryDraft: withConversationResolution(input.pendingDeliveryDraft, conversationResolution)
    };
  }

  // Un pedido explicito de un documento nuevo reemplaza cualquier borrador
  // pendiente anterior. Las confirmaciones y ajustes sin una nueva intencion
  // siguen operando sobre el borrador pendiente.
  if (input.pendingDeliveryDraft && intent === 'none') {
    const pending = withConversationResolution(input.pendingDeliveryDraft, conversationResolution);
    if (conversationResolution.action === 'CANCEL_DOCUMENT') {
      return { mode: 'local', answer: `Cancelé el borrador de ${draftKindLabel(pending.type)}.`, sources: [], suggestions };
    }
    if (conversationResolution.action === 'ASK_DRAFT_STATUS') {
      return {
        mode: 'local',
        answer: `${formatDocumentDraft(pending).replace(/\nNombre sugerido:[\s\S]*/m, '')}\n\nTodavía no generé el PDF.`,
        sources: [],
        suggestions,
        pendingDeliveryDraft: pending
      };
    }
    if (
      conversationResolution.action === 'APPEND_TO_DOCUMENT_DRAFT' ||
      conversationResolution.action === 'UPDATE_DOCUMENT_DRAFT' ||
      (pending.awaiting === 'items' || pending.awaiting === 'prices') && collectingItemEntry
    ) {
      const parsed = pending.type === 'quote'
        ? (await parseOpenAiDraft(input.message, 'quote')) ?? parseLocalDraft(input.message)
        : parseFollowUpDeliveryNoteForTest(input.message);
      const appended = withStableLineIds(parsed.items);
      if (appended.length) {
        const nextItems = [...pending.payload.items, ...appended];
        const next: PendingDeliveryDraft = {
          ...pending,
          payload: { ...pending.payload, items: nextItems },
          status: 'COLLECTING_INFORMATION',
          awaiting: pending.type === 'quote' && nextItems.some((item) => item.unitPrice === undefined || Number(item.unitPrice) <= 0) ? 'prices' : 'review',
          draftVersion: (pending.draftVersion ?? 1) + 1,
          previewVersion: undefined,
          updatedAt: new Date().toISOString(),
          rawSourceMessages: [...(pending.rawSourceMessages ?? []), input.message]
        };
        return {
          mode: 'local',
          answer: `Agregado al ${draftKindLabel(pending.type)}. Cuando quieras, pedime el resumen o el PDF.`,
          sources: [], suggestions, pendingDeliveryDraft: next
        };
      }
      return {
        mode: 'local',
        answer: `No pude identificar con seguridad el trabajo. Decímelo de otra forma y lo agrego al ${draftKindLabel(pending.type)}.`,
        sources: [],
        suggestions,
        pendingDeliveryDraft: pending
      };
    }
    const requestedFileName = extractRequestedFileName(input.message);
    if (conversationResolution.action === 'CONFIRM_DOCUMENT') {
      if (pending.status !== 'WAITING_CONFIRMATION' || pending.previewVersion !== pending.draftVersion) {
        return {
          mode: 'local',
          answer: 'Antes de guardarlo necesito generar el PDF actualizado. Pedime el PDF para revisarlo.',
          sources: [],
          suggestions,
          pendingDeliveryDraft: pending
        };
      }
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

    if (conversationResolution.action !== 'REQUEST_PREVIEW') {
      return { mode: 'local', answer: 'El borrador sigue abierto. Decime los trabajos, pedime el PDF o cancelalo.', sources: [], suggestions, pendingDeliveryDraft: pending };
    }
    if (!pending.payload.customerName && !pending.payload.customerCuit) {
      return {
        mode: 'local', answer: 'Antes del PDF necesito seleccionar el cliente. Decime la razón social, alias o CUIT.', sources: [], suggestions,
        pendingDeliveryDraft: { ...pending, awaiting: 'customer' }
      };
    }
    if (!pending.payload.items.length) {
      return {
        mode: 'local', answer: `Antes del PDF necesito al menos un ítem en el ${draftKindLabel(pending.type)}.`, sources: [], suggestions,
        pendingDeliveryDraft: { ...pending, awaiting: 'items' }
      };
    }
    if (pending.type === 'quote') {
      const missingPrices = pending.payload.items
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item.unitPrice === undefined || Number(item.unitPrice) <= 0);
      if (missingPrices.length) {
        return {
          mode: 'local',
          answer: ['Antes del PDF faltan precios:', ...missingPrices.map(({ item, index }) => `${index + 1}. ${item.description}`), 'Podés decir, por ejemplo: "cambiá el precio del ítem 1 a 50000".'].join('\n'),
          sources: [], suggestions,
          pendingDeliveryDraft: { ...pending, awaiting: 'prices' }
        };
      }
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
    const customerOnly = isCustomerOnlyDeliverySetup(input.message) || Boolean(selectedMenuOption);
    const localPayload = parseLocalDraft(input.message);
    const aiPayload = customerOnly ? null : await parseOpenAiDraft(input.message, effectiveIntent);
    let payload: DraftPayload = customerOnly
      ? {
          customerName: firstCustomerGuess(input.message),
          currency: /\b(u\$s|usd|dolar|dolares)\b/i.test(input.message) ? 'USD' : 'ARS',
          notes: effectiveIntent === 'delivery_note' ? 'Remito generado desde el asistente IA. Revisar antes de entregar.' : undefined,
          items: []
        }
      : {
          ...(aiPayload ?? localPayload),
          customerName: aiPayload?.customerName || localPayload.customerName,
          customerCuit: aiPayload?.customerCuit || localPayload.customerCuit,
          customerAddress: aiPayload?.customerAddress || localPayload.customerAddress,
          items: aiPayload?.items?.length ? aiPayload.items : localPayload.items
        };

    const deterministicCustomer = firstCustomerGuess(input.message);
    if (deterministicCustomer) payload.customerName = deterministicCustomer;
    payload = { ...payload, items: withStableLineIds(payload.items) };

    const customerQuery = payload.customerCuit || payload.customerName;
    const customerChoice = customerQuery ? await resolveCustomerChoice(companyId, customerQuery) : null;
    if (customerChoice?.selected) payload = applyCustomerToPayload(payload, customerChoice.selected);

    if (customerChoice && !customerChoice.selected && customerChoice.candidates.length) {
      const collecting = createCollectingDraft({
        type: effectiveIntent as 'quote' | 'delivery_note', payload, sourceMessage: input.message,
        awaiting: 'customer_selection', candidates: customerChoice.candidates
      });
      return { mode: 'local', answer: customerCandidatesAnswer(customerChoice.candidates), sources: [], suggestions, pendingDeliveryDraft: collecting, action: { type: 'document_draft_pending' } };
    }

    if (!customerChoice?.selected) {
      const collecting = createCollectingDraft({ type: effectiveIntent as 'quote' | 'delivery_note', payload, sourceMessage: input.message, awaiting: 'customer' });
      const answer = customerQuery
        ? `No encontré un cliente registrado que coincida con "${customerQuery}". Escribime la razón social, alias o CUIT.`
        : `Para crear el ${effectiveIntent === 'quote' ? 'presupuesto' : 'remito'} necesito seleccionar el cliente. Escribime la razón social, alias o CUIT.`;
      return { mode: 'local', answer, sources: [], suggestions, pendingDeliveryDraft: collecting, action: { type: 'document_draft_pending' } };
    }

    if (!payload.items.length) {
      const collecting = createCollectingDraft({ type: effectiveIntent as 'quote' | 'delivery_note', payload, sourceMessage: input.message, awaiting: 'items' });
      const answer = effectiveIntent === 'quote'
        ? `Seleccioné a ${payload.customerName}. Decime los productos o trabajos, cantidades y precios del presupuesto.`
        : `Seleccioné a ${payload.customerName}. Mandame los trabajos o materiales del remito.`;
      return { mode: 'local', answer, sources: [], suggestions, pendingDeliveryDraft: collecting, action: { type: 'document_draft_pending' } };
    }

    if (effectiveIntent === 'quote' && payload.items.some((item) => item.unitPrice === undefined || Number(item.unitPrice) <= 0)) {
      const collecting = createCollectingDraft({ type: 'quote', payload, sourceMessage: input.message, awaiting: 'prices' });
      return {
        mode: 'local',
        answer: `${formatDocumentDraft(collecting)}\n\nFaltan uno o más precios. Indicame el precio por ítem antes de generar el PDF.`,
        sources: [], suggestions, pendingDeliveryDraft: collecting, action: { type: 'document_draft_pending' }
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
