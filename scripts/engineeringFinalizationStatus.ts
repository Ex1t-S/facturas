import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { prisma } from '../src/db.js';
import { engineeringFinalizationStatus } from '../src/services/engineering/engineeringFinalization.js';

const databaseMode = /^postgres(ql)?:\/\//i.test(process.env.DATABASE_URL || '');
const direct = process.argv.includes('--direct');

async function openProductionStatus() {
  const executable = process.platform === 'win32' ? path.resolve('tools/render/render.exe') : 'render';
  const child = spawn(executable, ['ssh', process.env.RENDER_ENGINEERING_SERVICE || 'fmh-gestion', '--', '-t', 'npm run engineering:finalization:status:direct'], { stdio: 'inherit' });
  await new Promise<void>((resolve, reject) => { child.on('error', reject); child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`Render SSH finalizo con codigo ${code ?? 'desconocido'}.`))); });
}

function markdown(status: any) {
  const checks = (rows: any[]) => rows.map((row) => `- ${row.passed ? 'PASS' : 'PENDING'} — ${row.name}: ${row.detail}`).join('\n');
  return `# FMH Engineering Finalization Status\n\nGenerado: ${new Date().toISOString()}\n\nEstado: **${status.readiness}**\n\n## Produccion y migraciones\n\n- DB conectada: ${status.database?.connected ? 'SI' : 'NO'}\n- Migraciones requeridas pendientes: ${status.database?.pendingRequired?.join(', ') || 'ninguna'}\n\n## Fuentes\n\n- Total persistidas: ${status.sources?.total ?? 0}\n- Estados de descarga: ${JSON.stringify(status.sources?.byDownloadStatus || {})}\n\n## Benchmarks y herramientas\n\n- Benchmarks: ${status.benchmarks?.verified ?? 0} verificados / ${status.benchmarks?.total ?? 0} totales\n- Validaciones: ${status.validations?.passed ?? 0} PASS / ${status.validations?.failed ?? 0} FAIL\n\n## Catalogo, proyectos y planos\n\n- Catalogo: ${status.catalog?.confirmed ?? 0} confirmados / ${status.catalog?.total ?? 0}\n- Proyectos: ${status.projects?.confirmed ?? 0} confirmados; ${status.projects?.golden ?? 0} Golden\n- Planos: ${status.drawings?.reviewed ?? 0} revisados / ${status.drawings?.total ?? 0}\n\n## Criterios criticos\n\n${checks(status.critical || [])}\n\n## Conocimiento recomendado\n\n${checks(status.recommended || [])}\n`;
}

if (!databaseMode && !direct) {
  if (process.stdin.isTTY) { await openProductionStatus(); process.exit(0); }
  const sourceReport = JSON.parse(await fs.readFile('docs/engineering-source-sync-report.json', 'utf8'));
  const benchmarkReport = JSON.parse(await fs.readFile('docs/engineering-benchmark-extraction-report.json', 'utf8'));
  const catalogReport = JSON.parse(await fs.readFile('docs/engineering-catalog-extraction-report.json', 'utf8'));
  const local = { readiness: 'PRODUCTION_CHECK_REQUIRED', database: { connected: false, pendingRequired: ['20260720000000_engineering_golden_library', '20260721000000_engineering_review_finalization'] }, sources: { total: sourceReport.manifestCount, byDownloadStatus: Object.fromEntries(['DOWNLOADED', 'ACCESS_RESTRICTED', 'NOT_ATTEMPTED'].map((status) => [status, sourceReport.results.filter((item: any) => item.downloadStatus === status).length])) }, benchmarks: { total: benchmarkReport.candidates.length, verified: 0 }, validations: { passed: 0, failed: 0 }, catalog: { total: catalogReport.rows, confirmed: 0 }, projects: { confirmed: 0, golden: 0 }, drawings: { total: 0, reviewed: 0 }, critical: [{ name: 'Produccion', passed: false, detail: 'Ejecutar en terminal interactiva para consultar Render.' }], recommended: [] };
  await fs.writeFile('docs/fmh-finalization-status.md', markdown(local));
  console.log(JSON.stringify(local, null, 2));
  process.exit(0);
}

const status = await engineeringFinalizationStatus(process.argv.find((arg) => arg.startsWith('--company='))?.split('=')[1]);
console.log('\nFMH Engineering Finalization\n');
console.log(JSON.stringify(status, null, 2));
if (process.argv.includes('--write-doc')) await fs.writeFile('docs/fmh-finalization-status.md', markdown(status));
await prisma.$disconnect();
