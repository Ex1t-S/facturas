import { describe, expect, it } from 'vitest';
import { canonicalDocumentName } from './documentNaming.js';

const base = { mimeType: 'application/pdf', createdAt: new Date('2026-07-24T00:00:00Z'), sourceType: 'historical' };

describe('canonical document names', () => {
  it('uses no number placeholder for remitos and quotes', () => {
    expect(canonicalDocumentName({ ...base, kind: 'DELIVERY_NOTE', fileName: 'remito mario alvarez julio 2024.docx' })?.fileName).toBe('REMITO_2024-07-01_MARIO-ALVAREZ.docx');
    expect(canonicalDocumentName({ ...base, kind: 'QUOTE', fileName: 'presupuesto la emancipacion.docx' })?.fileName).toBe('PRESUPUESTO_2026-07-24_LA-EMANCIPACION.docx');
  });

  it('includes the official number for invoices when available', () => {
    expect(canonicalDocumentName({ ...base, kind: 'INVOICE', fileName: 'factura mario.pdf', externalNumber: '0002-00000487' })?.fileName).toBe('FACTURA_2026-07-24_MARIO_0002-00000487.pdf');
  });
});
