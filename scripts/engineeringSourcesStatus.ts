import fs from 'node:fs/promises';
import { prisma } from '../src/db.js';
import { engineeringSourceStatus } from '../src/services/engineering/engineeringSourceImporter.js';

if (!/^postgres(ql)?:\/\//i.test(process.env.DATABASE_URL || '')) {
  try { console.log(JSON.stringify({ mode: 'OFFLINE_NO_DATABASE', report: JSON.parse(await fs.readFile('docs/engineering-source-sync-report.json', 'utf8')) }, null, 2)); } catch { console.log(JSON.stringify({ mode: 'OFFLINE_NO_DATABASE', total: 0, note: 'Ejecutá engineering:sources:sync -- --offline para crear el reporte.' }, null, 2)); }
  await prisma.$disconnect();
  process.exit(0);
}
const rows = await engineeringSourceStatus();
console.log(JSON.stringify({
  total: rows.length,
  byJurisdiction: Object.fromEntries([...rows.reduce((map, row) => map.set(row.jurisdiction, (map.get(row.jurisdiction) || 0) + 1), new Map<string, number>())]),
  byDownloadStatus: Object.fromEntries([...rows.reduce((map, row) => map.set(row.downloadStatus, (map.get(row.downloadStatus) || 0) + 1), new Map<string, number>())]),
  sources: rows.map((row) => ({ id: row.id, title: row.title, sourceType: row.sourceType, jurisdiction: row.jurisdiction, verificationStatus: row.verificationStatus, downloadStatus: row.downloadStatus, fileHash: row.fileHash, documents: row.documents.length }))
}, null, 2));
await prisma.$disconnect();
