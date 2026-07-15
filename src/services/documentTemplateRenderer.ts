import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { convertDocxToPdf, renderFmhQuoteDocx, type QuoteWithDetails } from './fmhQuoteDocument.js';
import { renderFmhDeliveryNoteDocx, type FmhDeliveryNoteDocumentInput } from './fmhDeliveryNoteDocument.js';

export type BusinessTemplateType = 'QUOTE' | 'DELIVERY_NOTE';
export type RendererUsed = 'FMH_TEMPLATE' | 'GENERIC_FALLBACK';

export type TemplateRenderInput =
  | { templateType: 'QUOTE'; quote: QuoteWithDetails }
  | { templateType: 'DELIVERY_NOTE'; deliveryNote: FmhDeliveryNoteDocumentInput };

export type TemplateRenderResult = {
  docx: Buffer;
  pdf: Buffer | null;
  rendererUsed: RendererUsed;
  fallbackReason?: string;
};

/** The sole DOCX-to-PDF path used by quote and delivery-note previews/finals. */
export async function renderDocumentFromTemplate(input: TemplateRenderInput): Promise<TemplateRenderResult> {
  try {
    const docx = input.templateType === 'QUOTE'
      ? await renderFmhQuoteDocx(input.quote)
      : await renderFmhDeliveryNoteDocx(input.deliveryNote);
    const directory = path.resolve(config.UPLOAD_DIR, 'generated', 'template-previews');
    await fs.mkdir(directory, { recursive: true });
    const docxPath = path.join(directory, `${input.templateType.toLowerCase()}-${crypto.randomUUID()}.docx`);
    await fs.writeFile(docxPath, docx);
    const pdfPath = await convertDocxToPdf(docxPath);
    return {
      docx,
      pdf: pdfPath ? await fs.readFile(pdfPath) : null,
      rendererUsed: 'FMH_TEMPLATE',
      ...(pdfPath ? {} : { fallbackReason: 'LibreOffice no pudo convertir el DOCX FMH a PDF.' })
    };
  } catch (error) {
    return {
      docx: Buffer.alloc(0),
      pdf: null,
      rendererUsed: 'GENERIC_FALLBACK',
      fallbackReason: error instanceof Error ? error.message : String(error)
    };
  }
}
