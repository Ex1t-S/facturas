import { config } from '../config.js';
import { prisma } from '../db.js';
import {
  getOperationalWeakPoints,
  parseDateHints,
  parseDocumentKindFromMessage,
  searchBusinessKnowledge,
  type KnowledgeSource
} from './businessKnowledge.js';

type AssistantMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type AssistantInput = {
  companyId?: string;
  message: string;
  history?: AssistantMessage[];
};

type AssistantResponse = {
  mode: 'local' | 'openai';
  answer: string;
  sources: KnowledgeSource[];
  suggestions: string[];
};

async function buildBusinessContext(companyId?: string) {
  const company = companyId ? await prisma.company.findUnique({ where: { id: companyId } }) : await prisma.company.findFirst();
  if (!company) return 'No hay empresa activa cargada.';

  const [products, customers, quotes, pendingDocuments] = await Promise.all([
    prisma.product.findMany({ where: { companyId: company.id, active: true }, orderBy: { name: 'asc' }, take: 80 }),
    prisma.customer.findMany({ where: { companyId: company.id }, orderBy: { legalName: 'asc' }, take: 40 }),
    prisma.quote.findMany({ where: { companyId: company.id }, include: { customer: true, items: true }, orderBy: { issueDate: 'desc' }, take: 8 }),
    prisma.document.findMany({
      where: {
        OR: [{ companyId: company.id }, { companyId: null }],
        extractionStatus: { in: ['UPLOADED', 'NEEDS_REVIEW', 'STRUCTURED'] }
      },
      orderBy: { createdAt: 'desc' },
      take: 12
    })
  ]);

  return [
    `Empresa: ${company.legalName}${company.tradeName ? ` (${company.tradeName})` : ''}. CUIT: ${company.cuit}.`,
    `Clientes cargados: ${customers.map((customer) => `${customer.legalName}${customer.cuit ? ` CUIT ${customer.cuit}` : ''}`).join('; ') || 'sin clientes'}.`,
    `Productos y servicios frecuentes: ${products.map((product) => `${product.name}${product.category ? ` [${product.category}]` : ''}`).join('; ') || 'sin productos'}.`,
    `Presupuestos recientes: ${quotes.map((quote) => `#${quote.number} ${quote.customer.legalName} total ${quote.currency} ${quote.total}`).join('; ') || 'sin presupuestos'}.`,
    `Documentos pendientes/recientes: ${pendingDocuments.map((document) => `${document.fileName} (${document.kind}/${document.extractionStatus})`).join('; ') || 'sin documentos pendientes'}.`
  ].join('\n');
}

function localAssistant(input: AssistantInput, knowledge: string, weakPoints: string) {
  const message = input.message.toLowerCase();
  const evidence = `\n\nInformación encontrada:\n${knowledge}`;

  if (message.includes('presupuesto')) {
    return [
      'Para presupuestos FMH conviene trabajar por bloques: descripción técnica clara, cantidad/unidad, costo base, margen editable, IVA y revisión final del DOCX/PDF antes de enviar.',
      'Puedo ayudarte a convertir un remito o texto de WhatsApp en un borrador, pero la app debe pedir confirmación antes de guardarlo como presupuesto.',
      evidence
    ].join('\n\n');
  }

  if (message.includes('inventario') || message.includes('producto') || message.includes('material')) {
    return [
      'El inventario debería priorizar materiales con uso real en documentos: chapa galvanizada, perfiles, motores, norias, extractores, sinfines, correas, rodamientos y trabajos de montaje/reparación.',
      'Los puntos más importantes son completar precios, vincular proveedor, normalizar aliases informales y mantener un nombre técnico para presupuestar.',
      evidence,
      `Puntos débiles detectados:\n${weakPoints}`
    ].join('\n\n');
  }

  if (message.includes('arca') || message.includes('factura')) {
    return [
      'Para facturación ARCA la app debe preparar borradores y validaciones, no emitir automáticamente sin confirmación.',
      'No se debe guardar clave fiscal. La integración real requiere certificado, clave privada, CUIT y punto de venta Web Services.',
      evidence
    ].join('\n\n');
  }

  if (message.includes('debil') || message.includes('mejorar') || message.includes('problema') || message.includes('analisis')) {
    return [
      'Análisis operativo de puntos débiles:',
      weakPoints,
      'Prioridad recomendada: completar precios/proveedores, revisar documentos sin tipo o sin texto, y usar fuentes de la base antes de generar presupuestos.',
      evidence
    ].join('\n\n');
  }

  return [
    'Puedo responder consultas generales y también ayudarte con datos internos de clientes, documentos, productos, precios y presupuestos.',
    'Cuando haya datos de la app, voy a mostrar fuentes para que puedas verificar de dónde sale la respuesta.',
    evidence,
    'Ahora estoy en modo ayuda local porque no hay OPENAI_API_KEY configurada.'
  ].join('\n\n');
}

