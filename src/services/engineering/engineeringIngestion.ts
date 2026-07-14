import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import mammoth from 'mammoth';
import { prisma } from '../../db.js';
import { engineeringExtractionSchema } from './engineeringSchemas.js';

const supported = new Set(['.pdf', '.docx', '.txt', '.csv', '.jpg', '.jpeg', '.png']);
const knownProjectTypes: Array<[string, string]> = [['silo', 'SILO'], ['galpon', 'WAREHOUSE'], ['tolva', 'HOPPER'], ['noria', 'ELEVATOR'], ['sinf', 'AUGER'], ['transport', 'CONVEYOR'], ['estructura', 'STEEL_STRUCTURE'], ['soporte', 'SUPPORT_STRUCTURE'], ['plataforma', 'PLATFORM'], ['escalera', 'STAIR'], ['pasarela', 'WALKWAY'], ['conducto', 'DUCT'], ['cañer', 'PIPING'], ['tanque', 'TANK'], ['chasis', 'CHASSIS'], ['base', 'BASE'], ['reeler', 'REELER'], ['reeler', 'REELER'], ['repar', 'REPAIR'], ['montaje', 'INSTALLATION']];

async function walk(root: string, result: string[] = []) {
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (entry.name.startsWith('~$') || entry.name.toLowerCase().includes('files')) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) await walk(full, result);
    else if (supported.has(path.extname(entry.name).toLowerCase()) || ['.dwg', '.doc', '.xls', '.xlsx'].includes(path.extname(entry.name).toLowerCase())) result.push(full);
  }
  return result;
}

async function extractText(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.txt' || extension === '.csv') return fs.readFile(filePath, 'utf8');
  if (extension === '.docx') return (await mammoth.extractRawText({ path: filePath })).value;
  if (extension === '.pdf') {
    const pdfModule = await import('pdf-parse');
    const buffer = await fs.readFile(filePath);
    const parser = 'default' in pdfModule && typeof pdfModule.default === 'function' ? pdfModule.default : undefined;
    if (parser) return (await parser(buffer)).text ?? '';
    const instance = new (pdfModule as any).PDFParse({ data: buffer });
    const result = await instance.getText();
    await instance.destroy();
    return result.text ?? '';
  }
  return '';
}

function classify(filePath: string, text: string) {
  const value = `${path.basename(filePath)} ${text.slice(0, 5000)}`.toLowerCase();
  const projectType = knownProjectTypes.find(([term]) => value.includes(term))?.[1] ?? 'OTHER';
  let documentType = 'OTHER';
  if (value.includes('presupuesto')) documentType = 'QUOTE';
  else if (value.includes('remito')) documentType = 'DELIVERY_NOTE';
  else if (value.includes('factura')) documentType = 'INVOICE';
  else if (value.includes('plano') || path.extname(filePath).toLowerCase() === '.dwg') documentType = 'DRAWING';
  else if (value.includes('cálculo') || value.includes('calculo')) documentType = 'CALCULATION';
  return { documentType, projectType };
}

function structured(filePath: string, text: string) {
  const classification = classify(filePath, text);
  const capacities = [...text.matchAll(/(\d+(?:[.,]\d+)?)\s*(t|ton|toneladas|kg|m3|m³)/gi)].slice(0, 20).map((match) => ({ value: Number(match[1].replace(',', '.')), unit: match[2], meaning: 'capacidad o magnitud detectada en el documento' }));
  const dimensions = [...text.matchAll(/(alto|ancho|largo|diámetro|diametro|espesor)\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*(mm|cm|m)/gi)].slice(0, 20).map((match) => ({ name: match[1], value: Number(match[2].replace(',', '.')), unit: match[3] }));
  return engineeringExtractionSchema.parse({ ...classification, description: text.slice(0, 3000), capacities, dimensions, assumptions: [], observations: [], warnings: text.trim() ? [] : ['No se pudo extraer texto; requiere visión o revisión.'], evidence: text.trim() ? [{ field: 'description', excerpt: text.slice(0, 500) }] : [], extractionConfidence: text.trim() ? 0.55 : 0.1 });
}

export async function scanEngineeringRoot(rootPath: string) { return { rootPath: path.resolve(rootPath), files: await walk(path.resolve(rootPath)) }; }

