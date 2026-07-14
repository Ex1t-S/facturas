import path from 'node:path';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { answerEngineering } from '../services/engineering/engineeringAssistant.js';
import { getEngineeringDocument, searchEngineeringKnowledge } from '../services/engineering/engineeringKnowledge.js';
import { ingestEngineeringKnowledge } from '../services/engineering/engineeringIngestion.js';
import { projectTypes } from '../services/engineering/engineeringSchemas.js';

const companyQuery = z.object({ companyId: z.string().min(1) });
const chatSchema = z.object({ companyId: z.string().min(1), message: z.string().trim().min(1).max(6000) });
const startSchema = z.object({ companyId: z.string().min(1), rootPath: z.string().trim().min(1).optional() });
const reviewSchema = z.object({ status: z.enum(['VERIFIED', 'CORRECTED', 'REJECTED', 'OBSOLETE']), correctedJson: z.string().optional(), note: z.string().max(2000).optional(), reviewerName: z.string().max(120).optional() });

function allowedRoot(rootPath: string) {
  const configured = [config.ENGINEERING_KNOWLEDGE_ROOT, config.HISTORICAL_DOCUMENT_ROOT].filter(Boolean).map((root) => path.resolve(root));
  const resolved = path.resolve(rootPath);
  if (!configured.some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`))) throw new Error('La carpeta debe estar dentro de ENGINEERING_KNOWLEDGE_ROOT o HISTORICAL_DOCUMENT_ROOT.');
  return resolved;
}

export const engineeringRoutes: FastifyPluginAsync = async (app) => {
  app.post('/engineering/chat', async (request) => answerEngineering(chatSchema.parse(request.body)));

  app.get('/engineering/knowledge', async (request) => {
    const query = z.object({ ...companyQuery.shape, q: z.string().default(''), projectType: z.enum(projectTypes).optional(), material: z.string().optional(), verified: z.coerce.boolean().optional(), dateFrom: z.string().optional(), dateTo: z.string().optional(), take: z.coerce.number().int().min(1).max(100).default(30) }).parse(request.query);
    return searchEngineeringKnowledge(query);
  });

  app.get('/engineering/knowledge/:id', async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const query = companyQuery.parse(request.query);
    const document = await getEngineeringDocument(params.id, query.companyId);
    if (!document) return reply.code(404).send({ error: 'Documento de ingeniería no encontrado' });
    return document;
  });

  app.get('/engineering/projects', async (request) => {
    const query = z.object({ ...companyQuery.shape, projectType: z.enum(projectTypes).optional(), take: z.coerce.number().int().min(1).max(100).default(50) }).parse(request.query);
    return prisma.engineeringProject.findMany({ where: { companyId: query.companyId, projectType: query.projectType }, include: { documents: { include: { knowledge: true } } }, orderBy: { updatedAt: 'desc' }, take: query.take });
  });

  app.get('/engineering/ingestion/status', async (request) => {
    const query = companyQuery.parse(request.query);
    const [latest, counts] = await Promise.all([
      prisma.engineeringIngestionRun.findFirst({ where: { companyId: query.companyId }, orderBy: { startedAt: 'desc' } }),
      prisma.engineeringKnowledgeDocument.groupBy({ by: ['status'], where: { OR: [{ companyId: query.companyId }, { companyId: null }] }, _count: { _all: true } })
    ]);
    return { latest, counts: Object.fromEntries(counts.map((row) => [row.status, row._count._all])) };
  });

  app.post('/engineering/ingestion/start', async (request, reply) => {
    const body = startSchema.parse(request.body);
    const rootPath = allowedRoot(body.rootPath || config.ENGINEERING_KNOWLEDGE_ROOT || config.HISTORICAL_DOCUMENT_ROOT);
    const run = await prisma.engineeringIngestionRun.create({ data: { companyId: body.companyId, rootPath } });
    void ingestEngineeringKnowledge({ rootPath, companyId: body.companyId, runId: run.id }).catch(async (error) => {
      await prisma.engineeringIngestionRun.update({ where: { id: run.id }, data: { status: 'FAILED', lastError: error instanceof Error ? error.message : 'Error desconocido', finishedAt: new Date() } }).catch(() => undefined);
    });
    return reply.code(202).send({ runId: run.id, status: 'RUNNING', rootPath });
  });

  app.post('/engineering/knowledge/:id/review', async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const query = companyQuery.parse(request.query);
    const body = reviewSchema.parse(request.body);
    const document = await prisma.engineeringKnowledgeDocument.findFirst({ where: { id: params.id, OR: [{ companyId: query.companyId }, { companyId: null }] } });
    if (!document) return reply.code(404).send({ error: 'Documento de ingeniería no encontrado' });
    const updated = await prisma.engineeringKnowledgeDocument.update({ where: { id: document.id }, data: { verified: body.status === 'VERIFIED' || body.status === 'CORRECTED', status: body.status === 'OBSOLETE' ? 'NEEDS_REVIEW' : 'INDEXED', reviewNotes: body.note } });
    await prisma.engineeringReview.create({ data: { companyId: query.companyId, knowledgeId: document.id, originalJson: document.structuredJson, correctedJson: body.correctedJson, status: body.status, note: body.note, reviewerName: body.reviewerName } });
    return updated;
  });
};
