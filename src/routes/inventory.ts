import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { normalizeName } from '../services/normalize.js';

type InventorySuggestion = {
  name: string;
  quantity: number;
  unit: string;
  source: string;
  confidence: number;
};

export const inventoryRoutes: FastifyPluginAsync = async (app) => {
  app.get('/inventory', async (request) => {
    const query = z.object({ companyId: z.string() }).parse(request.query);
    const [products, quoteItems, reviewedDocuments, comparison] = await Promise.all([
      prisma.product.findMany({
        where: { companyId: query.companyId, type: 'MATERIAL' },
        include: { supplierPrices: { include: { supplier: true }, orderBy: { price: 'asc' }, take: 5 } },
        orderBy: { name: 'asc' }
      }),
      prisma.quoteItem.findMany({
        where: { quote: { companyId: query.companyId } },
        include: { quote: { select: { number: true } } },
        orderBy: { id: 'desc' },
        take: 200
      }),
      prisma.document.findMany({
        where: { status: 'REVIEWED' },
        include: { extraction: true },
        orderBy: { createdAt: 'desc' },
        take: 50
      }),
      prisma.supplierProductPrice.findMany({
        where: { companyId: query.companyId, available: true },
        include: { supplier: true },
        orderBy: [{ price: 'asc' }, { observedAt: 'desc' }],
        take: 500
      })
    ]);

    const suggestions = new Map<string, InventorySuggestion>();

    for (const item of quoteItems) {
      const key = normalizeName(item.description);
      const current = suggestions.get(key);
      suggestions.set(key, {
        name: item.description,
        quantity: (current?.quantity ?? 0) + Number(item.quantity),
        unit: item.unit,
        source: current ? `${current.source}, Presupuesto #${item.quote.number}` : `Presupuesto #${item.quote.number}`,
        confidence: 0.72
      });
    }

    for (const document of reviewedDocuments) {
      const parsed = document.extraction?.extractedJson ? JSON.parse(document.extraction.extractedJson) : {};
      const items = Array.isArray(parsed.items) ? parsed.items : [];
      for (const raw of items) {
        if (!raw.description) continue;
        const key = normalizeName(String(raw.description));
        const current = suggestions.get(key);
        suggestions.set(key, {
          name: String(raw.description),
          quantity: (current?.quantity ?? 0) + Number(raw.quantity ?? 1),
          unit: String(raw.unit ?? current?.unit ?? 'unidad'),
          source: current ? `${current.source}, ${document.fileName}` : document.fileName,
          confidence: Math.max(current?.confidence ?? 0, Number(document.extraction?.confidence ?? 0.6))
        });
      }
    }

    return {
      products,
      supplierPrices: comparison,
      suggestions: [...suggestions.values()].sort((a, b) => b.quantity - a.quantity)
    };
  });

  app.post('/inventory/promote', async (request, reply) => {
    const body = z
      .object({
        companyId: z.string(),
        name: z.string().min(1),
        unit: z.string().default('unidad'),
        price: z.number().nonnegative().default(0),
        category: z.string().default('Importado')
      })
      .parse(request.body);

    const product = await prisma.product.create({
      data: {
        companyId: body.companyId,
        name: body.name,
        normalizedName: normalizeName(body.name),
        unit: body.unit,
        price: body.price,
        category: body.category,
        taxRate: 21
      }
    });

    return reply.code(201).send(product);
  });
};
