import fs from 'node:fs/promises';
import { answerAssistant, type AssistantResponse, type PendingDeliveryDraft } from '../src/services/assistant.js';
import { prisma } from '../src/db.js';
import { resolveStoredDocumentPath } from '../src/services/documentStorage.js';

type Turn = { message: string; answer?: string; itemCount?: number; status?: string };
type Conversation = {
  id: number;
  category: string;
  messages: string[];
  check?: (result: RunResult) => string | undefined;
};
type RunResult = {
  conversation: Conversation;
  turns: Turn[];
  responses: AssistantResponse[];
  pending?: PendingDeliveryDraft;
  previewPaths: string[];
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function itemCount(response?: AssistantResponse) {
  return response?.pendingDeliveryDraft?.payload.items.length ?? 0;
}

function hasForbiddenInstruction(items: PendingDeliveryDraft['payload']['items']) {
  return items.some((item) => /^(agrega(?:r)?\s+que|agregale|pon[eé]|cambia|saca|borra|pasame el pdf|resumen|guardalo|al item|precio del item)\b/i.test(item.description.trim()));
}

async function runConversation(companyId: string, conversation: Conversation): Promise<RunResult> {
  let pending: PendingDeliveryDraft | undefined;
  let history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  const responses: AssistantResponse[] = [];
  const turns: Turn[] = [];
  const previewPaths = new Set<string>();

  for (const message of conversation.messages) {
    const response = await answerAssistant({
      companyId,
      conversationId: `simulation-100-${conversation.id}`,
      message,
      history,
      pendingDeliveryDraft: pending,
      channel: 'web'
    });
    responses.push(response);
    if (response.pendingDeliveryDraft?.previewStoragePath) previewPaths.add(response.pendingDeliveryDraft.previewStoragePath);
    pending = response.pendingDeliveryDraft;
    turns.push({
      message,
      answer: response.answer,
      itemCount: itemCount(response),
      status: response.pendingDeliveryDraft?.status
    });
    history = [...history, { role: 'user', content: message }, { role: 'assistant', content: response.answer }].slice(-12);
  }

  return { conversation, turns, responses, pending, previewPaths: [...previewPaths] };
}

function makeConversations(customer: string, secondCustomer: string | undefined): Conversation[] {
  const quote = (extra: string) => `Haceme un presupuesto para ${customer}, ${extra}`;
  const delivery = (extra: string) => `Haceme un remito para ${customer}, ${extra}`;
  const cases: Conversation[] = [];
  const add = (category: string, messages: string[], check?: Conversation['check']) => cases.push({ id: cases.length + 1, category, messages, check });

  const social = ['hola', 'buenas', 'gracias', 'qué lindo día', 'ok', 'jaja', '👍', '¿cómo estás?', 'perfecto', 'dale'];
  const resets = ['reiniciar', 'salir', 'reset', 'empecemos de 0', 'volver a empezar', 'arranquemos de cero', 'borrón y cuenta nueva', 'empezamos de nuevo', 'cancelar borrador', 'no, dejá'];
  const prices = ['al item uno ponle 20000', 'cambia el precio del item 1 a $20.000', 'precio del item 1 a 20 mil', 'pone USD 20000 al primero', 'al segundo 30k', 'cambia precio ítem 1 a 50000', 'precio del item 2 a 20000', 'pone 20.000 pesos al primer item', 'U$S 15000 al item 1', 'cambiar valor del segundo a 45 mil'];
  const deletes = ['saca el ultimo punto', 'saca el último', 'borra el item uno', 'elimina el primero', 'saca el ítem 2', 'borra los rodamientos', 'elimina el de la noria', 'sacá el último ítem', 'borrá todo', 'quita el anterior'];
  const replacements = ['Cambia 14 metros por 16 metros', 'reemplazá soldadura por fabricación de soporte', 'cambia el texto techado por cubierta', 'modifica 200 t por 250 t', 'cambia soporte por plataforma', 'reemplaza 10 unidades por 12 unidades', 'cambiá la palabra noria por elevador', 'poné 16 metros en lugar de 14 metros', 'cambia la descripción del item 1 a mantenimiento integral', 'reemplazá el de la noria por servicio de limpieza'];

  // 1-10: creación básica y extracción de cliente/ítems.
  for (let i = 0; i < 10; i++) {
    const extras = ['1 unidad de soporte a 30000.', '2 unidades de rodamientos a 50000.', 'Techado de galpón con 14 metros.', 'Silo 200 t precio 20000$.', '1 servicio de mantenimiento.', 'batea y limpieza de cabezales.', '3 unidades de chapa a 90000.', 'instalación de plataforma por 120 mil.', 'reparación de noria.', '1 unidad de motor a $45.000.'][i]!;
    add('creación y extracción', [quote(extras)]);
  }

  // 11-20: remitos, audio transcripto y múltiples ítems.
  for (let i = 0; i < 10; i++) {
    const messages = i % 2 === 0
      ? [delivery('2 unidades de rodamientos, 1 unidad de soporte.')]
      : [delivery(''), 'Audio transcripto: entregamos 2 unidades de rodamientos.', 'también limpiamos cabezales de una noria.'];
    add('remito y mensajes separados', messages);
  }

  // 21-30: contenido social dentro de un borrador; nunca debe transformarse en ítem.
  for (let i = 0; i < 10; i++) {
    const before = quote('1 unidad de soporte a 30000.');
    const after = i % 2 === 0 ? 'Agregá 1 unidad de motor a 120000.' : 'caminamos sobre un techo';
    add('social y contenido', [before, social[i]!, after], (result) => {
      const socialTurn = result.turns[1]?.itemCount ?? 0;
      if (socialTurn !== 1) return `el mensaje social alteró el borrador (${socialTurn} ítems)`;
      if (hasForbiddenInstruction(result.pending?.payload.items ?? [])) return 'se guardó una instrucción como descripción';
      return undefined;
    });
  }

  // 31-40: reinicio/cancelación en distintas formas.
  for (let i = 0; i < 10; i++) {
    add('reinicio y cancelación', [quote('1 unidad de soporte a 30000.'), 'agregá 1 unidad de chapa.', resets[i]!], (result) => {
      if (result.pending) return `el reinicio no limpió el borrador (${result.pending.payload.items.length} ítems)`;
      return undefined;
    });
  }

  // 41-50: mutaciones de precios y formatos monetarios.
  for (let i = 0; i < 10; i++) {
    add('precios y moneda', [quote('1 unidad de soporte a 30000, 1 unidad de motor a 40000.'), prices[i]!], (result) => {
      if (!result.pending) return 'se perdió el borrador al editar precio';
      if (hasForbiddenInstruction(result.pending.payload.items)) return 'se agregó la orden de precio como ítem';
      if (result.pending.payload.items.some((item) => item.unitPrice !== undefined && (!Number.isFinite(item.unitPrice) || item.unitPrice < 0))) return 'precio inválido/NaN';
      return undefined;
    });
  }

  // 51-60: referencias de ítems y borrado.
  for (let i = 0; i < 10; i++) {
    add('borrado y referencias', [quote('1 unidad de rodamientos a 50000, 1 unidad de soporte a 30000.'), deletes[i]!], (result) => {
      if (!result.pending && i !== 8) return 'se perdió el borrador al borrar';
      // “el de la noria” no coincide con ninguno de los dos ítems sembrados:
      // conservar el borrador sin cambios es el comportamiento seguro esperado.
      if (i === 6) {
        if ((result.pending?.payload.items.length ?? 0) !== 2) return 'una referencia inexistente modificó el borrador';
        return undefined;
      }
      if (i !== 8 && (result.pending?.payload.items.length ?? 0) >= 2) return 'la eliminación no quitó ningún ítem';
      if (hasForbiddenInstruction(result.pending?.payload.items ?? [])) return 'se guardó el comando de borrado como ítem';
      return undefined;
    });
  }

  // 61-70: reemplazos parciales/completos.
  for (let i = 0; i < 10; i++) {
    add('reemplazos', [quote('Techado de galpón con 14 metros.'), replacements[i]!], (result) => {
      if (!result.pending) return 'se perdió el borrador al reemplazar';
      if (hasForbiddenInstruction(result.pending.payload.items)) return 'se agregó la instrucción de reemplazo como ítem';
      return undefined;
    });
  }

  // 71-80: resumen, preview, renombrado y confirmación/cancelación sin persistir documento final.
  for (let i = 0; i < 10; i++) {
    const flow = i % 3 === 0
      ? [quote('1 unidad de soporte a 30000.'), 'resumen', 'resumen PDF', 'no lo guardes']
      : i % 3 === 1
        // El runner no crea documentos definitivos: renombramos y cancelamos
        // después del preview para mantener la base de prueba limpia.
        ? [delivery('1 unidad de soporte.'), 'pasame el PDF', `cambia el nombre a remito-prueba-${i}`, 'no lo guardes']
        : [quote('1 unidad de soporte a 30000.'), 'pasame el pdf', 'cambia el nombre a prueba-simetrica', 'cancelar'];
    add('resumen, preview y nombre', flow, (result) => {
      if (result.responses.some((response) => response.pendingDeliveryDraft?.payload.items.some((item) => /pasame el pdf|resumen|guardalo/i.test(item.description)))) return 'instrucción de preview/nombre guardada como ítem';
      return undefined;
    });
  }

  // 81-90: mensajes híbridos de cliente, presupuesto y consulta interna.
  for (let i = 0; i < 10; i++) {
    const messages = i % 2 === 0
      ? [`Presupuesto para ${customer} de un SILO ${200 + i * 10}T precio ${20000 + i * 1000}$`]
      : ['Presupuesto', customer, `silo ${200 + i * 10}t 20000`];
    add('cliente e intención mezclados', messages);
  }

  // 91-100: ruido, typos, mensajes fuera de contexto y cambios de documento.
  const noise = ['asdf qwerty', '???', 'hola hola', 'quiero algo', 'precio?', 'mandame eso', 'el anterior', 'uno', 'gracias chau', 'Ahora armame un presupuesto'];
  for (let i = 0; i < 10; i++) {
    const start = i === 9 ? [delivery('1 unidad de soporte.')] : [quote('1 unidad de soporte a 30000.')];
    add('ruido y cambios de contexto', [...start, noise[i]!, i === 9 ? 'empecemos un presupuesto nuevo' : 'Agregá 1 unidad de motor a 120000.']);
  }

  assert(cases.length === 100, `Se generaron ${cases.length} casos, se esperaban 100.`);
  return cases;
}

async function main() {
  const company = await prisma.company.findFirst();
  assert(company, 'No hay empresa configurada para ejecutar las 100 conversaciones.');
  const customers = await prisma.customer.findMany({ where: { companyId: company.id }, orderBy: { legalName: 'asc' }, take: 2, select: { legalName: true } });
  assert(customers.length > 0, 'No hay clientes configurados para ejecutar las 100 conversaciones.');
  const conversations = makeConversations(customers[0]!.legalName, customers[1]?.legalName);
  const results: Array<{ id: number; category: string; ok: boolean; error?: string; turns: Turn[] }> = [];
  const previewPaths = new Set<string>();

  try {
    for (const conversation of conversations) {
      try {
        const result = await runConversation(company.id, conversation);
        result.previewPaths.forEach((path) => previewPaths.add(path));
        const checkError = conversation.check?.(result);
        results.push({ id: conversation.id, category: conversation.category, ok: !checkError, error: checkError, turns: result.turns });
      } catch (error) {
        results.push({ id: conversation.id, category: conversation.category, ok: false, error: error instanceof Error ? error.message : String(error), turns: [] });
      }
    }
  } finally {
    for (const storagePath of previewPaths) await fs.rm(resolveStoredDocumentPath(storagePath), { force: true }).catch(() => undefined);
    await prisma.$disconnect();
  }

  const failed = results.filter((result) => !result.ok);
  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'assistant-direct-not-whatsapp',
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    categories: [...new Set(results.map((result) => result.category))],
    results
  };
  await fs.mkdir('.tmp', { recursive: true });
  await fs.writeFile('.tmp/assistant-100-report.json', JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify({ ok: failed.length === 0, total: report.total, passed: report.passed, failed: report.failed, report: '.tmp/assistant-100-report.json', failures: failed.slice(0, 20).map(({ id, category, error }) => ({ id, category, error })) }, null, 2));
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
