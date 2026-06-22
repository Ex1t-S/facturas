import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { normalizeName } from '../services/normalize.js';

const productSchema = z.object({
  companyId: z.string(),
  sku: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  unit: z.string().default('unidad'),
  category: z.string().optional(),
  type: z.enum(['PRODUCT', 'MATERIAL', 'SERVICE']).default('MATERIAL'),
  baseCost: z.number().nonnegative().default(0),
  price: z.number().nonnegative(),
  taxRate: z.number().nonnegative().default(21),
  active: z.boolean().default(true)
});

export const productRoutes: FastifyPluginAsync = async (app) => {
  app.get('/products', async (request) => {
    const query = z
      .object({
        companyId: z.string(),
        q: z.string().optional(),
        category: z.string().optional(),
        type: z.enum(['PRODUCT', 'MATERIAL', 'SERVICE', 'all']).default('all'),
        priceStatus: z.enum(['all', 'missing', 'priced']).default('all'),
        supplierStatus: z.enum(['all', 'missing', 'linked']).default('all'),
        stockTracked: z.coerce.boolean().optional(),
        active: z.coerce.boolean().optional(),
        sort: z.enum(['name', 'priceAsc', 'priceDesc', 'createdDesc']).default('name'),
        take: z.coerce.number().int().positive().max(500).default(200)
      })
      .parse(request.query);
    const normalized = query.q ? normalizeName(query.q) : undefined;
    const orderBy =
      query.sort === 'priceAsc'
        ? { price: 'asc' as const }
        : query.sort === 'priceDesc'
          ? { price: 'desc' as const }
          : query.sort === 'createdDesc'
            ? { createdAt: 'desc' as const }
            : { name: 'asc' as const };
    return prisma.product.findMany({
      where: {
        companyId: query.companyId,
        active: query.active,
        category: query.category,
        type: query.type === 'all' ? undefined : query.type,
        stockTracked: query.stockTracked,
        price: query.priceStatus === 'missing' ? 0 : query.priceStatus === 'priced' ? { gt: 0 } : undefined,
        supplierPrices: query.supplierStatus === 'missing' ? { none: {} } : query.supplierStatus === 'linked' ? { some: {} } : undefined,
        OR: query.q
          ? [
              { name: { contains: query.q } },
              { normalizedName: { contains: normalized } },
              { aliasesJson: { contains: normalized } },
              { sku: { contains: query.q } },
              { description: { contains: query.q } },
              { category: { contains: query.q } }
            ]
          : undefined
      },
      include: { supplierPrices: { include: { supplier: true }, orderBy: { price: 'asc' }, take: 5 } },
      take: query.take,
      orderBy
    });
  });

  app.post('/products', async (request, reply) => {
    const body = productSchema.parse(request.body);
    const product = await prisma.product.create({ data: { ...body, normalizedName: normalizeName(body.name) } });
    return reply.code(201).send(product);
  });
};
