import type { Prisma } from '../../generated/postgres-client/index.js';
import { prisma } from '../../db.js';
import { calculateQuoteTotals } from '../../domain/money.js';
import { runSerializableTransaction } from '../transaction.js';

export type DeliveryNoteInput = {
  companyId: string;
  customerId: string;
  commercialDraftId?: string;
  documentId?: string;
  items: Array<{ description: string; quantity: number; unit?: string; unitPrice?: number; taxRate?: number }>;
  notes?: string;
  projectName?: string;
  currency?: string;
};

export type DeliveryNoteConversionInput = {
  companyId: string;
  customerId: string;
  deliveryNoteIds: string[];
  notes?: string;
  prices?: Record<string, number>;
  billingMonth?: string;
};

export async function createDeliveryNoteRecord(input: DeliveryNoteInput) {
  return runSerializableTransaction(async (tx) => {
    if (input.commercialDraftId) {
      const existing = await tx.deliveryNote.findUnique({
        where: { commercialDraftId: input.commercialDraftId },
        include: { customer: true, items: true, document: true }
      });
      if (existing) return existing;
    }
    const last = await tx.deliveryNote.findFirst({
      where: { companyId: input.companyId },
      orderBy: { number: 'desc' },
      select: { number: true }
    });
    return tx.deliveryNote.create({
      data: {
        companyId: input.companyId,
        customerId: input.customerId,
        commercialDraftId: input.commercialDraftId,
        documentId: input.documentId,
        number: (last?.number ?? 0) + 1,
        status: 'PENDING',
        currency: input.currency ?? 'ARS',
        projectName: input.projectName,
        notes: input.notes,
        items: {
          create: input.items.map((item) => ({
            description: item.description,
            quantity: item.quantity,
            unit: item.unit ?? 'unidad',
            unitPrice: item.unitPrice,
            taxRate: item.taxRate ?? 21,
            priceOrigin: item.unitPrice == null ? 'SIN_PRECIO' : 'PRECIO_MANUAL'
          }))
        }
      },
      include: { customer: true, items: true, document: true }
    });
  }, { retryUniqueConflict: true });
}

export async function listPendingDeliveryNotes(companyId: string, customerId?: string) {
  return prisma.deliveryNote.findMany({
    where: { companyId, customerId, status: 'PENDING' },
    include: { customer: true, items: true, document: true, quoteLinks: { include: { quote: true } } },
    orderBy: [{ issueDate: 'asc' }, { number: 'asc' }]
  });
}

export async function getDeliveryNote(id: string, companyId: string) {
  return prisma.deliveryNote.findFirst({
    where: { id, companyId },
    include: { customer: true, items: true, document: true, quoteLinks: { include: { quote: true } } }
  });
}

export async function linkDeliveryNotesToQuote(companyId: string, quoteId: string, deliveryNoteIds: string[]) {
  return prisma.$transaction(async (tx) => {
    const notes = await tx.deliveryNote.findMany({
      where: { companyId, id: { in: deliveryNoteIds } },
      select: { id: true, status: true }
    });
    if (notes.length !== deliveryNoteIds.length) {
      throw new Error('No se pudieron relacionar todos los remitos con el presupuesto.');
    }
    await tx.deliveryNoteQuote.createMany({
      data: deliveryNoteIds.map((deliveryNoteId) => ({ deliveryNoteId, quoteId })),
      skipDuplicates: true
    });
    await tx.deliveryNote.updateMany({
      where: { companyId, id: { in: deliveryNoteIds } },
      data: { status: 'QUOTED' }
    });
    return notes;
  });
}

function uniqueIds(ids: string[]) {
  return [...new Set(ids)];
}

export function billingMonthBounds(value: string) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
  if (!match) throw new Error('El mes de cierre debe tener formato AAAA-MM.');
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  // El mes comercial de FMH se interpreta en Argentina (UTC-03:00), no en UTC.
  // Así un remito de las 23:30 del último día no salta al mes siguiente.
  return {
    from: new Date(Date.UTC(year, monthIndex, 1, 3)),
    to: new Date(Date.UTC(year, monthIndex + 1, 1, 3))
  };
}

