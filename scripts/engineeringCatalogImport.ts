import fs from 'node:fs/promises';
import { prisma } from '../src/db.js';
import { importCirsocRectangularSections, importStructuralSectionCatalog, parseCirsocRectangularSections } from '../src/services/engineering/structuralCatalogImporter.js';

const [companyId, sourceId, filePath, verifiedFlag] = process.argv.slice(2);
if (!companyId || !sourceId || !filePath) throw new Error('Uso: npm run engineering:catalog:import -- <companyId> <sourceId> <csv> [verified]');
if (!/^postgres(ql)?:\/\//i.test(process.env.DATABASE_URL || '')) {
  const text = filePath.toLowerCase().endsWith('.pdf') ? await (async () => { const m = await import('pdf-parse'); const b = await fs.readFile(filePath); const p = new (m as any).PDFParse({ data: b }); const t = await p.getText(); await p.destroy(); return t.text || ''; })() : await fs.readFile(filePath, 'utf8');
  const rows = filePath.toLowerCase().endsWith('.pdf') ? parseCirsocRectangularSections(text) : [];
  await fs.writeFile('docs/engineering-catalog-extraction-report.json', JSON.stringify({ mode: 'OFFLINE_NO_DATABASE', generatedAt: new Date().toISOString(), sourceId, filePath, rows: rows.length, verified: 0, propertyMissing: rows.filter((row) => row.notes.includes('PROPERTY_MISSING')).length, sample: rows.slice(0, 10) }, null, 2));
  console.log(JSON.stringify({ mode: 'OFFLINE_NO_DATABASE', rows: rows.length, verified: 0, report: 'docs/engineering-catalog-extraction-report.json' }, null, 2));
  await prisma.$disconnect();
  process.exit(0);
}
const result = filePath.toLowerCase().endsWith('.pdf') ? await importCirsocRectangularSections({ companyId, sourceId, filePath, verified: verifiedFlag === 'true' }) : await importStructuralSectionCatalog({ companyId, sourceId, filePath, verified: verifiedFlag === 'true' });
console.log(JSON.stringify(result, null, 2));
await prisma.$disconnect();
