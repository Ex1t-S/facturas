import { prisma } from '../src/db.js';
import { runEngineeringGoldenValidation } from '../src/services/engineering/engineeringValidation.js';

if (!/^postgres(ql)?:\/\//i.test(process.env.DATABASE_URL || '')) {
  console.log(JSON.stringify({ mode: 'OFFLINE_NO_DATABASE', benchmarks: { total: 0, verified: 0, needsReview: 0 }, validations: { total: 0, passed: 0, failed: 0 }, note: 'La base de datos no está configurada; no se marcan benchmarks como verificados.' }, null, 2));
  await prisma.$disconnect();
  process.exit(0);
}
const validationRun = await runEngineeringGoldenValidation(process.argv[2]);
const [benchmarks, validations] = await Promise.all([
  prisma.engineeringBenchmark.findMany({ select: { id: true, title: true, status: true, verified: true, implementedTool: true } }),
  prisma.engineeringToolValidation.findMany({ orderBy: { validatedAt: 'desc' }, select: { toolName: true, toolVersion: true, benchmarkId: true, passed: true, relativeError: true } })
]);
const byTool = new Map<string, { passed: number; failed: number; total: number }>();
for (const item of validations) { const key = `${item.toolName}@${item.toolVersion}`; const current = byTool.get(key) || { passed: 0, failed: 0, total: 0 }; current.total += 1; item.passed ? current.passed++ : current.failed++; byTool.set(key, current); }
console.log(JSON.stringify({ benchmarkRun: validationRun, benchmarks: { total: benchmarks.length, verified: benchmarks.filter((item) => item.verified).length, needsReview: benchmarks.filter((item) => item.status === 'NEEDS_REVIEW').length }, validations: { total: validations.length, passed: validations.filter((item) => item.passed).length, failed: validations.filter((item) => !item.passed).length, tools: Object.fromEntries(byTool) } }, null, 2));
await prisma.$disconnect();
