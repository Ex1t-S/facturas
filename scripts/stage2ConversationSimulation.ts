import fs from 'node:fs/promises';
import { answerAssistant, type AssistantResponse, type PendingDeliveryDraft } from '../src/services/assistant.js';
import { prisma } from '../src/db.js';
import { resolveStoredDocumentPath } from '../src/services/documentStorage.js';

type Scenario = { id: number; name: string; run: (ctx: Context) => Promise<void> };
type Context = { companyId: string; customerName: string; secondCustomerName?: string; previewPaths: Set<string> };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function conversation(ctx: Context, messages: string[]) {
  let pending: PendingDeliveryDraft | undefined;
  let history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  const responses: AssistantResponse[] = [];
  const previewPaths = new Set<string>();
  for (const message of messages) {
    const response = await answerAssistant({ companyId: ctx.companyId, message, history, pendingDeliveryDraft: pending });
    responses.push(response);
    if (response.pendingDeliveryDraft?.previewStoragePath) {
      previewPaths.add(response.pendingDeliveryDraft.previewStoragePath);
      ctx.previewPaths.add(response.pendingDeliveryDraft.previewStoragePath);
    }
    pending = response.pendingDeliveryDraft;
    history = [...history, { role: 'user', content: message }, { role: 'assistant', content: response.answer }].slice(-12);
  }
  return { pending, responses, previewPaths: [...previewPaths] };
}