async function convertDeliveryNotesToQuoteWithClient(
  tx: Prisma.TransactionClient,
  input: DeliveryNoteConversionInput
) {
  const deliveryNoteIds = uniqueIds(input.deliveryNoteIds);
  if (deliveryNoteIds.length !== input.deliveryNoteIds.length) {
    throw new Error('La selección contiene remitos repetidos.');
  }

  const notes = await tx.deliveryNote.findMany({
    where: {
      companyId: input.companyId,
      customerId: input.customerId,
      id: { in: deliveryNoteIds },
      status: 'PENDING'
    },
    include: { items: true, customer: true }
  });
  if (notes.length !== deliveryNoteIds.length) {
    throw new Error('Uno o más remitos no están pendientes o no pertenecen al cliente indicado.');
  }

  if (input.billingMonth) {
    const bounds = billingMonthBounds(input.billingMonth);
    const outsideMonth = notes.filter((note) => note.issueDate < bounds.from || note.issueDate >= bounds.to);
    if (outsideMonth.length) {
      throw new Error('Todos los remitos del cierre deben pertenecer al mes seleccionado.');
    }
  }

  const currencies = new Set(notes.map((note) => note.currency));
  if (currencies.size !== 1) throw new Error('No se pueden consolidar remitos con monedas diferentes.');

  const lines = notes.flatMap((note) =>
    note.items.map((item) => ({
      description: item.description,
      quantity: Number(item.quantity),
      unit: item.unit,
      unitPrice: input.prices?.[item.id] ?? (item.unitPrice == null ? undefined : Number(item.unitPrice)),
      taxRate: Number(item.taxRate)
    }))
  );
  const missing = lines.filter(
    (line) => line.unitPrice == null || !Number.isFinite(line.unitPrice) || line.unitPrice <= 0
  );
  if (missing.length) {
    throw new Error('Faltan precios válidos para: ' + missing.map((line) => line.description).join(', '));
  }

  const quoteLines = lines.map((line) => ({
    productId: undefined,
    description: line.description,
    quantity: line.quantity,
    unit: line.unit,
    unitPrice: line.unitPrice!,
    discount: 0,
    taxRate: line.taxRate
  }));
  const totals = calculateQuoteTotals(quoteLines);
  const last = await tx.quote.findFirst({
    where: { companyId: input.companyId },
    orderBy: { number: 'desc' },
    select: { number: true }
  });
  const quote = await tx.quote.create({
    data: {
      companyId: input.companyId,
      customerId: input.customerId,
      number: (last?.number ?? 0) + 1,
      status: 'DRAFT',
      currency: notes[0]?.currency ?? 'ARS',
      subtotal: totals.subtotal,
      taxTotal: totals.taxTotal,
      total: totals.total,
      notes: input.notes,
      items: {
        create: quoteLines.map((line, index) => ({
          ...line,
          total: totals.lines[index]?.total ?? 0
        }))
      },
      deliveryNoteLinks: { create: notes.map((note) => ({ deliveryNoteId: note.id })) }
    },
    include: { customer: true, items: true, deliveryNoteLinks: true }
  });
  await tx.deliveryNote.updateMany({
    where: { id: { in: notes.map((note) => note.id) }, companyId: input.companyId },
    data: { status: 'QUOTED' }
  });
  return { quote, deliveryNotes: notes };
}

export async function convertDeliveryNotesToQuote(input: DeliveryNoteConversionInput) {
  return runSerializableTransaction((tx) => convertDeliveryNotesToQuoteWithClient(tx, input), {
    retryUniqueConflict: true
  });
}

export async function closeDeliveryNotesToInvoiceDraft(
  input: DeliveryNoteConversionInput & { invoiceType: 'A' | 'B' }
) {
  return runSerializableTransaction(async (tx) => {
    const deliveryNoteIds = uniqueIds(input.deliveryNoteIds);
    if (deliveryNoteIds.length !== input.deliveryNoteIds.length) {
      throw new Error('La selección contiene remitos repetidos.');
    }

    const selected = await tx.deliveryNote.findMany({
      where: {
        companyId: input.companyId,
        customerId: input.customerId,
        id: { in: deliveryNoteIds }
      },
      include: { quoteLinks: true }
    });
    if (selected.length !== deliveryNoteIds.length) {
      throw new Error('No se encontraron todos los remitos seleccionados.');
    }

    const existingQuoteIds = [...new Set(selected.flatMap((note) => note.quoteLinks.map((link) => link.quoteId)))];
    if (selected.every((note) => note.status === 'INVOICED') && existingQuoteIds.length === 1) {
      const existingInvoice = await tx.invoice.findFirst({
        where: { companyId: input.companyId, quoteId: existingQuoteIds[0] },
        include: { customer: true, items: true, quote: true }
      });
      const existingQuote = await tx.quote.findFirst({
        where: { id: existingQuoteIds[0], companyId: input.companyId }
      });
      if (existingInvoice && existingQuote) {
        if (existingInvoice.type !== input.invoiceType) {
          throw new Error(`El cierre ya tiene una factura ${existingInvoice.type}; no se puede repetir como tipo ${input.invoiceType}.`);
        }
        return {
          quote: existingQuote,
          invoice: existingInvoice,
          deliveryNotes: selected,
          replayed: true
        };
      }
    }

    const converted = await convertDeliveryNotesToQuoteWithClient(tx, input);
    if (input.invoiceType === 'A' && !/^\d{11}$/.test(converted.quote.customer.cuit || '')) {
      throw new Error('La factura A requiere un CUIT válido de 11 dígitos del cliente.');
    }

    const invoice = await tx.invoice.create({
      data: {
        companyId: input.companyId,
        customerId: input.customerId,
        quoteId: converted.quote.id,
        type: input.invoiceType,
        status: 'PENDING_CONFIRMATION',
        currency: converted.quote.currency,
        subtotal: converted.quote.subtotal,
        taxTotal: converted.quote.taxTotal,
        total: converted.quote.total,
        items: {
          create: converted.quote.items.map((item) => ({
            productId: item.productId,
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            taxRate: item.taxRate,
            total: item.total
          }))
        }
      },
      include: { customer: true, items: true, quote: true }
    });

    await tx.quote.update({ where: { id: converted.quote.id }, data: { status: 'INVOICED' } });
    await tx.deliveryNote.updateMany({
      where: { companyId: input.companyId, id: { in: deliveryNoteIds } },
      data: { status: 'INVOICED' }
    });
    await tx.auditLog.create({
      data: {
        entityType: 'MONTHLY_DELIVERY_NOTE_CLOSE',
        entityId: invoice.id,
        action: 'CREATE_INVOICE_DRAFT',
        afterJson: JSON.stringify({
          companyId: input.companyId,
          customerId: input.customerId,
          billingMonth: input.billingMonth,
          deliveryNoteIds,
          quoteId: converted.quote.id,
          invoiceId: invoice.id,
          invoiceType: input.invoiceType
        })
      }
    });

    return {
      quote: converted.quote,
      invoice,
      deliveryNotes: converted.deliveryNotes,
      replayed: false
    };
  }, { retryUniqueConflict: true });
}
