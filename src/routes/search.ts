import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { searchBusinessKnowledge } from '../services/businessKnowledge.js';
import { normalizeName } from '../services/normalize.js';

export const searchRoutes: FastifyPluginAsync = async (app) => {
  app.get('/search', async (request) => {
    const query = z.object({ companyId: z.string(), q: z.string().trim().min(1) }).parse(request.query);
    const q = query.q;
    const normalized = normalizeName(q);
    const knowledge = await searchBusinessKnowledge({ companyId: query.companyId, q, take: 8 });

    const [customers, products, suppliers, supplierPrices, quotes, documents] = await Promise.all([
      prisma.customer.findMany({
        where: { companyId: query.companyId, OR: [{ legalName: { contains: q } }, { tradeName: { contains: q } }, { cuit: { contains: q } }] },
        take: 8,
        orderBy: { legalName: 'asc' }
      }),
      prisma.product.findMany({
        where: {
          companyId: query.companyId,
          active: true,
          OR: [{ name: { contains: q } }, { normalizedName: { contains: normalized } }, { sku: { contains: q } }, { category: { contains: q } }]
        },
        include: { supplierPrices: { include: { supplier: true }, orderBy: { price: 'asc' }, take: 5 } },
        take: 12,
        orderBy: { name: 'asc' }
      }),
      prisma.supplier.findMany({
        where: { companyId: query.companyId, OR: [{ name: { contains: q } }, { cuit: { contains: q } }] },
        include: { _count: { select: { prices: true } } },
        take: 8,
        orderBy: { name: 'asc' }
      }),
      prisma.supplierProductPrice.findMany({
        where: {
          companyId: query.companyId,
          OR: [{ rawName: { contains: q } }, { normalizedName: { contains: normalized } }, { supplierSku: { contains: q } }]
        },
        include: { supplier: true, product: true },
        take: 12,
        orderBy: [{ price: 'asc' }, { observedAt: 'desc' }]
      }),
      prisma.quote.findMany({
        where: { companyId: query.companyId, OR: [{ notes: { contains: q } }, { customer: { legalName: { contains: q } } }] },
        include: { customer: true, items: true },
        take: 8,
        orderBy: { issueDate: 'desc' }
      }),
      prisma.document.findMany({
        where: { OR: [{ companyId: query.companyId }, { companyId: null }], fileName: { contains: q } },
        include: { extraction: true },
        take: 8,
        orderBy: { createdAt: 'desc' }
      })
    ]);

    return { q, customers, products, suppliers, supplierPrices, quotes, documents, sources: knowledge.sources, summary: knowledge.summary };
  });
};
