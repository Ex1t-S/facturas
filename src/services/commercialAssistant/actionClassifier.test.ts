import { describe, expect, it } from 'vitest';
import { classifyCommercialAction } from './actionClassifier.js';
import type { CommercialDraft } from './types.js';

const activeDraft = {
  schemaVersion: 2,
  id: 'draft-1',
  conversationId: 'conversation-1',
  companyId: 'company-1',
  documentType: 'QUOTE',
  status: 'COLLECTING_ITEMS',
  customerId: 'customer-1',
  customerName: 'Mario Alvarez',
  currency: 'ARS',
  items: [],
  suggestedFileName: 'presupuesto-mario-alvarez.pdf',
  draftVersion: 1,
  awaiting: 'ITEMS',
  createdAt: new Date('2026-07-23T12:00:00Z'),
  updatedAt: new Date('2026-07-23T12:00:00Z'),
  expiresAt: new Date('2026-07-25T12:00:00Z')
} satisfies CommercialDraft;

describe('commercial action classifier priority', () => {
  it.each([
    ['saca el ultimo punto', 'DELETE_ITEM'],
    ['saca el último', 'DELETE_ITEM'],
    ['borra el item uno', 'DELETE_ITEM'],
    ['elimina el primero', 'DELETE_ITEM'],
    ['cambia 14 metros por 16 metros', 'REPLACE_ITEM_TEXT'],
    ['al item uno ponle 20000$', 'SET_ITEM_PRICE'],
    ['precio del item 2 a 20000', 'SET_ITEM_PRICE'],
    ['pone 20 mil al segundo', 'SET_ITEM_PRICE'],
    ['resumen', 'SHOW_SUMMARY'],
    ['resumen PDF', 'GENERATE_PREVIEW'],
    ['pasame el PDF', 'GENERATE_PREVIEW'],
    ['cambia el nombre a remito-mario', 'RENAME_DRAFT'],
    ['agrega que caminamos sobre un techo', 'APPEND_ITEM']
  ])('%s -> %s', (message, expected) => {
    expect(classifyCommercialAction(message, activeDraft).type).toBe(expected);
  });

  it.each(['guardalo', 'guardalo como remito-mario-2307'])('%s confirms a current preview', (message) => {
    expect(classifyCommercialAction(message, { ...activeDraft, status: 'WAITING_CONFIRMATION' }).type).toBe(
      'CONFIRM_DOCUMENT'
    );
  });
});
