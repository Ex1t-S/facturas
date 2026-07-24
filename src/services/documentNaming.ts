import path from 'node:path';
import { normalizeName } from './normalize.js';

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'setiembre', 'octubre', 'noviembre', 'diciembre'];

export type DocumentNamingInput = {
  sourceType: string;
  kind: string;
  fileName: string;
  mimeType: string;
  documentDate?: Date | null;
  createdAt: Date;
  externalNumber?: string | null;
  issuerName?: string | null;
  customerCandidates?: Array<{ legalName?: string | null; tradeName?: string | null }>;
  extractedJson?: string | null;
};

export type DocumentNamingResult = { fileName: string; customer: string; date: string; number?: string };

function parseJson(value?: string | null) {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as Record<string, any>;
  } catch {
    return undefined;
  }
}

function slug(value: string, fallback = 'CLIENTE-DESCONOCIDO') {
  const result = normalizeName(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70)
    .toUpperCase();
  return result || fallback;
}

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function inferDate(input: DocumentNamingInput, extracted: Record<string, any> | undefined) {
  if (input.documentDate) return input.documentDate;
  const extractedDate = extracted?.document?.date;
  if (typeof extractedDate === 'string' && !Number.isNaN(Date.parse(extractedDate))) return new Date(extractedDate);

  const source = normalizeName(input.fileName);
  const year = source.match(/\b(19\d{2}|20\d{2})\b/);
  if (year) {
    const monthIndex = MONTHS.findIndex((month) => source.includes(month));
    return new Date(Number(year[1]), monthIndex >= 0 ? monthIndex : 0, 1);
  }
  return input.createdAt;
}

function inferCustomer(input: DocumentNamingInput, extracted: Record<string, any> | undefined) {
  const fromStructured = extracted?.customer?.legalName || extracted?.customer?.tradeName;
  if (input.issuerName || fromStructured) return slug(input.issuerName || fromStructured);
  const candidate = input.customerCandidates?.find((item) => item.legalName || item.tradeName);
  if (candidate) return slug(candidate.legalName || candidate.tradeName || '');

  const base = path.basename(input.fileName, path.extname(input.fileName));
  const cleaned = normalizeName(base)
    .replace(/^(?:factura|fact|presupuesto|presupueto|presup|remito)\s*/i, '')
    .replace(/\b(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/gi, ' ')
    .replace(/\b(?:19\d{2}|20\d{2})\b/g, ' ')
    .replace(/^\d{11}_\d{3}_\d{5}_\d{8}\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || /^\d/.test(cleaned)) return 'CLIENTE-DESCONOCIDO';
  return slug(cleaned);
}

function inferNumber(input: DocumentNamingInput) {
  if (input.externalNumber?.trim()) return input.externalNumber.trim().replace(/\s+/g, '-');
  const base = path.basename(input.fileName, path.extname(input.fileName));
  const afip = base.match(/^\d{11}_(\d{3})_\d{5}_(\d{8})$/);
  return afip ? `${afip[1]}-${afip[2]}` : undefined;
}

export function canonicalDocumentName(input: DocumentNamingInput): DocumentNamingResult | null {
  const prefix = input.kind === 'DELIVERY_NOTE' ? 'REMITO' : input.kind === 'QUOTE' ? 'PRESUPUESTO' : input.kind === 'PURCHASE_INVOICE' ? 'FACTURA-COMPRA' : input.kind === 'INVOICE' ? 'FACTURA' : null;
  if (!prefix || input.sourceType === 'whatsapp') return null;

  const extracted = parseJson(input.extractedJson);
  const date = isoDate(inferDate(input, extracted));
  const customer = inferCustomer(input, extracted);
  const number = prefix.startsWith('FACTURA') ? inferNumber(input) : undefined;
  const extension = path.extname(input.fileName).toLowerCase() || '.bin';
  const parts = [prefix, date, customer];
  if (number) parts.push(number);
  return { fileName: `${parts.join('_')}${extension}`, customer, date, number };
}
