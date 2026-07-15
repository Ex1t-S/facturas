import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { prisma } from '../src/db.js';
import {
  benchmarkToolSpecs,
  defaultEngineeringCompanyId,
  isBenchmarkReady,
  pendingReviewItems,
  reviewBenchmark,
  reviewCatalogSection,
  reviewDrawing,
  reviewKnowledgeDocument,
  reviewProgress,
  reviewProject,
  runEngineeringGoldenValidation,
  setReviewSessionStatus,
  startOrResumeReviewSession,
  type ReviewType
} from '../src/services/engineering/engineeringReview.js';

const isDatabaseMode = /^postgres(ql)?:\/\//i.test(process.env.DATABASE_URL || '');
const direct = process.argv.includes('--direct');

async function openProductionWizard() {
  const executable = process.platform === 'win32' ? path.resolve('tools/render/render.exe') : 'render';
  if (process.platform === 'win32' && !fs.existsSync(executable)) throw new Error('No se encontro Render CLI para abrir el wizard de produccion.');
  console.log('Abriendo FMH Engineering Review dentro del servicio de produccion...');
  const child = spawn(executable, ['ssh', process.env.RENDER_ENGINEERING_SERVICE || 'fmh-gestion', '--', '-t', 'npm run engineering:review:direct'], { stdio: 'inherit' });
  await new Promise<void>((resolve, reject) => { child.on('error', reject); child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`Render SSH finalizo con codigo ${code ?? 'desconocido'}.`))); });
}

if (!isDatabaseMode && !direct) {
  if (!process.stdin.isTTY) {
    console.log('FMH Engineering Review');
    console.log('La terminal no es interactiva y no hay DATABASE_URL local. En una terminal normal, este comando abre automaticamente el wizard dentro de Render.');
    process.exit(0);
  }
  await openProductionWizard();
  process.exit(0);
}
if (!isDatabaseMode) throw new Error('El modo directo requiere DATABASE_URL PostgreSQL.');

const rl = createInterface({ input, output });
const clean = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();
const preview = (value: unknown, max = 1800) => clean(value).slice(0, max) || '(sin dato extraido)';
const numberValue = (value: string) => { const parsed = Number(value.replace(',', '.')); return Number.isFinite(parsed) ? parsed : undefined; };
const ask = async (question: string) => (await rl.question(question)).trim();

function nestedValue(pathName: string, value: number) {
  const root: Record<string, unknown> = {};
  const parts = pathName.split('.');
  let cursor = root;
  for (let index = 0; index < parts.length - 1; index += 1) { cursor[parts[index]] = {}; cursor = cursor[parts[index]] as Record<string, unknown>; }
  cursor[parts.at(-1)!] = value;
  return root;
}

async function chooseCompany() {
  const companies = await prisma.company.findMany({ orderBy: { createdAt: 'asc' }, select: { id: true, legalName: true, tradeName: true } });
  if (!companies.length) throw new Error('No hay empresas cargadas en produccion.');
  if (companies.length === 1) return companies[0];
  console.log('\nEmpresas disponibles:');
  companies.forEach((company, index) => console.log(`${index + 1}. ${company.tradeName || company.legalName}`));
  const selected = Number(await ask('Elegir empresa: ')) - 1;
  return companies[selected] || companies[0];
}

async function showProgress(companyId: string) {
  const value = await reviewProgress(companyId);
  console.log('\nFMH Engineering Review — progreso');
  console.log(`Benchmarks: ${value.benchmarks.verified} verificados, ${value.benchmarks.pending} pendientes`);
  console.log(`Catalogo: ${value.catalog.confirmed} confirmadas, ${value.catalog.pending} pendientes`);
  console.log(`Proyectos: ${value.projects.confirmed} confirmados, ${value.projects.golden} Golden, ${value.projects.suggested} sugeridos`);
  console.log(`Planos: ${value.drawings.reviewed} revisados, ${value.drawings.pending} pendientes`);
  console.log(`Documentos tecnicos pendientes: ${value.documents.pending}`);
}

async function confirmAction(prompt = '¿Confirmar? [a/c/s/r/v/q]: ') {
  const value = (await ask(prompt)).toLowerCase();
  return value[0] || 'q';
}

