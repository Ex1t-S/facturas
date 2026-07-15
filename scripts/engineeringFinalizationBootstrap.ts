import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../src/db.js';
import { config } from '../src/config.js';
import { syncEngineeringSources } from '../src/services/engineering/engineeringSourceImporter.js';
import { ingestEngineeringKnowledge } from '../src/services/engineering/engineeringIngestion.js';
import { extractBenchmarkCandidates, suggestEngineeringProjects } from '../src/services/engineering/engineeringCuration.js';
import { importCirsocRectangularSections } from '../src/services/engineering/structuralCatalogImporter.js';
import { ingestEngineeringDrawings } from '../src/services/engineering/drawingLibrary.js';
import { engineeringFinalizationStatus } from '../src/services/engineering/engineeringFinalization.js';

if (!/^postgres(ql)?:\/\//i.test(process.env.DATABASE_URL || '')) throw new Error('engineering:finalization:bootstrap requiere DATABASE_URL PostgreSQL.');

const company = await prisma.company.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true, legalName: true } });
if (!company) throw new Error('No existe una empresa para asociar catalogo, proyectos y planos.');

const sourceSync = await syncEngineeringSources();
const storageRoot = path.resolve(config.ENGINEERING_SOURCE_STORAGE_ROOT);
await ingestEngineeringKnowledge({ rootPath: storageRoot });
let documentsLinked = 0;
for (const item of sourceSync.results.filter((row) => row.fileHash)) {
  const document = await prisma.engineeringKnowledgeDocument.findFirst({ where: { sha256: item.fileHash!, companyId: null } });
  if (!document) continue;
  await prisma.engineeringKnowledgeDocument.update({ where: { id: document.id }, data: { sourceId: item.id } });
  await prisma.engineeringSource.update({ where: { id: item.id }, data: { documentId: document.id } });
  documentsLinked += 1;
}

const benchmarks = await extractBenchmarkCandidates(15);
let catalog: unknown = { skipped: true, reason: 'Fuente o archivo de catalogo no disponible.' };
const catalogSource = await prisma.engineeringSource.findUnique({ where: { id: 'cirsoc-301-302-tables-2005' } });
if (catalogSource?.localFilePath) {
  const filePath = path.resolve(config.UPLOAD_DIR, catalogSource.localFilePath);
  try {
    await fs.access(filePath);
    catalog = await importCirsocRectangularSections({ companyId: company.id, sourceId: catalogSource.id, filePath, sourceDocumentId: catalogSource.documentId || undefined, verified: false });
  } catch (error) { catalog = { skipped: true, reason: error instanceof Error ? error.message : String(error) }; }
}

const projectSuggestions = await suggestEngineeringProjects(company.id);
let drawings: unknown = { skipped: true, reason: 'No hay raiz de planos accesible en produccion.' };
const drawingsRoot = config.ENGINEERING_DRAWINGS_ROOT || config.ENGINEERING_KNOWLEDGE_ROOT || config.HISTORICAL_DOCUMENT_ROOT;
if (drawingsRoot) {
  try { await fs.access(drawingsRoot); drawings = await ingestEngineeringDrawings({ companyId: company.id, rootPath: drawingsRoot }); }
  catch (error) { drawings = { skipped: true, reason: error instanceof Error ? error.message : String(error) }; }
}

const result = { company, sourceSync, documentsLinked, benchmarksCreated: benchmarks.length, catalog, projectSuggestions: projectSuggestions.length, drawings, status: await engineeringFinalizationStatus(company.id) };
console.log(JSON.stringify(result, null, 2));
await prisma.$disconnect();
