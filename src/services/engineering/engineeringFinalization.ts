import { prisma } from '../../db.js';
import { engineeringModelConfig } from './engineeringRuntime.js';
import { defaultEngineeringCompanyId, reviewProgress } from './engineeringReview.js';

const requiredMigrations = ['20260720000000_engineering_golden_library', '20260721000000_engineering_review_finalization'];

export type FinalizationCheck = { name: string; passed: boolean; detail: string };

export async function engineeringFinalizationStatus(companyId?: string) {
  const selectedCompanyId = companyId || await defaultEngineeringCompanyId();
  let dbConnected = false;
  let appliedMigrations: string[] = [];
  try {
    await prisma.$queryRawUnsafe('SELECT 1');
    dbConnected = true;
    const rows = await prisma.$queryRawUnsafe<Array<{ migration_name: string; finished_at: Date | null }>>('SELECT migration_name, finished_at FROM "_prisma_migrations" WHERE rolled_back_at IS NULL');
    appliedMigrations = rows.filter((row) => row.finished_at).map((row) => row.migration_name);
  } catch {
    dbConnected = false;
  }

  if (!dbConnected) return {
    readiness: 'NOT_READY', companyId: selectedCompanyId, database: { connected: false, appliedMigrations: [], pendingRequired: requiredMigrations },
    critical: [{ name: 'Base de datos', passed: false, detail: 'No se pudo consultar la base configurada.' } satisfies FinalizationCheck], recommended: []
  };

  const [sources, sourceDownloads, benchmarks, benchmarkVerified, validations, validationPassed, validationFailed, progress, recentSol] = await Promise.all([
    prisma.engineeringSource.count(),
    prisma.engineeringSource.groupBy({ by: ['downloadStatus'], _count: { _all: true } }),
    prisma.engineeringBenchmark.count({ where: { OR: [{ companyId: selectedCompanyId || null }, { companyId: null }] } }),
    prisma.engineeringBenchmark.count({ where: { OR: [{ companyId: selectedCompanyId || null }, { companyId: null }], verified: true } }),
    prisma.engineeringToolValidation.count({ where: { OR: [{ companyId: selectedCompanyId || null }, { companyId: null }] } }),
    prisma.engineeringToolValidation.count({ where: { OR: [{ companyId: selectedCompanyId || null }, { companyId: null }], passed: true } }),
    prisma.engineeringToolValidation.count({ where: { OR: [{ companyId: selectedCompanyId || null }, { companyId: null }], passed: false } }),
    reviewProgress(selectedCompanyId),
    prisma.engineeringMessage.findFirst({ where: { provider: 'openai', actualModel: 'gpt-5.6-sol', fallbackUsed: false }, orderBy: { createdAt: 'desc' }, select: { createdAt: true, actualModel: true } })
  ]);
  const model = engineeringModelConfig();
  const pendingRequired = requiredMigrations.filter((migration) => !appliedMigrations.includes(migration));
  const downloadCounts = Object.fromEntries(sourceDownloads.map((row) => [row.downloadStatus, row._count._all]));
  const critical: FinalizationCheck[] = [
    { name: 'Base de datos', passed: true, detail: 'Consulta minima correcta.' },
    { name: 'Migraciones Golden/Review', passed: pendingRequired.length === 0, detail: pendingRequired.length ? `Pendientes: ${pendingRequired.join(', ')}` : 'Aplicadas.' },
    { name: 'Fuentes persistidas', passed: sources > 0, detail: `${sources} fuentes en EngineeringSource.` },
    { name: 'GPT-5.6 Sol configurado', passed: model.requestedModel === 'gpt-5.6-sol', detail: `Modelo solicitado: ${model.requestedModel}.` },
    { name: 'GPT-5.6 Sol observado', passed: Boolean(recentSol), detail: recentSol ? `Ultima respuesta real: ${recentSol.createdAt.toISOString()}.` : 'No hay respuesta real reciente en la DB.' }
  ];
  const recommended: FinalizationCheck[] = [
    { name: 'Benchmarks humanos', passed: benchmarkVerified >= 5, detail: `${benchmarkVerified}/${benchmarks} verificados.` },
    { name: 'Catalogo estructural', passed: progress.catalog.confirmed >= 10, detail: `${progress.catalog.confirmed}/${progress.catalog.total} confirmados.` },
    { name: 'Proyectos FMH', passed: progress.projects.confirmed >= 3, detail: `${progress.projects.confirmed} confirmados; ${progress.projects.golden} Golden.` },
    { name: 'Planos FMH', passed: progress.drawings.reviewed >= 5, detail: `${progress.drawings.reviewed}/${progress.drawings.total} revisados.` },
    { name: 'Validaciones', passed: validationPassed >= 5, detail: `${validationPassed}/${validations} PASS; ${validationFailed} FAIL.` }
  ];
  const criticalReady = critical.every((check) => check.passed);
  const knowledgeReady = recommended.some((check) => check.passed);
  return {
    readiness: criticalReady ? (knowledgeReady ? 'READY_FOR_USE' : 'READY_KNOWLEDGE_EXPANDING') : 'NOT_READY',
    companyId: selectedCompanyId,
    database: { connected: true, appliedMigrations, pendingRequired },
    sources: { total: sources, byDownloadStatus: downloadCounts },
    benchmarks: { total: benchmarks, verified: benchmarkVerified, pending: Math.max(0, benchmarks - benchmarkVerified) },
    validations: { total: validations, passed: validationPassed, failed: validationFailed },
    catalog: progress.catalog,
    projects: progress.projects,
    drawings: progress.drawings,
    documents: progress.documents,
    reviewSessions: progress.sessions,
    model: { requested: model.requestedModel, recentActual: recentSol?.actualModel, lastObservedAt: recentSol?.createdAt },
    critical,
    recommended
  };
}
