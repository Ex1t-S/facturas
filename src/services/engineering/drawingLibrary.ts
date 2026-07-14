import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PDFParse } from 'pdf-parse';
import { config } from '../../config.js';
import { prisma } from '../../db.js';

export const drawingStatuses = ['DISCOVERED', 'EXTRACTED', 'ANALYZED_LOCAL', 'NEEDS_REVIEW', 'FAILED'] as const;

export type DrawingExtraction = {
  drawingNumber?: string;
  projectName?: string;
  customerName?: string;
  projectType?: string;
  drawingTitle?: string;
  revision?: string;
  date?: string;
  scale?: string;
  sheetSize?: string;
  views: Array<{ type: string; title?: string }>;
  dimensions: Array<{ label?: string; value?: number; unit?: string; context?: string }>;
  components: Array<{ name: string; material?: string; profile?: string; quantity?: number }>;
  notes: string[];
  titleBlock: { companyName?: string; logoDetected?: boolean; projectField?: string; customerField?: string; drawingNumberField?: string; revisionField?: string; dateField?: string; scaleField?: string };
  layoutFeatures: { titleBlockPosition?: string; logoPosition?: string; primaryViewPosition?: string; secondaryViewPositions?: string[]; notesPosition?: string };
  confidence: number;
};

function classify(text: string, fileName: string) {
  const value = `${fileName} ${text}`.toLowerCase();
  if (value.includes('silo')) return 'SILO';
  if (value.includes('tolva')) return 'HOPPER';
  if (value.includes('galpon') || value.includes('galpón')) return 'WAREHOUSE';
  if (value.includes('noria')) return 'ELEVATOR';
  if (value.includes('sinfin') || value.includes('sinfín')) return 'AUGER';
  if (value.includes('estructura')) return 'STEEL_STRUCTURE';
  return undefined;
}

