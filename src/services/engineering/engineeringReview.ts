import { prisma } from '../../db.js';
import { validateEngineeringBenchmark, runEngineeringGoldenValidation } from './engineeringValidation.js';

export const reviewTypes = ['BENCHMARK', 'CATALOG', 'PROJECT', 'DRAWING', 'DOCUMENT', 'CONFLICT'] as const;
export type ReviewType = (typeof reviewTypes)[number];
export const reviewDecisions = ['CONFIRMED', 'CORRECTED', 'SKIPPED', 'REJECTED'] as const;
export type ReviewDecision = (typeof reviewDecisions)[number];

export const benchmarkToolSpecs: Record<string, { label: string; inputs: Array<{ name: string; label: string; optional?: boolean }>; expectedPath: string }> = {
  calculate_vertical_load: { label: 'Carga vertical', inputs: [{ name: 'storedMassT', label: 'Masa almacenada [t]' }, { name: 'selfWeightKN', label: 'Peso propio [kN]', optional: true }, { name: 'additionalLoadKN', label: 'Carga adicional [kN]', optional: true }], expectedPath: 'result.value' },
  calculate_load_per_support: { label: 'Carga por apoyo', inputs: [{ name: 'totalLoadKN', label: 'Carga total [kN]' }, { name: 'supportCount', label: 'Cantidad de apoyos' }], expectedPath: 'result.value' },
  compare_support_alternatives: { label: 'Comparacion de apoyos', inputs: [{ name: 'totalLoadKN', label: 'Carga total [kN]' }], expectedPath: 'rows.0.result.value' },
  calculate_simple_axial_stress: { label: 'Tension axial simple', inputs: [{ name: 'forceKN', label: 'Fuerza [kN]' }, { name: 'areaMm2', label: 'Area [mm2]' }], expectedPath: 'result.value' },
  calculate_slenderness: { label: 'Esbeltez', inputs: [{ name: 'lengthMm', label: 'Longitud [mm]' }, { name: 'radiusGyrationMm', label: 'Radio de giro [mm]' }, { name: 'effectiveLengthFactor', label: 'Factor de longitud efectiva', optional: true }], expectedPath: 'result.value' },
  calculate_euler_reference_buckling: { label: 'Euler de referencia', inputs: [{ name: 'elasticModulusMPa', label: 'Modulo elastico [MPa]' }, { name: 'inertiaMm4', label: 'Inercia [mm4]' }, { name: 'effectiveLengthMm', label: 'Longitud efectiva [mm]' }], expectedPath: 'result.value' },
  get_section_properties: { label: 'Propiedades de seccion', inputs: [{ name: 'kind', label: 'Tipo (rectangular_hollow/square_hollow/circular_tube)' }, { name: 'widthMm', label: 'Ancho [mm]', optional: true }, { name: 'heightMm', label: 'Alto [mm]', optional: true }, { name: 'diameterMm', label: 'Diametro [mm]', optional: true }, { name: 'thicknessMm', label: 'Espesor [mm]', optional: true }], expectedPath: 'areaMm2' }
};

function parseJson(value: string | null | undefined, fallback: unknown) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function numericLeaves(value: unknown): number[] {
  if (typeof value === 'number' && Number.isFinite(value)) return [value];
  if (!value || typeof value !== 'object') return [];
  return Object.values(value as Record<string, unknown>).flatMap(numericLeaves);
}

export function isBenchmarkReady(benchmark: { inputJson: string; expectedOutputJson: string; implementedTool: string | null }) {
  const input = parseJson(benchmark.inputJson, {});
  const expected = parseJson(benchmark.expectedOutputJson, {});
  return Boolean(benchmark.implementedTool && input && typeof input === 'object' && Object.keys(input as object).length && numericLeaves(expected).length);
}

export function entityReviewPatch(type: ReviewType, decision: ReviewDecision, golden = false) {
  if (type === 'BENCHMARK') return decision === 'CONFIRMED' ? { status: 'CONFIRMED', verified: true } : { status: decision, verified: false };
  if (type === 'CATALOG') return decision === 'CONFIRMED' ? { reviewStatus: 'CONFIRMED', verified: true } : { reviewStatus: decision, verified: false };
  if (type === 'PROJECT') return decision === 'CONFIRMED' ? { status: 'CONFIRMED', verified: golden } : { status: decision, verified: false };
  if (type === 'DRAWING') return { status: decision === 'CONFIRMED' ? 'REVIEWED' : decision };
  if (type === 'DOCUMENT') return decision === 'CONFIRMED' ? { status: 'INDEXED', verified: true } : { status: decision === 'REJECTED' ? 'NEEDS_REVIEW' : decision, verified: false };
  return { status: decision };
}

