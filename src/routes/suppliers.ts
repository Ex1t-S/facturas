import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { bestTechnicalSimilarity, normalizeName, similarity } from '../services/normalize.js';
import { publicSupplierSources, syncPublicSupplierPrices } from '../services/supplierPublicSync.js';

const supplierSchema = z.object({
  companyId: z.string(),
  name: z.string().min(1),
  cuit: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  website: z.string().url().optional(),
  notes: z.string().optional()
});

const priceItemSchema = z.object({
  productId: z.string().optional(),
  supplierSku: z.string().optional(),
  name: z.string().min(1),
  unit: z.string().default('unidad'),
  currency: z.string().default('ARS'),
  price: z.number().nonnegative(),
  taxIncluded: z.boolean().default(false),
  available: z.boolean().default(true),
  notes: z.string().optional()
});

async function buildMaterialPriceReferences(companyId: string, take?: number) {
  const [products, prices] = await Promise.all([
    prisma.product.findMany({
      where: { companyId, active: true, type: 'MATERIAL' },
      orderBy: { name: 'asc' },
      take: take ? Math.max(take * 3, take) : undefined
    }),
    prisma.supplierProductPrice.findMany({
      where: { companyId, available: true },
      include: { supplier: true },
      orderBy: [{ price: 'asc' }, { observedAt: 'desc' }]
    })
  ]);

  return products
    .map((product) => {
      const normalized = product.normalizedName || normalizeName(product.name);
      const candidates = prices
        .map((price) => ({
          ...price,
          matchScore:
            price.productId === product.id
              ? 1
              : Math.max(
                  similarity(normalized, price.normalizedName),
                  similarity(product.name, price.rawName),
                  bestTechnicalSimilarity(price.rawName, [
                    product.name,
                    product.normalizedName || '',
                    product.aliasesJson || '',
                    product.metadataJson || ''
                  ])
                )
        }))
        .filter((price) => price.productId === product.id || price.matchScore >= 0.45)
        .sort((a, b) => Number(a.price) - Number(b.price));
      const best = candidates[0] ?? null;

      return {
        product,
        best,
        alternatives: candidates.slice(0, 5),
        savingsVsCurrent:
          best && Number(product.baseCost) > 0 ? Math.max(0, Number(product.baseCost) - Number(best.price)) : null
      };
    })
    .filter((item) => item.best || item.alternatives.length > 0)
    .slice(0, take ?? undefined);
}

export const supplierRoutes: FastifyPluginAsync = async (app) => {
  app.get('/suppliers', async (request) => {
    const query = z.object({ companyId: z.string() }).parse(request.query);
    return prisma.supplier.findMany({
      where: { companyId: query.companyId },
      include: { _count: { select: { prices: true, priceLists: true } } },
      orderBy: { name: 'asc' }
    });
  });

  app.post('/suppliers', async (request, reply) => {
    const body = supplierSchema.parse(request.body);
    const supplier = await prisma.supplier.upsert({
      where: { companyId_name: { companyId: body.companyId, name: body.name } },
      update: body,
      create: body
    });
    return reply.code(201).send(supplier);
  });

  app.post('/suppliers/:id/prices', async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({
        companyId: z.string(),
        name: z.string().default('Lista manual'),
        sourceType: z.string().default('manual'),
        currency: z.string().default('ARS'),
        validFrom: z.coerce.date().optional(),
        notes: z.string().optional(),
        items: z.array(priceItemSchema).min(1)
      })
      .parse(request.body);

    const supplier = await prisma.supplier.findUnique({ where: { id: params.id } });
    if (!supplier) return reply.code(404).send({ error: 'Supplier not found' });

    const priceList = await prisma.supplierPriceList.create({
      data: {
        companyId: body.companyId,
        supplierId: supplier.id,
        name: body.name,
        sourceType: body.sourceType,
        currency: body.currency,
        validFrom: body.validFrom,
        notes: body.notes,
        prices: {
          create: body.items.map((item) => ({
            companyId: body.companyId,
            supplierId: supplier.id,
            productId: item.productId,
            supplierSku: item.supplierSku,
            rawName: item.name,
            normalizedName: normalizeName(item.name),
            unit: item.unit,
            currency: item.currency || body.currency,
            price: item.price,
            taxIncluded: item.taxIncluded,
            available: item.available,
            notes: item.notes
          }))
        }
      },
      include: { prices: true }
    });

    return reply.code(201).send(priceList);
  });

  app.get('/supplier-public-sources', async () => {
    return publicSupplierSources();
  });

  app.post('/supplier-public-sync', async (request, reply) => {
    const body = z.object({ companyId: z.string() }).parse(request.body);
    const result = await syncPublicSupplierPrices(body.companyId);
    return reply.code(201).send(result);
  });

  app.get('/material-price-references', async (request) => {
    const query = z.object({ companyId: z.string(), take: z.coerce.number().int().positive().max(100).default(20) }).parse(request.query);
    return buildMaterialPriceReferences(query.companyId, query.take);
  });

  app.get('/supplier-prices', async (request) => {
    const query = z
      .object({
        companyId: z.string(),
        productId: z.string().optional(),
        supplierId: z.string().optional(),
        q: z.string().optional(),
        unlinked: z.coerce.boolean().optional(),
        take: z.coerce.number().int().positive().max(1000).default(300)
      })
      .parse(request.query);
    const normalized = query.q ? normalizeName(query.q) : undefined;
    return prisma.supplierProductPrice.findMany({
      where: {
        companyId: query.companyId,
        productId: query.unlinked ? null : query.productId,
        supplierId: query.supplierId,
        OR: query.q
          ? [{ rawName: { contains: query.q } }, { normalizedName: { contains: normalized } }, { supplierSku: { contains: query.q } }]
          : undefined
      },
      include: { supplier: true, product: true, priceList: true },
      take: query.take,
      orderBy: [{ available: 'desc' }, { price: 'asc' }, { observedAt: 'desc' }]
    });
  });

  app.post('/supplier-prices/:id/link-product', async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ productId: z.string() }).parse(request.body);
    const price = await prisma.supplierProductPrice.update({
      where: { id: params.id },
      data: { productId: body.productId },
      include: { supplier: true, product: true }
    });

    await prisma.product.update({
      where: { id: body.productId },
      data: { lastCost: price.price, baseCost: price.price }
    });

    return price;
  });

  app.get('/price-comparison', async (request) => {
    const query = z.object({ companyId: z.string() }).parse(request.query);
    return buildMaterialPriceReferences(query.companyId);
  });
};