function extractFields(text: string, fileName: string): DrawingExtraction {
  const clean = text.replace(/\s+/g, ' ').trim();
  const projectType = classify(clean, fileName);
  const number = clean.match(/(?:plano|n[°ºo]?|drawing)\s*[:#-]?\s*([A-Z0-9][A-Z0-9._/-]{2,})/i)?.[1];
  const scale = clean.match(/escala\s*[:=]?\s*([\w:./-]+)/i)?.[1];
  const dimensions = [...clean.matchAll(/(di[aá]metro|altura|ancho|largo|espesor|radio)\s*[:=]?\s*(\d+(?:[,.]\d+)?)\s*(mm|cm|m)?/gi)].map((match) => ({ label: match[1], value: Number(match[2].replace(',', '.')), unit: match[3] || 'mm' }));
  return { drawingNumber: number, projectType, drawingTitle: clean.slice(0, 160) || undefined, scale, views: [], dimensions, components: [], notes: clean ? [clean.slice(0, 1000)] : [], titleBlock: { companyName: /FMH|FABRICA METALURGICA HUANGUELEN/i.test(clean) ? 'FMH' : undefined, logoDetected: /FMH/i.test(clean) }, layoutFeatures: { titleBlockPosition: 'INFERRED_FROM_SCAN', logoPosition: 'INFERRED_FROM_SCAN', primaryViewPosition: 'CENTER', secondaryViewPositions: [], notesPosition: 'LOWER_AREA' }, confidence: clean ? 0.45 : 0.2 };
}

function rootUploadPath(relative: string) { return path.resolve(config.UPLOAD_DIR, relative); }

async function filesRecursively(rootPath: string) {
  const result: string[] = [];
  async function visit(directory: string) { for (const item of await fs.readdir(directory, { withFileTypes: true })) { const full = path.join(directory, item.name); if (item.isDirectory()) await visit(full); else if (item.isFile() && path.extname(item.name).toLowerCase() === '.pdf') result.push(full); } }
  await visit(rootPath);
  return result;
}

export async function ingestEngineeringDrawings(input: { companyId: string; rootPath: string; limit?: number }) {
  const files = (await filesRecursively(input.rootPath)).slice(0, input.limit || 10000);
  const result = { found: files.length, processed: 0, unchanged: 0, duplicates: 0, failed: 0, thumbnails: 0, templates: 0 };
  const template = await prisma.engineeringDrawingTemplate.upsert({ where: { companyId_code: { companyId: input.companyId, code: 'FMH_TEMPLATE_SCAN' } }, update: { sampleCount: { increment: 0 } }, create: { companyId: input.companyId, code: 'FMH_TEMPLATE_SCAN', name: 'Plantilla FMH escaneada', version: 'detectada localmente', sheetSize: 'A4/A3 escaneado', titleBlockPosition: 'inferido en lateral o inferior derecho', layoutJson: JSON.stringify({ logo: 'FMH', titleBlock: 'right-or-bottom', views: 'central' }), confidence: 0.55 } });
  for (const filePath of files) {
    const buffer = await fs.readFile(filePath);
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const relativePath = path.relative(input.rootPath, filePath);
    const existing = await prisma.engineeringDrawingDocument.findUnique({ where: { companyId_sha256: { companyId: input.companyId, sha256 } } });
    if (existing) { result.unchanged += 1; continue; }
    try {
      const parser = new PDFParse({ data: buffer });
      const info = await parser.getInfo();
      const textResult = await parser.getText({ first: Math.min(3, info.total || 1) });
      const extraction = extractFields(textResult.text, path.basename(filePath));
      const thumbnailRelative = path.posix.join('engineering-drawings', 'thumbnails', `${sha256}.png`);
      const thumbnailPath = rootUploadPath(thumbnailRelative);
      await fs.mkdir(path.dirname(thumbnailPath), { recursive: true });
      const screenshot = await parser.getScreenshot({ first: 1, desiredWidth: 1200, imageDataUrl: false });
      await fs.writeFile(thumbnailPath, screenshot.pages[0].data);
      await parser.destroy();
      await prisma.engineeringDrawingDocument.create({ data: { companyId: input.companyId, templateId: template.id, fileName: path.basename(filePath), relativePath, sourcePath: filePath, sha256, byteSize: buffer.byteLength, pageCount: info.total || 0, status: 'ANALYZED_LOCAL', extractedText: textResult.text.slice(0, 10000), extractionJson: JSON.stringify(extraction), thumbnailPath: thumbnailRelative, drawingNumber: extraction.drawingNumber, projectName: extraction.projectName, customerName: extraction.customerName, projectType: extraction.projectType, drawingTitle: extraction.drawingTitle, revision: extraction.revision, sheetSize: extraction.sheetSize } });
      result.processed += 1; result.thumbnails += 1;
    } catch (error) {
      await prisma.engineeringDrawingDocument.create({ data: { companyId: input.companyId, templateId: template.id, fileName: path.basename(filePath), relativePath, sourcePath: filePath, sha256, byteSize: buffer.byteLength, status: 'FAILED', extractionJson: JSON.stringify({ error: error instanceof Error ? error.message : 'Error desconocido' }) } }).catch(() => undefined);
      result.failed += 1;
    }
  }
  await prisma.engineeringDrawingTemplate.update({ where: { id: template.id }, data: { sampleCount: { increment: result.processed }, isDefault: true } });
  result.templates = 1;
  return result;
}

export async function listEngineeringDrawings(input: { companyId: string; q?: string; projectType?: string; customerName?: string; take?: number }) {
  return prisma.engineeringDrawingDocument.findMany({ where: { companyId: input.companyId, projectType: input.projectType || undefined, customerName: input.customerName ? { contains: input.customerName } : undefined, OR: input.q ? [{ fileName: { contains: input.q } }, { drawingTitle: { contains: input.q } }, { projectName: { contains: input.q } }, { customerName: { contains: input.q } }, { projectType: { contains: input.q } }] : undefined }, include: { template: true }, orderBy: { updatedAt: 'desc' }, take: input.take || 100 });
}

export async function getEngineeringDrawing(id: string, companyId: string) { return prisma.engineeringDrawingDocument.findFirst({ where: { id, companyId }, include: { template: true } }); }
export async function readEngineeringDrawingFile(id: string, companyId: string) {
  const item = await getEngineeringDrawing(id, companyId);
  if (!item) return null;
  const configured = [config.ENGINEERING_DRAWINGS_ROOT, config.ENGINEERING_KNOWLEDGE_ROOT, config.HISTORICAL_DOCUMENT_ROOT].filter(Boolean).map((root) => path.resolve(root));
  const source = path.resolve(item.sourcePath);
  if (!configured.some((root) => source === root || source.startsWith(`${root}${path.sep}`))) throw new Error('La ruta del plano no esta dentro de una biblioteca configurada.');
  return { fileName: item.fileName, buffer: await fs.readFile(source) };
}
export async function getEngineeringDrawingStatus(companyId: string) { const groups = await prisma.engineeringDrawingDocument.groupBy({ by: ['status'], where: { companyId }, _count: { _all: true } }); return { total: groups.reduce((sum, item) => sum + item._count._all, 0), counts: Object.fromEntries(groups.map((item) => [item.status, item._count._all])) }; }