export async function answerAssistant(input: AssistantInput): Promise<AssistantResponse> {
  const context = await buildBusinessContext(input.companyId);
  const company = input.companyId ? await prisma.company.findUnique({ where: { id: input.companyId } }) : await prisma.company.findFirst();
  const companyId = company?.id;
  const suggestions = ['Filtrar documentos por tipo y fecha', 'Completar productos sin precio', 'Crear borrador con confirmación'];

  const knowledge = companyId
    ? await searchBusinessKnowledge({
        companyId,
        q: input.message,
        kind: parseDocumentKindFromMessage(input.message),
        ...parseDateHints(input.message),
        take: 10
      })
    : { summary: 'No hay empresa activa para consultar datos.', sources: [] };
  const weakPoints = companyId ? await getOperationalWeakPoints(companyId) : 'No hay empresa activa para auditar.';

  if (!config.OPENAI_API_KEY) {
    return { mode: 'local', answer: localAssistant(input, knowledge.summary, weakPoints), sources: knowledge.sources, suggestions };
  }

  const system = [
    'Sos un asistente operativo para FMH/metalúrgica.',
    'Ayudás con presupuestos, remitos, inventario, clientes, WhatsApp, documentos y ARCA.',
    'No emitís facturas reales, no inventás CUIT, no pedís clave fiscal y siempre indicás revisar antes de enviar o facturar.',
    'No creás ni modificás datos finales: proponés acciones para que una persona confirme.',
    'Los presupuestos FMH usan bloques descriptivos largos, líneas de costo, moneda ARS/USD, + IVA y cierre formal.',
    'Si respondés sobre clientes, documentos, precios o presupuestos, usá la información encontrada y aclará cuando no haya evidencia.',
    'Si faltan datos, pedilos de forma concreta.'
  ].join('\n');

  const history = (input.history ?? []).slice(-8).map((message) => ({
    role: message.role,
    content: [{ type: 'input_text', text: message.content }]
  }));

  const tools = config.OPENAI_VECTOR_STORE_ID
    ? [
        {
          type: 'file_search',
          vector_store_ids: [config.OPENAI_VECTOR_STORE_ID],
          max_num_results: 6
        }
      ]
    : undefined;

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: config.OPENAI_MODEL,
      input: [
        { role: 'system', content: [{ type: 'input_text', text: system }] },
        { role: 'user', content: [{ type: 'input_text', text: `Contexto de la app:\n${context}` }] },
        { role: 'user', content: [{ type: 'input_text', text: `Resultados de búsqueda interna:\n${knowledge.summary}\n\nPuntos débiles operativos:\n${weakPoints}` }] },
        ...history,
        { role: 'user', content: [{ type: 'input_text', text: input.message }] }
      ],
      tools,
      include: tools ? ['file_search_call.results'] : undefined,
      max_output_tokens: 1000,
      store: false
    })
  });

  if (!response.ok) {
    const body = await response.text();
    return {
      mode: 'local',
      answer: `${localAssistant(input, knowledge.summary, weakPoints)}\n\nLa IA remota no respondió correctamente: ${response.status} ${body.slice(0, 300)}`,
      sources: knowledge.sources,
      suggestions
    };
  }

  const data = (await response.json()) as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
  const answer = data.output_text ?? data.output?.flatMap((item) => item.content ?? []).map((item) => item.text).filter(Boolean).join('\n') ?? '';
  return { mode: 'openai', answer: answer || localAssistant(input, knowledge.summary, weakPoints), sources: knowledge.sources, suggestions };
}
