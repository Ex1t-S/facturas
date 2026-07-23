import type { FastifyPluginAsync } from 'fastify';
import type { QuoteItem } from '../generated/postgres-client/index.js';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { authorizeInvoiceWithArca } from '../services/arca.js';
import { runSerializableTransaction } from '../services/transaction.js';

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
    const body = z.object({ type: z.enum(['A', 'B']).default('B'), companyId: z.string().optional() }).parse(request.body ?? {});
    const result = await runSerializableTransaction(async (tx) => {
      const quote = await tx.quote.findFirst({
        where: { id: params.id, companyId: body.companyId },
        include: { customer: true, items: true }
      });
      if (!quote) return { error: 'Quote not found', status: 404 as const };
      if (body.type === 'A' && !/^\d{11}$/.test(quote.customer.cuit || '')) {
        return { error: 'Factura A requiere CUIT del cliente', status: 422 as const };
      }

      const existing = await tx.invoice.findFirst({
        where: { companyId: quote.companyId, quoteId: quote.id },
        include: { items: true, customer: true }
      });
      if (existing && existing.type !== body.type) {
        return {
          error: `El presupuesto ya tiene una factura ${existing.type} en estado ${existing.status}.`,
          status: 409 as const
        };
      }
      if (existing) return { invoice: existing, created: false };

      const invoice = await tx.invoice.create({
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
      await tx.quote.update({ where: { id: quote.id }, data: { status: 'INVOICED' } });
      await tx.deliveryNote.updateMany({
        where: { companyId: quote.companyId, quoteLinks: { some: { quoteId: quote.id } } },
        data: { status: 'INVOICED' }
      });
      await tx.auditLog.create({
        data: {
          entityType: 'INVOICE',
          entityId: invoice.id,
          action: 'CREATE_DRAFT_FROM_QUOTE',
          afterJson: JSON.stringify({ quoteId: quote.id, companyId: quote.companyId, type: body.type })
        }
      });
      return { invoice, created: true };
    }, { retryUniqueConflict: true });

    if ('error' in result) return reply.code(result.status ?? 500).send({ error: result.error });
    return reply.code(result.created ? 201 : 200).send({ ...result.invoice, replayed: !result.created });
  });

  app.get('/invoices/:id/arca-preflight', async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const query = z.object({ companyId: z.string() }).parse(request.query);
    const invoice = await prisma.invoice.findFirst({ where: { id: params.id, companyId: query.companyId }, include: { customer: true } });
    if (!invoice) return reply.code(404).send({ error: 'Invoice not found' });
    const missing = [
      invoice.type === 'A' && !/^\d{11}$/.test(invoice.customer.cuit || '') ? 'CUIT válido de 11 dígitos del cliente' : null,
      !config.ARCA_CUIT ? 'CUIT emisor ARCA' : null,
      !config.ARCA_POINT_OF_SALE ? 'punto de venta ARCA' : null,
      !config.ARCA_CERT_PATH ? 'certificado ARCA' : null,
      !config.ARCA_KEY_PATH ? 'clave privada ARCA' : null,
      'integración WSAA/WSFEv1 pendiente de homologación'
    ].filter(Boolean);
    return { ok: false, environment: config.ARCA_ENVIRONMENT, missing, type: invoice.type, customerCuit: invoice.customer.cuit || null };
  });

  app.post('/invoices/:id/authorize-arca', async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ companyId: z.string() }).parse(request.body);
    const invoice = await prisma.invoice.findFirst({ where: { id: params.id, companyId: body.companyId }, include: { customer: true } });
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
