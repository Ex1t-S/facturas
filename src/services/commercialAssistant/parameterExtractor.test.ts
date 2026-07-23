import { describe, expect, it } from 'vitest';
import { classifyCommercialAction } from './actionClassifier.js';
import {
  extractCommercialAction,
  extractCommercialContent,
  extractDraftItems,
  sanitizeRequestedPdfFileName
} from './parameterExtractor.js';
import type { CommercialDraft } from './types.js';

const draft = {
  schemaVersion: 2,
  id: 'draft-1',
  conversationId: 'conversation-1',
  companyId: 'company-1',
  documentType: 'QUOTE',
  status: 'COLLECTING_PRICES',
  customerId: 'customer-1',
  customerName: 'Mario Alvarez',
  currency: 'ARS',
  items: [],
  suggestedFileName: 'presupuesto.pdf',
  draftVersion: 1,
  awaiting: 'PRICES',
  createdAt: new Date('2026-07-23T12:00:00Z'),
  updatedAt: new Date('2026-07-23T12:00:00Z'),
  expiresAt: new Date('2026-07-25T12:00:00Z')
} satisfies CommercialDraft;

function action(message: string) {
  const classification = classifyCommercialAction(message, draft);
  return extractCommercialAction(classification, message, draft);
}

describe('commercial parameter extraction', () => {
  it('removes the append command from commercial content', () => {
    const classification = classifyCommercialAction('agrega que caminamos sobre un techo', draft);
    expect(extractCommercialContent('agrega que caminamos sobre un techo', classification)).toBe(
      'caminamos sobre un techo'
    );
  });

  it.each([
    ['al item uno ponle 20000$', 20_000, { kind: 'INDEX', index: 1 }],
    ['cambia el precio del item 1 a 50000', 50_000, { kind: 'INDEX', index: 1 }],
    ['precio del item 2 a 20000', 20_000, { kind: 'INDEX', index: 2 }],
    ['pone 20 mil al segundo', 20_000, { kind: 'INDEX', index: 2 }],
    ['pone USD 20000 al primero', 20_000, { kind: 'FIRST' }],
    ['pone 20.000 pesos al primer item', 20_000, { kind: 'FIRST' }]
  ])('extracts price from %s', (message, amount, reference) => {
    expect(action(message)).toMatchObject({
      type: 'SET_ITEM_PRICE',
      reference,
      unitPrice: amount
    });
  });

  it('extracts silo capacity as description and not quantity', () => {
    expect(extractDraftItems('silo 500t 20000', 'ARS')).toEqual([
      expect.objectContaining({
        description: 'Silo 500 t',
        quantity: 1,
        unit: 'unidad',
        unitPrice: 20_000
      })
    ]);
  });

  it('does not use zero for an unknown price', () => {
    expect(extractDraftItems('Instalación de plataforma', 'ARS')[0]?.unitPrice).toBeUndefined();
  });

  it('sanitizes file names and rejects traversal', () => {
    expect(sanitizeRequestedPdfFileName('remito-mario-2307')).toEqual({
      ok: true,
      fileName: 'remito-mario-2307.pdf'
    });
    expect(sanitizeRequestedPdfFileName('../secreto')).toMatchObject({ ok: false });
    expect(sanitizeRequestedPdfFileName('carpeta\\archivo')).toMatchObject({ ok: false });
  });
});
