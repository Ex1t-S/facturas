import { describe, expect, it } from 'vitest';
import { detectDraftIntent, parseFollowUpDeliveryNoteForTest, requestsPreview, sanitizeDocumentInstructions, structuredDeliveryItemsFromMessage, validateGeneratedBusinessDocument } from './assistant.js';

describe('detectDraftIntent', () => {
  it('detects quote draft requests', () => {
    expect(detectDraftIntent('armame un presupuesto para Pasman con 2 motores')).toBe('quote');
  });

  it('detects delivery note draft requests', () => {
    expect(detectDraftIntent('crea un remito para Agro SRL con 4 correas')).toBe('delivery_note');
  });

  it('detects invoice requests so they can be blocked', () => {
    expect(detectDraftIntent('generame una factura para el cliente')).toBe('invoice');
  });

  it('ignores informational questions', () => {
    expect(detectDraftIntent('busca remitos de Pasman de enero')).toBe('none');
  });

  it('does not treat customer list requests as delivery note creation', () => {
    expect(detectDraftIntent('Quiero armar un remito pasame la lista de clietnnes q tenemos')).toBe('none');
  });
});

describe('parseFollowUpDeliveryNoteForTest', () => {
  it('treats customer-only setup as missing items', () => {
    const parsed = parseFollowUpDeliveryNoteForTest('vamos a armarlo para mario alvarez');
    expect(parsed.customerName).toBe('mario alvarez');
    expect(parsed.items).toEqual([]);
  });

  it('extracts work description when the message includes actual work', () => {
    const parsed = parseFollowUpDeliveryNoteForTest('para mario alvarez, retiramos espira y atornillamos la malla');
    expect(parsed.customerName).toBe('mario alvarez');
    expect(parsed.items[0]?.description).toBe('retiramos espira y atornillamos la malla');
  });
});

describe('structured commercial delivery-note data', () => {
  const request = 'Haceme un remito para Cooperativa Adolfo Alsina por los siguientes trabajos: acortar cinta de noria, destapar dos caños de llenado de silo y realizar una revisión general. Prepará el PDF para revisarlo antes de guardarlo.';

  it('keeps only commercial items from a conversational request', () => {
    expect(structuredDeliveryItemsFromMessage(request).map((item) => item.description)).toEqual([
      'acortar cinta de noria',
      'destapar dos caños de llenado de silo',
      'realizar una revisión general'
    ]);
  });

  it('removes chat-only instructions deterministically', () => {
    expect(sanitizeDocumentInstructions('Prepará el PDF para revisarlo antes de guardarlo')).toBe('');
    expect(() => validateGeneratedBusinessDocument({ customerName: 'Cooperativa Adolfo Alsina', items: [{ description: 'Haceme un remito' }] })).toThrow();
  });
});

describe('PDF requests from WhatsApp transcriptions', () => {
  it.each(['Dame el PDF.', 'Pasame el PDF ya limpio.', 'Quiero que me pases el PDF final.', 'Preparámelo.'])('recognizes %s as a preview request', (message) => {
    expect(requestsPreview(message)).toBe(true);
  });
});
