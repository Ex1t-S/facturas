import fs from 'node:fs/promises';
import path from 'node:path';
import mammoth from 'mammoth';
import { classifyDocumentName } from '../src/services/documentExtraction.js';
import { normalizeName } from '../src/services/normalize.js';

type DocKind = 'QUOTE' | 'INVOICE' | 'DELIVERY_NOTE' | 'UNKNOWN';

type ScannedDocument = {
  path: string;
  relativePath: string;
  fileName: string;
  extension: string;
  size: number;
  kind: DocKind;
  textExtracted: boolean;
  textLength: number;
  customer?: string;
  date?: string;
  number?: string;
  currency?: string;
  costs: CostLine[];
  inventoryTerms: InventoryTerm[];
  warnings: string[];
};

type CostLine = {
  description: string;
  amount: number;
  currency: 'ARS' | 'USD';
  plusIva: boolean;
};

type InventoryTerm = {
  name: string;
  category: string;
  count: number;
};

const ROOT = process.argv[2] || process.env.HISTORICAL_DOCUMENT_ROOT || 'C:\\Users\\German\\Documents\\Adalberto';
const OUT_DIR = path.resolve('analysis');
const MAX_TEXT_SAMPLE = 900;

const usefulExtensions = new Set(['.docx', '.pdf', '.jpg', '.jpeg', '.png']);
const ignoredDirs = new Set(['Paragliding Thermal Maps_files']);

