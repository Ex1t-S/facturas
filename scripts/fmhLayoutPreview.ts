import fs from 'node:fs/promises';
import path from 'node:path';
import { PDFParse } from 'pdf-parse';
import { renderFmhDeliveryNoteDocx } from '../src/services/fmhDeliveryNoteDocument.js';
import { convertDocxToPdf, renderFmhQuoteDocx, type QuoteWithDetails } from '../src/services/fmhQuoteDocument.js';

async function writePdf(docxPath: string, docx: Buffer) {
  await fs.writeFile(docxPath, docx);
  const pdfPath = await convertDocxToPdf(docxPath);
  if (!pdfPath) throw new Error(`LibreOffice no pudo convertir ${path.basename(docxPath)}.`);
  return pdfPath;
}

async function validateSinglePagePdf(pdfPath: string, requiredText: string[]) {
  const parser = new PDFParse({ data: await fs.readFile(pdfPath) });
  const parsed = await parser.getText();
  await parser.destroy();
  if (parsed.total !== 1) throw new Error(`${path.basename(pdfPath)} generó ${parsed.total} páginas.`);
  for (const text of requiredText) {
    if (!parsed.text.includes(text)) throw new Error(`${path.basename(pdfPath)} no contiene: ${text}`);
  }
}

async function main() {
  const outputDir = path.resolve(process.env.USERPROFILE || process.cwd(), 'Desktop', 'Pruebas Bot WhatsApp', 'Formato A4 FMH');
  await fs.mkdir(outputDir, { recursive: true });

  const deliveryNoteDocx = await renderFmhDeliveryNoteDocx({
    number: '1',
    customerName: 'Mario Alvarez',
    issueDate: new Date('2026-07-15T12:00:00-03:00'),
    items: [
      { description: 'Abulonar unos cangilones', quantity: 1, unit: 'trabajo' },
      { description: 'Soldar una cremallera', quantity: 1, unit: 'trabajo' }
    ]
  });
  const deliveryNoteDocxPath = path.join(outputDir, 'Remito-FMH-A4-dos-trabajos.docx');
  const deliveryNotePdfPath = await writePdf(deliveryNoteDocxPath, deliveryNoteDocx);
  await validateSinglePagePdf(deliveryNotePdfPath, ['Abulonar unos cangilones', 'Soldar una cremallera', 'Hago propicia']);

  const quote = {
    id: 'preview-layout',
    number: 1,
    issueDate: new Date('2026-07-15T12:00:00-03:00'),
    currency: 'ARS',
    notes: null,
    customer: { legalName: 'Mario Alvarez' },
    items: [
      { description: 'Abulonar unos cangilones', quantity: 1, unit: 'trabajo', unitPrice: 100000, discount: 0, taxRate: 21 },
      { description: 'Soldar una cremallera', quantity: 1, unit: 'trabajo', unitPrice: 80000, discount: 0, taxRate: 21 }
    ]
  } as unknown as QuoteWithDetails;
  const quoteDocx = await renderFmhQuoteDocx(quote);
  const quoteDocxPath = path.join(outputDir, 'Presupuesto-FMH-A4-dos-trabajos.docx');
  const quotePdfPath = await writePdf(quoteDocxPath, quoteDocx);
  await validateSinglePagePdf(quotePdfPath, ['Abulonar unos cangilones', 'Soldar una cremallera', 'hacemos propicia']);

  console.log(JSON.stringify({ outputDir, deliveryNoteDocxPath, deliveryNotePdfPath, quoteDocxPath, quotePdfPath }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
