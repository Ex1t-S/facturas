import { prisma } from '../../db.js';
import { calculateQuoteTotals } from '../../domain/money.js';

export type DeliveryNoteInput = {
  companyId: string;
  customerId: string;
  documentId?: string;
  items: Array<{ description: string; quantity: number; unit?: string; unitPrice?: number; taxRate?: number }>;
  notes?: string;
  projectName?: string;
  currency?: string;
};

export async function createDeliveryNoteRecord(input: DeliveryNoteInput) {
  return prisma.$transaction(async (tx) => {
    const last = await tx.deliveryNote.findFirst({ where: { companyId: input.companyId }, orderBy: { number: 'desc' }, select: { number: true } });
    return tx.deliveryNote.create({
      data: {
        companyId: input.companyId,
        customerId: input.customerId,
        documentId: input.documentId,
        number: (last?.number ?? 0) + 1,
        status: 'PENDING',
        currency: input.currency ?? 'ARS',
        projectName: input.projectName,
        notes: input.notes,
        items: { create: input.items.map((item) => ({ description: item.description, quantity: item.quantity, unit: item.unit ?? 'unidad', unitPrice: item.unitPrice, taxRate: item.taxRate ?? 21, priceOrigin: item.unitPrice == null ? 'SIN_PRECIO' : 'PRECIO_MANUAL' })) }
      },
      include: { customer: true, items: true, document: true }
    });
  });
}

export async function listPendingDeliveryNotes(companyId: string, customerId?: string) {
  return prisma.deliveryNote.findMany({
    where: { companyId, customerId, status: 'PENDING' },
    include: { customer: true, items: true, document: true, quoteLinks: { include: { quote: true } } },
    orderBy: [{ issueDate: 'asc' }, { number: 'asc' }]
  });
}

export async function getDeliveryNote(id: string, companyId: string) {
  return prisma.deliveryNote.findFirst({ where: { id, companyId }, include: { customer: true, items: true, document: true, quoteLinks: { include: { quote: true } } } });
}

export async function linkDeliveryNotesToQuote(companyId: string, quoteId: string, deliveryNoteIds: string[]) {
  return prisma.$transaction(async (tx) => {
    const notes = await tx.deliveryNote.findMany({ where: { companyId, id: { in: deliveryNoteIds } }, select: { id: true, status: true } });
    if (notes.length !== deliveryNoteIds.length) throw new Error('No se pudieron relacionar todos los remitos con el presupuesto.');
    await tx.deliveryNoteQuote.createMany({ data: deliveryNoteIds.map((deliveryNoteId) => ({ deliveryNoteId, quoteId })), skipDuplicates: true });
    await tx.deliveryNote.updateMany({ where: { companyId, id: { in: deliveryNoteIds } }, data: { status: 'QUOTED' } });
    return notes;
  });
}

export async function convertDeliveryNotesToQuote(input: { companyId: string; customerId: string; deliveryNoteIds: string[]; notes?: string; prices?: Record<string, number> }) {
  return prisma.$transaction(async (tx) => {
    const notes = await tx.deliveryNote.findMany({ where: { companyId: input.companyId, customerId: input.customerId, id: { in: input.deliveryNoteIds }, status: 'PENDING' }, include: { items: true, customer: true } });
    if (notes.length !== input.deliveryNoteIds.length) throw new Error('Uno o más remitos no están pendientes o no pertenecen al cliente indicado.');
    const lines = notes.flatMap((note) => note.items.map((item) => ({ description: item.description, quantity: Number(item.quantity), unit: item.unit, unitPrice: input.prices?.[item.id] ?? (item.unitPrice == null ? undefined : Number(item.unitPrice)), taxRate: Number(item.taxRate), sourceId: note.id })));
    const missing = lines.filter((line) => line.unitPrice == null);
    if (missing.length) throw new Error('Faltan precios para: ' + missing.map((line) => line.description).join(', '));
    const quoteLines = lines.map((line) => ({ productId: undefined, description: line.description, quantity: line.quantity, unit: line.unit, unitPrice: line.unitPrice!, discount: 0, taxRate: line.taxRate }));
    const totals = calculateQuoteTotals(quoteLines);
    const last = await tx.quote.findFirst({ where: { companyId: input.companyId }, orderBy: { number: 'desc' }, select: { number: true } });
    const quote = await tx.quote.create({
      data: {
        companyId: input.companyId,
        customerId: input.customerId,
        number: (last?.number ?? 0) + 1,
        status: 'DRAFT',
        currency: 'ARS',
        subtotal: totals.subtotal,
        taxTotal: totals.taxTotal,
        total: totals.total,
        notes: input.notes,
        items: { create: quoteLines.map((line, index) => ({ ...line, total: totals.lines[index]?.total ?? 0 })) },
        deliveryNoteLinks: { create: notes.map((note) => ({ deliveryNoteId: note.id })) }
      },
      include: { customer: true, items: true, deliveryNoteLinks: true }
    });
    await tx.deliveryNote.updateMany({ where: { id: { in: notes.map((note) => note.id) }, companyId: input.companyId }, data: { status: 'QUOTED' } });
    return { quote, deliveryNotes: notes };
  });
}
