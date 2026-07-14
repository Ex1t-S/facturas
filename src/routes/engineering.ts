import path from 'node:path';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { answerEngineering } from '../services/engineering/engineeringAssistant.js';
import { getEngineeringDocument, searchEngineeringKnowledge } from '../services/engineering/engineeringKnowledge.js';
import { ingestEngineeringKnowledge } from '../services/engineering/engineeringIngestion.js';
import { projectTypes } from '../services/engineering/engineeringSchemas.js';
import { answerEngineeringConversation, createEngineeringConversation, getEngineeringConversation, listEngineeringConversations, saveEngineeringCase } from '../services/engineering/engineeringConversation.js';
import { searchOfficialEngineeringRegulations } from '../services/engineering/regulations.js';
import { renderPreliminaryEngineeringPdf, renderPreliminaryEngineeringSvg, type EngineeringDrawingSpec } from '../services/engineering/drawing.js';
import { getEngineeringDrawing, getEngineeringDrawingStatus, ingestEngineeringDrawings, listEngineeringDrawings, readEngineeringDrawingFile } from '../services/engineering/drawingLibrary.js';
import { readStoredDocumentFile } from '../services/documentStorage.js';

const companyQuery = z.object({ companyId: z.string().min(1) });
const chatSchema = z.object({ companyId: z.string().min(1), message: z.string().trim().min(1).max(6000) });
const startSchema = z.object({ companyId: z.string().min(1), rootPath: z.string().trim().min(1).optional() });
const reviewSchema = z.object({ status: z.enum(['VERIFIED', 'CORRECTED', 'REJECTED', 'OBSOLETE']), correctedJson: z.string().optional(), note: z.string().max(2000).optional(), reviewerName: z.string().max(120).optional() });
const conversationCreateSchema = z.object({ companyId: z.string().min(1), title: z.string().trim().max(120).optional() });
const conversationMessageSchema = z.object({ companyId: z.string().min(1), message: z.string().trim().min(1).max(12000) });
const drawingSchema = z.object({ drawingType: z.enum(['SILO', 'HOPPER', 'WAREHOUSE', 'SUPPORT_STRUCTURE']), width: z.number().positive().optional(), length: z.number().positive().optional(), diameter: z.number().positive().optional(), height: z.number().positive().optional(), bodyHeight: z.number().positive().optional(), coneHeight: z.number().positive().optional(), freeHeight: z.number().positive().optional(), lowerOpening: z.number().positive().optional(), roofSlope: z.number().positive().optional(), capacityT: z.number().positive().optional(), supportCount: z.number().int().positive().optional(), customerName: z.string().max(160).optional(), projectName: z.string().max(160).optional(), quoteNumber: z.string().max(80).optional(), notes: z.array(z.string().max(300)).max(20).optional() });

