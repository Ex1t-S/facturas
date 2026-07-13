import { DocumentKind } from '../generated/postgres-client/index.js';
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
import { renderDeliveryNotePdf, renderQuotePdf } from './pdf.js';

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
  action?: {
    type: 'quote_draft_created' | 'delivery_note_created' | 'delivery_note_draft_pending' | 'invoice_unavailable';
    quoteId?: string;
    documentId?: string;
  };
  pendingDeliveryDraft?: PendingDeliveryDraft;
};

type DraftIntent = 'quote' | 'delivery_note' | 'invoice' | 'none';

type DraftItem = {
  description: string;
  quantity: number;
  unit: string;
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
  type: 'delivery_note';
  payload: DraftPayload;
  suggestedFileName: string;
};

function wantsCreation(message: string) {
  const normalized = message.toLocaleLowerCase('es-AR');
  if (/\b(lista|listar|pasame|mostrame|mostrar|ver|buscar|busca|quienes)\b/i.test(normalized)) return false;
  return /\b(arm|cre|gener|hac|prepar|carg|guard)/i.test(normalized);
}

export function detectDraftIntent(message: string): DraftIntent {
  const normalized = message.toLocaleLowerCase('es-AR');
  if (!wantsCreation(normalized)) return 'none';
  if (normalized.includes('factura')) return 'invoice';
  if (normalized.includes('remito')) return 'delivery_note';
  if (normalized.includes('presupuesto')) return 'quote';
  return 'none';
}