async function editBenchmark(item: any) {
  const tools = Object.entries(benchmarkToolSpecs);
  console.log('\nHerramientas candidatas:');
  tools.forEach(([name, spec], index) => console.log(`${index + 1}. ${spec.label} (${name})`));
  const selected = tools[Number(await ask('Herramienta: ')) - 1];
  if (!selected) throw new Error('Herramienta no valida.');
  const [implementedTool, spec] = selected;
  const values: Record<string, unknown> = {};
  for (const field of spec.inputs) {
    const answer = await ask(`${field.label}${field.optional ? ' (opcional)' : ''}: `);
    if (!answer && field.optional) continue;
    if (field.name === 'kind') values[field.name] = answer;
    else if (field.name === 'supportCounts') values[field.name] = answer.split(/[;, ]+/).map(numberValue).filter((value): value is number => value !== undefined);
    else {
      const parsed = numberValue(answer);
      if (parsed === undefined) throw new Error(`${field.label}: se esperaba un numero.`);
      values[field.name] = parsed;
    }
  }
  const expectedAnswer = await ask(`Resultado humano esperado (${spec.expectedPath}): `);
  const expected = numberValue(expectedAnswer);
  if (expected === undefined) throw new Error('El resultado esperado debe ser numerico.');
  const toleranceAnswer = await ask('Tolerancia relativa/absoluta (ej. 0,001): ');
  const tolerance = numberValue(toleranceAnswer) ?? 0.001;
  const note = await ask('Nota de revision (opcional): ');
  return { correction: { implementedTool, inputJson: JSON.stringify(values), expectedOutputJson: JSON.stringify(nestedValue(spec.expectedPath, expected)), tolerancesJson: JSON.stringify({ default: tolerance }), status: 'CORRECTED', verified: false }, note };
}

async function reviewBenchmarks(companyId: string, reviewer: string) {
  const session = await startOrResumeReviewSession({ companyId, reviewType: 'BENCHMARK', reviewer });
  while (true) {
    const rows = await pendingReviewItems('BENCHMARK', companyId, 1) as any[];
    if (!rows.length) { await setReviewSessionStatus(session.id, 'COMPLETED'); console.log('\nNo quedan benchmarks pendientes.'); return; }
    const item = rows[0];
    const pages = JSON.parse(item.pageReferencesJson || '[]');
    console.log(`\nBenchmark humano — ${item.title}`);
    console.log(`Fuente: ${item.source.title}`);
    console.log(`Norma/edicion: ${item.standardCode || 'pendiente'} / ${item.standardEdition || item.source.edition || 'pendiente'}`);
    console.log(`Pagina: ${pages.join(', ') || 'pendiente'}`);
    console.log(`Extracto: ${preview(item.problemStatement)}`);
    console.log(`Herramienta: ${item.implementedTool || 'pendiente'}`);
    console.log(`Datos estructurados: ${isBenchmarkReady(item) ? 'completos para confirmar' : 'incompletos; usar corregir'}`);
    const action = await confirmAction();
    try {
      if (action === 'a') {
        const result = await reviewBenchmark({ id: item.id, sessionId: session.id, reviewer, decision: 'CONFIRMED' });
        const validation: any = result.validation;
        if (validation && !validation.skipped) {
          const worst = validation.errors?.sort((a: any, b: any) => b.relativeError - a.relativeError)[0];
          console.log(`Resultado esperado: ${worst?.expected ?? '—'} | FMH: ${worst?.actual ?? '—'} | Error relativo: ${worst ? `${(worst.relativeError * 100).toFixed(4)} %` : '—'} | ${validation.passed ? 'PASS' : 'FAIL'}`);
        }
      } else if (action === 'c') {
        const changed = await editBenchmark(item);
        await reviewBenchmark({ id: item.id, sessionId: session.id, reviewer, decision: 'CORRECTED', ...changed });
        console.log('Correccion guardada. El mismo benchmark queda listo para confirmar.');
      } else if (action === 's') await reviewBenchmark({ id: item.id, sessionId: session.id, reviewer, decision: 'SKIPPED' });
      else if (action === 'r') await reviewBenchmark({ id: item.id, sessionId: session.id, reviewer, decision: 'REJECTED' });
      else if (action === 'v') { console.log(`\nRuta local: ${item.source.localFilePath || 'no disponible'}`); console.log(`URL: ${item.source.sourceUrl}`); console.log(`Contexto ampliado:\n${preview(item.problemStatement, 5000)}`); }
      else { await setReviewSessionStatus(session.id, 'PAUSED'); console.log('Sesion guardada. Podes retomarla con npm run engineering:review.'); return; }
    } catch (error) { console.log(`No se guardo la confirmacion: ${error instanceof Error ? error.message : String(error)}`); }
  }
}

