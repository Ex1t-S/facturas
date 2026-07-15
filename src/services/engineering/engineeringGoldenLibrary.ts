import { prisma } from '../../db.js';
import { searchEngineeringSectionCandidates } from './sectionCandidates.js';
import { searchOfficialEngineeringRegulations } from './regulations.js';
import { searchEngineeringKnowledge } from './engineeringKnowledge.js';
import { sourcePriority } from './engineeringSourceImporter.js';

export async function searchEngineeringGoldenLibrary(input: { companyId: string; q: string; take?: number }) {
  const take = Math.min(Math.max(input.take || 8, 1), 50);
  const [knowledge, regulations, benchmarks, sections, sources] = await Promise.all([
    searchEngineeringKnowledge({ companyId: input.companyId, q: input.q, take }),
    searchOfficialEngineeringRegulations(input.companyId, input.q),
    prisma.engineeringBenchmark.findMany({ where: { AND: [{ OR: [{ companyId: input.companyId }, { companyId: null }] }, ...(input.q.trim() ? [{ OR: [{ title: { contains: input.q } }, { problemStatement: { contains: input.q } }, { standardCode: { contains: input.q } }] }] : [])] }, include: { source: { select: { id: true, title: true, jurisdiction: true, sourceType: true, verificationStatus: true, sourceUrl: true } } }, orderBy: [{ verified: 'desc' }, { updatedAt: 'desc' }], take }),
    searchEngineeringSectionCandidates(input.companyId, input.q, take),
    prisma.engineeringSource.findMany({ where: { ...(input.q.trim() ? { OR: [{ title: { contains: input.q } }, { publisher: { contains: input.q } }, { sourceType: { contains: input.q } }, { jurisdiction: { contains: input.q } }] } : {}) }, orderBy: [{ verificationStatus: 'asc' }, { title: 'asc' }], take: take * 3 })
  ]);
  return {
    fmhPrecedents: knowledge.documents,
    regulations,
    benchmarks,
    sectionCandidates: sections,
    internationalReferences: sources.filter((source) => source.jurisdiction !== 'AR').map((source) => ({ ...source, usagePolicy: 'INTERNATIONAL_REFERENCE' as const })),
    sources: sources.map((source) => ({ ...source, priority: sourcePriority(source) })),
    projects: knowledge.projects
  };
}
