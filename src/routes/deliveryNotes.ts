import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import {
  billingMonthBounds,
  closeDeliveryNotesToInvoiceDraft,
  convertDeliveryNotesToQuote,
  getDeliveryNote,
  listPendingDeliveryNotes
} from '../services/deliveryNotes/deliveryNoteService.js';

const billingMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const querySchema = z.object({
  companyId: z.string(),
  customerId: z.string().optional(),
  status: z.enum(['DRAFT', 'PENDING', 'QUOTED', 'INVOICED', 'CANCELLED']).optional(),
  billingMonth: billingMonthSchema.optional()
});
const conversionSchema = z.object({
  companyId: z.string(),
  customerId: z.string(),
  deliveryNoteIds: z.array(z.string()).min(1),
  billingMonth: billingMonthSchema.optional(),
  notes: z.string().optional(),
  prices: z.record(z.string(), z.number().positive()).optional()
});

export const deliveryNoteRoutes: FastifyPluginAsync = async (app) => {
  app.get('/delivery-notes', async (request) => {
    const query = querySchema.parse(request.query);
    const month = query.billingMonth ? billingMonthBounds(query.billingMonth) : undefined;
    return prisma.deliveryNote.findMany({
      where: {
        companyId: query.companyId,
        customerId: query.customerId,
        status: query.status,
        issueDate: month ? { gte: month.from, lt: month.to } : undefined
      },
      include: {
        customer: true,
        items: true,
        document: true,
        quoteLinks: { include: { quote: { include: { invoices: true } } } }
      },
      orderBy: [{ issueDate: 'desc' }, { number: 'desc' }]
    });
  });

  app.get('/delivery-notes/pending', async (request) => {
    const query = querySchema.parse(request.query);
    return listPendingDeliveryNotes(query.companyId, query.customerId);
  });

  app.get('/delivery-notes/:id', async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const query = z.object({ companyId: z.string() }).parse(request.query);
    const note = await getDeliveryNote(params.id, query.companyId);
    return note ? note : reply.code(404).send({ error: 'Delivery note not found' });
  });

  app.post('/delivery-notes/convert-to-quote/preview', async (request, reply) => {
    const body = conversionSchema.parse(request.body);
    const month = body.billingMonth ? billingMonthBounds(body.billingMonth) : undefined;
    const notes = await prisma.deliveryNote.findMany({
      where: {
        companyId: body.companyId,
        customerId: body.customerId,
        id: { in: body.deliveryNoteIds },
        status: 'PENDING',
        issueDate: month ? { gte: month.from, lt: month.to } : undefined
      },
      include: { customer: true, items: true },
      orderBy: { number: 'asc' }
    });
    if (notes.length !== new Set(body.deliveryNoteIds).size) {
      return reply.code(409).send({
        error: 'Uno o más remitos ya no están pendientes, no pertenecen al cliente o están fuera del mes.'
      });
    }
    const currencies = new Set(notes.map((note) => note.currency));
    if (currencies.size > 1) {
      return reply.code(409).send({ error: 'No se pueden consolidar remitos con monedas diferentes.' });
    }
    const lines = notes.flatMap((note) =>
      note.items.map((item) => {
        const requestedPrice = body.prices?.[item.id];
        return {
          deliveryNoteId: note.id,
          deliveryNoteNumber: note.number,
          itemId: item.id,
          description: item.description,
          quantity: Number(item.quantity),
          unit: item.unit,
          unitPrice: requestedPrice ?? (item.unitPrice == null ? null : Number(item.unitPrice)),
          taxRate: Number(item.taxRate)
        };
      })
    );
    return {
      billingMonth: body.billingMonth ?? null,
      customer: notes[0]?.customer ?? null,
      currency: notes[0]?.currency ?? 'ARS',
      deliveryNotes: notes,
      lines,
      missingPrices: lines.filter((line) => line.unitPrice == null || line.unitPrice <= 0)
    };
  });

  app.post('/delivery-notes/convert-to-quote', async (request, reply) => {
    try {
      const body = conversionSchema.parse(request.body);
      return await convertDeliveryNotesToQuote(body);
    } catch (error) {
      return reply.code(409).send({
        error: error instanceof Error ? error.message : 'Could not convert delivery notes'
      });
    }
  });

  app.post('/delivery-notes/close-month', async (request, reply) => {
    try {
      const body = conversionSchema
        .extend({
          billingMonth: billingMonthSchema,
          invoiceType: z.enum(['A', 'B'])
        })
        .parse(request.body);
      const result = await closeDeliveryNotesToInvoiceDraft(body);
      return reply.code(result.replayed ? 200 : 201).send(result);
    } catch (error) {
      return reply.code(409).send({
        error: error instanceof Error ? error.message : 'No se pudo preparar el cierre mensual.'
      });
    }
  });
};
