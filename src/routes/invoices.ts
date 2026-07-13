import type { FastifyPluginAsync } from 'fastify';
import type { QuoteItem } from '../generated/postgres-client/index.js';
import { z } from 'zod';
import { prisma } from '../db.js';
import { authorizeInvoiceWithArca } from '../services/arca.js';

export const invoiceRoutes: FastifyPluginAsync = async (app) => {
  app.get('/invoices', async (request) => {
    const query = z.object({ companyId: z.string() }).parse(request.query);
    return prisma.invoice.findMany({
      where: { companyId: query.companyId },
      include: { customer: true, items: true, quote: true },
      orderBy: { issueDate: 'desc' }
    });
  });

  app.post('/quotes/:id/invoice-draft', async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ type: z.enum(['A', 'B']).default('B') }).parse(request.body ?? {});
    const quote = await prisma.quote.findUnique({
      where: { id: params.id },
      include: { customer: true, items: true }
    });
    if (!quote) return reply.code(404).send({ error: 'Quote not found' });
    if (body.type === 'A' && !quote.customer.cuit) return reply.code(422).send({ error: 'Factura A requiere CUIT del cliente' });

    const invoice = await prisma.invoice.create({
      data: {
        companyId: quote.companyId,
        customerId: quote.customerId,
        quoteId: quote.id,
        type: body.type,
        status: 'PENDING_CONFIRMATION',
        currency: quote.currency,
        subtotal: quote.subtotal,
        taxTotal: quote.taxTotal,
        total: quote.total,
        items: {
          create: quote.items.map((item: QuoteItem) => ({
            productId: item.productId,
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            taxRate: item.taxRate,
            total: item.total
          }))
        }
      },
      include: { items: true, customer: true }
    });

    return reply.code(201).send(invoice);
  });

  app.get('/invoices/:id/arca-preflight', async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const invoice = await prisma.invoice.findUnique({ where: { id: params.id }, include: { customer: true } });
    if (!invoice) return reply.code(404).send({ error: 'Invoice not found' });
    const missing = [
      !invoice.customer.cuit && invoice.type === 'A' ? 'CUIT del cliente' : null,
      !invoice.pointOfSale ? 'punto de venta ARCA' : null
    ].filter(Boolean);
    return { ok: missing.length === 0, environment: process.env.ARCA_ENVIRONMENT || 'homologacion', missing, type: invoice.type, customerCuit: invoice.customer.cuit || null };
  });

  app.post('/invoices/:id/authorize-arca', async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const invoice = await prisma.invoice.findUnique({ where: { id: params.id }, include: { customer: true } });
    if (!invoice) return reply.code(404).send({ error: 'Invoice not found' });
    if (invoice.status !== 'PENDING_CONFIRMATION') {
      return reply.code(409).send({ error: 'Invoice must be pending confirmation before ARCA authorization' });
    }

    const result = await authorizeInvoiceWithArca({
      invoiceId: invoice.id,
      type: invoice.type,
      customerCuit: invoice.customer.cuit,
      subtotal: Number(invoice.subtotal),
      taxTotal: Number(invoice.taxTotal),
      total: Number(invoice.total)
    });

    return prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        status: 'AUTHORIZED',
        cae: result.cae,
        caeDueDate: result.caeDueDate,
        pointOfSale: result.pointOfSale,
        number: result.number,
        arcaResponseJson: JSON.stringify(result.rawResponse)
      }
    });
  });
};
