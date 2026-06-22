import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../db.js';
import { extractDocumentFromFile, isCandidateBusinessDocument, mimeTypeForPath } from './documentExtraction.js';
import { writeDocumentFile } from './documentStorage.js';

type ImportHistoricalInput = {
  rootPath: string;
  companyId?: string;
  limit?: number;
  dryRun?: boolean;
};

type ImportCandidate = {
  path: string;
  fileName: string;
  extension: string;
  size: number;
};

async function walkFiles(rootPath: string, limit: number, candidates: ImportCandidate[] = []) {
  if (candidates.length >= limit) return candidates;
  const entries = await fs.readdir(rootPath, { withFileTypes: true });
  for (const entry of entries) {
    if (candidates.length >= limit) break;
    const fullPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.toLowerCase().includes('paragliding thermal maps_files')) continue;
      await walkFiles(fullPath, limit, candidates);
      continue;
    }
    if (!entry.isFile() || !isCandidateBusinessDocument(entry.name)) continue;
    const stat = await fs.stat(fullPath);
    candidates.push({
      path: fullPath,
      fileName: entry.name,
      extension: path.extname(entry.name).toLowerCase(),
      size: stat.size
    });
  }
  return candidates;
}

export async function scanHistoricalDocuments(input: ImportHistoricalInput) {
  const limit = input.limit ?? 250;
  const rootPath = path.resolve(input.rootPath);
  const candidates = await walkFiles(rootPath, limit);
  return { rootPath, candidates, count: candidates.length };
}

export async function importHistoricalDocuments(input: ImportHistoricalInput) {
  const scan = await scanHistoricalDocuments(input);
  if (input.dryRun) return { ...scan, imported: [], skipped: [] };

  const imported = [];
  const skipped = [];
  for (const candidate of scan.candidates) {
    try {
      const buffer = await fs.readFile(candidate.path);
      const stored = await writeDocumentFile({
        buffer,
        filename: candidate.fileName,
        mimeType: mimeTypeForPath(candidate.path),
        sourceType: 'historical'
      });

      const existing = await prisma.document.findFirst({ where: { sha256: stored.sha256 } });
      if (existing) {
        skipped.push({ path: candidate.path, reason: 'duplicate', documentId: existing.id });
        continue;
      }

      const extracted = await extractDocumentFromFile(candidate.path, candidate.fileName);
      const document = await prisma.document.create({
        data: {
          companyId: input.companyId,
          kind: extracted.document?.kind ?? 'UNKNOWN',
          sourceType: 'historical',
          fileName: candidate.fileName,
          mimeType: mimeTypeForPath(candidate.path),
          storagePath: stored.storagePath,
          sha256: stored.sha256,
          extractionStatus: extracted.source.engine === 'docx-text-v1' && extracted.items.length > 0 ? 'STRUCTURED' : 'UPLOADED',
          documentDate: extracted.document?.date,
          externalNumber: extracted.document?.number,
          currency: extracted.document?.currency ?? 'ARS',
          total: extracted.totals?.total,
          extraction: {
            create: {
              engine: extracted.source.engine,
              rawText: extracted.source.rawText ?? '',
              extractedJson: JSON.stringify(extracted),
              normalizedJson: extracted.items.length > 0 ? JSON.stringify(extracted) : undefined,
              confidence: extracted.source.confidence,
              fieldConfidence: JSON.stringify({ warnings: extracted.source.warnings, originalPath: candidate.path })
            }
          }
        },
        include: { extraction: true }
      });
      imported.push({ path: candidate.path, documentId: document.id, kind: document.kind, items: extracted.items.length });
    } catch (error) {
      skipped.push({
        path: candidate.path,
        reason: error instanceof Error ? error.message : 'unknown import error'
      });
      continue;
    }
  }

  return { rootPath: scan.rootPath, count: scan.count, imported, skipped };
}