function allowedRoot(rootPath: string) {
  const configured = [config.ENGINEERING_DRAWINGS_ROOT, config.ENGINEERING_KNOWLEDGE_ROOT, config.HISTORICAL_DOCUMENT_ROOT].filter(Boolean).map((root) => path.resolve(root));
  const resolved = path.resolve(rootPath);
  if (!configured.some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`))) throw new Error('La carpeta debe estar dentro de ENGINEERING_KNOWLEDGE_ROOT o HISTORICAL_DOCUMENT_ROOT.');
  return resolved;
}

export const engineeringRoutes: FastifyPluginAsync = async (app) => {
  app.post('/engineering/chat', async (request) => answerEngineering(chatSchema.parse(request.body)));

  app.get('/engineering/conversations', async (request) => listEngineeringConversations(companyQuery.parse(request.query).companyId));
  app.post('/engineering/conversations', async (request, reply) => { const body = conversationCreateSchema.parse(request.body); return reply.code(201).send(await createEngineeringConversation(body.companyId, body.title)); });
  app.get('/engineering/conversations/:id', async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const conversation = await getEngineeringConversation(params.id, companyQuery.parse(request.query).companyId);
    if (!conversation) return reply.code(404).send({ error: 'Conversación no encontrada' });
    return conversation;
  });
  app.post('/engineering/conversations/:id/messages', async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = conversationMessageSchema.parse(request.body);
    return answerEngineeringConversation(params.id, body.companyId, body.message);
  });
  app.patch('/engineering/conversations/:id', async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ companyId: z.string(), title: z.string().trim().min(1).max(120).optional(), archived: z.boolean().optional() }).parse(request.body);
    const updated = await prisma.engineeringConversation.updateMany({ where: { id: params.id, companyId: body.companyId }, data: { title: body.title, archivedAt: body.archived ? new Date() : body.archived === false ? null : undefined, status: body.archived ? 'ARCHIVED' : 'OPEN' } });
    return { updated: updated.count === 1 };
  });
  app.post('/engineering/conversations/:id/save-case', async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ companyId: z.string(), name: z.string().trim().max(160).optional() }).parse(request.body);
    return saveEngineeringCase(params.id, body.companyId, body.name);
  });
  app.get('/engineering/regulations', async (request) => {
    const query = z.object({ companyId: z.string(), q: z.string().default('') }).parse(request.query);
    return searchOfficialEngineeringRegulations(query.companyId, query.q);
  });
  app.post('/engineering/drawing', async (request) => { const spec = drawingSchema.parse(request.body) as EngineeringDrawingSpec; return { spec, svg: renderPreliminaryEngineeringSvg(spec) }; });
  app.post('/engineering/drawing/pdf', async (request, reply) => { const spec = drawingSchema.parse(request.body) as EngineeringDrawingSpec; return reply.type('application/pdf').send(await renderPreliminaryEngineeringPdf(spec)); });
  app.get('/engineering/drawings', async (request) => { const query = z.object({ companyId: z.string(), q: z.string().optional(), projectType: z.string().optional(), customerName: z.string().optional(), take: z.coerce.number().int().min(1).max(300).default(100) }).parse(request.query); return listEngineeringDrawings(query); });
  app.get('/engineering/drawings/status', async (request) => getEngineeringDrawingStatus(companyQuery.parse(request.query).companyId));
  app.get('/engineering/drawings/:id', async (request, reply) => { const params = z.object({ id: z.string() }).parse(request.params); const item = await getEngineeringDrawing(params.id, companyQuery.parse(request.query).companyId); if (!item) return reply.code(404).send({ error: 'Plano no encontrado' }); const { sourcePath: _sourcePath, ...publicItem } = item; return publicItem; });
  app.get('/engineering/drawings/:id/file', async (request, reply) => { const params = z.object({ id: z.string() }).parse(request.params); const item = await readEngineeringDrawingFile(params.id, companyQuery.parse(request.query).companyId); if (!item) return reply.code(404).send({ error: 'Plano no encontrado' }); return reply.type('application/pdf').header('Content-Disposition', `inline; filename="${item.fileName}"`).send(item.buffer); });
  app.get('/engineering/drawings/:id/thumbnail', async (request, reply) => { const params = z.object({ id: z.string() }).parse(request.params); const item = await getEngineeringDrawing(params.id, companyQuery.parse(request.query).companyId); if (!item?.thumbnailPath) return reply.code(404).send({ error: 'Miniatura no disponible' }); const buffer = await readStoredDocumentFile(item.thumbnailPath); return reply.type('image/png').send(buffer); });
  app.post('/engineering/drawings/ingestion/start', async (request, reply) => { const body = startSchema.parse(request.body); const rootPath = allowedRoot(body.rootPath || config.ENGINEERING_DRAWINGS_ROOT || config.ENGINEERING_KNOWLEDGE_ROOT || config.HISTORICAL_DOCUMENT_ROOT); void ingestEngineeringDrawings({ companyId: body.companyId, rootPath }).catch(() => undefined); return reply.code(202).send({ status: 'RUNNING', rootPath }); });

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
    return { latest, totalFiles: counts.reduce((total, row) => total + row._count._all, 0), counts: Object.fromEntries(counts.map((row) => [row.status, row._count._all])) };
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
