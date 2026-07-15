import AdmZip from 'adm-zip';
import { describe, expect, it } from 'vitest';
import { renderDocumentFromTemplate } from './documentTemplateRenderer.js';

describe('DocumentTemplateRenderer', () => {
  it('renders the canonical FMH remito template without conversational instructions', async () => {
    const result = await renderDocumentFromTemplate({
      templateType: 'DELIVERY_NOTE',
      deliveryNote: {
        number: 'borrador',
        customerName: 'Cooperativa Adolfo Alsina',
        issueDate: new Date('2026-07-15T12:00:00Z'),
        items: [
          { description: 'Acortar cinta de noria', quantity: '', unit: '' },
          { description: 'Destapar dos caños de llenado de silo', quantity: '', unit: '' },
          { description: 'Realizar una revisión general', quantity: '', unit: '' }
        ]
      }
    });

    expect(result.rendererUsed).toBe('FMH_TEMPLATE');
    expect(result.docx.length).toBeGreaterThan(0);
    const xml = new AdmZip(result.docx).getEntry('word/document.xml')?.getData().toString('utf8') ?? '';
    expect(xml).toContain('Cooperativa Adolfo Alsina');
    expect(xml).not.toMatch(/Prepará el PDF|Guardalo|Haceme un remito/);
  });
});
