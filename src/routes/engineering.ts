import fs from 'node:fs/promises';
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
import { engineeringModelConfig, resolveEngineeringModel } from '../services/engineering/engineeringRuntime.js';
import { parseOptionalBoolean } from '../services/engineering/queryParsing.js';
import { engineeringSourceStatus } from '../services/engineering/engineeringSourceImporter.js';
import { searchEngineeringGoldenLibrary } from '../services/engineering/engineeringGoldenLibrary.js';
import { createEngineeringCurationJob, listEngineeringCurationJobs, curationJobTypes } from '../services/engineering/engineeringCuration.js';
import { pendingReviewItems, reviewBenchmark, reviewCatalogSection, reviewDrawing, reviewKnowledgeDocument, reviewProgress, reviewProject, runEngineeringGoldenValidation, setReviewSessionStatus, startOrResumeReviewSession, reviewTypes, reviewDecisions } from '../services/engineering/engineeringReview.js';
import { engineeringFinalizationStatus } from '../services/engineering/engineeringFinalization.js';

const companyQuery = z.object({ companyId: z.string().min(1) });
const chatSchema = z.object({ companyId: z.string().min(1), message: z.string().trim().min(1).max(6000) });
const startSchema = z.object({ companyId: z.string().min(1), rootPath: z.string().trim().min(1).optional() });
const reviewSchema = z.object({ status: z.enum(['VERIFIED', 'CORRECTED', 'REJECTED', 'OBSOLETE']), correctedJson: z.string().optional(), note: z.string().max(2000).optional(), reviewerName: z.string().max(120).optional(), reviewerUserId: z.string().optional(), fieldName: z.string().max(120).optional() });
const conversationCreateSchema = z.object({ companyId: z.string().min(1), title: z.string().trim().max(120).optional() });
const conversationMessageSchema = z.object({ companyId: z.string().min(1), message: z.string().trim().min(1).max(12000) });
const drawingSchema = z.object({ drawingType: z.enum(['SILO', 'HOPPER', 'WAREHOUSE', 'SUPPORT_STRUCTURE']), width: z.number().positive().optional(), length: z.number().positive().optional(), diameter: z.number().positive().optional(), height: z.number().positive().optional(), bodyHeight: z.number().positive().optional(), coneHeight: z.number().positive().optional(), freeHeight: z.number().positive().optional(), lowerOpening: z.number().positive().optional(), roofSlope: z.number().positive().optional(), capacityT: z.number().positive().optional(), supportCount: z.number().int().positive().optional(), customerName: z.string().max(160).optional(), projectName: z.string().max(160).optional(), quoteNumber: z.string().max(80).optional(), notes: z.array(z.string().max(300)).max(20).optional() });
const optionalBooleanQuery = z.unknown().optional().transform(parseOptionalBoolean);

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
  app.get('/engineering/diagnostics', async (request) => {
    const query = companyQuery.parse(request.query);
    const [latestConversation, ingestion, documents, drawings] = await Promise.all([
      prisma.engineeringConversation.findFirst({ where: { companyId: query.companyId }, orderBy: { updatedAt: 'desc' }, select: { id: true, currentIntent: true, intentConfidence: true, lastProvider: true, lastRequestedModel: true, lastActualModel: true, previousResponseId: true, lastLatencyMs: true, lastErrorJson: true, lastFallbackUsed: true, promptVersion: true, updatedAt: true } }),
      prisma.engineeringIngestionRun.findFirst({ where: { companyId: query.companyId }, orderBy: { startedAt: 'desc' }, select: { status: true, rootPath: true, foundCount: true, processedCount: true, pendingCount: true, failedCount: true, lastError: true, finishedAt: true } }),
      prisma.engineeringKnowledgeDocument.groupBy({ by: ['status', 'verified'], where: { OR: [{ companyId: query.companyId }, { companyId: null }] }, _count: { _all: true } }),
      prisma.engineeringDrawingDocument.groupBy({ by: ['status'], where: { companyId: query.companyId }, _count: { _all: true } })
    ]);
    return { model: resolveEngineeringModel(), modelConfig: engineeringModelConfig(), openAiKeyConfigured: Boolean(config.OPENAI_API_KEY.trim()), latestConversation, ingestion, documents, drawings };
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
  app.get('/engineering/library', async (request) => {
    const query = z.object({ companyId: z.string(), q: z.string().default(''), take: z.coerce.number().int().min(1).max(50).default(8) }).parse(request.query);
    return searchEngineeringGoldenLibrary(query);
  });
  app.get('/engineering/sources', async (request) => {
    companyQuery.parse(request.query);
    return engineeringSourceStatus();
  });
  app.get('/engineering/benchmarks', async (request) => {
    const query = z.object({ companyId: z.string(), q: z.string().default(''), status: z.string().optional(), take: z.coerce.number().int().min(1).max(200).default(100) }).parse(request.query);
    return prisma.engineeringBenchmark.findMany({ where: { AND: [{ OR: [{ companyId: query.companyId }, { companyId: null }] }, ...(query.status ? [{ status: query.status }] : []), ...(query.q ? [{ OR: [{ title: { contains: query.q } }, { problemStatement: { contains: query.q } }, { standardCode: { contains: query.q } }] }] : [])] }, include: { source: { select: { id: true, title: true, jurisdiction: true, sourceType: true, verificationStatus: true, sourceUrl: true } }, validations: true }, orderBy: [{ verified: 'desc' }, { updatedAt: 'desc' }], take: query.take });
  });
  app.get('/engineering/validations', async (request) => {
    const query = z.object({ companyId: z.string(), toolName: z.string().optional(), take: z.coerce.number().int().min(1).max(200).default(100) }).parse(request.query);
    return prisma.engineeringToolValidation.findMany({ where: { OR: [{ companyId: query.companyId }, { companyId: null }], toolName: query.toolName }, include: { benchmark: { select: { id: true, title: true, status: true, verified: true, sourceId: true } } }, orderBy: { validatedAt: 'desc' }, take: query.take });
  });
  app.get('/engineering/curation/jobs', async (request) => {
    const query = z.object({ companyId: z.string(), take: z.coerce.number().int().min(1).max(100).default(50) }).parse(request.query);
    return listEngineeringCurationJobs(query.companyId, query.take);
  });
  app.post('/engineering/curation/jobs', async (request, reply) => {
    const body = z.object({ companyId: z.string().optional(), type: z.enum(curationJobTypes) }).parse(request.body);
    return reply.code(202).send(await createEngineeringCurationJob(body.companyId, body.type));
  });
  app.get('/engineering/review/progress', async (request) => reviewProgress(companyQuery.parse(request.query).companyId));
  app.get('/engineering/review/queue', async (request) => {
    const query = z.object({ companyId: z.string(), type: z.enum(reviewTypes), take: z.coerce.number().int().min(1).max(100).default(20) }).parse(request.query);
    return pendingReviewItems(query.type, query.companyId, query.take);
  });
  app.post('/engineering/review/sessions', async (request, reply) => {
    const body = z.object({ companyId: z.string(), reviewType: z.enum(reviewTypes), reviewer: z.string().trim().min(1).max(120) }).parse(request.body);
    return reply.code(201).send(await startOrResumeReviewSession(body));
  });
  app.patch('/engineering/review/sessions/:id', async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ status: z.enum(['ACTIVE', 'PAUSED', 'COMPLETED']) }).parse(request.body);
    return setReviewSessionStatus(params.id, body.status);
  });
  app.post('/engineering/review/:type/:id', async (request) => {
    const params = z.object({ type: z.enum(reviewTypes), id: z.string() }).parse(request.params);
    const body = z.object({ sessionId: z.string(), reviewer: z.string().trim().min(1).max(120), decision: z.enum(reviewDecisions), correction: z.record(z.string(), z.unknown()).optional(), golden: z.boolean().optional(), note: z.string().max(2000).optional() }).parse(request.body);
    if (params.type === 'BENCHMARK') return reviewBenchmark({ id: params.id, ...body });
    if (params.type === 'CATALOG') return reviewCatalogSection({ id: params.id, ...body });
    if (params.type === 'PROJECT') return reviewProject({ id: params.id, ...body });
    if (params.type === 'DRAWING') return reviewDrawing({ id: params.id, ...body, correction: body.correction && typeof body.correction.field === 'string' ? { field: body.correction.field, value: body.correction.value } : undefined });
    if (params.type === 'DOCUMENT') return reviewKnowledgeDocument({ id: params.id, ...body });
    return { reviewed: false, reason: 'Los conflictos se resuelven revisando el benchmark o la herramienta de origen.' };
  });
  app.post('/engineering/review/validate', async (request) => runEngineeringGoldenValidation(companyQuery.parse(request.body).companyId));
  app.get('/engineering/finalization/status', async (request) => {
    const query = z.object({ companyId: z.string().min(1).optional() }).parse(request.query);
    return engineeringFinalizationStatus(query.companyId);
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
    const query = z.object({ ...companyQuery.shape, q: z.string().default(''), projectType: z.enum(projectTypes).optional(), material: z.string().optional(), verified: optionalBooleanQuery, dateFrom: z.string().optional(), dateTo: z.string().optional(), take: z.coerce.number().int().min(1).max(100).default(30) }).parse(request.query);
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
    try { await fs.access(rootPath); } catch { return reply.code(409).send({ error: 'La carpeta configurada no está disponible en este servidor.', code: 'ENGINEERING_SOURCE_UNAVAILABLE', rootPath }); }
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
    const updated = await prisma.engineeringKnowledgeDocument.update({ where: { id: document.id }, data: { verified: body.status === 'VERIFIED' || body.status === 'CORRECTED', status: body.status === 'OBSOLETE' ? 'NEEDS_REVIEW' : 'INDEXED', structuredJson: body.correctedJson || document.structuredJson, reviewNotes: body.note } });
    await prisma.engineeringReview.create({ data: { companyId: query.companyId, knowledgeId: document.id, originalJson: document.structuredJson, correctedJson: body.correctedJson, status: body.status, note: body.note, reviewerName: body.reviewerName, reviewerUserId: body.reviewerUserId, fieldName: body.fieldName } });
    return updated;
  });
};