function parseNumber(value?: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return undefined;
  const parsed = Number(value.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function firstCustomerGuess(message: string) {
  const match = message.match(/\b(?:para|cliente)\s+([^,.;\n]+?)(?:\s+con\b|\s+por\b|\s+de\b|,|\.|;|$)/i);
  return match?.[1]?.trim();
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

function suggestedDeliveryFileName(payload: DraftPayload) {
  return safeFileName(`remito-${slugify(payload.customerName || 'cliente-pendiente')}-${todayIsoDate()}.pdf`);
}

function ensurePdfFileName(value: string) {
  const cleaned = safeFileName(value.trim().replace(/^["']|["']$/g, ''));
  if (!cleaned) return '';
  return cleaned.toLowerCase().endsWith('.pdf') ? cleaned : `${cleaned}.pdf`;
}

function extractRequestedFileName(message: string) {
  const match = message.match(/\b(?:como|nombre|archivo)\s+["']?([^"'\n]+?\.pdf|[^"'\n]+?)["']?\s*$/i);
  return match?.[1] ? ensurePdfFileName(match[1]) : undefined;
}

function confirmsPendingDraft(message: string) {
  const normalized = normalizeText(message);
  return /\b(guardar|guardalo|confirmar|confirmalo|crear|crealo|generar|generalo|dale|ok|listo)\b/.test(normalized);
}

function formatDeliveryDraft(pending: PendingDeliveryDraft) {
  const items = pending.payload.items.length
    ? pending.payload.items.map((item, index) => `${index + 1}. ${item.quantity || 1} ${item.unit || 'unidad'} - ${item.description}`).join('\n')
    : 'Sin items cargados.';
  return [
    'Borrador de remito:',
    `Cliente: ${pending.payload.customerName || 'Cliente pendiente'}`,
    'Items:',
    items,
    `Nombre sugerido: ${pending.suggestedFileName}`,
    '',
    'Si esta bien, escribi "guardalo". Si queres cambiar el nombre, escribi por ejemplo: "guardalo como remito-mario-alvarez-espira.pdf".'
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
    .replace(/\b(vamos\s+a\s+armarlo|armarlo|lo\s+armamos|hacerlo|hacelo|hacer\s+remito|remito)\b/g, ' ')
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

  if (items.length === 0) {
    const description = message
      .replace(/\b(armame|arma|crear|crea|generar|genera|hacer|hace|preparar|prepara)\b/gi, '')
      .replace(/\b(un|una)?\s*(presupuesto|remito|factura)\b/gi, '')
      .trim();
    if (description.length > 12) {
      items.push({ description, quantity: 1, unit: 'trabajo', unitPrice: 0, taxRate: 21 });
    }
  }

  return { customerName, currency, items, notes: 'Borrador generado desde el asistente IA. Revisar antes de enviar.' };
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
  const description = message
    .replace(/\bpara\s+([^,.;\n]+?)(?:,|$)/i, '')
    .replace(/\b(armame|arma|crear|crea|generar|genera|hacer|hace|preparar|prepara|remito)\b/gi, '')
    .trim();
  return {
    customerName,
    currency: 'ARS',
    notes: 'Remito generado desde el asistente IA. Revisar antes de entregar.',
    items: description ? [{ description, quantity: 1, unit: 'trabajo' }] : []
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
                'Si falta unidad, usa "trabajo" para servicios o "unidad" para bienes.'
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
      notes: parsed.notes || 'Borrador generado desde el asistente IA. Revisar antes de enviar.',
      items: (parsed.items || [])
        .map((item) => ({
          description: item.description,
          quantity: Number(item.quantity || 1),
          unit: item.unit || 'unidad',
          unitPrice: item.unitPrice === null ? undefined : parseNumber(item.unitPrice),
          taxRate: item.taxRate === null ? 21 : parseNumber(item.taxRate) ?? 21
        }))
        .filter((item) => item.description)
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

  return prisma.customer.create({
    data: {
      companyId: input.companyId,
      legalName: input.name || 'Cliente pendiente - Asistente IA',
      cuit: input.cuit,
      address: input.address,
      notes: `Creado automaticamente desde ${input.source}. Revisar datos antes de enviar o facturar.`
    }
  });
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

async function createQuoteDraft(companyId: string, message: string, payload: DraftPayload): Promise<AssistantResponse['action'] & { answer: string; sources: KnowledgeSource[] }> {
  const customer = await resolveCustomer({
    companyId,
    name: payload.customerName,
    cuit: payload.customerCuit,
    address: payload.customerAddress,
    source: 'asistente IA'
  });
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

  const pdf = await renderQuotePdf({
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
  const stored = await writeDocumentFile({
    buffer: pdf,
    filename: `presupuesto-ia-${String(quote.number).padStart(5, '0')}.pdf`,
    mimeType: 'application/pdf',
    sourceType: 'ai_generated',
    companyId
  });
  const document = await prisma.document.create({
    data: {
      companyId,
      kind: 'QUOTE',
      sourceType: 'ai_generated',
      fileName: `presupuesto-ia-${String(quote.number).padStart(5, '0')}.pdf`,
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

  return {
    type: 'quote_draft_created',
    quoteId: quote.id,
    documentId: document.id,
    answer: [
      `Listo. Cree el presupuesto borrador #${quote.number} para ${quote.customer.legalName}.`,
      `Total estimado: ${quote.currency} ${Number(quote.total).toLocaleString('es-AR')}.`,
      'Quedo guardado como borrador editable y tambien como PDF en Documentos para revisar antes de enviar.'
    ].join('\n'),
    sources: [
      { type: 'quote', id: quote.id, title: `Presupuesto #${quote.number}`, subtitle: quote.customer.legalName },
      { type: 'document', id: document.id, title: document.fileName, subtitle: 'Presupuesto / Estructurado', url: `/api/documents/${document.id}/content` }
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
  const count = await prisma.document.count({ where: { companyId, kind: DocumentKind.DELIVERY_NOTE, sourceType: 'ai_generated' } });
  const number = String(count + 1).padStart(5, '0');
  const items = payload.items.length ? payload.items : [{ description: message, quantity: 1, unit: 'trabajo' }];
  const issueDate = new Date();
  const pdf = await renderDeliveryNotePdf({
    number,
    customerName: customer.legalName,
    issueDate,
    notes: payload.notes || 'Remito generado desde el asistente IA. Revisar antes de entregar.',
    items: items.map((item) => ({ description: item.description, quantity: item.quantity || 1, unit: item.unit || 'unidad' }))
  });
  const filename = ensurePdfFileName(fileName || suggestedDeliveryFileName(payload)) || `remito-ia-${number}.pdf`;
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

  return {
    type: 'delivery_note_created',
    documentId: document.id,
    answer: [
      `Listo. Guarde el remito borrador #${number} para ${customer.legalName}.`,
      `Archivo: ${filename}`,
      'Quedo como PDF en Documentos, tipo Remito, para revisar antes de entregar o enviar.'
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
    'Responde en espanol argentino, claro y breve.'
  ].join('\n');

  const history = (input.history ?? []).slice(-10).map((message) => ({
    role: message.role,
    content: [{ type: 'input_text', text: message.content }]
  }));

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
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

  if (input.pendingDeliveryDraft) {
    const requestedFileName = extractRequestedFileName(input.message);
    if (confirmsPendingDraft(input.message) || requestedFileName) {
      const created = await createDeliveryNote(companyId, input.message, input.pendingDeliveryDraft.payload, requestedFileName || input.pendingDeliveryDraft.suggestedFileName);
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

    if (normalizeText(input.message).includes('nombre')) {
      const fileName = requestedFileName || input.pendingDeliveryDraft.suggestedFileName;
      const pending = { ...input.pendingDeliveryDraft, suggestedFileName: fileName };
      return {
        mode: config.OPENAI_API_KEY ? 'openai' : 'local',
        answer: formatDeliveryDraft(pending),
        sources: [],
        suggestions,
        pendingDeliveryDraft: pending,
        action: { type: 'delivery_note_draft_pending' }
      };
    }
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
      effectiveIntent === 'delivery_note' && intent === 'none'
        ? parseFollowUpDeliveryNoteForTest(input.message)
        : (await parseOpenAiDraft(input.message, effectiveIntent)) ?? parseLocalDraft(input.message);
    const missing: string[] = [];
    if (!payload.customerName && !payload.customerCuit) missing.push('cliente');
    if (payload.items.length === 0) missing.push('items o descripcion');
    if (missing.length) {
      const answer =
        effectiveIntent === 'delivery_note' && payload.customerName && missing.length === 1 && missing[0] === 'items o descripcion'
          ? `Perfecto, lo armamos para ${payload.customerName}. Decime que tenemos que agregar al remito: trabajos, materiales, cantidades o descripcion.`
          : `Para crear el ${effectiveIntent === 'quote' ? 'presupuesto' : 'remito'} necesito estos datos: ${missing.join(', ')}. Pasamelos en un mensaje y lo guardo como borrador editable.`;
      return {
        mode: config.OPENAI_API_KEY ? 'openai' : 'local',
        answer,
        sources: [],
        suggestions
      };
    }

    if (effectiveIntent === 'delivery_note') {
      const pending: PendingDeliveryDraft = {
        type: 'delivery_note',
        payload,
        suggestedFileName: suggestedDeliveryFileName(payload)
      };
      return {
        mode: config.OPENAI_API_KEY ? 'openai' : 'local',
        answer: formatDeliveryDraft(pending),
        sources: [],
        suggestions,
        pendingDeliveryDraft: pending,
        action: { type: 'delivery_note_draft_pending' }
      };
    }

    const created = await createQuoteDraft(companyId, input.message, payload);
    return {
      mode: config.OPENAI_API_KEY ? 'openai' : 'local',
      answer: created.answer,
      sources: created.sources,
      suggestions,
      action: {
        type: created.type,
        quoteId: created.quoteId,
        documentId: created.documentId
      }
    };
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
