import AdmZip from 'adm-zip';
import { describe, expect, it } from 'vitest';
import { renderFmhQuoteDocx, type QuoteWithDetails } from './fmhQuoteDocument.js';

describe('FMH quote DOCX template', () => {
  it('uses A4, keeps each priced job separate and anchors the greeting after the detail area', async () => {
    const quote = {
      id: 'quote-test',
      number: 12,
      issueDate: new Date('2026-07-15T12:00:00Z'),
      currency: 'ARS',
      notes: null,
      customer: { legalName: 'Mario Alvarez' },
      items: [
        { description: 'Abulonar cangilones', quantity: 1, unit: 'trabajo', unitPrice: 100000, discount: 0, taxRate: 21 },
        { description: 'Soldar una cremallera', quantity: 1, unit: 'trabajo', unitPrice: 80000, discount: 0, taxRate: 21 }
      ]
    } as unknown as QuoteWithDetails;

    const zip = new AdmZip(await renderFmhQuoteDocx(quote));
    const documentXml = zip.getEntry('word/document.xml')?.getData().toString('utf8') ?? '';
    const text = documentXml.replace(/<[^>]+>/g, '');

    expect(documentXml).toContain('<w:pgSz w:w="11906" w:h="16838"/>');
    expect(documentXml).not.toContain('<w:trHeight w:val="6000" w:hRule="atLeast"/>');
    expect(documentXml.match(/<w:tbl\b/g)?.length).toBeGreaterThanOrEqual(8);
    expect(text).toContain('1');
    expect(text).toContain('Abulonar cangilones');
    expect(text).toContain('2');
    expect(text).toContain('Soldar una cremallera');
    expect(text).toContain('$ 100.000');
    expect(text).toContain('TOTAL');
  });
});
