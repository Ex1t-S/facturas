import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { calculateQuoteTotals } from '../domain/money.js';
import { extractDocumentFromFile } from '../services/documentExtraction.js';
import { buildPreview, isImageMime, isPdfMime } from '../services/documentPreview.js';
import { readStoredDocumentFile, resolveStoredDocumentPath, writeDocumentFile } from '../services/documentStorage.js';
import { importHistoricalDocuments, scanHistoricalDocuments } from '../services/historicalImport.js';

const normalizedDocumentSchema = z.object({
  document: z
    .object({
      kind: z.enum(['QUOTE', 'INVOICE', 'PURCHASE_INVOICE', 'DELIVERY_NOTE', 'UNKNOWN']).default('UNKNOWN'),
      date: z.coerce.date().optional(),
      number: z.string().optional(),
      currency: z.string().default('ARS')
    })
    .optional(),
  customer: z
    .object({
      legalName: z.string().optional(),
      tradeName: z.string().optional(),
      cuit: z.string().optional(),
      taxCondition: z.string().optional(),
      address: z.string().optional()
    })
    .optional(),
  items: z
    .array(
      z.object({
        description: z.string().min(1),
        quantity: z.number().optional(),
        unit: z.string().optional(),
        unitPrice: z.number().optional(),
        total: z.number().optional(),
        taxRate: z.number().optional(),
        sku: z.string().optional(),
        category: z.string().optional(),
        type: z.enum(['PRODUCT', 'MATERIAL', 'SERVICE']).default('PRODUCT')
      })
    )
    .default([]),
  totals: z.object({ total: z.number().optional() }).optional()
});

function normalizeName(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('es-AR');
}

function documentKindLabel(kind: string) {
  if (kind === 'QUOTE') return 'Presupuestos';
  if (kind === 'INVOICE') return 'Facturas';
  if (kind === 'PURCHASE_INVOICE') return 'Facturas compra';
  if (kind === 'DELIVERY_NOTE') return 'Remitos';
  return 'Sin clasificar';
}

function monthLabel(month: number) {
  return ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'][month] ?? 'Sin mes';
}

function readOriginalPath(fieldConfidence?: string | null) {
  if (!fieldConfidence) return '';
  try {
    const parsed = JSON.parse(fieldConfidence);
    return typeof parsed.originalPath === 'string' ? parsed.originalPath : '';
  } catch {
    return '';
  }
}

function inferDocumentDate(document: { documentDate?: Date | null; createdAt?: Date; fileName: string; extraction?: { fieldConfidence?: string | null } | null }) {
  if (document.documentDate) return document.documentDate;
  const source = `${document.fileName} ${readOriginalPath(document.extraction?.fieldConfidence)}`.toLocaleLowerCase('es-AR');
  const yearMatch = source.match(/\b(19\d{2}|20\d{2})\b/);
  if (!yearMatch) return document.createdAt ?? new Date();

  const months = [
    ['enero', 0],
    ['febrero', 1],
    ['marzo', 2],
    ['abril', 3],
    ['mayo', 4],
    ['junio', 5],
    ['julio', 6],
    ['agosto', 7],
    ['septiembre', 8],
    ['setiembre', 8],
    ['octubre', 9],
    ['noviembre', 10],
    ['diciembre', 11]
  ] as const;
  const month = months.find(([name]) => source.includes(name))?.[1] ?? 0;
  return new Date(Number(yearMatch[1]), month, 1);
}

function documentYear(document: { documentDate?: Date | null; createdAt?: Date; fileName: string; extraction?: { fieldConfidence?: string | null } | null }) {
  return String(inferDocumentDate(document).getFullYear());
}

function documentMonth(document: { documentDate?: Date | null; createdAt?: Date; fileName: string; extraction?: { fieldConfidence?: string | null } | null }) {
  return inferDocumentDate(document).getMonth() + 1;
}