const catalogFields = ['designation', 'type', 'material', 'width', 'height', 'diameter', 'thickness', 'area', 'massPerMeter', 'ix', 'iy', 'rx', 'ry', 'yieldStrength', 'commercialLength', 'sourcePage'];

async function reviewCatalog(companyId: string, reviewer: string) {
  const session = await startOrResumeReviewSession({ companyId, reviewType: 'CATALOG', reviewer });
  while (true) {
    const rows = await pendingReviewItems('CATALOG', companyId, 1) as any[];
    if (!rows.length) { await setReviewSessionStatus(session.id, 'COMPLETED'); console.log('\nNo quedan secciones pendientes.'); return; }
    const item = rows[0];
    console.log(`\nSeccion: ${item.designation}`);
    console.log(`Fuente: ${item.sourceRecord?.title || item.source}`);
    console.log(`Pagina: ${item.sourcePage || 'pendiente'}`);
    console.log(`Area: ${item.area ?? '—'} mm2 | Peso: ${item.massPerMeter ?? '—'} kg/m`);
    console.log(`Ix: ${item.ix ?? '—'} mm4 | Iy: ${item.iy ?? '—'} mm4 | rx: ${item.rx ?? '—'} mm | ry: ${item.ry ?? '—'} mm`);
    const action = await confirmAction();
    if (action === 'a') await reviewCatalogSection({ id: item.id, sessionId: session.id, reviewer, decision: 'CONFIRMED' });
    else if (action === 'c') {
      catalogFields.forEach((field, index) => console.log(`${index + 1}. ${field}: ${item[field] ?? '—'}`));
      const field = catalogFields[Number(await ask('Campo a corregir: ')) - 1];
      if (!field) { console.log('Campo no valido.'); continue; }
      const answer = await ask('Nuevo valor (vacio = null): ');
      const value = ['designation', 'type', 'material'].includes(field) ? (answer || null) : (answer ? numberValue(answer) : null);
      await reviewCatalogSection({ id: item.id, sessionId: session.id, reviewer, decision: 'CORRECTED', correction: { [field]: value } });
      console.log('Correccion guardada; confirma la fila en la siguiente pregunta.');
    } else if (action === 's') await reviewCatalogSection({ id: item.id, sessionId: session.id, reviewer, decision: 'SKIPPED' });
    else if (action === 'r') await reviewCatalogSection({ id: item.id, sessionId: session.id, reviewer, decision: 'REJECTED' });
    else if (action === 'v') { console.log(`Ruta: ${item.sourceRecord?.localFilePath || 'no disponible'}\nURL: ${item.sourceRecord?.sourceUrl || 'no disponible'}\nNotas: ${item.notes || '—'}`); }
    else { await setReviewSessionStatus(session.id, 'PAUSED'); console.log('Sesion guardada.'); return; }
  }
}

