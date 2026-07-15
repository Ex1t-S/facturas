import fs from 'node:fs/promises';
import { prisma } from '../../db.js';

const numericFields = ['width', 'height', 'diameter', 'thickness', 'area', 'massPerMeter', 'ix', 'iy', 'rx', 'ry', 'yieldStrength', 'commercialLength'] as const;
type CatalogRow = Record<string, string | number | boolean | null | undefined>;

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCsv(text: string) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [] as CatalogRow[];
  const headers = lines[0].split(',').map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(',');
    return Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() || null]));
  });
}

export async function importStructuralSectionCatalog(input: { companyId: string; sourceId: string; filePath: string; sourceDocumentId?: string; verified?: boolean }) {
  const source = await prisma.engineeringSource.findUnique({ where: { id: input.sourceId } });
  if (!source) throw new Error('La fuente del catálogo no existe.');
  const rows = parseCsv(await fs.readFile(input.filePath, 'utf8'));
  const imported = [];
  for (const row of rows) {
    const designation = String(row.designation || row.Designation || '').trim();
    if (!designation) continue;
    const values = Object.fromEntries(numericFields.map((field) => [field, numberOrNull(row[field])])) as Record<(typeof numericFields)[number], number | null>;
    const missing = numericFields.filter((field) => values[field] === null);
    const verified = Boolean(input.verified) && source.verificationStatus !== 'UNKNOWN';
    const data = { companyId: input.companyId, designation, type: String(row.type || 'CUSTOM').toUpperCase(), material: row.material ? String(row.material) : null, ...values, source: source.title, sourceId: source.id, sourcePage: numberOrNull(row.sourcePage), sourceDocumentId: input.sourceDocumentId, reviewStatus: verified ? 'CONFIRMED' : 'PENDING_REVIEW', verified, verifiedAt: verified ? new Date() : null, notes: missing.length ? `PROPERTY_MISSING: ${missing.join(', ')}` : null };
    imported.push(await prisma.structuralSection.upsert({ where: { companyId_designation_source: { companyId: input.companyId, designation, source: source.title } }, update: data, create: data }));
  }
  return { sourceId: source.id, rows: rows.length, imported: imported.length, verified: imported.filter((row) => row.verified).length, propertyMissing: imported.filter((row) => row.notes?.includes('PROPERTY_MISSING')).length };
}

export function parseStructuralCatalogCsv(text: string) { return parseCsv(text); }

export type CirsocRectangularSectionCandidate = {
  designation: string;
  type: 'RHS';
  width: number;
  height: number;
  thickness: number;
  area: number;
  massPerMeter: number;
  ix: number;
  iy: number;
  rx: number;
  ry: number;
  sourcePage?: number;
  notes: string;
};

function integerDimension(value: number) { return Number.isInteger(value) && value >= 5 && value <= 1000; }

/** Conservative parser for the rectangular hollow-section tables in the
 * official CIRSOC 301-EL/302-EL PDF. Rows are kept as candidates and remain
 * unverified until a human confirms the page/row mapping. */
export function parseCirsocRectangularSections(text: string) {
  const start = Math.max(text.lastIndexOf('Tubos de acero'), text.lastIndexOf('Tubos de acero'));
  const body = start >= 0 ? text.slice(start) : text;
  const candidates: CirsocRectangularSectionCandidate[] = [];
  let sourcePage: number | undefined;
  for (const line of body.split(/\r?\n/)) {
    const marker = line.match(/--\s*(\d+)\s+of\s+\d+\s+--/i);
    if (marker) { sourcePage = Number(marker[1]); continue; }
    const values = [...line.matchAll(/[-+]?\d+(?:[.,]\d+)?/g)].map((match) => Number(match[0].replace(',', '.')));
    if (values.length < 16) continue;
    let width: number; let height: number; let row: number[];
    if (integerDimension(values[0]) && integerDimension(values[1])) { [width, height] = values; row = values.slice(2, 16); }
    else if (integerDimension(values.at(-2) || 0) && integerDimension(values.at(-1) || 0)) { width = values.at(-2)!; height = values.at(-1)!; row = values.slice(0, 14); }
    else continue;
    if (row.length < 14 || row[0] <= 0 || row[1] <= 0 || row[4] <= 0 || row[5] <= 0) continue;
    const [thickness, _p, areaCm2, massPerMeter, ixCm4, _sx, rxCm, _zx, iyCm4, _sy, ryCm, ..._] = row;
    if (thickness * 2 >= Math.min(width, height)) continue;
    candidates.push({ designation: `RHS ${width}x${height}x${thickness}`, type: 'RHS', width, height, thickness, area: areaCm2 * 100, massPerMeter, ix: ixCm4 * 10_000, iy: iyCm4 * 10_000, rx: rxCm * 10, ry: ryCm * 10, sourcePage, notes: 'EXTRACTED_NEEDS_REVIEW: confirmar fila y página contra PDF oficial.' });
  }
  return candidates;
}

export async function importCirsocRectangularSections(input: { companyId: string; sourceId: string; filePath: string; sourceDocumentId?: string; verified?: boolean }) {
  const source = await prisma.engineeringSource.findUnique({ where: { id: input.sourceId } });
  if (!source) throw new Error('La fuente del catálogo no existe.');
  const pdfModule = await import('pdf-parse');
  const buffer = await fs.readFile(input.filePath);
  const parser = 'default' in pdfModule && typeof pdfModule.default === 'function' ? pdfModule.default : undefined;
  let text = '';
  if (parser) text = (await parser(buffer)).text || '';
  else { const instance = new (pdfModule as any).PDFParse({ data: buffer }); const result = await instance.getText(); text = result.text || ''; await instance.destroy(); }
  const rows = parseCirsocRectangularSections(text);
  let imported = 0;
  for (const row of rows) {
    await prisma.structuralSection.upsert({ where: { companyId_designation_source: { companyId: input.companyId, designation: row.designation, source: source.title } }, update: { ...row, source: source.title, sourceId: source.id, sourceDocumentId: input.sourceDocumentId, reviewStatus: input.verified ? 'CONFIRMED' : 'PENDING_REVIEW', verified: Boolean(input.verified), verifiedAt: input.verified ? new Date() : null }, create: { companyId: input.companyId, ...row, source: source.title, sourceId: source.id, sourceDocumentId: input.sourceDocumentId, reviewStatus: input.verified ? 'CONFIRMED' : 'PENDING_REVIEW', verified: Boolean(input.verified), verifiedAt: input.verified ? new Date() : null } });
    imported += 1;
  }
  return { sourceId: input.sourceId, rows: rows.length, imported, verified: input.verified ? imported : 0 };
}
