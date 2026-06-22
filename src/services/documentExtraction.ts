import path from 'node:path';
import mammoth from 'mammoth';
import { normalizeName } from './normalize.js';

export type ExtractedDocument = {
  document?: {
    kind: 'QUOTE' | 'INVOICE' | 'PURCHASE_INVOICE' | 'DELIVERY_NOTE' | 'UNKNOWN';
    date?: Date;
    number?: string;
    currency?: string;
  };
  customer?: {
    legalName?: string;
    cuit?: string;
    address?: string;
  };
  items: Array<{
    description: string;
    quantity?: number;
    unit?: string;
    unitPrice?: number;
    total?: number;
    taxRate?: number;
    category?: string;
    type?: 'PRODUCT' | 'MATERIAL' | 'SERVICE';
  }>;
  totals?: { total?: number };
  source: {
    engine: 'docx-text-v1' | 'filename-v1' | 'unsupported-v1';
    confidence: number;
    rawText?: string;
    warnings: string[];
  };
};

type ExtractedDocumentKind = NonNullable<ExtractedDocument['document']>['kind'];

const MONTHS: Record<string, number> = {
  enero: 0,
  febrero: 1,
  marzo: 2,
  abril: 3,
  mayo: 4,
  junio: 5,
  julio: 6,
  agosto: 7,
  septiembre: 8,
  setiembre: 8,
  octubre: 9,
  noviembre: 10,
  diciembre: 11
};

export function classifyDocumentName(fileName: string): ExtractedDocumentKind {
  const name = normalizeName(fileName);
  if (name.includes('presup')) return 'QUOTE';
  if (name.includes('remito')) return 'DELIVERY_NOTE';
  if (name.includes('nota de credito') || name.includes('not de credito')) return 'INVOICE';
  if (name.includes('fact') || name.match(/\b\d{11}_\d{3}_\d{5}_\d{8}\b/)) return 'INVOICE';
  return 'UNKNOWN';
}

export function mimeTypeForPath(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (ext === '.doc') return 'application/msword';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.xls') return 'application/vnd.ms-excel';
  if (ext === '.xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  return 'application/octet-stream';
}

export function isCandidateBusinessDocument(fileName: string) {
  const kind = classifyDocumentName(fileName);
  const ext = path.extname(fileName).toLowerCase();
  return kind !== 'UNKNOWN' && ['.pdf', '.docx', '.jpg', '.jpeg', '.png'].includes(ext);
}

function parseSpanishDate(text: string): Date | undefined {
  const numeric = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
  if (numeric) {
    const year = Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3]);
    return new Date(year, Number(numeric[2]) - 1, Number(numeric[1]));
  }

  const named = normalizeName(text).match(/\b(\d{1,2})\s+de\s+([a-z]+)\s+(?:de\s+)?(\d{4})\b/);
  if (named && MONTHS[named[2]] !== undefined) {
    return new Date(Number(named[3]), MONTHS[named[2]], Number(named[1]));
  }

  return undefined;
}

function parseMoney(value: string) {
  const cleaned = value.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function splitCostBlocks(rawText: string) {
  const normalized = rawText.replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
  const pattern = /(.{12,900}?)\s+Costo\s*[:.·…-]*\s*(U\$S|\$)?\s*([\d.,]+)\s*(\+\s*iva)?/gi;
  const items: ExtractedDocument['items'] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(normalized)) !== null) {
    const description = match[1]
      .replace(/^(F\.M\.H\.|De:|Cliente:|Fecha de emisión:).*?/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    const total = parseMoney(match[3]);
    if (!description || total === undefined) continue;
    items.push({
      description: description.slice(-700),
      quantity: 1,
      unit: 'trabajo',
      unitPrice: total,
      total,
      taxRate: match[4] ? 21 : 0,
      type: 'SERVICE'
    });
  }

  return items;
}

function extractCustomer(rawText: string) {
  const client = rawText.match(/CLIENTE\s*:\s*([^\n\r]+)/i);
  if (client?.[1]) return { legalName: client[1].trim() };

  const de = rawText.match(/\b(?:Cliente|Señores|Sres\.?)\s+([A-ZÁÉÍÓÚÑ0-9 .,&-]{4,80})/i);
  if (de?.[1]) return { legalName: de[1].trim() };

  return undefined;
}

function extractNumber(rawText: string, kind: ExtractedDocumentKind) {
  if (kind === 'DELIVERY_NOTE') {
    return rawText.match(/Remito\s*N[°º]?\s*([0-9-]+)/i)?.[1];
  }
  if (kind === 'QUOTE') {
    return rawText.match(/Presupuesto\s*N[°º]?\s*([0-9-]+)/i)?.[1];
  }
  return rawText.match(/(?:Factura|Comprobante)\s*N[°º]?\s*([0-9-]+)/i)?.[1];
}

export async function extractDocumentFromFile(filePath: string, fileName = path.basename(filePath)): Promise<ExtractedDocument> {
  const kind = classifyDocumentName(fileName);
  const warnings: string[] = [];

  if (path.extname(filePath).toLowerCase() !== '.docx') {
    return {
      document: { kind, currency: 'ARS' },
      items: [],
      source: {
        engine: kind === 'UNKNOWN' ? 'unsupported-v1' : 'filename-v1',
        confidence: kind === 'UNKNOWN' ? 0.1 : 0.35,
        warnings: ['Automatic structured extraction is currently implemented for DOCX; PDF/images require review or IA extraction.']
      }
    };
  }

  const result = await mammoth.extractRawText({ path: filePath });
  const rawText = result.value.trim();
  if (!rawText) warnings.push('DOCX did not produce readable text.');

  const items = splitCostBlocks(rawText);
  if (items.length === 0) warnings.push('No cost blocks were detected.');

  const total = items.reduce((sum, item) => sum + Number(item.total ?? 0), 0);
  const currency = rawText.includes('U$S') ? 'USD' : 'ARS';
  const date = parseSpanishDate(rawText) ?? parseSpanishDate(fileName);

  return {
    document: {
      kind,
      date,
      number: extractNumber(rawText, kind),
      currency
    },
    customer: extractCustomer(rawText),
    items,
    totals: total > 0 ? { total } : undefined,
    source: {
      engine: 'docx-text-v1',
      confidence: Math.min(0.95, 0.45 + items.length * 0.1 + (date ? 0.1 : 0) + (kind !== 'UNKNOWN' ? 0.1 : 0)),
      rawText,
      warnings
    }
  };
}
