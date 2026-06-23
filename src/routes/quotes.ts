import type { FastifyPluginAsync } from 'fastify';
import type { QuoteItem } from '../../src/generated/postgres-client/index.js';
import { z } from 'zod';
import { prisma } from '../db.js';
import { calculateQuoteTotals } from '../domain/money.js';
import { convertDocxToPdf, writeFmhQuoteDocx } from '../services/fmhQuoteDocument.js';
import { renderQuotePdf } from '../services/pdf.js';

const quoteItemSchema = z.object({
  productId: z.string().optional(),
  description: z.string().min(1),
  quantity: z.number().positive(),
  unit: z.string().default('unidad'),
  unitPrice: z.number().nonnegative(),
  discount: z.number().min(0).max(100).default(0),
  taxRate: z.number().nonnegative().default(21)
});

const quoteSchema = z.object({
  companyId: z.string(),
  customerId: z.string(),
  validUntil: z.coerce.date().optional(),
  currency: z.string().default('ARS'),
  notes: z.string().optional(),
  createdById: z.string().optional(),
  items: z.array(quoteItemSchema).min(1)
});

export const quoteRoutes: FastifyPluginAsync = async (app) => {
  app.get('/quotes', async (request) => {
    const query = z.object({ companyId: z.string() }).parse(request.query);
    return prisma.quote.findMany({
      where: { companyId: query.companyId },
      include: { customer: true, items: true },
      orderBy: { issueDate: 'desc' }
    });
  });

  app.post('/quotes', async (request, reply) => {
    const body = quoteSchema.parse(request.body);
    const totals = calculateQuoteTotals(body.items);
    const last = await prisma.quote.findFirst({
      where: { companyId: body.companyId },
      orderBy: { number: 'desc' }
    });
    const number = (last?.number ?? 0) + 1;

    const quote = await prisma.quote.create({
      data: {
        companyId: body.companyId,
        customerId: body.customerId,
        number,
        validUntil: body.validUntil,
        currency: body.currency,
        notes: body.notes,
        createdById: body.createdById,
        subtotal: totals.subtotal,
        taxTotal: totals.taxTotal,
        total: totals.total,
        items: {
          create: body.items.map((item, index) => ({
            productId: item.productId,
            description: item.description,
            quantity: item.quantity,
            unit: item.unit,
            unitPrice: item.unitPrice,
            discount: item.discount,
            taxRate: item.taxRate,
            total: totals.lines[index]?.total ?? 0
          }))
        }
      },
      include: { customer: true, items: true }
    });

    return reply.code(201).send(quote);
  });

  app.post('/quotes/preview-totals', async (request) => {
    const body = z.object({ items: z.array(quoteItemSchema).min(1) }).parse(request.body);
    return calculateQuoteTotals(body.items);
  });

  app.post('/quotes/draft-from-items', async (request, reply) => {
    const body = quoteSchema
      .extend({
        marginPercent: z.number().min(-100).max(1000).default(0),
        source: z.string().optional()
      })
      .parse(request.body);
    const items = body.items.map((item) => ({
      ...item,
      unitPrice: Math.round((item.unitPrice * (1 + body.marginPercent / 100) + Number.EPSILON) * 100) / 100
    }));
    const totals = calculateQuoteTotals(items);
    const last = await prisma.quote.findFirst({
      where: { companyId: body.companyId },
      orderBy: { number: 'desc' }
    });
    const number = (last?.number ?? 0) + 1;

    const quote = await prisma.quote.create({
      data: {
        companyId: body.companyId,
        customerId: body.customerId,
        number,
        status: 'DRAFT',
        validUntil: body.validUntil,
        currency: body.currency,
        notes: [body.notes, body.source ? `Origen: ${body.source}` : undefined, body.marginPercent ? `Margen aplicado: ${body.marginPercent}%` : undefined]
          .filter(Boolean)
          .join('\n'),
        createdById: body.createdById,
        subtotal: totals.subtotal,
        taxTotal: totals.taxTotal,
        total: totals.total,
        items: {
          create: items.map((item, index) => ({
            productId: item.productId,
            description: item.description,
            quantity: item.quantity,
            unit: item.unit,
            unitPrice: item.unitPrice,
            discount: item.discount,
            taxRate: item.taxRate,
            total: totals.lines[index]?.total ?? 0
          }))
        }
      },
      include: { customer: true, items: true }
    });

    return reply.code(201).send(quote);
  });

  app.get('/quotes/:id/docx', async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const quote = await prisma.quote.findUnique({
      where: { id: params.id },
      include: { customer: true, items: true }
    });

    if (!quote) return reply.code(404).send({ error: 'Quote not found' });
    const docxPath = await writeFmhQuoteDocx(quote);
    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      .header('Content-Disposition', `attachment; filename="presupuesto-fmh-${quote.number}.docx"`)
      .send(await import('node:fs/promises').then((fs) => fs.readFile(docxPath)));
  });

  app.get('/quotes/:id/pdf', async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const quote = await prisma.quote.findUnique({
      where: { id: params.id },
      include: { customer: true, items: true }
    });

    if (!quote) return reply.code(404).send({ error: 'Quote not found' });

    const docxPath = await writeFmhQuoteDocx(quote);
    const convertedPdf = await convertDocxToPdf(docxPath);
    if (convertedPdf) {
      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="presupuesto-fmh-${quote.number}.pdf"`)
        .send(await import('node:fs/promises').then((fs) => fs.readFile(convertedPdf)));
    }

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
      items: quote.items.map((item: QuoteItem) => ({
        description: item.description,
        quantity: item.quantity.toString(),
        unit: item.unit,
        unitPrice: item.unitPrice.toString(),
        total: item.total.toString()
      }))
    });

    return reply.header('Content-Type', 'application/pdf').send(pdf);
  });
};
