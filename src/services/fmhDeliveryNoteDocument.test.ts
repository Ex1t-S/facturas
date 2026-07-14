import AdmZip from 'adm-zip';
import { describe, expect, it } from 'vitest';
import { renderFmhDeliveryNoteDocx } from './fmhDeliveryNoteDocument.js';

describe('FMH delivery note DOCX template', () => {
  it('keeps the FMH template and replaces the operational fields', async () => {
    const buffer = await renderFmhDeliveryNoteDocx({
      number: '7',
      customerName: 'Cooperativa Adolfo Alsina',
      issueDate: new Date('2026-07-14T12:00:00Z'),
      items: [
        { description: 'Acortar cinta de noria', quantity: 1, unit: 'trabajo' },
        { description: 'Destapar dos caños de llenado de silo', quantity: 2, unit: 'caños' }
      ]
    });

    const zip = new AdmZip(buffer);
    const documentXml = zip.getEntry('word/document.xml')?.getData().toString('utf8') ?? '';
    const text = documentXml.replace(/<[^>]+>/g, '');

    expect(documentXml).toContain('Remito N°00007');
    expect(text).toContain('CLIENTE: Cooperativa Adolfo Alsina');
    expect(text).toContain('Acortar cinta de noria');
    expect(text).toContain('2 caños - Destapar dos caños de llenado de silo');
    expect(text).not.toContain('Matadero Municipal');
    expect(text).toContain('F.M.H.');
  });
});