export function updatedSessionCounters(current: { processedCount: number; confirmedCount: number; correctedCount: number; skippedCount: number; rejectedCount: number }, decision: ReviewDecision) {
  return {
    processedCount: current.processedCount + 1,
    confirmedCount: current.confirmedCount + (decision === 'CONFIRMED' ? 1 : 0),
    correctedCount: current.correctedCount + (decision === 'CORRECTED' ? 1 : 0),
    skippedCount: current.skippedCount + (decision === 'SKIPPED' ? 1 : 0),
    rejectedCount: current.rejectedCount + (decision === 'REJECTED' ? 1 : 0)
  };
}

export function mergeDrawingCorrection(extraction: unknown, field: string, value: unknown) {
  const base = extraction && typeof extraction === 'object' ? { ...(extraction as Record<string, unknown>) } : {};
  base[field] = value;
  return base;
}

export async function defaultEngineeringCompanyId() {
  return (await prisma.company.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } }))?.id;
}

export async function startOrResumeReviewSession(input: { companyId?: string; reviewType: ReviewType; reviewer: string }) {
  const existing = await prisma.engineeringReviewSession.findFirst({ where: { companyId: input.companyId || null, reviewType: input.reviewType, reviewer: input.reviewer, status: { in: ['ACTIVE', 'PAUSED'] } }, orderBy: { lastActivityAt: 'desc' } });
  if (existing) return prisma.engineeringReviewSession.update({ where: { id: existing.id }, data: { status: 'ACTIVE' } });
  return prisma.engineeringReviewSession.create({ data: { companyId: input.companyId, reviewType: input.reviewType, reviewer: input.reviewer } });
}

export async function setReviewSessionStatus(sessionId: string, status: 'ACTIVE' | 'PAUSED' | 'COMPLETED') {
  return prisma.engineeringReviewSession.update({ where: { id: sessionId }, data: { status, finishedAt: status === 'COMPLETED' ? new Date() : null } });
}

async function auditDecision(input: { sessionId: string; companyId?: string; entityType: ReviewType; entityId: string; decision: ReviewDecision | 'VALIDATION_FAILURE'; reviewer: string; original: unknown; corrected?: unknown; fieldName?: string; note?: string }) {
  const session = await prisma.engineeringReviewSession.findUniqueOrThrow({ where: { id: input.sessionId } });
  const counters = input.decision === 'VALIDATION_FAILURE' ? undefined : updatedSessionCounters(session, input.decision);
  await prisma.$transaction([
    prisma.engineeringReview.create({ data: { companyId: input.companyId, sessionId: input.sessionId, entityType: input.entityType, entityId: input.entityId, decision: input.decision, status: input.decision, originalJson: JSON.stringify(input.original), correctedJson: input.corrected === undefined ? null : JSON.stringify(input.corrected), fieldName: input.fieldName, note: input.note, reviewerName: input.reviewer } }),
    prisma.engineeringReviewSession.update({ where: { id: input.sessionId }, data: { ...(counters || {}), cursorJson: JSON.stringify({ entityType: input.entityType, entityId: input.entityId }) } })
  ]);
}

export async function pendingReviewItems(type: ReviewType, companyId?: string, take = 100) {
  if (type === 'BENCHMARK') return prisma.engineeringBenchmark.findMany({ where: { OR: [{ companyId: companyId || null }, { companyId: null }], status: { in: ['NEEDS_REVIEW', 'PENDING_REVIEW', 'CORRECTED'] } }, include: { source: true }, orderBy: { createdAt: 'asc' }, take });
  if (type === 'CATALOG') return companyId ? prisma.structuralSection.findMany({ where: { companyId, reviewStatus: { in: ['PENDING_REVIEW', 'CORRECTED'] } }, include: { sourceRecord: true }, orderBy: { createdAt: 'asc' }, take }) : [];
  if (type === 'PROJECT') return companyId ? prisma.engineeringProject.findMany({ where: { companyId, status: { in: ['SUGGESTED', 'REVIEWED', 'CORRECTED'] } }, include: { documents: { include: { knowledge: true } } }, orderBy: { createdAt: 'asc' }, take }) : [];
  if (type === 'DRAWING') return companyId ? prisma.engineeringDrawingDocument.findMany({ where: { companyId, status: { notIn: ['REVIEWED', 'REJECTED', 'NON_TECHNICAL', 'SKIPPED'] } }, orderBy: { createdAt: 'asc' }, take }) : [];
  if (type === 'DOCUMENT') return prisma.engineeringKnowledgeDocument.findMany({ where: { OR: [{ companyId: companyId || null }, { companyId: null }], verified: false, status: { notIn: ['FAILED', 'UNSUPPORTED', 'REJECTED', 'SKIPPED'] } }, orderBy: { createdAt: 'asc' }, take });
  return prisma.engineeringToolValidation.findMany({ where: { passed: false, OR: [{ companyId: companyId || null }, { companyId: null }] }, include: { benchmark: { include: { source: true } } }, orderBy: { validatedAt: 'asc' }, take });
}

