import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { convertDeliveryNotesToQuote, getDeliveryNote, listPendingDeliveryNotes } from '../services/deliveryNotes/deliveryNoteService.js';

const querySchema = z.object({ companyId: z.string(), customerId: z.string().optional(), status: z.enum(['DRAFT', 'PENDING', 'QUOTED', 'INVOICED', 'CANCELLED']).optional() });

export const deliveryNoteRoutes: FastifyPluginAsync = async (app) => {
  app.get('/delivery-notes', async (request) => {
    const query = querySchema.parse(request.query);
    return prisma.deliveryNote.findMany({ where: { companyId: query.companyId, customerId: query.customerId, status: query.status }, include: { customer: true, items: true, document: true, quoteLinks: { include: { quote: true } } }, orderBy: { issueDate: 'desc' } });
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

  app.post('/delivery-notes/convert-to-quote/preview', async (request) => {
    const body = z.object({ companyId: z.string(), customerId: z.string(), deliveryNoteIds: z.array(z.string()).min(1) }).parse(request.body);
    const notes = await prisma.deliveryNote.findMany({ where: { companyId: body.companyId, customerId: body.customerId, id: { in: body.deliveryNoteIds }, status: 'PENDING' }, include: { customer: true, items: true }, orderBy: { number: 'asc' } });
    const lines = notes.flatMap((note) => note.items.map((item) => ({ deliveryNoteId: note.id, deliveryNoteNumber: note.number, itemId: item.id, description: item.description, quantity: Number(item.quantity), unit: item.unit, unitPrice: item.unitPrice == null ? null : Number(item.unitPrice), taxRate: Number(item.taxRate) })));
    return { customer: notes[0]?.customer ?? null, deliveryNotes: notes, lines, missingPrices: lines.filter((line) => line.unitPrice == null) };
  });

  app.post('/delivery-notes/convert-to-quote', async (request, reply) => {
    try {
      const body = z.object({ companyId: z.string(), customerId: z.string(), deliveryNoteIds: z.array(z.string()).min(1), notes: z.string().optional(), prices: z.record(z.string(), z.number().nonnegative()).optional() }).parse(request.body);
      return await convertDeliveryNotesToQuote(body);
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : 'Could not convert delivery notes' });
    }
  });
};
