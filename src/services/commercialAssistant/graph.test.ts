import { describe, expect, it } from 'vitest';
import { processCommercialMessageWithGraph } from './graph.js';
import type { CommercialDraft, CommercialOrchestratorAdapters } from './types.js';

const adapters: CommercialOrchestratorAdapters = {
  customers: [{ id: 'customer-1', legalName: 'Mario Alvarez' }],
  defaultCurrency: 'ARS',
  createId: () => 'draft-1',
  now: () => new Date('2026-07-23T12:00:00Z')
};

describe('commercial LangGraph orchestration', () => {
  it('runs the existing deterministic transition through a graph node', async () => {
    const result = await processCommercialMessageWithGraph({
      companyId: 'company-1',
      conversationId: 'conversation-1',
      message: 'Quiero armar un presupuesto',
      adapters
    });

    expect(result.classification.type).toBe('START_DRAFT');
    expect(result.draft?.documentType).toBe('QUOTE');
    expect(result.draft?.status).toBe('COLLECTING_CUSTOMER');
  });

  it('keeps an ambiguous message non-mutating inside the graph', async () => {
    const draft: CommercialDraft = {
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
    };
    const result = await processCommercialMessageWithGraph({
      companyId: 'company-1',
      conversationId: 'conversation-1',
      message: 'que lindo dia',
      draft,
      adapters
    });

    expect(result.classification.type).toBe('AMBIGUOUS');
    expect(result.draft?.items).toHaveLength(0);
    expect(result.draft?.draftVersion).toBe(1);
  });
});