const inventoryPatterns: Array<{ category: string; pattern: RegExp; canonical?: (match: RegExpMatchArray) => string }> = [
  { category: 'Material', pattern: /\bchapa\s+(?:galvanizada|negra|estampada|acanalada|antidesgaste)?\s*(?:n[°º]?\s*)?(?:\d+\/\d+|\d+[.,]?\d*\s*mm|calibre\s*\d+)?(?:\s*x\s*[\d.,]+\s*m?)?/gi },
  { category: 'Material', pattern: /\bcañ?o\s+(?:schedulle\s*)?(?:de\s*)?(?:\d+\/\d+|\d+[.,]?\d*)\s*(?:\"|pulgadas|mm)?(?:\s*x\s*[\d.,]+\s*mm)?/gi },
  { category: 'Material', pattern: /\bipn\s*\d+\b/gi },
  { category: 'Material', pattern: /\bupn\s*\d+\b/gi },
  { category: 'Material', pattern: /\bmetal desplegado\b/gi },
  { category: 'Material', pattern: /\bvarillas? roscadas?\s*[\w/"., ]{0,20}/gi },
  { category: 'Equipo', pattern: /\bnoria(?:\s+(?:de|para)\s+[\d.,]+\s*(?:ton|m))?/gi },
  { category: 'Equipo', pattern: /\bextractores?(?:\s+a\s+sinf[ií]n)?(?:\s+de\s+[\d.,]+\s*(?:ton\/h|mm|m))?/gi },
  { category: 'Equipo', pattern: /\bsinf[ií]n(?:es)?(?:\s+[\d.,-]+\s*)?/gi },
  { category: 'Equipo', pattern: /\breductores?(?:\s+marca\s+[a-z0-9 ]{2,30})?/gi },
  { category: 'Equipo', pattern: /\bdistribuidor(?:es)?(?:\s+de\s+\d+\s+bocas)?/gi },
  { category: 'Equipo', pattern: /\bbarredor(?:es)?(?:\s+de\s+silo)?/gi },
  { category: 'Trabajo', pattern: /\breparaci[oó]n\s+(?:de\s+)?(?:noria|silo|extractor|sinf[ií]n|port[oó]n|galp[oó]n|cañ?o|distribuidor)/gi },
  { category: 'Trabajo', pattern: /\bfabricaci[oó]n\s+(?:de\s+)?(?:noria|silo|extractor|sinf[ií]n|galp[oó]n|cañ?o|estructura|pie de noria)/gi },
  { category: 'Trabajo', pattern: /\bmontaje\s+(?:de\s+)?(?:noria|silo|extractor|sinf[ií]n|galp[oó]n|cañ?o|estructura)/gi },
  { category: 'Trabajo', pattern: /\bcambio\s+(?:de\s+)?(?:cinta|motor|rodamientos?|chapas?|cangilones?)/gi },
  { category: 'Componente', pattern: /\bmotor(?:es)?(?:\s+(?:nuevo|trif[aá]sico|de)?\s*[\d.,]+\s*hp)?/gi },
  { category: 'Componente', pattern: /\brodamientos?\s+[a-z]{2,4}\s*\d+/gi },
  { category: 'Componente', pattern: /\bcangilones?(?:\s+(?:met[aá]licos?|pl[aá]sticos?))?/gi },
  { category: 'Componente', pattern: /\bcinta\s+(?:noria|transportadora|ep\s*\d+)/gi },
  { category: 'Componente', pattern: /\bguillotina(?:\s+cierre\s+a\s+cremallera)?/gi }
];

async function walk(root: string, files: string[] = []) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (ignoredDirs.has(entry.name)) continue;
      await walk(full, files);
      continue;
    }
    if (entry.isFile() && usefulExtensions.has(path.extname(entry.name).toLowerCase())) files.push(full);
  }
  return files;
}

async function extractText(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.docx') {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  }
  if (extension === '.pdf') {
    const pdfModule = await import('pdf-parse');
    const pdfParse = 'default' in pdfModule ? pdfModule.default : pdfModule.PDFParse;
    const buffer = await fs.readFile(filePath);
    if (typeof pdfParse === 'function') {
      const result = await pdfParse(buffer);
      return result.text ?? '';
    }
    const parser = new pdfModule.PDFParse({ data: buffer });
    const result = await parser.getText();
    await parser.destroy();
    return result.text ?? '';
  }
  return '';
}

function parseMoney(value: string) {
  const cleaned = value.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function extractCosts(text: string): CostLine[] {
  const clean = text.replace(/\r/g, '\n').replace(/[ \t]+/g, ' ');
  const costs: CostLine[] = [];
  const patterns = [
    /(.{12,850}?)\s+Costo\s*[:.·…-]*\s*(U\$S|\$)?\s*([\d.,]+)\s*(\+\s*iva)?/gis,
    /(.{12,850}?)\s+(?:Total|Importe)\s*[:.·…-]*\s*(U\$S|\$)?\s*([\d.,]+)\s*(\+\s*iva)?/gis
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(clean)) !== null) {
      const amount = parseMoney(match[3]);
      if (amount === undefined || amount <= 0) continue;
      const description = match[1].replace(/\s+/g, ' ').trim().slice(-650);
      if (!description) continue;
      costs.push({
        description,
        amount,
        currency: match[2] === 'U$S' ? 'USD' : 'ARS',
        plusIva: Boolean(match[4])
      });
    }
  }
  return dedupeCosts(costs);
}

