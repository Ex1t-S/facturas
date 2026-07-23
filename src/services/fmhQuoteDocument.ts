import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import AdmZip from 'adm-zip';
import type { Quote, QuoteItem, Customer } from '../generated/postgres-client/index.js';
import { config } from '../config.js';
import { applyFmhA4Layout, applyFmhA4PageSize, buildBottomAnchoredFmhBody } from './fmhDocumentLayout.js';
import { isModernFmhQuoteTemplate, replaceModernQuoteTemplate } from './fmhModernTemplate.js';

const execFileAsync = promisify(execFile);

export type QuoteWithDetails = Quote & {
  customer: Customer;
  items: QuoteItem[];
};

function templatePath() {
  return path.resolve(config.FMH_QUOTE_TEMPLATE_PATH);
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function stripXml(value: string) {
  return value.replace(/<[^>]+>/g, '');
}

function paragraph(text: string, options: { bold?: boolean; size?: number; align?: 'center' | 'right'; style?: string; before?: number } = {}) {
  const bold = options.bold ? '<w:b/>' : '';
  const align = options.align ? `<w:jc w:val="${options.align}"/>` : '';
  const style = options.style ? `<w:pStyle w:val="${options.style}"/>` : '';
  const size = options.size ?? 28;
  return [
    '<w:p>',
    `<w:pPr>${style}${align}<w:spacing w:before="${options.before ?? 0}" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>`,
    '<w:r>',
    `<w:rPr>${bold}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr>`,
    `<w:t xml:space="preserve">${escapeXml(text)}</w:t>`,
    '</w:r>',
    '</w:p>'
  ].join('');
}

function splitDescription(description: string) {
  const normalized = description.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 260) return [normalized];
  const sentences = normalized.match(/[^.!?]+[.!?,-]*/g)?.map((part) => part.trim()).filter(Boolean) ?? [normalized];
  const lines: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if ((current + ' ' + sentence).trim().length > 280 && current) {
      lines.push(current);
      current = sentence;
    } else {
      current = `${current} ${sentence}`.trim();
    }
  }
  if (current) lines.push(current);
  return lines;
}

function formatDate(date: Date) {
  return date.toLocaleDateString('es-AR');
}

function formatAmount(value: number) {
  return value.toLocaleString('es-AR', { maximumFractionDigits: 2 });
}

function lineNet(item: QuoteItem) {
  return Number(item.quantity) * Number(item.unitPrice) * (1 - Number(item.discount ?? 0) / 100);
}

function costLeader(currency: string, amount: number, taxRate: number) {
  const label = currency === 'USD' ? 'U$S' : '$';
  const iva = taxRate > 0 ? ' + iva' : '';
  return `              Costo:${'…'.repeat(28)}${label} ${formatAmount(amount)}${iva}`;
}

function buildQuoteParagraphs(quote: QuoteWithDetails) {
  const blocks: string[] = [];
  quote.items.forEach((item, index) => {
    const descriptionLines = splitDescription(item.description);
    descriptionLines.forEach((line, lineIndex) => {
      const prefix = quote.items.length > 1 && lineIndex === 0 ? `${index + 1}. ` : '';
      blocks.push(paragraph(`${prefix}${line}`, { style: 'Prrafodelista', size: 28, bold: index === 0 && lineIndex === 0 }));
    });
    if (Number(item.quantity) > 1 && item.unit !== 'trabajo') {
      blocks.push(paragraph(`Cantidad: ${item.quantity.toString()} ${item.unit}`, { style: 'Prrafodelista', size: 28 }));
    }
    blocks.push(paragraph(costLeader(quote.currency, lineNet(item), Number(item.taxRate)), { style: 'Prrafodelista', size: 28 }));
  });
  if (quote.notes) blocks.push(paragraph(quote.notes, { style: 'Prrafodelista', size: 24 }));
  return {
    detailsXml: blocks.join(''),
    closingXml: paragraph('hacemos propicia la oportunidad para saludar muy atentamente. -', { style: 'Prrafodelista', size: 28 })
  };
}

function replaceFirst(value: string, search: string, replacement: string) {
  const index = value.indexOf(search);
  if (index === -1) return value;
  return `${value.slice(0, index)}${replacement}${value.slice(index + search.length)}`;
}

function replaceParagraphContaining(xml: string, marker: string, replacement: string) {
  const paragraphRegex = /<w:p[\s\S]*?<\/w:p>/g;
  const match = [...xml.matchAll(paragraphRegex)].find((item) => stripXml(item[0]).includes(marker));
  if (!match || match.index === undefined) return xml;
  return `${xml.slice(0, match.index)}${replacement}${xml.slice(match.index + match[0].length)}`;
}

