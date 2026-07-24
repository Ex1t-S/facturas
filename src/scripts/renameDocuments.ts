import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../db.js';
import { canonicalDocumentName } from '../services/documentNaming.js';

type BackupRow = { id: string; oldFileName: string; newFileName: string; fieldConfidence: string | null; storagePath: string; sha256: string };

const apply = process.argv.includes('--apply');
const rollbackArg = process.argv.find((arg) => arg.startsWith('--rollback='));
const outputArg = process.argv.find((arg) => arg.startsWith('--output='))?.split('=').slice(1).join('=');

function parseOriginalField(value: string | null) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function rollback(filePath: string) {
  const rows = JSON.parse(await fs.readFile(filePath, 'utf8')) as BackupRow[];
  await prisma.$transaction(rows.map((row) => prisma.document.update({ where: { id: row.id }, data: { fileName: row.oldFileName } })));
  for (const row of rows) {
    if (row.fieldConfidence !== null) await prisma.documentExtraction.update({ where: { documentId: row.id }, data: { fieldConfidence: row.fieldConfidence } }).catch(() => undefined);
  }
  console.log(JSON.stringify({ rollback: filePath, restored: rows.length }, null, 2));
}

async function main() {
  if (rollbackArg) {
    await rollback(rollbackArg.split('=').slice(1).join('='));
    return;
  }

  const documents = await prisma.document.findMany({
    where: { kind: { in: ['INVOICE', 'PURCHASE_INVOICE', 'DELIVERY_NOTE', 'QUOTE'] } },
    include: { extraction: true, customerCandidates: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
  });
  const used = new Set<string>();
  const rows: BackupRow[] = [];
  const preview = [];

  for (const document of documents) {
    const result = canonicalDocumentName({ ...document, sourceType: document.sourceType, extractedJson: document.extraction?.extractedJson });
    if (!result) continue;
    const extension = path.extname(result.fileName);
    const stem = result.fileName.slice(0, -extension.length);
    let fileName = result.fileName;
    let suffix = 2;
    while (used.has(fileName.toLocaleLowerCase('es-AR'))) fileName = `${stem}_${String(suffix++).padStart(2, '0')}${extension}`;
    used.add(fileName.toLocaleLowerCase('es-AR'));
    const fieldConfidence = document.extraction?.fieldConfidence ?? null;
    rows.push({ id: document.id, oldFileName: document.fileName, newFileName: fileName, fieldConfidence, storagePath: document.storagePath, sha256: document.sha256 });
    preview.push({ id: document.id, kind: document.kind, old: document.fileName, new: fileName });
  }

  const output = outputArg || path.resolve(process.cwd(), `document-name-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await fs.writeFile(output, JSON.stringify(rows, null, 2), 'utf8');
  if (apply) {
    await prisma.$transaction(rows.filter((row) => row.oldFileName !== row.newFileName).map((row) => prisma.document.update({
      where: { id: row.id },
      data: {
        fileName: row.newFileName,
        extraction: row.fieldConfidence !== null ? { update: { fieldConfidence: JSON.stringify({ ...parseOriginalField(row.fieldConfidence), originalFileName: row.oldFileName }) } } : undefined
      }
    })));
  }
  console.log(JSON.stringify({ apply, renamed: rows.filter((row) => row.oldFileName !== row.newFileName).length, backup: output, preview: preview.slice(0, 30) }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