function dedupeCosts(costs: CostLine[]) {
  const seen = new Set<string>();
  return costs.filter((cost) => {
    const key = `${normalizeName(cost.description).slice(0, 80)}:${cost.amount}:${cost.currency}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractCustomer(text: string) {
  return (
    text.match(/CLIENTE\s*:\s*([^\n\r]+)/i)?.[1]?.trim() ||
    text.match(/\b(?:Señores|Sres\.?)\s*:?\s*([^\n\r]{4,90})/i)?.[1]?.trim()
  );
}

function extractDate(text: string, fileName: string) {
  const source = `${text.slice(0, 1200)} ${fileName}`;
  return (
    source.match(/\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/)?.[1] ||
    source.match(/\b(\d{1,2}\s+de\s+[a-záéíóúñ]+\s+(?:de\s+)?\d{4})\b/i)?.[1]
  );
}

function extractNumber(text: string, kind: DocKind) {
  if (kind === 'DELIVERY_NOTE') return text.match(/Remito\s*N[°º]?\s*([0-9-]+)/i)?.[1];
  if (kind === 'QUOTE') return text.match(/Presupuesto\s*N[°º]?\s*([0-9-]+)/i)?.[1];
  return text.match(/(?:Factura|Comprobante)\s*N[°º]?\s*([0-9-]+)/i)?.[1];
}

function detectInventory(text: string) {
  const terms = new Map<string, InventoryTerm>();
  const normalizedText = text.replace(/\s+/g, ' ');
  for (const { category, pattern } of inventoryPatterns) {
    for (const match of normalizedText.matchAll(pattern)) {
      const raw = cleanInventoryTerm(match[0]);
      if (raw.length < 4) continue;
      const name = raw.replace(/\s+/g, ' ');
      const key = normalizeName(name);
      const current = terms.get(key);
      terms.set(key, { name, category, count: (current?.count ?? 0) + 1 });
    }
  }
  return [...terms.values()].sort((a, b) => b.count - a.count);
}

function cleanInventoryTerm(value: string) {
  return value
    .replace(/\b(Costo|Cliente|Fecha|Presupuesto|Remito|contacto|Cel|Parque Industrial).*$/i, '')
    .replace(/\s+n[°º]?\s*$/i, '')
    .replace(/[.,;:]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function kindFromFolderOrName(filePath: string) {
  const byName = classifyDocumentName(path.basename(filePath));
  if (byName !== 'UNKNOWN') return byName as DocKind;
  const normalizedPath = normalizeName(filePath);
  if (normalizedPath.includes('\\presupuestos\\')) return 'QUOTE';
  if (normalizedPath.includes('\\facturas\\')) return 'INVOICE';
  return 'UNKNOWN';
}

async function scanFile(root: string, filePath: string): Promise<ScannedDocument> {
  const stat = await fs.stat(filePath);
  const fileName = path.basename(filePath);
  const kind = kindFromFolderOrName(filePath);
  const warnings: string[] = [];
  let text = '';
  try {
    text = (await extractText(filePath)).trim();
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : 'Text extraction failed');
  }
  if (!text && ['.jpg', '.jpeg', '.png'].includes(path.extname(filePath).toLowerCase())) warnings.push('Image requires OCR/vision extraction.');
  if (!text && path.extname(filePath).toLowerCase() === '.pdf') warnings.push('PDF has no extractable text or requires OCR.');
  const costs = extractCosts(text);
  return {
    path: filePath,
    relativePath: path.relative(root, filePath),
    fileName,
    extension: path.extname(filePath).toLowerCase(),
    size: stat.size,
    kind,
    textExtracted: text.length > 0,
    textLength: text.length,
    customer: extractCustomer(text),
    date: extractDate(text, fileName),
    number: extractNumber(text, kind),
    currency: text.includes('U$S') ? 'USD' : text.includes('$') ? 'ARS' : undefined,
    costs,
    inventoryTerms: detectInventory(text),
    warnings
  };
}

function summarize(docs: ScannedDocument[]) {
  const byKind = countBy(docs, (doc) => doc.kind);
  const byExtension = countBy(docs, (doc) => doc.extension || '(none)');
  const withText = docs.filter((doc) => doc.textExtracted).length;
  const withCosts = docs.filter((doc) => doc.costs.length > 0).length;
  const inventory = new Map<string, InventoryTerm>();
  const customers = new Map<string, number>();

  for (const doc of docs) {
    if (doc.customer) customers.set(doc.customer, (customers.get(doc.customer) ?? 0) + 1);
    for (const term of doc.inventoryTerms) {
      const key = normalizeName(term.name);
      const current = inventory.get(key);
      inventory.set(key, { ...term, count: (current?.count ?? 0) + term.count });
    }
  }

  return {
    scannedAt: new Date().toISOString(),
    root: ROOT,
    totals: {
      files: docs.length,
      withText,
      withCosts,
      byKind,
      byExtension
    },
    topCustomers: [...customers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([name, count]) => ({ name, count })),
    inventoryCandidates: [...inventory.values()].sort((a, b) => b.count - a.count).slice(0, 180),
    templateSignals: inferTemplateSignals(docs),
    samples: docs
      .filter((doc) => doc.textExtracted && (doc.kind === 'QUOTE' || doc.kind === 'DELIVERY_NOTE') && doc.costs.length > 0)
      .slice(0, 25)
      .map((doc) => ({
        relativePath: doc.relativePath,
        kind: doc.kind,
        customer: doc.customer,
        date: doc.date,
        number: doc.number,
        currency: doc.currency,
        costCount: doc.costs.length,
        firstCosts: doc.costs.slice(0, 3)
      })),
    needsOcr: docs.filter((doc) => !doc.textExtracted && doc.kind !== 'UNKNOWN').slice(0, 120).map((doc) => ({
      relativePath: doc.relativePath,
      kind: doc.kind,
      extension: doc.extension,
      warnings: doc.warnings
    }))
  };
}

function inferTemplateSignals(docs: ScannedDocument[]) {
  const quoteDocs = docs.filter((doc) => doc.kind === 'QUOTE' && doc.textExtracted);
  const deliveryDocs = docs.filter((doc) => doc.kind === 'DELIVERY_NOTE' && doc.textExtracted);
  return {
    header: ['F.M.H.', 'Adalberto R. Arroyo', 'SILOS-NORIAS- SINFINES -ESTRUCTURAS METÁLICAS', 'Fabricación y montaje', 'Parque Industrial- Huanguelén'],
    commonFields: ['CLIENTE', 'Fecha de emisión', 'Presupuesto', 'Remito N°', 'Costo', '+ iva'],
    quoteTextDocs: quoteDocs.length,
    deliveryTextDocs: deliveryDocs.length,
    usesBlockCosts: docs.filter((doc) => doc.costs.length > 0).length,
    usesUsd: docs.filter((doc) => doc.currency === 'USD').length,
    usesArs: docs.filter((doc) => doc.currency === 'ARS').length
  };
}

function countBy<T>(items: T[], getKey: (item: T) => string) {
  return items.reduce<Record<string, number>>((acc, item) => {
    const key = getKey(item);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function toMarkdown(summary: ReturnType<typeof summarize>) {
  const lines = [
    '# Analisis historico de documentos',
    '',
    `Carpeta: \`${summary.root}\``,
    `Fecha: ${summary.scannedAt}`,
    '',
    '## Totales',
    '',
    `- Archivos analizados: ${summary.totals.files}`,
    `- Con texto extraido: ${summary.totals.withText}`,
    `- Con costos detectados: ${summary.totals.withCosts}`,
    `- Por tipo: ${JSON.stringify(summary.totals.byKind)}`,
    `- Por extension: ${JSON.stringify(summary.totals.byExtension)}`,
    '',
    '## Senales de plantilla',
    '',
    ...summary.templateSignals.header.map((item) => `- ${item}`),
    '',
    '## Campos comunes',
    '',
    ...summary.templateSignals.commonFields.map((item) => `- ${item}`),
    '',
    '## Inventario candidato',
    '',
    '| Producto/trabajo | Categoria | Apariciones |',
    '|---|---:|---:|',
    ...summary.inventoryCandidates.slice(0, 80).map((item) => `| ${item.name.replace(/\|/g, '/')} | ${item.category} | ${item.count} |`),
    '',
    '## Clientes frecuentes detectados',
    '',
    ...summary.topCustomers.slice(0, 30).map((item) => `- ${item.name}: ${item.count}`)
  ];
  return lines.join('\n');
}

async function main() {
  const root = path.resolve(ROOT);
  await fs.mkdir(OUT_DIR, { recursive: true });
  const files = await walk(root);
  const docs: ScannedDocument[] = [];
  for (const [index, file] of files.entries()) {
    docs.push(await scanFile(root, file));
    if ((index + 1) % 100 === 0) console.log(`Analizados ${index + 1}/${files.length}`);
  }
  const summary = summarize(docs);
  await fs.writeFile(path.join(OUT_DIR, 'historical-documents-full.json'), JSON.stringify({ documents: docs, summary }, null, 2), 'utf8');
  await fs.writeFile(path.join(OUT_DIR, 'historical-summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  await fs.writeFile(path.join(OUT_DIR, 'historical-summary.md'), toMarkdown(summary), 'utf8');
  console.log(JSON.stringify(summary.totals, null, 2));
  console.log(`Resumen escrito en ${path.join(OUT_DIR, 'historical-summary.md')}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
