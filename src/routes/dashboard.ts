import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';

const asNumber = (value: unknown) => Number(value ?? 0);

export const dashboardRoutes: FastifyPluginAsync = async (app) => {
  app.get('/dashboard', async (request) => {
    const query = z.object({ companyId: z.string().optional() }).parse(request.query);
    const company = query.companyId
      ? await prisma.company.findUnique({ where: { id: query.companyId } })
      : await prisma.company.findFirst({ orderBy: { createdAt: 'asc' } });

    if (!company) {
      return {
        company: null,
        stats: { customers: 0, products: 0, quotes: 0, documentsPending: 0, invoicesPending: 0, quoteTotal: 0 },
        recentQuotes: [],
        recentDocuments: [],
        recentInvoices: []
      };
    }

    const [customers, products, quotes, documentsPending, invoicesPending, recentQuotes, recentDocuments, recentInvoices] =
      await Promise.all([
        prisma.customer.count({ where: { companyId: company.id } }),
        prisma.product.count({ where: { companyId: company.id } }),
        prisma.quote.findMany({ where: { companyId: company.id }, select: { total: true } }),
        prisma.document.count({ where: { status: 'PENDING_REVIEW' } }),
        prisma.invoice.count({ where: { companyId: company.id, status: 'PENDING_CONFIRMATION' } }),
        prisma.quote.findMany({
          where: { companyId: company.id },
          include: { customer: true },
          orderBy: { issueDate: 'desc' },
          take: 6
        }),
        prisma.document.findMany({ include: { extraction: true }, orderBy: { createdAt: 'desc' }, take: 6 }),
        prisma.invoice.findMany({
          where: { companyId: company.id },
          include: { customer: true },
          orderBy: { issueDate: 'desc' },
          take: 6
        })
      ]);

    return {
      company,
      stats: {
        customers,
        products,
        quotes: quotes.length,
        documentsPending,
        invoicesPending,
        quoteTotal: quotes.reduce((sum, quote) => sum + asNumber(quote.total), 0)
      },
      recentQuotes,
      recentDocuments,
      recentInvoices
    };
  });
};