async function reviewProjects(companyId: string, reviewer: string) {
  const session = await startOrResumeReviewSession({ companyId, reviewType: 'PROJECT', reviewer });
  while (true) {
    const rows = await pendingReviewItems('PROJECT', companyId, 1) as any[];
    if (!rows.length) { await setReviewSessionStatus(session.id, 'COMPLETED'); console.log('\nNo quedan proyectos sugeridos.'); return; }
    const item = rows[0];
    console.log(`\nProyecto sugerido: ${item.name}\nCliente: ${item.customerName || 'pendiente'}\nTipo: ${item.projectType}\nArchivos relacionados: ${item.documents.length}\n${item.description || ''}`);
    item.documents.slice(0, 12).forEach((link: any) => console.log(`- ${link.knowledge.fileName} (${link.knowledge.documentType})`));
    const action = await confirmAction('¿Pertenecen al mismo proyecto? [a/c/s/r/v/q]: ');
    if (action === 'a') {
      const goldenAnswer = (await ask('¿Usarlo como antecedente FMH prioritario? [s/n/d=despues]: ')).toLowerCase();
      await reviewProject({ id: item.id, sessionId: session.id, reviewer, decision: 'CONFIRMED', golden: goldenAnswer.startsWith('s') });
    } else if (action === 'c') {
      const name = await ask(`Nombre [${item.name}]: `); const customerName = await ask(`Cliente [${item.customerName || ''}]: `); const projectType = await ask(`Tipo [${item.projectType}]: `);
      await reviewProject({ id: item.id, sessionId: session.id, reviewer, decision: 'CORRECTED', correction: { ...(name ? { name } : {}), ...(customerName ? { customerName } : {}), ...(projectType ? { projectType } : {}) } });
    } else if (action === 's') await reviewProject({ id: item.id, sessionId: session.id, reviewer, decision: 'SKIPPED' });
    else if (action === 'r') await reviewProject({ id: item.id, sessionId: session.id, reviewer, decision: 'REJECTED' });
    else if (action === 'v') item.documents.forEach((link: any) => console.log(`${link.knowledge.fileName}: ${link.knowledge.relativePath || link.knowledge.sourcePath || 'sin ruta'}`));
    else { await setReviewSessionStatus(session.id, 'PAUSED'); return; }
  }
}

async function reviewDrawings(companyId: string, reviewer: string) {
  const session = await startOrResumeReviewSession({ companyId, reviewType: 'DRAWING', reviewer });
  while (true) {
    const rows = await pendingReviewItems('DRAWING', companyId, 1) as any[];
    if (!rows.length) { await setReviewSessionStatus(session.id, 'COMPLETED'); console.log('\nNo quedan planos pendientes.'); return; }
    const item = rows[0]; const data = JSON.parse(item.extractionJson || '{}');
    console.log(`\nPlano: ${item.drawingTitle || item.fileName}\nTipo: ${item.projectType || data.projectType || 'pendiente'}\nCliente: ${item.customerName || data.customer || 'pendiente'}\nNumero: ${item.drawingNumber || data.drawingNumber || 'pendiente'}\nRevision: ${item.revision || data.revision || 'pendiente'}`);
    console.log(`Datos extraidos: ${preview(data, 1800)}`);
    const action = await confirmAction('[a] confirmar [c] corregir [s] no legible [r] no tecnico [v] ver fuente [q] salir: ');
    if (action === 'a') await reviewDrawing({ id: item.id, sessionId: session.id, reviewer, decision: 'CONFIRMED' });
    else if (action === 'c') { const field = await ask('Dato a corregir (ej. diameter, capacity, customerName): '); const answer = await ask('Nuevo valor: '); const parsed = numberValue(answer); await reviewDrawing({ id: item.id, sessionId: session.id, reviewer, decision: 'CORRECTED', correction: { field, value: parsed ?? answer } }); }
    else if (action === 's') await reviewDrawing({ id: item.id, sessionId: session.id, reviewer, decision: 'SKIPPED', note: 'No se puede leer con confianza.' });
    else if (action === 'r') await reviewDrawing({ id: item.id, sessionId: session.id, reviewer, decision: 'REJECTED', note: 'No es un plano tecnico.' });
    else if (action === 'v') console.log(`Ruta: ${item.sourcePath}\nMiniatura: ${item.thumbnailPath || 'no disponible'}\nTexto:\n${preview(item.extractedText, 5000)}`);
    else { await setReviewSessionStatus(session.id, 'PAUSED'); return; }
  }
}

