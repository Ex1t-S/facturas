import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const tx = {
    commercialDraft: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn()
    },
    commercialDraftItem: {
      deleteMany: vi.fn(),
      createMany: vi.fn()
    },
    whatsAppConversation: {
      update: vi.fn()
    }
  };
  return {
    tx,
    rootFindFirst: vi.fn(),
    transaction: vi.fn(async (work: (client: typeof tx) => unknown) => work(tx))
  };
});

vi.mock('../../db.js', () => ({
  prisma: {
    $transaction: mocks.transaction,
    commercialDraft: {
      findFirst: mocks.rootFindFirst
    }
  }
}));

import {
  CommercialDraftVersionConflictError,
  loadPersistedPendingDraft,
  persistCommercialDraftSnapshot
} from './draftRepository.js';
import type { CommercialDraft } from './types.js';
import type { PendingDeliveryDraft } from '../assistant.js';

const draft: CommercialDraft = {
  schemaVersion: 2,
  id: 'draft-1',
  conversationId: 'conversation-1',
  companyId: 'company-1',
  documentType: 'QUOTE',
  status: 'COLLECTING_PRICES',
  customerId: 'customer-1',
  customerName: 'Mario Alvarez',
  currency: 'ARS',
  items: [
    {
      lineId: 'line-1',
      position: 1,
      description: 'Instalación de plataforma',
      quantity: 1,
      unit: 'unidad'
    }
  ],
  suggestedFileName: 'presupuesto-mario.pdf',
  draftVersion: 3,
  awaiting: 'PRICES',
  createdAt: new Date('2026-07-23T16:00:00Z'),
  updatedAt: new Date('2026-07-23T16:01:00Z'),
  expiresAt: new Date('2026-07-25T16:00:00Z')
};

const pending: PendingDeliveryDraft = {
  type: 'quote',
  payload: {
    customerName: 'Mario Alvarez',
    currency: 'ARS',
    items: [{ lineId: 'line-1', description: 'Instalación de plataforma', quantity: 1 }]
  },
  suggestedFileName: 'presupuesto-mario.pdf',
  token: 'draft-1',
  previewStoragePath: '',
  previewFileName: '',
  previewMimeType: 'application/pdf',
  status: 'COLLECTING_INFORMATION',
  draftVersion: 3,
  commercialDraft: draft
};

describe('commercial draft repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tx.commercialDraft.findUnique.mockResolvedValue(null);
    mocks.tx.commercialDraft.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.commercialDraft.create.mockResolvedValue({});
    mocks.tx.commercialDraftItem.deleteMany.mockResolvedValue({ count: 1 });
    mocks.tx.commercialDraftItem.createMany.mockResolvedValue({ count: 1 });
    mocks.tx.whatsAppConversation.update.mockResolvedValue({});
  });

  it('persists normalized lines and the rollback-compatible pendingJson atomically', async () => {
    await persistCommercialDraftSnapshot({
      conversationId: 'conversation-1',
      pending,
      expectedDraftVersion: 2
    });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.tx.commercialDraft.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: 'draft-1',
        conversationId: 'conversation-1',
        draftVersion: 3,
        activeSlot: 1
      })
    });
    expect(mocks.tx.commercialDraftItem.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          draftId: 'draft-1',
          lineId: 'line-1',
          unitPrice: undefined
        })
      ]
    });
    expect(mocks.tx.whatsAppConversation.update).toHaveBeenCalledWith({
      where: { id: 'conversation-1' },
      data: { pendingJson: JSON.stringify(pending) }
    });
  });

  it('rejects a stale optimistic-lock update without replacing items', async () => {
    mocks.tx.commercialDraft.findUnique.mockResolvedValue({ draftVersion: 3 });
    mocks.tx.commercialDraft.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      persistCommercialDraftSnapshot({
        conversationId: 'conversation-1',
        pending: {
          ...pending,
          draftVersion: 4,
          commercialDraft: { ...draft, draftVersion: 4 }
        },
        expectedDraftVersion: 2
      })
    ).rejects.toBeInstanceOf(CommercialDraftVersionConflictError);
    expect(mocks.tx.commercialDraftItem.deleteMany).not.toHaveBeenCalled();
  });

  it('restores pending state from normalized persistence after a process restart', async () => {
    mocks.rootFindFirst.mockResolvedValue({ legacyPayloadJson: JSON.stringify(pending) });
    await expect(loadPersistedPendingDraft('conversation-1')).resolves.toMatchObject({
      token: 'draft-1',
      draftVersion: 3,
      commercialDraft: { status: 'COLLECTING_PRICES' }
    });
  });
});
