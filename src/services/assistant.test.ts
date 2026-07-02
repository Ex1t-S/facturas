import { describe, expect, it } from 'vitest';
import { detectDraftIntent, parseFollowUpDeliveryNoteForTest } from './assistant.js';

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
