import { prisma } from '../../db.js';
import { executeEngineeringTool } from './engineeringTools.js';

const toolVersions: Record<string, string> = {
  calculate_vertical_load: 'v1',
  calculate_load_per_support: 'v1',
  compare_support_alternatives: 'v1',
  calculate_simple_axial_stress: 'v1',
  calculate_slenderness: 'v1',
  calculate_euler_reference_buckling: 'v1',
  compare_section_candidates: 'v1',
  get_section_properties: 'v1',
  build_preliminary_takeoff: 'v1',
  calculate_purchase_plan: 'v1'
};

function numericLeaves(value: unknown, prefix = ''): Array<{ path: string; value: number }> {
  if (typeof value === 'number' && Number.isFinite(value)) return [{ path: prefix, value }];
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => numericLeaves(child, prefix ? `${prefix}.${key}` : key));
}

function getPath(value: unknown, path: string) { return path.split('.').reduce<unknown>((current, key) => current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined, value); }

export async function validateEngineeringBenchmark(benchmarkId: string, companyId = '') {
  const benchmark = await prisma.engineeringBenchmark.findUnique({ where: { id: benchmarkId } });
  if (!benchmark?.verified || !benchmark.implementedTool) return { benchmarkId, skipped: true, reason: 'El benchmark no está verificado o no tiene herramienta.' };
  const inputs = JSON.parse(benchmark.inputJson) as Record<string, unknown>;
  const expected = JSON.parse(benchmark.expectedOutputJson) as unknown;
  const tolerance = JSON.parse(benchmark.tolerancesJson || '{}') as Record<string, number>;
  const actual = await executeEngineeringTool(benchmark.implementedTool, inputs, companyId);
  const leaves = numericLeaves(expected);
  const errors = leaves.map(({ path, value }) => { const actualValue = Number(getPath(actual, path)); const absoluteError = Number.isFinite(actualValue) ? Math.abs(actualValue - value) : Number.POSITIVE_INFINITY; const relativeError = value === 0 ? absoluteError : absoluteError / Math.abs(value); const allowed = Number(tolerance[path] ?? tolerance.default ?? 1e-6); return { path, expected: value, actual: actualValue, absoluteError, relativeError, allowed, passed: absoluteError <= allowed || relativeError <= allowed }; });
  const passed = leaves.length > 0 && errors.every((item) => item.passed);
  const toolVersion = toolVersions[benchmark.implementedTool] || 'v1';
  const priorPassed = await prisma.engineeringToolValidation.count({ where: { toolName: benchmark.implementedTool, toolVersion, passed: true, benchmarkId: { not: benchmarkId } } });
  const scope = passed ? (priorPassed + 1 >= 2 ? 'VALIDATED_FOR_SCOPE' : 'PARTIALLY_VALIDATED') : 'FAILED';
  const validation = await prisma.engineeringToolValidation.upsert({ where: { toolName_toolVersion_benchmarkId: { toolName: benchmark.implementedTool, toolVersion, benchmarkId } }, update: { companyId: benchmark.companyId, resultJson: JSON.stringify({ actual, expected, errors }), absoluteError: errors.length ? Math.max(...errors.map((item) => item.absoluteError)) : null, relativeError: errors.length ? Math.max(...errors.map((item) => item.relativeError)) : null, passed, scope, validatedAt: new Date() }, create: { companyId: benchmark.companyId, toolName: benchmark.implementedTool, toolVersion, benchmarkId, resultJson: JSON.stringify({ actual, expected, errors }), absoluteError: errors.length ? Math.max(...errors.map((item) => item.absoluteError)) : null, relativeError: errors.length ? Math.max(...errors.map((item) => item.relativeError)) : null, passed, scope } });
  if (scope === 'VALIDATED_FOR_SCOPE') await prisma.engineeringToolValidation.updateMany({ where: { toolName: benchmark.implementedTool, toolVersion, passed: true }, data: { scope } });
  return { benchmarkId, toolName: benchmark.implementedTool, toolVersion, passed, errors, validationId: validation.id };
}

export async function runEngineeringGoldenValidation(companyId?: string) {
  const benchmarks = await prisma.engineeringBenchmark.findMany({ where: { verified: true, implementedTool: { not: null }, ...(companyId ? { OR: [{ companyId }, { companyId: null }] } : {}) } });
  const results = [];
  for (const benchmark of benchmarks) results.push(await validateEngineeringBenchmark(benchmark.id, companyId || benchmark.companyId || ''));
  return { total: results.length, passed: results.filter((item) => item.passed).length, failed: results.filter((item) => item.passed === false).length, results };
}
