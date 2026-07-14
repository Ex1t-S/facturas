import { prisma } from '../../db.js';

const candidates = [
  { code: 'CIRSOC 101', title: 'Reglamento argentino de cargas permanentes y sobrecargas', sourceDomain: 'inti.gob.ar', sourceUrl: 'https://www.inti.gob.ar/cirsoc', notes: 'Candidato para acciones gravitatorias; verificar edición y alcance.' },
  { code: 'CIRSOC 102', title: 'Reglamento argentino de acción del viento', sourceDomain: 'inti.gob.ar', sourceUrl: 'https://www.inti.gob.ar/cirsoc', notes: 'Candidato para viento; no asumir vigencia sin comprobación oficial.' },
  { code: 'CIRSOC 301', title: 'Reglamento argentino de estructuras de acero', sourceDomain: 'inti.gob.ar', sourceUrl: 'https://www.inti.gob.ar/cirsoc', notes: 'Candidato para elementos y estructuras de acero.' },
  { code: 'CIRSOC 201', title: 'Reglamento argentino de estructuras de hormigón', sourceDomain: 'inti.gob.ar', sourceUrl: 'https://www.inti.gob.ar/cirsoc', notes: 'Candidato para bases y fundaciones de hormigón.' },
  { code: 'INPRES-CIRSOC 103', title: 'Reglamento argentino para construcciones sismorresistentes', sourceDomain: 'inpres.gob.ar', sourceUrl: 'https://www.inpres.gob.ar/', notes: 'Aplicabilidad dependiente de la ubicación y uso.' }
];

export async function ensureRegulationCandidates(companyId: string) {
  for (const item of candidates) await prisma.engineeringRegulation.upsert({ where: { companyId_code_revision: { companyId, code: item.code, revision: '' } }, update: { title: item.title, sourceUrl: item.sourceUrl, sourceDomain: item.sourceDomain, notes: item.notes }, create: { companyId, ...item, revision: '', status: 'UNKNOWN' } });
  return prisma.engineeringRegulation.findMany({ where: { OR: [{ companyId }, { companyId: null }], jurisdiction: 'AR' }, orderBy: { code: 'asc' } });
}

export async function searchOfficialEngineeringRegulations(companyId: string, query: string) {
  const rows = await ensureRegulationCandidates(companyId);
  const terms = query.toLowerCase().split(/\s+/).filter((term) => term.length > 2);
  return rows.filter((row) => !terms.length || terms.some((term) => `${row.code} ${row.title} ${row.notes || ''}`.toLowerCase().includes(term))).map((row) => ({ code: row.code, title: row.title, status: row.status, sourceUrl: row.sourceUrl || undefined, sourceType: row.status === 'CURRENT' ? 'OFFICIAL' as const : 'INTERNAL' as const, excerpt: row.notes || undefined }));
}
