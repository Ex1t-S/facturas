import { DocumentKind, ExtractionStatus, DocumentStatus } from '../../src/generated/postgres-client/index.js';
import { prisma } from '../db.js';
import { normalizeName } from './normalize.js';

export type KnowledgeSource = {
  type: 'customer' | 'product' | 'supplierPrice' | 'quote' | 'document';
  id: string;
  title: string;
  subtitle?: string;
  url?: string;
};

export type BusinessKnowledgeResult = {
  summary: string;
  sources: KnowledgeSource[];
};

function asDate(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function documentTextSearch(q: string) {
  const terms = Array.from(new Set([q, ...normalizeName(q).split(' ').filter((term) => term.length >= 4)])).slice(0, 8);
  return {
    OR: terms.flatMap((term) => [
      { fileName: { contains: term } },
      { issuerName: { contains: term } },
      { issuerCuit: { contains: term } },
      { externalNumber: { contains: term } },
      { extraction: { is: { rawText: { contains: term } } } },
      { extraction: { is: { extractedJson: { contains: term } } } },
      { customerCandidates: { some: { legalName: { contains: term } } } },
      { customerCandidates: { some: { cuit: { contains: term } } } },
      { itemCandidates: { some: { rawDescription: { contains: term } } } },
      { itemCandidates: { some: { normalizedName: { contains: normalizeName(term) } } } }
    ])
  };
}

export async function searchBusinessKnowledge(input: {
  companyId: string;
  q: string;
  kind?: DocumentKind;
  dateFrom?: string;
  dateTo?: string;
  take?: number;
}): Promise<BusinessKnowledgeResult> {
  const q = input.q.trim();
  const normalized = normalizeName(q);
  const take = input.take ?? 8;
  const dateFrom = asDate(input.dateFrom);
  const dateTo = asDate(input.dateTo);

  const [customers, products, supplierPrices, quotes, documents] = await Promise.all([
    prisma.customer.findMany({
      where: {
        companyId: input.companyId,
        OR: [{ legalName: { contains: q } }, { tradeName: { contains: q } }, { cuit: { contains: q } }, { address: { contains: q } }]
      },
      take,
      orderBy: { legalName: 'asc' }
    }),
    prisma.product.findMany({
      where: {
        companyId: input.companyId,
        OR: [
          { name: { contains: q } },
          { normalizedName: { contains: normalized } },
          { aliasesJson: { contains: normalized } },
          { sku: { contains: q } },
          { category: { contains: q } },
          { description: { contains: q } }
        ]
      },
      include: { supplierPrices: { include: { supplier: true }, orderBy: { price: 'asc' }, take: 3 } },
      take,
      orderBy: { name: 'asc' }
    }),
    prisma.supplierProductPrice.findMany({
      where: {
        companyId: input.companyId,
        OR: [{ rawName: { contains: q } }, { normalizedName: { contains: normalized } }, { supplierSku: { contains: q } }]
      },
      include: { supplier: true, product: true },
      take,
      orderBy: [{ price: 'asc' }, { observedAt: 'desc' }]
    }),
    prisma.quote.findMany({
      where: {
        companyId: input.companyId,
        OR: [{ notes: { contains: q } }, { customer: { legalName: { contains: q } } }, { items: { some: { description: { contains: q } } } }],
        issueDate: { gte: dateFrom, lte: dateTo }
      },
      include: { customer: true, items: true },
      take,
      orderBy: { issueDate: 'desc' }
    }),
    prisma.document.findMany({
      where: {
        OR: [{ companyId: input.companyId }, { companyId: null }],
        kind: input.kind,
        documentDate: { gte: dateFrom, lte: dateTo },
        ...(q ? documentTextSearch(q) : {})
      },
      include: { extraction: true, customerCandidates: true, itemCandidates: true },
      take,
      orderBy: [{ documentDate: 'desc' }, { createdAt: 'desc' }]
    })
  ]);

  const lines = [
    customers.length ? `Clientes encontrados: ${customers.map((c) => `${c.legalName}${c.cuit ? ` CUIT ${c.cuit}` : ''}`).join('; ')}.` : '',
    products.length
      ? `Productos encontrados: ${products
          .map((p) => {
            const price = Number(p.price || 0);
            const suppliers = p.supplierPrices.map((sp) => `${sp.supplier.name} $${Number(sp.price).toLocaleString('es-AR')}`).join(', ');
            return `${p.name}${p.category ? ` (${p.category})` : ''}${price ? ` venta $${price.toLocaleString('es-AR')}` : ' sin precio de venta'}${suppliers ? `; proveedores: ${suppliers}` : ''}`;
          })
          .join(' | ')}.`
      : '',
    supplierPrices.length
      ? `Precios de proveedor: ${supplierPrices
          .map((sp) => `${sp.rawName} - ${sp.supplier.name}: ${sp.currency} ${Number(sp.price).toLocaleString('es-AR')}`)
          .join(' | ')}.`
      : '',
    quotes.length ? `Presupuestos relacionados: ${quotes.map((qte) => `#${qte.number} ${qte.customer.legalName} ${qte.currency} ${qte.total}`).join('; ')}.` : '',
    documents.length
      ? `Documentos relacionados: ${documents
          .map((doc) => `${doc.kind} ${doc.fileName}${doc.documentDate ? ` fecha ${doc.documentDate.toLocaleDateString('es-AR')}` : ''}${doc.total ? ` total ${doc.currency} ${doc.total}` : ''}`)
          .join('; ')}.`
      : ''
  ].filter(Boolean);

  const sources: KnowledgeSource[] = [
    ...customers.map((c) => ({ type: 'customer' as const, id: c.id, title: c.legalName, subtitle: c.cuit ? `CUIT ${c.cuit}` : undefined })),
    ...products.map((p) => ({ type: 'product' as const, id: p.id, title: p.name, subtitle: p.category ?? undefined })),
    ...supplierPrices.map((sp) => ({ type: 'supplierPrice' as const, id: sp.id, title: sp.rawName, subtitle: `${sp.supplier.name} ${sp.currency} ${sp.price}` })),
    ...quotes.map((qte) => ({ type: 'quote' as const, id: qte.id, title: `Presupuesto #${qte.number}`, subtitle: qte.customer.legalName })),
    ...documents.map((doc) => ({
      type: 'document' as const,
      id: doc.id,
      title: doc.fileName,
      subtitle: `${doc.kind} / ${doc.extractionStatus}`,
      url: `/api/documents/${doc.id}/content`
    }))
  ];

  return {
    summary: lines.join('\n') || 'No encontré coincidencias directas en clientes, productos, precios, presupuestos ni documentos.',
    sources
  };
}

export async function getOperationalWeakPoints(companyId: string) {
  const [productsMissingPrice, productsWithoutSupplier, pendingDocuments, unknownDocuments, customersMissingCuit] = await Promise.all([
    prisma.product.count({ where: { companyId, active: true, price: 0 } }),
    prisma.product.count({ where: { companyId, active: true, supplierPrices: { none: {} } } }),
    prisma.document.count({ where: { OR: [{ companyId }, { companyId: null }], extractionStatus: { in: [ExtractionStatus.UPLOADED, ExtractionStatus.NEEDS_REVIEW, ExtractionStatus.FAILED] } } }),
    prisma.document.count({ where: { OR: [{ companyId }, { companyId: null }], kind: DocumentKind.UNKNOWN } }),
    prisma.customer.count({ where: { companyId, OR: [{ cuit: null }, { cuit: '' }] } })
  ]);

  return [
    `Productos activos sin precio de venta: ${productsMissingPrice}.`,
    `Productos activos sin precios de proveedor vinculados: ${productsWithoutSupplier}.`,
    `Documentos pendientes, fallidos o por revisar: ${pendingDocuments}.`,
    `Documentos sin tipo detectado: ${unknownDocuments}.`,
    `Clientes sin CUIT cargado: ${customersMissingCuit}.`
  ].join('\n');
}

export function parseDocumentKindFromMessage(message: string): DocumentKind | undefined {
  const normalized = normalizeName(message);
  if (normalized.includes('factura')) return DocumentKind.INVOICE;
  if (normalized.includes('remito')) return DocumentKind.DELIVERY_NOTE;
  if (normalized.includes('presupuesto')) return DocumentKind.QUOTE;
  return undefined;
}

export function parseDateHints(message: string) {
  const normalized = normalizeName(message);
  const year = normalized.match(/\b(20\d{2})\b/)?.[1];
  const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'setiembre', 'octubre', 'noviembre', 'diciembre'];
  const monthIndex = months.findIndex((month) => normalized.includes(month));
  if (!year || monthIndex < 0) return {};
  const month = monthIndex === 8 && normalized.includes('setiembre') ? 8 : monthIndex;
  const from = new Date(Number(year), month, 1);
  const to = new Date(Number(year), month + 1, 0, 23, 59, 59, 999);
  return { dateFrom: from.toISOString(), dateTo: to.toISOString() };
}