export async function ingestEngineeringKnowledge(input: { rootPath: string; companyId?: string; runId?: string }) {
  const scan = await scanEngineeringRoot(input.rootPath);
  const run = input.runId ? await prisma.engineeringIngestionRun.findUnique({ where: { id: input.runId } }) : await prisma.engineeringIngestionRun.create({ data: { companyId: input.companyId, rootPath: scan.rootPath, foundCount: scan.files.length } });
  if (!run) throw new Error('No se encontró la ejecución de ingesta.');
  const counts = { found: scan.files.length, newCount: 0, unchanged: 0, modified: 0, processed: 0, pending: 0, failed: 0 };
  for (const filePath of scan.files) {
    try {
      const stat = await fs.stat(filePath);
      const buffer = await fs.readFile(filePath);
      const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
      const relativePath = path.relative(scan.rootPath, filePath);
      const existing = await prisma.engineeringKnowledgeDocument.findFirst({ where: { companyId: input.companyId, relativePath } });
      if (existing?.sha256 === sha256 && existing.status !== 'FAILED') { counts.unchanged++; continue; }
      if (existing) counts.modified++; else counts.newCount++;
      const extension = path.extname(filePath).toLowerCase();
      const mimeType = extension === '.pdf' ? 'application/pdf' : extension === '.docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : extension.startsWith('.jp') ? 'image/jpeg' : extension === '.png' ? 'image/png' : 'text/plain';
      if (!supported.has(extension)) {
        const data = { fileName: path.basename(filePath), relativePath, extension, mimeType, sha256, sizeBytes: stat.size, status: 'UNSUPPORTED', documentType: extension === '.dwg' ? 'DRAWING' : 'OTHER', projectType: 'OTHER', metadataJson: JSON.stringify({ reason: 'Formato no procesable directamente' }), errorMessage: 'Requiere conversión o herramienta especializada.' };
        if (existing) await prisma.engineeringKnowledgeDocument.update({ where: { id: existing.id }, data }); else await prisma.engineeringKnowledgeDocument.create({ data: { ...data, companyId: input.companyId } });
        counts.pending++; continue;
      }
      const text = await extractText(filePath);
      const extracted = structured(filePath, text);
      const status = ['.jpg', '.jpeg', '.png'].includes(extension) || !text.trim() ? 'NEEDS_VISION' : 'EXTRACTED';
      const data = { fileName: path.basename(filePath), relativePath, extension, mimeType, sha256, sizeBytes: stat.size, status, documentType: extracted.documentType, projectType: extracted.projectType, rawText: text || null, structuredJson: JSON.stringify(extracted), metadataJson: JSON.stringify({ originalPath: filePath }), confidence: extracted.extractionConfidence, errorMessage: null };
      if (existing) await prisma.engineeringKnowledgeDocument.update({ where: { id: existing.id }, data }); else await prisma.engineeringKnowledgeDocument.create({ data: { ...data, companyId: input.companyId } });
      status === 'NEEDS_VISION' ? counts.pending++ : counts.processed++;
    } catch (error) {
      counts.failed++;
      const relativePath = path.relative(scan.rootPath, filePath);
      const existing = await prisma.engineeringKnowledgeDocument.findFirst({ where: { companyId: input.companyId, relativePath } });
      const data = { fileName: path.basename(filePath), relativePath, extension: path.extname(filePath).toLowerCase(), mimeType: 'application/octet-stream', sha256: `failed-${Date.now()}`, sizeBytes: 0, status: 'FAILED', documentType: 'OTHER', projectType: 'OTHER', errorMessage: error instanceof Error ? error.message : 'Error desconocido' };
      if (existing) await prisma.engineeringKnowledgeDocument.update({ where: { id: existing.id }, data }); else await prisma.engineeringKnowledgeDocument.create({ data: { ...data, companyId: input.companyId } });
    }
  }
  await prisma.engineeringIngestionRun.update({ where: { id: run.id }, data: { status: counts.failed ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED', foundCount: counts.found, newCount: counts.newCount, unchangedCount: counts.unchanged, modifiedCount: counts.modified, processedCount: counts.processed, pendingCount: counts.pending, failedCount: counts.failed, finishedAt: new Date() } });
  return { runId: run.id, rootPath: scan.rootPath, ...counts };
}