async function main() {
  const company = await prisma.company.findFirst();
  assert(company, 'No hay empresa para las simulaciones de etapa 2.');
  const customers = await prisma.customer.findMany({
    where: { companyId: company.id }, orderBy: { legalName: 'asc' }, take: 3,
    select: { legalName: true }
  });
  assert(customers.length > 0, 'No hay clientes para las simulaciones de etapa 2.');
  const previewPaths = new Set<string>();
  const ctx: Context = { companyId: company.id, customerName: customers[0]!.legalName, secondCustomerName: customers[1]?.legalName, previewPaths };
  const itemText = '2 unidades de rodamientos a 50000, 1 unidad de soporte a 30000';
  const separateItems = ['Agregá 2 unidades de rodamientos a 50000.', 'Agregá 1 unidad de soporte a 30000.'];
  const cases: Scenario[] = [
    { id: 1, name: 'menú y selección de presupuesto', run: async (c) => {
      const result = await conversation(c, ['menú', '1', c.customerName, itemText]);
      assert(result.pending?.type === 'quote' && result.pending.payload.items.length === 2, 'No armó presupuesto desde menú.');
    } },
    { id: 2, name: 'presupuesto con todos los ítems en un mensaje', run: async (c) => {
      const result = await conversation(c, [`Haceme un presupuesto para ${c.customerName}, ${itemText}.`]);
      assert(result.pending?.type === 'quote' && result.pending.payload.items.length >= 2, 'No detectó ítems juntos.');
    } },
    { id: 3, name: 'presupuesto con ítems separados', run: async (c) => {
      const result = await conversation(c, [`Haceme un presupuesto para ${c.customerName}.`, ...separateItems]);
      assert(result.pending?.payload.items.length === 2, 'No acumuló ítems separados.');
    } },
    { id: 4, name: 'agregar un ítem después del resumen', run: async (c) => {
      const result = await conversation(c, [`Haceme un presupuesto para ${c.customerName}, 2 unidades de rodamientos a 50000.`, 'Agregá 1 unidad de motor a 120000.']);
      assert(result.pending?.payload.items.some((item) => /motor/i.test(item.description)), 'No agregó el ítem posterior.');
    } },
    { id: 5, name: 'borrar por descripción', run: async (c) => {
      const result = await conversation(c, [`Haceme un presupuesto para ${c.customerName}, ${itemText}.`, 'Borrá los rodamientos.']);
      assert(result.pending?.payload.items.length === 1 && !/rodamiento/i.test(result.pending.payload.items[0]!.description), 'No borró por descripción.');
    } },
    { id: 6, name: 'borrar por número de ítem', run: async (c) => {
      const result = await conversation(c, [`Haceme un presupuesto para ${c.customerName}, ${itemText}.`, 'Sacá el ítem 2.']);
      assert(result.pending?.payload.items.length === 1 && /rodamiento/i.test(result.pending.payload.items[0]!.description), 'No borró por número.');
    } },
    { id: 7, name: 'cambiar cantidad con palabras', run: async (c) => {
      const result = await conversation(c, [`Haceme un presupuesto para ${c.customerName}, 2 unidades de rodamientos a 50000.`, 'En vez de dos rodamientos poné cuatro.']);
      assert(result.pending?.payload.items[0]?.quantity === 4, 'No cambió la cantidad.');
    } },
    { id: 8, name: 'cambiar precio en miles', run: async (c) => {
      const result = await conversation(c, [`Haceme un presupuesto para ${c.customerName}, 2 unidades de rodamientos a 50000.`, 'Cambiá el precio del ítem 1 a 120 mil.']);
      assert(result.pending?.payload.items[0]?.unitPrice === 120000, 'No cambió el precio.');
    } },
    { id: 9, name: 'reemplazar descripción', run: async (c) => {
      const result = await conversation(c, [`Haceme un presupuesto para ${c.customerName}, 1 unidad de soldadura a 30000.`, 'Reemplazá soldadura por fabricación de soporte.']);
      assert(result.pending?.payload.items[0]?.description === 'fabricacion de soporte', `No reemplazó la descripción: ${JSON.stringify(result.pending?.payload.items)}`);
    } },
    { id: 10, name: 'borrar todos y volver a cargar', run: async (c) => {
      const result = await conversation(c, [`Haceme un presupuesto para ${c.customerName}, ${itemText}.`, 'Borrá todo.', 'Agregá 3 unidades de chapa a 90000.']);
      assert(result.pending?.payload.items.length === 1 && /chapa/i.test(result.pending.payload.items[0]!.description), 'No pudo vaciar y recargar.');
    } },
    { id: 11, name: 'cambiar cliente antes del PDF', run: async (c) => {
      assert(c.secondCustomerName, 'Se necesitan dos clientes para este caso.');
      const result = await conversation(c, [`Haceme un presupuesto para ${c.customerName}, 1 unidad de soporte a 30000.`, `Cambiá el cliente a ${c.secondCustomerName}.`]);
      assert(result.pending?.payload.customerName === c.secondCustomerName && result.pending.draftVersion === 2, 'No cambió el cliente o no invalidó la versión.');
    } },
    { id: 12, name: 'cliente indicado en un mensaje posterior', run: async (c) => {
      const result = await conversation(c, ['Haceme un presupuesto.', c.customerName, '1 unidad de soporte a 30000.']);
      assert(result.pending?.payload.customerName === c.customerName && result.pending.payload.items.length === 1, `No completó cliente pendiente: ${JSON.stringify(result.pending)}`);
    } },
    { id: 13, name: 'remito con todos los trabajos juntos', run: async (c) => {
      const result = await conversation(c, [`Haceme un remito para ${c.customerName}, 2 unidades de rodamientos, 1 unidad de soporte.`]);
      assert(result.pending?.type === 'delivery_note' && result.pending.payload.items.length >= 2, 'No armó remito con ítems juntos.');
    } },
    { id: 14, name: 'remito con audios separados', run: async (c) => {
      const result = await conversation(c, [`Haceme un remito para ${c.customerName}.`, 'Audio transcripto: entregamos 2 unidades de rodamientos.', 'Audio transcripto: también 1 unidad de soporte.']);
      assert(result.pending?.type === 'delivery_note' && result.pending.payload.items.length >= 2, 'No acumuló audios separados.');
    } },
    { id: 15, name: 'pedir resumen sin perder contexto', run: async (c) => {
      const result = await conversation(c, [`Haceme un presupuesto para ${c.customerName}, 1 unidad de soporte a 30000.`, '¿Qué tenés anotado?', 'Agregá 2 unidades de chapa a 90000.']);
      assert(result.pending?.payload.items.length === 2, 'Perdió el borrador después del resumen.');
    } },
    { id: 16, name: 'pedir PDF y cancelar sin guardar', run: async (c) => {
      const result = await conversation(c, [`Haceme un remito para ${c.customerName}, 1 unidad de soporte.`, 'Pasame el PDF.', 'Al final no lo quiero guardar.']);
      assert(result.responses[1]?.pendingDeliveryDraft?.status === 'WAITING_CONFIRMATION' && !result.pending, 'No canceló el remito luego del PDF.');
    } },
    { id: 17, name: 'cambiar nombre del remito después del PDF', run: async (c) => {
      const result = await conversation(c, [`Haceme un remito para ${c.customerName}, 1 unidad de soporte.`, 'Pasame el PDF.', 'Cambiá el nombre del remito a entrega-mario']);
      assert(result.pending?.suggestedFileName === 'entrega-mario.pdf', 'No cambió el nombre sugerido del remito.');
    } },
    { id: 18, name: 'cambiar nombre del presupuesto y cancelar', run: async (c) => {
      const result = await conversation(c, [`Haceme un presupuesto para ${c.customerName}, 1 unidad de soporte a 30000.`, 'Pasame el PDF.', 'Renombrá el archivo como presupuesto-final.pdf', 'No lo guardes.']);
      assert(result.responses[2]?.pendingDeliveryDraft?.suggestedFileName === 'presupuesto-final.pdf' && !result.pending, 'No renombró o canceló el presupuesto.');
    } },
    { id: 19, name: 'editar después del preview y exigir PDF nuevo', run: async (c) => {
      const result = await conversation(c, [`Haceme un presupuesto para ${c.customerName}, 1 unidad de soporte a 30000.`, 'Pasame el PDF.', 'Cambiá el precio del ítem 1 a 45000.', 'Guardalo.']);
      assert(result.responses[2]?.pendingDeliveryDraft?.previewVersion === undefined && /PDF actualizado/i.test(result.responses[3]?.answer || ''), 'No invalidó el preview antes de guardar.');
    } },
    { id: 20, name: 'remito terminado con cancelación coloquial', run: async (c) => {
      const result = await conversation(c, [`Haceme un remito para ${c.customerName}, 1 unidad de soporte.`, 'Pasame el PDF.', 'Olvidalo, no hace falta guardarlo.']);
      assert(!result.pending && /Cancelé el borrador/i.test(result.responses.at(-1)?.answer || ''), 'No entendió la cancelación coloquial.');
    } }
  ];

  const selectedIds = process.env.STAGE2_CASES?.split(',').map(Number).filter(Number.isFinite);
  const selectedCases = selectedIds?.length ? cases.filter((scenario) => selectedIds.includes(scenario.id)) : cases;
  const results: Array<{ id: number; name: string; ok: boolean; error?: string }> = [];
  try {
    for (const scenario of selectedCases) {
      try {
        await scenario.run(ctx);
        results.push({ id: scenario.id, name: scenario.name, ok: true });
      } catch (error) {
        results.push({ id: scenario.id, name: scenario.name, ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    }
  } finally {
    for (const storagePath of previewPaths) {
      await fs.rm(resolveStoredDocumentPath(storagePath), { force: true }).catch(() => undefined);
    }
    await prisma.$disconnect();
  }

  const failed = results.filter((result) => !result.ok);
  console.log(JSON.stringify({ ok: failed.length === 0, total: results.length, passed: results.length - failed.length, failed, results }, null, 2));
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
