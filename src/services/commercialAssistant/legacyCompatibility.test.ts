import { describe, expect, it } from 'vitest';
import { detectDraftIntent, parseFollowUpDeliveryNoteForTest } from '../assistant.js';
import {
  applyCommercialDraftMutation,
  parseCommercialDraftMutation
} from '../commercialConversation.js';
import { resolveDocumentConversationMessage } from '../documentConversationResolver.js';

describe('compatibilidad de fachadas legacy', () => {
  it('does not start a new remito while confirming a named file', () => {
    expect(detectDraftIntent('guardalo como remito-mario-alvarez-2307')).toBe('none');
  });

  it('removes an explicit append prefix before legacy extraction', () => {
    expect(
      parseFollowUpDeliveryNoteForTest('agrega que caminamos sobre un techo').items
        .map((item) => item.description)
    ).toEqual(['caminamos sobre un techo']);
  });

  it('supports positional deletion and partial replacement', () => {
    const deleted = applyCommercialDraftMutation('saca el ultimo punto', [
      { lineId: 'a', description: 'Primero' },
      { lineId: 'b', description: 'Segundo' }
    ]);
    expect(deleted).toMatchObject({
      status: 'applied',
      items: [{ lineId: 'a' }]
    });
    const replaced = applyCommercialDraftMutation('Cambia 14 metros por 16 metros', [
      {
        lineId: 'line-1',
        description: 'Techado de galpón con 14 metros',
        quantity: 1,
        unitPrice: 50_000
      }
    ]);
    expect(replaced.items[0]).toMatchObject({
      lineId: 'line-1',
      description: 'Techado de galpón con 16 metros',
      quantity: 1,
      unitPrice: 50_000
    });
  });

  it('routes summary before append and accepts price without a change verb', () => {
    expect(
      resolveDocumentConversationMessage({
        message: 'resumen',
        hasActiveDraft: true
      }).action
    ).toBe('ASK_DRAFT_STATUS');
    expect(parseCommercialDraftMutation('precio del item 2 a 20000')).toMatchObject({
      kind: 'price',
      unitPrice: 20_000
    });
  });
});
