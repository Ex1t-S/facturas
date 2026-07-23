import fs from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { config } from '../config.js';
import { convertDocxToPdf } from './fmhQuoteDocument.js';
import { applyFmhA4Layout, buildBottomAnchoredFmhBody } from './fmhDocumentLayout.js';
import { isModernFmhDeliveryTemplate, replaceModernDeliveryTemplate } from './fmhModernTemplate.js';

export type FmhDeliveryNoteDocumentInput = {
  number?: string;
  customerName: string;
  issueDate: Date;
  notes?: string | null;
  items: Array<{
    description: string;
    quantity: string | number;
    unit: string;
  }>;
};

function templatePath() {
  return path.resolve(config.FMH_DELIVERY_NOTE_TEMPLATE_PATH);
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

function formatDate(date: Date) {
  return date.toLocaleDateString('es-AR');
}

function paragraph(text: string, sourceParagraph?: string) {
  const pPr = sourceParagraph?.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)?.[0] ?? '<w:pPr><w:spacing w:after="0"/></w:pPr>';
  const rPr = sourceParagraph?.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0] ?? '<w:rPr><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr>';
  return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function replaceParagraphContaining(xml: string, marker: string, replacement: string) {
  const paragraphs = [...xml.matchAll(/<w:p[\s\S]*?<\/w:p>/g)];
  const match = paragraphs.find((item) => stripXml(item[0]).includes(marker));
  if (!match || match.index === undefined) return xml;
  return `${xml.slice(0, match.index)}${replacement}${xml.slice(match.index + match[0].length)}`;
}

function replaceDetails(xml: string, input: FmhDeliveryNoteDocumentInput) {
  const paragraphs = [...xml.matchAll(/<w:p[\s\S]*?<\/w:p>/g)].map((match) => ({
    xml: match[0],
    index: match.index ?? 0,
    text: stripXml(match[0])
  }));
  const detailIndex = paragraphs.findIndex((item) => item.text.includes('DETALLE'));
  const closingIndex = paragraphs.findIndex((item, index) => index > detailIndex && /Hago propicia|Hacemos llegar/.test(item.text));
  if (detailIndex < 0 || closingIndex < 0 || closingIndex <= detailIndex + 1) {
    throw new Error('FMH remito template detail markers were not found');
  }

  const sourceParagraph = paragraphs[detailIndex + 1].xml;
  const closingParagraph = paragraphs[closingIndex].xml;
  const lines = input.items.map((item, index) => {
    const prefix = input.items.length > 1 ? `${index + 1}. ` : '';
    const quantity = String(item.quantity ?? '').trim();
    const unit = item.unit?.trim();
    const genericSingleWork = quantity === '1' && /^(?:trabajo|servicio|unidad)$/i.test(unit || '');
    const itemPrefix = quantity && !genericSingleWork ? `${quantity}${unit ? ` ${unit}` : ''} - ` : '';
    return `${prefix}${itemPrefix}${item.description}`;
  });
  if (input.notes) lines.push(input.notes);
  const replacement = buildBottomAnchoredFmhBody({
    detailsXml: lines.map((line) => paragraph(line, sourceParagraph)).join(''),
    closingXml: paragraph('Hago propicia la oportunidad para saludarlos muy atte.', closingParagraph),
    detailAreaHeightTwips: 4400
  });
  const start = paragraphs[detailIndex + 1].index;
  const end = paragraphs[closingIndex].index + paragraphs[closingIndex].xml.length;
  return `${xml.slice(0, start)}${replacement}${xml.slice(end)}`;
}

export async function renderFmhDeliveryNoteDocx(input: FmhDeliveryNoteDocumentInput) {
  const zip = new AdmZip(await fs.readFile(templatePath()));
  const entry = zip.getEntry('word/document.xml');
  if (!entry) throw new Error('FMH remito template is missing word/document.xml');
  let xml = entry.getData().toString('utf8');
  if (isModernFmhDeliveryTemplate(xml)) {
    xml = replaceModernDeliveryTemplate(xml, input);
  } else {
    xml = replaceParagraphContaining(xml, 'Remito', paragraph(`REMITO N.º ${input.number ? String(input.number).padStart(5, '0') : 'BORRADOR'}`));
    xml = replaceParagraphContaining(xml, 'CLIENTE:', paragraph(`CLIENTE: ${input.customerName}`));
    xml = replaceParagraphContaining(xml, 'Fecha de emisión:', paragraph(`Fecha de emisión: ${formatDate(input.issueDate)}`));
    xml = replaceDetails(xml, input);
  }
  xml = applyFmhA4Layout(xml);
  zip.updateFile('word/document.xml', Buffer.from(xml, 'utf8'));
  return zip.toBuffer();
}

export async function writeFmhDeliveryNoteDocx(input: FmhDeliveryNoteDocumentInput, id: string) {
  const dir = path.resolve(config.UPLOAD_DIR, 'generated', 'delivery-notes', id);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `remito-fmh-${input.number || 'borrador'}.docx`);
  await fs.writeFile(filePath, await renderFmhDeliveryNoteDocx(input));
  return filePath;
}

export async function renderFmhDeliveryNotePdf(input: FmhDeliveryNoteDocumentInput) {
  const dir = path.resolve(config.UPLOAD_DIR, 'generated', 'delivery-note-previews');
  await fs.mkdir(dir, { recursive: true });
  const docxPath = path.join(dir, `preview-${Date.now()}-${Math.random().toString(16).slice(2)}.docx`);
  await fs.writeFile(docxPath, await renderFmhDeliveryNoteDocx(input));
  const pdfPath = await convertDocxToPdf(docxPath);
  if (!pdfPath) return null;
  return fs.readFile(pdfPath);
}
