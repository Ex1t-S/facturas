import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../src/db.js';
import { extractBenchmarkCandidates, extractBenchmarkSlices } from '../src/services/engineering/engineeringCuration.js';
import { loadEngineeringSourceManifest } from '../src/services/engineering/engineeringSourceImporter.js';

if (!/^postgres(ql)?:\/\//i.test(process.env.DATABASE_URL || '')) {
  const report = JSON.parse(await fs.readFile('docs/engineering-source-sync-report.json', 'utf8')) as { results: Array<{ id: string; title: string; status: string; localFilePath?: string; fileHash?: string }> };
  const manifest = await loadEngineeringSourceManifest();
  const allowed = new Set(manifest.filter((entry) => entry.category === 'WORKED_EXAMPLE' || entry.category === 'INTERNATIONAL_REFERENCE').map((entry) => entry.id));
  const candidates: Array<Record<string, unknown>> = [];
  for (const source of report.results.filter((item) => item.localFilePath && item.fileHash && allowed.has(item.id))) {
    if (candidates.length >= 15) break;
    const filePath = path.resolve(source.localFilePath!);
    let text = '';
    let extractionError = '';
    try {
      const pdfModule = await import('pdf-parse');
      const buffer = await fs.readFile(filePath);
      if ('default' in pdfModule && typeof pdfModule.default === 'function') text = (await pdfModule.default(buffer)).text || '';
      else { const instance = new (pdfModule as any).PDFParse({ data: buffer }); const parsed = await instance.getText(); text = parsed.text || ''; await instance.destroy(); }
    } catch (error) { extractionError = error instanceof Error ? error.message : 'Error de extraccion'; }
    const slices = extractBenchmarkSlices(text, 15);
    const selected = slices.length ? slices : [{ heading: 'extraccion candidata', excerpt: text.slice(0, 1800), pageReferences: [] }];
    for (const slice of selected) {
      if (candidates.length >= 15) break;
      candidates.push({ sourceId: source.id, sourceTitle: source.title, title: `${source.title} — ${slice.heading}`, status: 'NEEDS_REVIEW', verified: false, pageReferences: slice.pageReferences, excerpt: slice.excerpt, extractionError });
    }
  }
  await fs.writeFile('docs/engineering-benchmark-extraction-report.json', JSON.stringify({ mode: 'OFFLINE_NO_DATABASE', generatedAt: new Date().toISOString(), candidates }, null, 2));
  console.log(JSON.stringify({ mode: 'OFFLINE_NO_DATABASE', candidates: candidates.length, verified: 0, report: 'docs/engineering-benchmark-extraction-report.json' }, null, 2));
  await prisma.$disconnect();
  process.exit(0);
}
const created = await extractBenchmarkCandidates();
console.log(JSON.stringify({ created: created.length, status: 'NEEDS_REVIEW', benchmarks: created.map((item) => ({ id: item.id, title: item.title, sourceId: item.sourceId })) }, null, 2));
await prisma.$disconnect();
