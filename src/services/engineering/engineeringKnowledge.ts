import { prisma } from '../../db.js';
import { normalizeName } from '../normalize.js';

export type EngineeringSearchInput = { companyId: string; q: string; projectType?: string; material?: string; verified?: boolean; dateFrom?: string; dateTo?: string; take?: number };

function termsFor(q: string) { return Array.from(new Set([q, ...normalizeName(q).split(/\s+/).filter((term) => term.length >= 3)])).slice(0, 12); }

export async function searchEngineeringKnowledge(input: EngineeringSearchInput) {
  const terms = termsFor(input.q);
  const where: any = { OR: [{ companyId: input.companyId }, { companyId: null }] };
  if (input.projectType) where.projectType = input.projectType;
  if (input.verified !== undefined) where.verified = input.verified;
  if (input.dateFrom || input.dateTo) where.documentDate = { gte: input.dateFrom ? new Date(input.dateFrom) : undefined, lte: input.dateTo ? new Date(input.dateTo) : undefined };
  if (input.q.trim()) where.AND = terms.map((term) => ({ OR: [{ fileName: { contains: term } }, { projectName: { contains: term } }, { customerName: { contains: term } }, { rawText: { contains: term } }, { structuredJson: { contains: term } }, { projectType: { contains: term } }] }));
  const docs = await prisma.engineeringKnowledgeDocument.findMany({ where, orderBy: [{ verified: 'desc' }, { confidence: 'desc' }, { updatedAt: 'desc' }], take: input.take ?? 12 });
  const projects = input.q.trim() ? await prisma.engineeringProject.findMany({ where: { companyId: input.companyId, OR: [{ name: { contains: input.q } }, { description: { contains: input.q } }, { projectType: { contains: input.q } }, { technicalJson: { contains: input.q } }] }, orderBy: [{ verified: 'desc' }, { updatedAt: 'desc' }], take: input.take ?? 8 }) : [];
  const products = input.q.trim() ? await prisma.product.findMany({ where: { companyId: input.companyId, OR: [{ name: { contains: input.q } }, { normalizedName: { contains: normalizeName(input.q) } }, { category: { contains: input.q } }] }, include: { supplierPrices: { include: { supplier: true }, orderBy: { observedAt: 'desc' }, take: 3 } }, take: input.take ?? 8 }) : [];
  return {
    documents: docs.map((doc) => ({ id: doc.id, title: doc.projectName || doc.fileName, type: doc.projectType, documentType: doc.documentType, verified: doc.verified, confidence: Number(doc.confidence), date: doc.documentDate, excerpt: (doc.rawText || doc.structuredJson || '').slice(0, 700), sourcePath: doc.relativePath || doc.fileName })),
    projects: projects.map((project) => ({ id: project.id, title: project.name, type: project.projectType, verified: project.verified, description: project.description, technical: project.technicalJson })),
    products: products.map((product) => ({ id: product.id, title: product.name, category: product.category, price: Number(product.price), prices: product.supplierPrices.map((price) => ({ supplier: price.supplier.name, value: Number(price.price), currency: price.currency, observedAt: price.observedAt })) })),
    sources: docs.map((doc) => ({ id: doc.id, title: doc.projectName || doc.fileName, type: doc.verified ? 'VERIFIED_INTERNAL' : 'HISTORICAL_PROJECT', relevance: doc.verified ? 0.9 : Number(doc.confidence) }))
  };
}

export async function getEngineeringDocument(id: string, companyId: string) {
  return prisma.engineeringKnowledgeDocument.findFirst({ where: { id, OR: [{ companyId }, { companyId: null }] }, include: { projects: { include: { project: true } }, reviews: true } });
}
