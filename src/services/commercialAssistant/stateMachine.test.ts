import { describe, expect, it } from 'vitest';
import { transitionCommercialDraft } from './stateMachine.js';
import type { CommercialAction, CommercialDraft, CommercialConversationState } from './types.js';

const now = new Date('2026-07-23T12:00:00Z');
const context = {
  companyId: 'company-1',
  conversationId: 'conversation-1',
  now,
  createId: (() => {
    let index = 0;
    return () => `id-${++index}`;
  })()
};

function draft(status: CommercialConversationState = 'COLLECTING_ITEMS'): CommercialDraft {
  return {
    schemaVersion: 2,
    id: 'draft-1',
    conversationId: 'conversation-1',
    companyId: 'company-1',
    documentType: 'QUOTE',
    status,
    customerId: 'customer-1',
    customerName: 'Mario Alvarez',
    currency: 'ARS',
    items: [
      {
        lineId: 'line-1',
        position: 1,
        description: 'Techado de galpón con 14 metros',
        quantity: 1,
        unit: 'unidad',
        unitPrice: 20_000
      }
    ],
    suggestedFileName: 'presupuesto-mario.pdf',
    draftVersion: 2,
    awaiting: status === 'WAITING_CONFIRMATION' ? 'CONFIRMATION' : 'ITEMS',
    previewVersion: status === 'WAITING_CONFIRMATION' ? 2 : undefined,
    previewStoragePath: status === 'WAITING_CONFIRMATION' ? 'preview://draft-1/2' : undefined,
    previewFileName: status === 'WAITING_CONFIRMATION' ? 'presupuesto-mario.pdf' : undefined,
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date('2026-07-25T12:00:00Z')
  };
}

function transition(current: CommercialDraft | null, action: CommercialAction) {
  return transitionCommercialDraft(current, action, {
    ...context,
    expectedDraftVersion: current?.draftVersion
  });
}

describe('commercial state machine', () => {
  it('rejects IDLE + CONFIRM_DOCUMENT', () => {
    expect(transition(null, { type: 'CONFIRM_DOCUMENT' })).toMatchObject({ ok: false, code: 'INVALID_STATE' });
  });

  it('allows COLLECTING_ITEMS + APPEND_ITEM', () => {
    const result = transition(draft(), {
      type: 'APPEND_ITEM',
      item: { description: 'Limpieza de noria' }
    });
    expect(result).toMatchObject({ ok: true, draft: { draftVersion: 3 } });
    if (result.ok) expect(result.draft.items.at(-1)?.lineId).toBeTruthy();
  });

  it('allows WAITING_CONFIRMATION + CONFIRM_DOCUMENT', () => {
    expect(transition(draft('WAITING_CONFIRMATION'), { type: 'CONFIRM_DOCUMENT' })).toMatchObject({
      ok: true,
      effects: [{ type: 'FINALIZE_DOCUMENT' }]
    });
  });

  it('invalidates a preview after editing and keeps the stable lineId', () => {
    const result = transition(draft('WAITING_CONFIRMATION'), {
      type: 'SET_ITEM_PRICE',
      reference: { kind: 'INDEX', index: 1 },
      unitPrice: 50_000
    });
    expect(result).toMatchObject({
      ok: true,
      draft: { draftVersion: 3, previewVersion: undefined, status: 'READY_FOR_PREVIEW' }
    });
    if (result.ok) expect(result.draft.items[0]).toMatchObject({ lineId: 'line-1', unitPrice: 50_000 });
  });

  it.each(['FINALIZED', 'EXPIRED'] as const)('rejects edits in %s', (status) => {
    expect(
      transition(draft(status), {
        type: 'SET_ITEM_PRICE',
        reference: { kind: 'INDEX', index: 1 },
        unitPrice: 50_000
      })
    ).toMatchObject({ ok: false, code: 'INVALID_STATE' });
  });

  it('performs a normalized partial replacement without overwriting the line', () => {
    const result = transition(draft(), {
      type: 'REPLACE_ITEM_TEXT',
      reference: { kind: 'TEXT', query: '14 metros' },
      targetText: '14 metros',
      replacementText: '16 metros'
    });
    expect(result).toMatchObject({
      ok: true,
      draft: {
        items: [
          {
            lineId: 'line-1',
            description: 'Techado de galpón con 16 metros',
            quantity: 1,
            unitPrice: 20_000
          }
        ]
      }
    });
  });

  it('detects optimistic-lock conflicts', () => {
    expect(
      transitionCommercialDraft(draft(), { type: 'SHOW_SUMMARY' }, { ...context, expectedDraftVersion: 1 })
    ).toMatchObject({ ok: false, code: 'VERSION_CONFLICT' });
  });
});