export async function reviewBenchmark(input: { id: string; sessionId: string; reviewer: string; decision: ReviewDecision; correction?: Record<string, unknown>; note?: string }) {
  const item = await prisma.engineeringBenchmark.findUniqueOrThrow({ where: { id: input.id } });
  if (input.decision === 'CONFIRMED' && !isBenchmarkReady(item)) throw new Error('BENCHMARK_INCOMPLETE: faltan entradas, resultado esperado o herramienta. Elegí corregir antes de confirmar.');
  const patch = input.decision === 'CORRECTED' ? { ...input.correction, status: 'CORRECTED', verified: false } : entityReviewPatch('BENCHMARK', input.decision);
  const updated = await prisma.engineeringBenchmark.update({ where: { id: item.id }, data: { ...(patch as any), verificationNotes: input.note || (input.decision === 'CONFIRMED' ? `Confirmado por ${input.reviewer}.` : item.verificationNotes) } });
  await auditDecision({ sessionId: input.sessionId, companyId: item.companyId || undefined, entityType: 'BENCHMARK', entityId: item.id, decision: input.decision, reviewer: input.reviewer, original: item, corrected: updated, note: input.note });
  let validation: Awaited<ReturnType<typeof validateEngineeringBenchmark>> | undefined;
  if (input.decision === 'CONFIRMED') {
    validation = await validateEngineeringBenchmark(item.id, item.companyId || '');
    if ('passed' in validation && validation.passed === false) await auditDecision({ sessionId: input.sessionId, companyId: item.companyId || undefined, entityType: 'BENCHMARK', entityId: item.id, decision: 'VALIDATION_FAILURE', reviewer: input.reviewer, original: validation, note: 'La validacion automatica fallo; no se modifico ninguna formula.' });
  }
  return { updated, validation };
}

export async function reviewCatalogSection(input: { id: string; sessionId: string; reviewer: string; decision: ReviewDecision; correction?: Record<string, unknown>; note?: string }) {
  const item = await prisma.structuralSection.findUniqueOrThrow({ where: { id: input.id } });
  const patch = input.decision === 'CORRECTED' ? { ...input.correction, reviewStatus: 'CORRECTED', verified: false, verifiedAt: null } : { ...entityReviewPatch('CATALOG', input.decision), verifiedAt: input.decision === 'CONFIRMED' ? new Date() : null };
  const updated = await prisma.structuralSection.update({ where: { id: item.id }, data: patch as any });
  await auditDecision({ sessionId: input.sessionId, companyId: item.companyId, entityType: 'CATALOG', entityId: item.id, decision: input.decision, reviewer: input.reviewer, original: item, corrected: updated, note: input.note });
  return updated;
}

export async function reviewProject(input: { id: string; sessionId: string; reviewer: string; decision: ReviewDecision; golden?: boolean; correction?: Record<string, unknown>; note?: string }) {
  const item = await prisma.engineeringProject.findUniqueOrThrow({ where: { id: input.id } });
  const patch = input.decision === 'CORRECTED' ? { ...input.correction, status: 'CORRECTED', verified: false } : entityReviewPatch('PROJECT', input.decision, Boolean(input.golden));
  const updated = await prisma.engineeringProject.update({ where: { id: item.id }, data: { ...(patch as any), notes: input.note || item.notes } });
  await auditDecision({ sessionId: input.sessionId, companyId: item.companyId, entityType: 'PROJECT', entityId: item.id, decision: input.decision, reviewer: input.reviewer, original: item, corrected: updated, note: input.note });
  return updated;
}