function replaceTemplateText(xml: string, quote: QuoteWithDetails) {
  let output = xml;
  output = replaceParagraphContaining(output, 'CLIENTE:', paragraph(`CLIENTE: ${quote.customer.legalName}`, { size: 28 }));
  output = replaceParagraphContaining(output, 'Fecha de', paragraph(`Fecha de emisión: ${formatDate(quote.issueDate)}`, { size: 16 }));
  output = replaceFirst(output, '<w:t>Presupuesto</w:t>', `<w:t>Presupuesto N° ${String(quote.number).padStart(5, '0')}</w:t>`);
  return output;
}

function replaceQuoteBody(xml: string, quote: QuoteWithDetails) {
  const paragraphRegex = /<w:p[\s\S]*?<\/w:p>/g;
  const matches = [...xml.matchAll(paragraphRegex)].map((match) => ({ xml: match[0], index: match.index ?? 0, text: stripXml(match[0]) }));
  const start = matches.find((match) => match.text.includes('Fabricar tres extractores'));
  const end = matches.find((match) => match.text.includes('hacemos propicia'));
  if (!start || !end) {
    throw new Error('FMH template body markers were not found');
  }
  const body = buildQuoteParagraphs(quote);
  const replacement = buildBottomAnchoredFmhBody(body);
  return `${xml.slice(0, start.index)}${replacement}${xml.slice(end.index + end.xml.length)}`;
}

async function quoteOutputDir(quoteId: string) {
  const dir = path.resolve(config.UPLOAD_DIR, 'generated', 'quotes', quoteId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function renderFmhQuoteDocx(quote: QuoteWithDetails) {
  const zip = new AdmZip(await fs.readFile(templatePath()));
  const entry = zip.getEntry('word/document.xml');
  if (!entry) throw new Error('Template is missing word/document.xml');
  let xml = entry.getData().toString('utf8');
  const modernTemplate = isModernFmhQuoteTemplate(xml);
  if (modernTemplate) {
    xml = replaceModernQuoteTemplate(xml, quote);
  } else {
    xml = replaceTemplateText(xml, quote);
    xml = replaceQuoteBody(xml, quote);
  }
  xml = modernTemplate ? applyFmhA4PageSize(xml) : applyFmhA4Layout(xml);
  zip.updateFile('word/document.xml', Buffer.from(xml, 'utf8'));
  return zip.toBuffer();
}

export async function writeFmhQuoteDocx(quote: QuoteWithDetails) {
  const dir = await quoteOutputDir(quote.id);
  const filePath = path.join(dir, `presupuesto-fmh-${quote.number}.docx`);
  await fs.writeFile(filePath, await renderFmhQuoteDocx(quote));
  return filePath;
}

async function findSoffice() {
  const configured = config.LIBREOFFICE_PATH.trim();
  const candidates = [
    ...(configured ? [configured] : []),
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
    'soffice',
    'libreoffice'
  ];
  for (const candidate of candidates) {
    try {
      if (candidate.includes('\\') || candidate.includes('/')) {
        await fs.access(candidate);
        return candidate;
      }
      await execFileAsync(candidate, ['--version'], { timeout: 3000 });
      return candidate;
    } catch {
      // Try next candidate.
    }
  }
  return null;
}

export async function convertDocxToPdf(docxPath: string) {
  const soffice = await findSoffice();
  if (!soffice) return null;
  const outDir = path.dirname(docxPath);
  // A disposable profile prevents Windows/Render processes from locking the user's
  // interactive LibreOffice profile and silently skipping the conversion.
  const profileDir = path.join(outDir, `.libreoffice-profile-${crypto.randomUUID()}`);
  await fs.mkdir(profileDir, { recursive: true });
  try {
    await execFileAsync(soffice, [
      `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
      '--headless', '--nologo', '--nofirststartwizard', '--convert-to', 'pdf', '--outdir', outDir, docxPath
    ], { timeout: 30000 });
    const pdfPath = docxPath.replace(/\.docx$/i, '.pdf');
    try {
      await fs.access(pdfPath);
      return pdfPath;
    } catch {
      return null;
    }
  } finally {
    await fs.rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function renderFmhQuotePdf(quote: QuoteWithDetails) {
  const dir = path.resolve(config.UPLOAD_DIR, 'generated', 'quote-previews');
  await fs.mkdir(dir, { recursive: true });
  const docxPath = path.join(dir, `preview-${crypto.randomUUID()}.docx`);
  await fs.writeFile(docxPath, await renderFmhQuoteDocx(quote));
  const pdfPath = await convertDocxToPdf(docxPath);
  if (!pdfPath) return null;
  return fs.readFile(pdfPath);
}