function shortDocumentName(fileName: string) {
  return fileName
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/^(presupuesto|factura|fact|remito)\s*/i, '')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function safeCustomerName(document: { issuerName?: string | null; fileName?: string; customerCandidates?: Array<{ legalName?: string | null }> }) {
  const candidate = document.issuerName || document.customerCandidates?.find((item) => item.legalName)?.legalName;
  if (candidate) return candidate;
  const normalized = (document.fileName ?? '').replace(/\.[a-z0-9]+$/i, '').replace(/^(fact|factura|presupuesto|remito)\s+/i, '').trim();
  const withoutDate = normalized.replace(/\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|19\d{2}|20\d{2}|\d{1,2})\b/gi, ' ').replace(/\s+/g, ' ').trim();
  return withoutDate ? withoutDate.slice(0, 70) : 'Sin cliente';
}

export const documentRoutes: FastifyPluginAsync = async (app) => {
  app.post('/documents', async (request, reply) => {
    const data = await request.file();
    if (!data) return reply.code(400).send({ error: 'File is required' });

    const buffer = await data.toBuffer();
    const { sha256, storagePath } = await writeDocumentFile({
      buffer,
      filename: data.filename,
      mimeType: data.mimetype,
      sourceType: 'upload'
    });

    const document = await prisma.document.create({
      data: {
        sourceType: 'upload',
        fileName: data.filename,
        mimeType: data.mimetype,
        storagePath,
        sha256,
        extraction: {
          create: {
            rawText: '',
            extractedJson: JSON.stringify({ status: 'pending_ocr' }),
            confidence: 0
          }
        }
      },
      include: { extraction: true }
    });

    return reply.code(201).send(document);
  });

  app.post('/documents/import-historical', async (request) => {
    const body = z
      .object({
        rootPath: z.string().optional(),
        companyId: z.string().optional(),
        limit: z.number().int().positive().max(2000).default(250),
        dryRun: z.boolean().default(false)
      })
      .parse(request.body ?? {});

    const rootPath = body.rootPath ?? config.HISTORICAL_DOCUMENT_ROOT;
    const resolved = path.resolve(rootPath);
    const allowedRoot = path.resolve(config.HISTORICAL_DOCUMENT_ROOT);
    if (!resolved.toLowerCase().startsWith(allowedRoot.toLowerCase())) {
      throw new Error('Historical import path must be inside HISTORICAL_DOCUMENT_ROOT');
    }

    return body.dryRun
      ? scanHistoricalDocuments({ rootPath: resolved, companyId: body.companyId, limit: body.limit, dryRun: true })
      : importHistoricalDocuments({ rootPath: resolved, companyId: body.companyId, limit: body.limit });
  });

  app.get('/documents', async (request) => {
    const query = z
      .object({
        companyId: z.string().optional(),
        q: z.string().trim().optional(),
        kind: z.enum(['QUOTE', 'INVOICE', 'PURCHASE_INVOICE', 'DELIVERY_NOTE', 'UNKNOWN']).optional(),
        status: z.enum(['PENDING_REVIEW', 'REVIEWED', 'REJECTED']).optional(),
        extractionStatus: z.enum(['UPLOADED', 'TEXT_EXTRACTED', 'STRUCTURED', 'NEEDS_REVIEW', 'APPROVED', 'APPLIED', 'FAILED']).optional(),
        customer: z.string().trim().optional(),
        cuit: z.string().trim().optional(),
        year: z.coerce.number().int().optional(),
        month: z.coerce.number().int().min(1).max(12).optional(),
        dateFrom: z.coerce.date().optional(),
        dateTo: z.coerce.date().optional(),
        hasText: z.coerce.boolean().optional(),
        take: z.coerce.number().int().positive().max(1000).default(300),
        skip: z.coerce.number().int().min(0).default(0)
      })
      .parse(request.query);

    const documents = await prisma.document.findMany({
      where: {
        OR: query.companyId ? [{ companyId: query.companyId }, { companyId: null }] : undefined,
        kind: query.kind,
        status: query.status,
        extractionStatus: query.extractionStatus,
        documentDate: { gte: query.dateFrom, lte: query.dateTo },
        AND: [
          query.q
            ? {
                OR: [
                  { fileName: { contains: query.q } },
                  { issuerName: { contains: query.q } },
                  { customerCandidates: { some: { legalName: { contains: query.q } } } }
                ]
              }
            : {},
          query.customer ? { OR: [{ issuerName: { contains: query.customer } }, { customerCandidates: { some: { legalName: { contains: query.customer } } } }] } : {},
          query.cuit ? { OR: [{ issuerCuit: { contains: query.cuit } }, { customerCandidates: { some: { cuit: { contains: query.cuit } } } }] } : {},
          query.hasText === true ? { extraction: { is: { rawText: { not: '' } } } } : {},
          query.hasText === false ? { OR: [{ extraction: null }, { extraction: { is: { rawText: '' } } }] } : {}
        ]
      },
      include: { extraction: true, customerCandidates: true },
      take: query.take,
      skip: query.skip,
      orderBy: [{ documentDate: 'desc' }, { createdAt: 'desc' }]
    });
    return documents
      .filter((document) => (query.year ? Number(documentYear(document)) === query.year : true))
      .filter((document) => (query.month ? documentMonth(document) === query.month : true))
      .map((document) => ({
        ...document,
        inferredDate: inferDocumentDate(document),
        displayCustomer: safeCustomerName(document),
        displayName: shortDocumentName(document.fileName)
      }));
  });

  app.get('/documents/tree', async (request) => {
    const query = z
      .object({
        companyId: z.string().optional(),
        q: z.string().trim().optional(),
        customer: z.string().trim().optional(),
        year: z.coerce.number().int().optional(),
        kind: z.enum(['QUOTE', 'INVOICE', 'PURCHASE_INVOICE', 'DELIVERY_NOTE', 'UNKNOWN']).optional(),
        take: z.coerce.number().int().positive().max(2500).default(1200)
      })
      .parse(request.query);

    const documents = await prisma.document.findMany({
      where: {
        OR: query.companyId ? [{ companyId: query.companyId }, { companyId: null }] : undefined,
        kind: query.kind,
        AND: [
          query.q
            ? {
                OR: [
                  { fileName: { contains: query.q } },
                  { issuerName: { contains: query.q } },
                  { customerCandidates: { some: { legalName: { contains: query.q } } } }
                ]
              }
            : {},
          query.customer ? { OR: [{ issuerName: { contains: query.customer } }, { customerCandidates: { some: { legalName: { contains: query.customer } } } }] } : {}
        ]
      },
      include: { extraction: true, customerCandidates: true },
      orderBy: [{ documentDate: 'desc' }, { createdAt: 'desc' }],
      take: query.take
    });

    const filtered = query.year ? documents.filter((document) => Number(documentYear(document)) === query.year) : documents;
    const sections = new Map<
      string,
      {
        kind: string;
        label: string;
        count: number;
        years: Map<
          string,
          {
            year: string;
            count: number;
            months: Map<
              string,
              { month: number; label: string; count: number; documents: typeof filtered }
            >;
          }
        >;
      }
    >();

    for (const document of filtered) {
      const kind = document.kind;
      const inferredDate = inferDocumentDate(document);
      const year = documentYear(document);
      const month = documentMonth(document);
      if (!sections.has(kind)) sections.set(kind, { kind, label: documentKindLabel(kind), count: 0, years: new Map() });
      const section = sections.get(kind)!;
      section.count += 1;
      if (!section.years.has(year)) section.years.set(year, { year, count: 0, months: new Map() });
      const yearNode = section.years.get(year)!;
      yearNode.count += 1;
      const monthKey = String(month).padStart(2, '0');
      if (!yearNode.months.has(monthKey)) yearNode.months.set(monthKey, { month, label: monthLabel(month - 1), count: 0, documents: [] });
      const monthNode = yearNode.months.get(monthKey)!;
      monthNode.count += 1;
      monthNode.documents.push(document);
    }

    return {
      count: filtered.length,
      sections: [...sections.values()].map((section) => ({
        kind: section.kind,
        label: section.label,
        count: section.count,
        years: [...section.years.values()]
          .sort((a, b) => Number(b.year) - Number(a.year))
          .map((year) => ({
            year: year.year,
            count: year.count,
            months: [...year.months.values()]
              .sort((a, b) => b.month - a.month)
              .map((month) => ({
                month: month.month,
                label: month.label,
                count: month.count,
                documents: month.documents.map((document) => ({
                  id: document.id,
                  fileName: document.fileName,
                  displayName: shortDocumentName(document.fileName),
                  kind: document.kind,
                  documentDate: document.documentDate,
                  inferredDate: inferDocumentDate(document),
                  createdAt: document.createdAt,
                  issuerName: document.issuerName,
                  displayCustomer: safeCustomerName(document),
                  issuerCuit: document.issuerCuit,
                  externalNumber: document.externalNumber,
                  currency: document.currency,
                  total: document.total,
                  extractionStatus: document.extractionStatus,
                  mimeType: document.mimeType,
                  sourceType: document.sourceType
                }))
              }))
          }))
      }))
    };
  });

  app.get('/documents/:id/content', async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const document = await prisma.document.findUnique({ where: { id: params.id } });
    if (!document) return reply.code(404).send({ error: 'Document not found' });

    const buffer = await readStoredDocumentFile(document.storagePath);
    const disposition = isPdfMime(document.mimeType, document.fileName) || isImageMime(document.mimeType, document.fileName) ? 'inline' : 'attachment';

    return reply
      .header('Content-Type', document.mimeType)
      .header('Content-Disposition', `${disposition}; filename="${encodeURIComponent(document.fileName)}"`)
      .send(buffer);
  });

  app.get('/documents/:id/download', async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const document = await prisma.document.findUnique({ where: { id: params.id } });
    if (!document) return reply.code(404).send({ error: 'Document not found' });

    const buffer = await readStoredDocumentFile(document.storagePath);

    return reply
      .header('Content-Type', document.mimeType)
      .header('Content-Disposition', `attachment; filename="${encodeURIComponent(document.fileName)}"`)
      .send(buffer);
  });

  app.get('/documents/:id/preview', async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const document = await prisma.document.findUnique({ where: { id: params.id } });
    if (!document) return reply.code(404).send({ error: 'Document not found' });

    return buildPreview(document);
  });

  app.post('/documents/:id/extract', async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const document = await prisma.document.findUnique({ where: { id: params.id } });
    if (!document) return reply.code(404).send({ error: 'Document not found' });

    const filePath = resolveStoredDocumentPath(document.storagePath);
    const extracted = await extractDocumentFromFile(filePath, document.fileName);
    return prisma.document.update({
      where: { id: document.id },
      data: {
        kind: extracted.document?.kind ?? document.kind,
        extractionStatus: extracted.items.length > 0 ? 'STRUCTURED' : 'NEEDS_REVIEW',
        documentDate: extracted.document?.date,
        externalNumber: extracted.document?.number,
        currency: extracted.document?.currency ?? document.currency,
        total: extracted.totals?.total,
        extraction: {
          upsert: {
            create: {
              engine: extracted.source.engine,
              rawText: extracted.source.rawText ?? '',
              extractedJson: JSON.stringify(extracted),
              normalizedJson: extracted.items.length > 0 ? JSON.stringify(extracted) : undefined,
              confidence: extracted.source.confidence,
              fieldConfidence: JSON.stringify({ warnings: extracted.source.warnings })
            },
            update: {
              engine: extracted.source.engine,
              rawText: extracted.source.rawText ?? '',
              extractedJson: JSON.stringify(extracted),
              normalizedJson: extracted.items.length > 0 ? JSON.stringify(extracted) : undefined,
              confidence: extracted.source.confidence,
              fieldConfidence: JSON.stringify({ warnings: extracted.source.warnings })
            }
          }
        }
      },
      include: { extraction: true }
    });
  });

  app.post('/documents/:id/restore-file', async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const document = await prisma.document.findUnique({ where: { id: params.id } });
    if (!document) return reply.code(404).send({ error: 'Document not found' });

    const data = await request.file();
    if (!data) return reply.code(400).send({ error: 'File is required' });

    const buffer = await data.toBuffer();
    const restored = await writeDocumentFile({
      buffer,
      filename: document.fileName || data.filename,
      mimeType: document.mimeType || data.mimetype,
      sourceType: 'restore'
    });

    if (document.sha256 && document.sha256 !== restored.sha256) {
      return reply.code(409).send({ error: 'Uploaded file does not match stored document hash' });
    }

    return prisma.document.update({
      where: { id: document.id },
      data: {
        storagePath: restored.storagePath,
        sha256: restored.sha256,
        mimeType: document.mimeType || data.mimetype
      }
    });
  });

  app.post('/documents/:id/review', async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ extractedJson: normalizedDocumentSchema, reviewedBy: z.string().optional() }).parse(request.body);
    const normalized = body.extractedJson;

    return prisma.document.update({
      where: { id: params.id },
      data: {
        status: 'REVIEWED',
        kind: normalized.document?.kind ?? 'UNKNOWN',
        extractionStatus: 'STRUCTURED',
        documentDate: normalized.document?.date,
        externalNumber: normalized.document?.number,
        currency: normalized.document?.currency ?? 'ARS',
        total: normalized.totals?.total,
        extraction: {
          update: {
            extractedJson: JSON.stringify(normalized),
            normalizedJson: JSON.stringify(normalized),
            reviewedBy: body.reviewedBy,
            reviewedAt: new Date(),
            confidence: 1
          }
        }
      },
      include: { extraction: true }
    });
  });

  app.post('/documents/:id/match', async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ companyId: z.string() }).parse(request.body);
    const document = await prisma.document.findUnique({ where: { id: params.id }, include: { extraction: true } });
    if (!document) return reply.code(404).send({ error: 'Document not found' });

    const normalized = normalizedDocumentSchema.parse(
      document.extraction?.normalizedJson
        ? JSON.parse(document.extraction.normalizedJson)
        : document.extraction?.extractedJson
          ? JSON.parse(document.extraction.extractedJson)
          : {}
    );

    await prisma.documentItemCandidate.deleteMany({ where: { documentId: document.id } });
    await prisma.customerCandidate.deleteMany({ where: { documentId: document.id } });

    let customerCandidate = null;
    if (normalized.customer) {
      const matchedCustomer = normalized.customer.cuit
        ? await prisma.customer.findFirst({ where: { companyId: body.companyId, cuit: normalized.customer.cuit } })
        : null;
      customerCandidate = await prisma.customerCandidate.create({
        data: {
          documentId: document.id,
          legalName: normalized.customer.legalName,
          tradeName: normalized.customer.tradeName,
          cuit: normalized.customer.cuit,
          taxCondition: normalized.customer.taxCondition,
          address: normalized.customer.address,
          matchedCustomerId: matchedCustomer?.id,
          confidence: matchedCustomer ? 0.95 : 0.65
        }
      });
    }

    const candidates = [];
    for (const [index, item] of normalized.items.entries()) {
      const normalizedName = normalizeName(item.description);
      const matchedProduct = await prisma.product.findFirst({
        where: {
          companyId: body.companyId,
          OR: [{ normalizedName }, { sku: item.sku }, { name: { equals: item.description } }]
        }
      });
      candidates.push(
        await prisma.documentItemCandidate.create({
          data: {
            documentId: document.id,
            lineNumber: index + 1,
            rawDescription: item.description,
            normalizedName,
            quantity: item.quantity,
            unit: item.unit,
            unitPrice: item.unitPrice,
            total: item.total,
            taxRate: item.taxRate,
            sku: item.sku,
            category: item.category,
            entityType: item.type,
            matchedProductId: matchedProduct?.id,
            confidence: matchedProduct ? 0.9 : 0.68
          }
        })
      );
    }

    await prisma.document.update({
      where: { id: document.id },
      data: { companyId: body.companyId, extractionStatus: 'NEEDS_REVIEW' }
    });

    return { customerCandidate, itemCandidates: candidates };
  });

  app.post('/documents/:id/create-quote-draft', async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({
        companyId: z.string(),
        customerId: z.string().optional(),
        marginPercent: z.number().min(-100).max(1000).default(0),
        defaultTaxRate: z.number().min(0).max(100).default(21)
      })
      .parse(request.body ?? {});

    const document = await prisma.document.findUnique({ where: { id: params.id }, include: { extraction: true } });
    if (!document) return reply.code(404).send({ error: 'Document not found' });

    const extracted = normalizedDocumentSchema
      .extend({ source: z.unknown().optional() })
      .parse(
        document.extraction?.normalizedJson
          ? JSON.parse(document.extraction.normalizedJson)
          : document.extraction?.extractedJson
            ? JSON.parse(document.extraction.extractedJson)
            : {}
      );

    if (extracted.items.length === 0) return reply.code(409).send({ error: 'Document has no extracted items to quote' });

    let customerId = body.customerId;
    if (!customerId && extracted.customer?.cuit) {
      const customer = await prisma.customer.findFirst({ where: { companyId: body.companyId, cuit: extracted.customer.cuit } });
      customerId = customer?.id;
    }
    if (!customerId) {
      const customer = await prisma.customer.create({
        data: {
          companyId: body.companyId,
          legalName: extracted.customer?.legalName || `Cliente pendiente - ${document.fileName.slice(0, 42)}`,
          cuit: extracted.customer?.cuit,
          address: extracted.customer?.address,
          notes: `Creado automáticamente desde documento ${document.fileName}. Revisar datos antes de enviar o facturar.`
        }
      });
      customerId = customer.id;
    }

    const items = extracted.items.map((item) => {
      const base = Number(item.unitPrice ?? item.total ?? 0);
      const unitPrice = Math.round((base * (1 + body.marginPercent / 100) + Number.EPSILON) * 100) / 100;
      return {
        productId: undefined,
        description: item.description,
        quantity: Number(item.quantity ?? 1),
        unit: item.unit ?? 'trabajo',
        unitPrice,
        discount: 0,
        taxRate: item.taxRate ?? body.defaultTaxRate
      };
    });
    const totals = calculateQuoteTotals(items);
    const last = await prisma.quote.findFirst({ where: { companyId: body.companyId }, orderBy: { number: 'desc' } });
    const number = (last?.number ?? 0) + 1;

    const quote = await prisma.quote.create({
      data: {
        companyId: body.companyId,
        customerId,
        number,
        status: 'DRAFT',
        currency: extracted.document?.currency ?? document.currency,
        notes: `Borrador generado desde ${document.kind} ${document.fileName}. Revisar precios, margen e IVA antes de enviar.`,
        subtotal: totals.subtotal,
        taxTotal: totals.taxTotal,
        total: totals.total,
        items: {
          create: items.map((item, index) => ({ ...item, total: totals.lines[index]?.total ?? 0 }))
        }
      },
      include: { customer: true, items: true }
    });

    await prisma.document.update({ where: { id: document.id }, data: { companyId: body.companyId, extractionStatus: 'NEEDS_REVIEW' } });
    return reply.code(201).send(quote);
  });

  app.get('/documents/:id/review', async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const document = await prisma.document.findUnique({
      where: { id: params.id },
      include: { extraction: true, customerCandidates: true, itemCandidates: { include: { matchedProduct: true } } }
    });
    if (!document) return reply.code(404).send({ error: 'Document not found' });
    return document;
  });
};