async function reviewDocuments(companyId: string, reviewer: string) {
  const session = await startOrResumeReviewSession({ companyId, reviewType: 'DOCUMENT', reviewer });
  while (true) {
    const rows = await pendingReviewItems('DOCUMENT', companyId, 1) as any[];
    if (!rows.length) { await setReviewSessionStatus(session.id, 'COMPLETED'); console.log('\nNo quedan documentos pendientes.'); return; }
    const item = rows[0];
    console.log(`\nDocumento: ${item.fileName}\nTipo: ${item.documentType}\nProyecto: ${item.projectName || 'pendiente'}\nCliente: ${item.customerName || 'pendiente'}\nExtracto: ${preview(item.rawText || item.structuredJson)}`);
    const action = await confirmAction();
    if (action === 'a') await reviewKnowledgeDocument({ id: item.id, sessionId: session.id, reviewer, decision: 'CONFIRMED' });
    else if (action === 'c') { const documentType = await ask(`Tipo [${item.documentType}]: `); const projectName = await ask(`Proyecto [${item.projectName || ''}]: `); const customerName = await ask(`Cliente [${item.customerName || ''}]: `); await reviewKnowledgeDocument({ id: item.id, sessionId: session.id, reviewer, decision: 'CORRECTED', correction: { ...(documentType ? { documentType } : {}), ...(projectName ? { projectName } : {}), ...(customerName ? { customerName } : {}) } }); }
    else if (action === 's') await reviewKnowledgeDocument({ id: item.id, sessionId: session.id, reviewer, decision: 'SKIPPED' });
    else if (action === 'r') await reviewKnowledgeDocument({ id: item.id, sessionId: session.id, reviewer, decision: 'REJECTED' });
    else if (action === 'v') console.log(`Ruta: ${item.relativePath || item.fileName}\nContexto:\n${preview(item.rawText || item.structuredJson, 5000)}`);
    else { await setReviewSessionStatus(session.id, 'PAUSED'); return; }
  }
}

async function reviewConflicts(companyId: string) {
  const rows = await pendingReviewItems('CONFLICT', companyId, 100) as any[];
  if (!rows.length) { console.log('\nNo hay fallas de validacion pendientes.'); return; }
  console.log(`\nFallas de validacion: ${rows.length}`);
  rows.forEach((item, index) => console.log(`${index + 1}. ${item.toolName} ${item.toolVersion} — ${item.benchmark.title}`));
}

async function routeReview(type: ReviewType, companyId: string, reviewer: string) {
  if (type === 'BENCHMARK') return reviewBenchmarks(companyId, reviewer);
  if (type === 'CATALOG') return reviewCatalog(companyId, reviewer);
  if (type === 'PROJECT') return reviewProjects(companyId, reviewer);
  if (type === 'DRAWING') return reviewDrawings(companyId, reviewer);
  if (type === 'DOCUMENT') return reviewDocuments(companyId, reviewer);
  return reviewConflicts(companyId);
}

try {
  const company = await chooseCompany();
  const reviewer = await ask(`Revisor [${process.env.USER || process.env.USERNAME || 'FMH'}]: `) || process.env.USER || process.env.USERNAME || 'FMH';
  console.log(`\nFMH Engineering Review\nEmpresa: ${company.tradeName || company.legalName}\nCada decision se guarda inmediatamente.`);
  while (true) {
    await showProgress(company.id);
    console.log('\n1. Revisar benchmarks\n2. Revisar catalogo estructural\n3. Revisar proyectos FMH\n4. Revisar planos\n5. Revisar documentos tecnicos\n6. Ver conflictos\n7. Ejecutar validacion\n8. Ver progreso\n9. Todo en orden recomendado\n0. Salir');
    const option = await ask('Elegir: ');
    if (option === '1') await routeReview('BENCHMARK', company.id, reviewer);
    else if (option === '2') await routeReview('CATALOG', company.id, reviewer);
    else if (option === '3') await routeReview('PROJECT', company.id, reviewer);
    else if (option === '4') await routeReview('DRAWING', company.id, reviewer);
    else if (option === '5') await routeReview('DOCUMENT', company.id, reviewer);
    else if (option === '6') await routeReview('CONFLICT', company.id, reviewer);
    else if (option === '7') console.log(JSON.stringify(await runEngineeringGoldenValidation(company.id), null, 2));
    else if (option === '8') await showProgress(company.id);
    else if (option === '9') { for (const type of ['BENCHMARK', 'CATALOG', 'PROJECT', 'DRAWING'] as ReviewType[]) await routeReview(type, company.id, reviewer); }
    else break;
  }
} finally {
  rl.close();
  await prisma.$disconnect();
}
