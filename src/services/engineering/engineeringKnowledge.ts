import { prisma } from '../../db.js';
import { normalizeEngineeringText, tokensForEngineeringSearch } from './engineeringIntelligence.js';
import { normalizeName } from '../normalize.js';

export type EngineeringSearchInput = { companyId: string; q: string; projectType?: string; material?: string; verified?: boolean; dateFrom?: string; dateTo?: string; take?: number };

function scoreDocument(doc: { fileName: string; projectName: string | null; customerName: string | null; rawText: string | null; structuredJson: string | null; projectType: string }, tokens: string[], verified: boolean) {
  const text = normalizeName(normalizeEngineeringText([doc.fileName, doc.projectName || '', doc.customerName || '', doc.rawText || '', doc.structuredJson || '', doc.projectType].join(' ')));
  const hits = tokens.filter((token) => text.includes(normalizeName(token))).length;
  const exactTitle = tokens.filter((token) => normalizeName(doc.fileName).includes(normalizeName(token))).length;
  return hits + exactTitle * 0.8 + (verified ? 2 : 0);
}

function textFilters(tokens: string[]) {
  const fields = ['fileName', 'projectName', 'customerName', 'rawText', 'structuredJson', 'projectType'];
  return tokens.flatMap((term) => fields.map((field) => ({ [field]: { contains: term } })));
}

export async function searchEngineeringKnowledge(input: EngineeringSearchInput) {
  const tokens = Array.from(new Set(tokensForEngineeringSearch(input.q))).slice(0, 12);
  const where: any = { OR: [{ companyId: input.companyId }, { companyId: null }] };
  if (input.projectType) where.projectType = input.projectType;
  if (input.verified !== undefined) where.verified = input.verified;
  if (input.dateFrom || input.dateTo) where.documentDate = { gte: input.dateFrom ? new Date(input.dateFrom) : undefined, lte: input.dateTo ? new Date(input.dateTo) : undefined };
  if (tokens.length) where.AND = [{ OR: textFilters(tokens) }];
  const limit = Math.min(Math.max(input.take ?? 12, 1) * (tokens.length ? 4 : 1), 200);
  const docs = await prisma.engineeringKnowledgeDocument.findMany({ where, orderBy: [{ verified: 'desc' }, { confidence: 'desc' }, { updatedAt: 'desc' }], take: limit });
  const ranked = docs.map((doc) => ({ doc, score: tokens.length ? scoreDocument(doc, tokens, doc.verified) : (doc.verified ? 2 : 0) + Number(doc.confidence) })).sort((a, b) => b.score - a.score).slice(0, input.take ?? 12);

  const projectWhere: any = { companyId: input.companyId };
  if (input.q.trim()) projectWhere.OR = tokens.flatMap((term) => ['name', 'description', 'projectType', 'technicalJson'].map((field) => ({ [field]: { contains: term } })));
  const projects = input.q.trim() ? await prisma.engineeringProject.findMany({ where: projectWhere, orderBy: [{ verified: 'desc' }, { updatedAt: 'desc' }], take: input.take ?? 8 }) : [];
  const productWhere: any = { companyId: input.companyId };
  if (input.q.trim()) productWhere.OR = tokens.flatMap((term) => ['name', 'normalizedName', 'category', 'description'].map((field) => ({ [field]: { contains: field === 'normalizedName' ? normalizeName(term) : term } })));
  const products = input.q.trim() ? await prisma.product.findMany({ where: productWhere, include: { supplierPrices: { include: { supplier: true }, orderBy: { observedAt: 'desc' }, take: 3 } }, take: input.take ?? 8 }) : [];
  return {
    documents: ranked.map(({ doc }) => ({ id: doc.id, title: doc.projectName || doc.fileName, type: doc.projectType, documentType: doc.documentType, status: doc.status, verified: doc.verified, confidence: Number(doc.confidence), date: doc.documentDate, projectName: doc.projectName, customerName: doc.customerName, excerpt: (doc.rawText || doc.structuredJson || '').slice(0, 900), sourcePath: doc.relativePath || doc.fileName })),
    projects: projects.map((project) => ({ id: project.id, title: project.name, type: project.projectType, verified: project.verified, description: project.description, technical: project.technicalJson })),
    products: products.map((product) => ({ id: product.id, title: product.name, category: product.category, price: Number(product.price), prices: product.supplierPrices.map((price) => ({ supplier: price.supplier.name, value: Number(price.price), currency: price.currency, observedAt: price.observedAt })) })),
    sources: ranked.map(({ doc, score }) => ({ id: doc.id, title: doc.projectName || doc.fileName, type: doc.verified ? 'VERIFIED_INTERNAL' : 'HISTORICAL_PROJECT', relevance: Math.max(Number(doc.confidence), Math.min(0.99, score / Math.max(tokens.length * 2, 1))), excerpt: (doc.rawText || doc.structuredJson || '').slice(0, 900) }))
  };
}

export async function getEngineeringDocument(id: string, companyId: string) {
  return prisma.engineeringKnowledgeDocument.findFirst({ where: { id, OR: [{ companyId }, { companyId: null }] }, include: { projects: { include: { project: true } }, reviews: true } });
}