export async function reviewDrawing(input: { id: string; sessionId: string; reviewer: string; decision: ReviewDecision; correction?: { field: string; value: unknown }; note?: string }) {
  const item = await prisma.engineeringDrawingDocument.findUniqueOrThrow({ where: { id: input.id } });
  let data: Record<string, unknown> = entityReviewPatch('DRAWING', input.decision);
  if (input.decision === 'CORRECTED' && input.correction) {
    const extraction = mergeDrawingCorrection(parseJson(item.extractionJson, {}), input.correction.field, input.correction.value);
    const direct = ['drawingNumber', 'projectName', 'customerName', 'projectType', 'drawingTitle', 'revision'].includes(input.correction.field) ? { [input.correction.field]: input.correction.value } : {};
    data = { ...direct, extractionJson: JSON.stringify(extraction), status: 'CORRECTED' };
  }
  const updated = await prisma.engineeringDrawingDocument.update({ where: { id: item.id }, data: data as any });
  await auditDecision({ sessionId: input.sessionId, companyId: item.companyId, entityType: 'DRAWING', entityId: item.id, decision: input.decision, reviewer: input.reviewer, original: item, corrected: updated, fieldName: input.correction?.field, note: input.note });
  return updated;
}

export async function reviewKnowledgeDocument(input: { id: string; sessionId: string; reviewer: string; decision: ReviewDecision; correction?: Record<string, unknown>; note?: string }) {
  const item = await prisma.engineeringKnowledgeDocument.findUniqueOrThrow({ where: { id: input.id } });
  const patch = input.decision === 'CORRECTED' ? { ...input.correction, status: 'CORRECTED', verified: false } : entityReviewPatch('DOCUMENT', input.decision);
  const updated = await prisma.engineeringKnowledgeDocument.update({ where: { id: item.id }, data: { ...(patch as any), reviewNotes: input.note || item.reviewNotes } });
  await auditDecision({ sessionId: input.sessionId, companyId: item.companyId || undefined, entityType: 'DOCUMENT', entityId: item.id, decision: input.decision, reviewer: input.reviewer, original: item, corrected: updated, note: input.note });
  return updated;
}

export async function reviewProgress(companyId?: string) {
  const [benchmarkTotal, benchmarkVerified, benchmarkPending, catalogTotal, catalogConfirmed, projectSuggested, projectConfirmed, projectGolden, drawingTotal, drawingReviewed, documentPending, sessions] = await Promise.all([
    prisma.engineeringBenchmark.count({ where: { OR: [{ companyId: companyId || null }, { companyId: null }] } }),
    prisma.engineeringBenchmark.count({ where: { OR: [{ companyId: companyId || null }, { companyId: null }], verified: true } }),
    prisma.engineeringBenchmark.count({ where: { OR: [{ companyId: companyId || null }, { companyId: null }], status: { in: ['NEEDS_REVIEW', 'PENDING_REVIEW', 'CORRECTED'] } } }),
    companyId ? prisma.structuralSection.count({ where: { companyId } }) : 0,
    companyId ? prisma.structuralSection.count({ where: { companyId, reviewStatus: 'CONFIRMED' } }) : 0,
    companyId ? prisma.engineeringProject.count({ where: { companyId, status: { in: ['SUGGESTED', 'REVIEWED', 'CORRECTED'] } } }) : 0,
    companyId ? prisma.engineeringProject.count({ where: { companyId, status: 'CONFIRMED' } }) : 0,
    companyId ? prisma.engineeringProject.count({ where: { companyId, status: 'CONFIRMED', verified: true } }) : 0,
    companyId ? prisma.engineeringDrawingDocument.count({ where: { companyId } }) : 0,
    companyId ? prisma.engineeringDrawingDocument.count({ where: { companyId, status: 'REVIEWED' } }) : 0,
    prisma.engineeringKnowledgeDocument.count({ where: { OR: [{ companyId: companyId || null }, { companyId: null }], verified: false } }),
    prisma.engineeringReviewSession.findMany({ where: { companyId: companyId || null }, orderBy: { lastActivityAt: 'desc' }, take: 20 })
  ]);
  return { benchmarks: { total: benchmarkTotal, verified: benchmarkVerified, pending: benchmarkPending }, catalog: { total: catalogTotal, confirmed: catalogConfirmed, pending: Math.max(0, catalogTotal - catalogConfirmed) }, projects: { suggested: projectSuggested, confirmed: projectConfirmed, golden: projectGolden }, drawings: { total: drawingTotal, reviewed: drawingReviewed, pending: Math.max(0, drawingTotal - drawingReviewed) }, documents: { pending: documentPending }, sessions };
}

export { runEngineeringGoldenValidation };
