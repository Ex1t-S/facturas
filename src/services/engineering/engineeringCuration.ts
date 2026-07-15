import { prisma } from '../../db.js';

export const curationJobTypes = ['CLASSIFY_DOCUMENTS', 'GROUP_PROJECTS', 'EXTRACT_BENCHMARKS', 'EXTRACT_SECTIONS', 'ANALYZE_DRAWINGS', 'FIND_DUPLICATES', 'VERIFY_SOURCE_STATUS'] as const;

export type BenchmarkSlice = {
  heading: string;
  offset: number;
  excerpt: string;
  pageReferences: number[];
};

/** Extracts examples while retaining embedded PDF page markers as provenance. */
export function extractBenchmarkSlices(rawText: string, limit = 15): BenchmarkSlice[] {
  const text = rawText.replace(/\r/g, '');
  const matches = [...text.matchAll(/\b(?:EJEMPLO|EXAMPLE)\s*(?:N[^0-9A-Z]{0,2}\s*)?\d+[A-Z]?/gi)];
  const grouped = new Map<string, number[]>();
  for (const match of matches) {
    const heading = match[0].replace(/\s+/g, ' ').trim();
    const offsets = grouped.get(heading.toLowerCase()) || [];
    offsets.push(match.index ?? 0);
    grouped.set(heading.toLowerCase(), offsets);
  }
  const allOffsets = [...grouped.values()].flat();
  const slices: BenchmarkSlice[] = [];
  for (const offsets of grouped.values()) {
    if (slices.length >= limit) break;
    const offset = offsets.length > 1 ? offsets[1] : offsets[0];
    const heading = text.slice(offset).match(/^\b(?:EJEMPLO|EXAMPLE)\s*(?:N[^0-9A-Z]{0,2}\s*)?\d+[A-Z]?/i)?.[0] || 'EXAMPLE';
    const nextOffset = allOffsets.filter((value) => value > offset).sort((a, b) => a - b)[0] ?? text.length;
    const excerpt = text.slice(offset, Math.min(nextOffset, offset + 2400)).replace(/\s+/g, ' ').trim();
    const pageReferences = [...text.slice(0, offset).matchAll(/--\s*(\d+)\s+of\s+\d+\s+--/g)].map((match) => Number(match[1])).filter(Number.isFinite).slice(-1);
    slices.push({ heading, offset, excerpt, pageReferences });
  }
  return slices;
}

export async function createEngineeringCurationJob(companyId: string | undefined, type: string) {
  if (!curationJobTypes.includes(type as (typeof curationJobTypes)[number])) throw new Error(`Tipo de job no soportado: ${type}`);
  return prisma.engineeringCurationJob.create({ data: { companyId, type, status: 'QUEUED' } });
}

export async function listEngineeringCurationJobs(companyId: string, take = 50) {
  return prisma.engineeringCurationJob.findMany({ where: { OR: [{ companyId }, { companyId: null }] }, orderBy: { createdAt: 'desc' }, take });
}

export async function suggestEngineeringProjects(companyId: string) {
  const documents = await prisma.engineeringKnowledgeDocument.findMany({ where: { OR: [{ companyId }, { companyId: null }], status: { in: ['EXTRACTED', 'NEEDS_REVIEW', 'INDEXED'] } }, orderBy: { updatedAt: 'desc' } });
  const groups = new Map<string, typeof documents>();
  for (const document of documents) {
    const name = document.projectName || document.customerName || document.fileName.replace(/\.[^.]+$/, '');
    const key = `${document.projectType}|${name.toLowerCase().replace(/[^a-z0-9]+/gi, ' ').trim()}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(document);
  }
  const suggestions = [];
  for (const [key, rows] of groups) {
    if (rows.length < 2) continue;
    const [projectType, normalizedName] = key.split('|');
    const existing = await prisma.engineeringProject.findFirst({ where: { companyId, name: { equals: normalizedName, mode: 'insensitive' } } });
    if (existing) continue;
    const candidate = await prisma.engineeringProject.create({ data: { companyId, name: rows[0].projectName || rows[0].customerName || rows[0].fileName, projectType, customerName: rows[0].customerName, status: 'SUGGESTED', verified: false, description: `Sugerencia asistida por ${rows.length} documentos relacionados; requiere confirmacion humana.`, technicalJson: JSON.stringify({ candidateDocumentIds: rows.map((row) => row.id), groupingKey: key }) } });
    await prisma.engineeringProjectDocument.createMany({ data: rows.map((row) => ({ projectId: candidate.id, knowledgeId: row.id })), skipDuplicates: true });
    suggestions.push({ projectId: candidate.id, documentCount: rows.length, status: candidate.status, reason: candidate.description });
  }
  return suggestions;
}

export async function extractBenchmarkCandidates() {
  const sources = await prisma.engineeringSource.findMany({ where: { sourceType: 'WORKED_EXAMPLE' }, include: { documents: true } });
  const created = [];
  for (const source of sources) {
    for (const document of source.documents) {
      const text = document.rawText || '';
      const slices = extractBenchmarkSlices(text);
      const candidates = slices.length ? slices : [{ heading: 'extraccion candidata', excerpt: text.slice(0, 1800), pageReferences: [] }];
      for (const candidate of candidates) {
        const title = `${source.title} — ${candidate.heading}`;
        const exists = await prisma.engineeringBenchmark.findFirst({ where: { sourceId: source.id, title } });
        if (exists) continue;
        const benchmark = await prisma.engineeringBenchmark.create({ data: { companyId: document.companyId, sourceId: source.id, title, benchmarkType: 'OTHER', jurisdiction: source.jurisdiction, standardCode: source.title.match(/CIRSOC\s+\d+/i)?.[0]?.toUpperCase(), standardEdition: source.edition, problemStatement: candidate.excerpt || 'Texto no extraido; requiere revision humana.', inputJson: JSON.stringify({}), expectedOutputJson: JSON.stringify({}), tolerancesJson: JSON.stringify({}), calculationStepsJson: JSON.stringify([]), pageReferencesJson: JSON.stringify(candidate.pageReferences), status: 'NEEDS_REVIEW', verified: false, verificationNotes: 'Extraccion inicial conservadora; no es un benchmark verificado.', extractionVersion: 'golden-extractor-v2' } });
        created.push(benchmark);
      }
    }
  }
  return created;
}
